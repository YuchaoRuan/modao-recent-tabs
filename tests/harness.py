# -*- coding: utf-8 -*-
"""
tests/harness.py — 共享测试基础设施
- 本地静态服务器：以项目根目录为根，/proto/design/<cid> 与未知路径均返回模拟墨刀页；
  真实资源（tabbar.js / tabbar.css / desktop/index.html 等）按路径静态提供。
- inject_and_create：注入真实源码并调用 MDRecentTabs.create（等价于 content.js 入口）。
- Tester：轻量 PASS/FAIL 收集器，输出结构化汇总。
"""
import os
import sys
import json
import threading
import http.server
import socketserver
import urllib.parse
from playwright.sync_api import sync_playwright

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "mock-modao-design.html")
ARTIFACTS = os.path.join(os.path.dirname(__file__), "artifacts")


class _Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=PROJECT_ROOT, **k)

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path.startswith("/proto/design/"):
            self._serve(FIXTURE, "text/html; charset=utf-8")
            return
        rel = path.lstrip("/")
        full = os.path.realpath(os.path.join(PROJECT_ROOT, rel))
        if (
            os.path.isfile(full)
            and os.path.commonpath([PROJECT_ROOT, full]) == PROJECT_ROOT
        ):
            return super().do_GET()
        # 未知路径（如 /workspace）→ 返回模拟页，使 cid 为空，验证标签栏隐藏
        self._serve(FIXTURE, "text/html; charset=utf-8")

    def _serve(self, fp, ctype):
        try:
            with open(fp, "rb") as f:
                data = f.read()
        except OSError:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass


def start_server():
    httpd = socketserver.TCPServer(("127.0.0.1", 0), _Handler)
    port = httpd.server_address[1]
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd, f"http://127.0.0.1:{port}"


def inject_and_create(page, cid, history, active_cid=None, canvas_title=None, display_mode=None):
    """写入 localStorage 历史、设定激活项、注入源码并创建控制器。
    history 支持：
      - None:  不写 localStorage（用于前置手工写值的用例）
      - str:   rbpVRNr<base62> 真实格式，写入非 JSON 字符串
      - list:  兼容旧的 JSON 数组（最新在前），按数组整体写入
    """
    active_js = (
        'document.querySelector(\'[data-cid="%s"]\').classList.add("is-active");'
        % active_cid
        if active_cid
        else ""
    )
    title_js = (
        'var __ct=document.querySelector(".canvas-title"); if(__ct) __ct.textContent="%s";'
        % canvas_title
        if canvas_title
        else ""
    )
    if history is None:
        set_js = "// history=None: 保持前置写入不变"
    elif isinstance(history, str):
        # 真实格式：单值字符串，**不二次 JSON 化**
        raw_js = "%s" % json.dumps(history)
        set_js = "var KEY='screen-history-onLeave-project-%s'; localStorage.setItem(KEY, %s);" % (cid, raw_js)
    else:
        # 旧版 JSON 数组兼容路径
        set_js = "var KEY='screen-history-onLeave-project-%s'; localStorage.setItem(KEY, JSON.stringify(%s));" % (
            cid, json.dumps(history),
        )
    dm_js = ('localStorage.setItem(\'md_display_mode\', %s);' % json.dumps(display_mode)) if display_mode else ""
    page.evaluate(
        """
        (function(){
          %s
          localStorage.removeItem('md_display_mode');
          %s
          document.querySelectorAll('.rn-list-item').forEach(function(e){ e.classList.remove('is-active'); });
          %s
          %s
        })();
        """
        % (set_js, dm_js, active_js, title_js)
    )
    # 给左侧画布项挂点击计数，用于校验「点标签→模拟点击左侧项」
    page.evaluate(
        """
        window.__clicks = {};
        document.querySelectorAll('.rn-list-item[data-cid]').forEach(function(el){
          el.addEventListener('click', function(){
            var id = el.getAttribute('data-cid');
            window.__clicks[id] = (window.__clicks[id]||0) + 1;
          });
        });
        """
    )
    page.add_style_tag(path=os.path.join(PROJECT_ROOT, "tabbar.css"))
    page.add_script_tag(path=os.path.join(PROJECT_ROOT, "tabbar.js"))
    page.add_script_tag(path=os.path.join(PROJECT_ROOT, "recent-tabs-core.js"))
    page.evaluate(
        """
        window.chrome = window.chrome || {
          runtime: { onMessage: { addListener: function(fn){ window.__mdMsgListener = fn; } }, lastError: null }
        };
        window.__ctrl = MDRecentTabs.create({ enableMessageListener: true });
        """
    )


class Tester:
    def __init__(self, name):
        self.name = name
        self.results = []

    def check(self, cond, msg):
        self.results.append(("PASS" if cond else "FAIL", msg))
        return cond

    def eq(self, got, exp, msg):
        return self.check(got == exp, "%s (got=%r, exp=%r)" % (msg, got, exp))

    def summary(self):
        print("\n=== %s ===" % self.name)
        for s, m in self.results:
            print("  [%s] %s" % (s, m))
        fails = sum(1 for s, _ in self.results if s == "FAIL")
        print("  -> %d/%d passed" % (len(self.results) - fails, len(self.results)))
        return fails


def new_page(browser):
    """创建隔离 context + page，并转发页面 JS 错误到 stdout（便于定位测试失败根因）。"""
    ctx = browser.new_context()
    page = ctx.new_page()
    page.on("pageerror", lambda e: print("  [PAGEERROR]", e))
    page.on("console", lambda m: print("  [CONSOLE:%s]" % m.type, m.text)
             if m.type in ("error", "warning") else None)
    return ctx, page


def screenshot(page, name):
    os.makedirs(ARTIFACTS, exist_ok=True)
    path = os.path.join(ARTIFACTS, name + ".png")
    try:
        page.screenshot(path=path, full_page=True)
        return path
    except Exception:
        return None
