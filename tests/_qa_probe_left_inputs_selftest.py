# -*- coding: utf-8 -*-
"""探针自验：在「带搜索框」夹具上跑 scripts/probe-left-inputs.min.js，
确认脚本可执行、无 pageerror、关键 JSON 字段齐全且类型正确、版本指纹可读。

仅为交付前自检，不是回归用例。输出直接写 _probe_left_inputs_selftest.txt
（脚本内重定向，不依赖 shell 重定向：本环境 PowerShell 对原生命令的 stdout
重定向不可靠）。

覆盖要点：
  - coreVersion 必须可读且 == 1.0.18（否则结论作废，这是版本指纹闸）；
  - searchLike / placeholderTop300 / topInputs / contentEditables /
    allCandidateBoxes / leftPanelProbe 各字段存在且类型正确；
  - 在「带搜索框」夹具上，搜索框能被 searchLike 命中（keyHitField=placeholder）、
    进入 placeholderTop300、并满足 allCandidateBoxes 的 top<300 & 宽>40 条件；
  - leftPanelProbe：夹具本身无 #screen-scroll-list，自检里注入一个以覆盖该分支。
"""
import os
import sys
import json
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(HERE, ".."))
LOG_PATH = os.path.join(PROJECT_ROOT, "_probe_left_inputs_selftest.txt")

_log = open(LOG_PATH, "w", encoding="utf-8", buffering=1)
sys.stdout = _log
sys.stderr = _log

sys.path.insert(0, HERE)
from playwright.sync_api import sync_playwright  # noqa: E402
from harness import start_server, new_page  # noqa: E402

FIXTURE = os.path.join(HERE, "fixtures", "mock-modao-design-search.html")
PROBE_MIN = os.path.join(PROJECT_ROOT, "scripts", "probe-left-inputs.min.js")
CID = "SEARCHCID"

EXPECTED_KEYS = {
    "tag", "type", "placeholder", "width", "height", "top", "left",
    "visible", "ancestorChain", "keyHitField",
}
LEFT_KEYS = {"node", "overflowY", "top", "height"}


def boot(page, base):
    page.goto(base + "/workspace", wait_until="load")
    page.evaluate("() => { localStorage.clear(); }")
    with open(FIXTURE, encoding="utf-8") as f:
        page.set_content(f.read())
    page.evaluate("(c) => history.replaceState({}, '', '/proto/design/' + c)", CID)
    page.add_style_tag(path=os.path.join(PROJECT_ROOT, "tabbar.css"))
    page.add_script_tag(path=os.path.join(PROJECT_ROOT, "tabbar.js"))
    with open(os.path.join(PROJECT_ROOT, "recent-tabs-core.js"), encoding="utf-8") as f:
        page.add_script_tag(content=f.read())
    page.evaluate(
        """() => {
            window.chrome = window.chrome || {
              runtime: { onMessage: { addListener: function (fn) {} }, lastError: null }
            };
            window.__ctrl = MDRecentTabs.create({ enableMessageListener: true });
        }"""
    )
    page.wait_for_selector(".md-recent-tabs", state="attached")


def main():
    print("START")
    errs = []
    fails = 0

    httpd, base = start_server()
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(headless=True, args=["--no-sandbox"])
            print("chromium launched")
            ctx, page = new_page(b)
            page.on("pageerror", lambda e: errs.append("PAGEERROR: %s" % e))
            boot(page, base)
            print("fixture booted")

            # 夹具本身无 #screen-scroll-list：注入一个覆盖 leftPanelProbe 分支
            page.evaluate(
                """() => {
                    if (!document.getElementById('screen-scroll-list')) {
                      var d = document.createElement('div');
                      d.id = 'screen-scroll-list';
                      d.className = 'rn-content-body scrollbar2-container';
                      d.style.position = 'absolute';
                      d.style.top = '120px';
                      d.style.height = '400px';
                      document.body.appendChild(d);
                    }
                }"""
            )

            min_src = open(PROBE_MIN, encoding="utf-8").read()
            print("min bytes = %d" % len(min_src))

            after = page.evaluate(min_src)
            print("")
            print("--- probe-left-inputs 输出 ---")
            print(json.dumps(after, ensure_ascii=False, indent=1))

            def fields_ok(items):
                if not isinstance(items, list):
                    return False
                for it in items:
                    if not isinstance(it, dict):
                        return False
                    if not EXPECTED_KEYS.issubset(set(it.keys())):
                        return False
                    if not isinstance(it.get("ancestorChain"), list):
                        return False
                    if not isinstance(it.get("visible"), bool):
                        return False
                return True

            sl = after.get("searchLike") or []
            pl = after.get("placeholderTop300") or []
            ti = after.get("topInputs") or []
            ce = after.get("contentEditables") or []
            ac = after.get("allCandidateBoxes") or []
            lp = after.get("leftPanelProbe")

            checks = [
                ("脚本可执行且返回对象", isinstance(after, dict)),
                ("coreVersion 可读且 == 1.0.18", after.get("coreVersion") == "1.0.18"),
                ("versionMatchesExpected == True", after.get("versionMatchesExpected") is True),
                ("total 为 int 且 >= 1", isinstance(after.get("total"), int) and (after.get("total") or 0) >= 1),
                ("searchLike 为 list 且非空", isinstance(sl, list) and len(sl) >= 1),
                ("searchLike 每项标准字段齐全且类型正确", fields_ok(sl)),
                ("searchLike 命中字段为 placeholder（夹具以 placeholder 命中）",
                 any((it.get("keyHitField") == "placeholder") for it in sl)),
                ("placeholderTop300 含 '关键字搜索…'（top<300 暴露关键词写法）",
                 "关键字搜索…" in pl),
                ("topInputs 为 list 且 1<=len<=15", isinstance(ti, list) and 1 <= len(ti) <= 15),
                ("topInputs 每项标准字段齐全", fields_ok(ti)),
                ("contentEditables 为 list", isinstance(ce, list)),
                ("allCandidateBoxes 为 list 且非空", isinstance(ac, list) and len(ac) >= 1),
                ("allCandidateBoxes 某项 placeholder 含 搜索（无关键词过滤也命中）",
                 any("搜索" in (it.get("placeholder") or "") for it in ac)),
                ("allCandidateBoxes 都满足 top<300 & 宽>40（分支已筛选）",
                 all(((it.get("top") or 999) < 300 and (it.get("width") or 0) > 40) for it in ac)),
                ("leftPanelProbe 为 list 且非空（已注入 #screen-scroll-list）",
                 isinstance(lp, list) and len(lp) >= 1),
                ("leftPanelProbe 首项 node 含 screen-scroll-list",
                 bool(lp) and "screen-scroll-list" in (lp[0].get("node") or "")),
                ("leftPanelProbe 每项含 node/overflowY/top/height 且 top/height 为 number",
                 isinstance(lp, list) and all(
                     (LEFT_KEYS.issubset(set(x.keys()))
                      and isinstance(x.get("top"), int) and isinstance(x.get("height"), int))
                     for x in lp)),
                ("无 pageerror", len(errs) == 0),
            ]
            print("")
            print("--- 探针自检判定 ---")
            for name, ok in checks:
                print("  [%s] %s" % ("PASS" if ok else "FAIL", name))
                if not ok:
                    fails += 1
            print("  -> %d/%d passed" % (len(checks) - fails, len(checks)))
            if errs:
                print("  pageerrors: %s" % errs)

            ctx.close()
            b.close()
    finally:
        httpd.shutdown()
    print("DONE fails=%d" % fails)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
    finally:
        _log.flush()
        _log.close()
