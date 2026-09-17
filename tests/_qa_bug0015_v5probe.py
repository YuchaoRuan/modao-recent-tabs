# -*- coding: utf-8 -*-
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright
from harness import start_server

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
COLLAPSED = "tests/fixtures/mock-modao-design-collapsed.html"
INST_CORE = os.path.join(PROJECT_ROOT, "tests", "_qa_bug0015_core_inst.js")
CUR_CORE = os.path.join(PROJECT_ROOT, "recent-tabs-core.js")

def boot(page, base, fixture, core_path, carrier="ext"):
    print("[probe] goto %s" % fixture, flush=True)
    page.goto(base + "/" + fixture, wait_until="load")
    print("[probe] goto done", flush=True)
    page.evaluate("() => { try{localStorage.clear();}catch(e){} }")
    print("[probe] localStorage cleared", flush=True)
    src = PROJECT_ROOT if carrier == "ext" else os.path.join(PROJECT_ROOT, "desktop")
    page.add_style_tag(path=os.path.join(src, "tabbar.css"))
    page.add_script_tag(path=os.path.join(src, "tabbar.js"))
    print("[probe] tabbar.css/js injected", flush=True)
    with open(core_path, encoding="utf-8") as f:
        page.add_script_tag(content=f.read())
    print("[probe] core injected (%d bytes)" % os.path.getsize(core_path), flush=True)
    page.evaluate(
        """() => {
            window.chrome = window.chrome || {
              runtime: { onMessage: { addListener: function (fn) { window.__mdMsgListener = fn; } }, lastError: null }
            };
            window.__ctrl = MDRecentTabs.create({ enableMessageListener: true });
        }""")
    print("[probe] MDRecentTabs.create done", flush=True)
    page.wait_for_selector(".md-recent-tabs", state="attached", timeout=20000)
    print("[probe] tabbar attached", flush=True)

def main():
    httpd, base = start_server()
    print("[probe] server %s" % base, flush=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        ctx, page = browser.new_context(), None
        page = ctx.new_page()
        page.on("pageerror", lambda e: print("[probe PAGEERROR]", e, flush=True))
        page.on("console", lambda m: print("[probe CONSOLE]", m.type, m.text[:200], flush=True))
        try:
            for label, core in [("INST", INST_CORE), ("CUR", CUR_CORE)]:
                print("===== boot with %s core =====" % label, flush=True)
                boot(page, base, COLLAPSED, core)
                print("[probe] folded=%s inDom(G05)=%s" % (
                    page.evaluate("() => window.__mock.isGroupOpen()"),
                    page.evaluate("() => window.__mock.inDom('G05')")), flush=True)
                print("[probe] __qa_diag type=%s" % page.evaluate("() => typeof window.__qa_diag"), flush=True)
        except Exception as e:
            print("[probe] EXCEPTION: %r" % e, flush=True)
        ctx.close()
        browser.close()
    print("[probe] DONE", flush=True)

if __name__ == "__main__":
    main()
