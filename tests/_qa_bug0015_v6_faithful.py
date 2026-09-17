# -*- coding: utf-8 -*-
"""
QA-BUG0015 V6 忠实复现：每个历史核心配同时代的 tabbar.js/css（解决 bar.setPosition 缺失导致的启动不兼容），
在 ?rows=980 夹具上点 P71 标签，断言出现「未找到画布」（漏扫缝隙复现）。
用于把 V6 从「2 个可启动核心 live 复现 + v1.0.13 源码等价」升级为「3/3 全部 live 复现」。
"""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright
from harness import start_server

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
VIRTUAL = "tests/fixtures/mock-modao-design-virtual.html"

SETS = {
    "v1.0.13": ("tests/_qa_old_v1.0.13.js", "tests/_qa_old_v1013_tabbar.js", "tests/_qa_old_v1013_tabbar.css"),
    "v1.0.16": ("tests/_qa_old_v1.0.16.js", "tests/_qa_old_v1016_tabbar.js", "tests/_qa_old_v1013_tabbar.css"),
    "5f08557": ("tests/_qa_old_5f08557.js", "tests/_qa_old_5f08557_tabbar.js", "tests/_qa_old_v1013_tabbar.css"),
}
TARGET = "P71"

def boot(page, base, core_path, tab_js, tab_css):
    page.goto(base + "/" + VIRTUAL + "?rows=980", wait_until="load")
    page.evaluate("() => { try{localStorage.clear();}catch(e){} }")
    page.add_style_tag(path=os.path.join(PROJECT_ROOT, tab_css))
    page.add_script_tag(path=os.path.join(PROJECT_ROOT, tab_js))
    with open(os.path.join(PROJECT_ROOT, core_path), encoding="utf-8") as f:
        page.add_script_tag(content=f.read())
    page.evaluate(
        """() => {
            window.chrome = window.chrome || {
              runtime: { onMessage: { addListener: function (fn) { window.__mdMsgListener = fn; } }, lastError: null }
            };
            window.__ctrl = MDRecentTabs.create({ enableMessageListener: true });
        }""")
    page.wait_for_selector(".md-recent-tabs", state="attached", timeout=20000)

def tab_ids(page):
    return page.evaluate("() => Array.from(document.querySelectorAll('.md-tab')).map(e => e.getAttribute('data-id'))")

def build_tab(page, cid):
    page.evaluate("(c) => window.__mock.scrollToCid(c)", cid)
    page.wait_for_timeout(120)
    page.evaluate("(c) => window.__mock.scrollToCid(c)", cid)
    page.wait_for_timeout(80)
    if not page.evaluate("(c) => window.__mock.inDom(c)", cid):
        return False
    page.evaluate(
        """(cid) => {
            window.__mock.scrollToCid(cid); window.__mock.render();
            var el = document.querySelector('.rn-list-item[data-cid=\"' + cid + '\"]');
            if (!el) throw new Error('left item not in DOM: ' + cid);
            el.click();
        }""", cid)
    page.wait_for_timeout(250)
    return cid in tab_ids(page)

def click_tab(page, tid):
    page.evaluate(
        """(id) => {
            var t = document.querySelector('.md-tab[data-id=\"' + id + '\"] .md-tab__label');
            if (!t) throw new Error('tab not found: ' + id);
            t.click();
        }""", tid)

def toast_text(page):
    return page.evaluate("() => { var e = document.querySelector('.md-recent-tabs__toast-text'); return e ? e.textContent : ''; }")

def main():
    httpd, base = start_server()
    print("server", base, flush=True)
    results = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        for ref, (core, tjs, tcss) in SETS.items():
            print("===== %s =====" % ref, flush=True)
            ctx = browser.new_context()
            page = ctx.new_page()
            try:
                boot(page, base, core, tjs, tcss)
                ok = build_tab(page, TARGET)
                print("  build_tab(%s)=%s" % (TARGET, ok), flush=True)
                page.evaluate("() => { var v=document.querySelector('.rn-virtual'); v.scrollTop=0; window.__mock.render(); }")
                page.wait_for_timeout(150)
                click_tab(page, TARGET)
                toast = ""
                waited = 0
                while waited < 15000:
                    tx = toast_text(page)
                    if tx:
                        toast = tx; break
                    page.wait_for_timeout(100); waited += 100
                reproduced = "未找到画布" in toast
                print("  toast=%r reproduced=%s" % (toast, reproduced), flush=True)
                results[ref] = {"boot": True, "built": ok, "reproduced": reproduced, "toast": toast}
            except Exception as e:
                print("  EXCEPTION: %r" % e, flush=True)
                results[ref] = {"boot": False, "error": repr(e)}
            finally:
                try: ctx.close()
                except Exception: pass
        try: browser.close()
        except Exception: pass
    # 总结
    print("\n=== V6 忠实复现总结 ===", flush=True)
    allok = True
    for ref, r in results.items():
        boot_ok = r.get("boot")
        repro = r.get("reproduced")
        ok = bool(boot_ok and repro)
        allok = allok and ok
        print("  %-8s boot=%s reproduced_leak=%s -> %s" % (ref, boot_ok, repro, "OK" if ok else "FAIL"))
    print("  V6 结论: %s" % ("三个历史核心均 live 复现漏扫缝隙" if allok else "见上（部分未复现/启动失败）"), flush=True)
    import os as _os
    _os._exit(0)

if __name__ == "__main__":
    main()
