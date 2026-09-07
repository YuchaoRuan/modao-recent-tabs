# -*- coding: utf-8 -*-
"""Faithful headless repro of options-page -> content-script position message.

Copy the extension to a temp dir with content_scripts matches + host_permissions
broadened to <all_urls>, serve a minimal fake 墨刀 design page on localhost (so the content
script auto-injects and registers its MD_SET_TABBAR_POSITION listener), open the real options
page, click "应用位置", then check (a) the options-page status text and (b) the fake page's
localStorage['md_tabbar_position'] + bar top style.
"""
import os, sys, shutil, tempfile, threading, json
from http.server import BaseHTTPRequestHandler, HTTPServer
from playwright.sync_api import sync_playwright

PROJ = os.path.abspath(os.path.dirname(__file__))
SRC = os.path.join(PROJ, "release", "modao-recent-tabs-browser")
CHROME = r"C:\Users\15020\AppData\Local\ms-playwright\chromium-1234\chrome-win64\chrome.exe"

FAKE_HTML = """<!doctype html><html><head><meta charset=utf-8><title>fake modao</title></head>
<body>
<header style="position:relative;top:0;height:48px;width:100%">TOOLBAR</header>
<div class="app-shell" style="position:relative">
  <div class="screen-container" style="position:absolute;top:48px;height:600px;width:100%">CANVAS</div>
</div>
</body></html>"""

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(FAKE_HTML.encode("utf-8"))
    def log_message(self, *a):
        pass

def main():
    tmp = tempfile.mkdtemp(prefix="md_ext_")
    ext = os.path.join(tmp, "ext")
    shutil.copytree(SRC, ext)
    mp = os.path.join(ext, "manifest.json")
    m = json.load(open(mp, encoding="utf-8"))
    m["content_scripts"][0]["matches"] = ["<all_urls>"]
    m["host_permissions"] = ["<all_urls>"]
    json.dump(m, open(mp, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    httpd = HTTPServer(("127.0.0.1", 0), H)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % port

    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=CHROME, headless=True,
            args=["--headless=new", "--no-sandbox", "--disable-gpu",
                  "--load-extension=" + ext.replace("\\", "/"), "--disable-dev-shm-usage"],
        )
        cdp = browser.new_browser_cdp_session()
        cdp.send("Target.setDiscoverTargets", {"discover": True})
        infos = cdp.send("Target.getTargets")["targetInfos"]
        ext_id = None
        for tg in infos:
            u = tg.get("url", "")
            if u.startswith("chrome-extension://"):
                ext_id = u.split("chrome-extension://")[1].split("/")[0]
                break
        print("EXT_ID:", ext_id)

        ctx = browser.new_context()
        errors = []
        # 1) fake 墨刀 page -> content script auto-injects
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append("MODAO:" + str(e)))
        page.goto(base + "/proto/design/TESTCID", wait_until="load")
        page.wait_for_timeout(1500)
        injected = page.evaluate("() => !!document.getElementById('md-recent-tabs-root')")
        print("CONTENT INJECTED:", injected)

        # 2) options page -> click 应用位置 (above)
        opt = ctx.new_page()
        opt.on("pageerror", lambda e: errors.append("OPTS:" + str(e)))
        opt.goto("chrome-extension://%s/options.html" % ext_id, wait_until="load")
        opt.wait_for_selector("#applyPosition", timeout=8000)
        opt.select_option("#tabbarPosition", "above")
        opt.click("#applyPosition")
        opt.wait_for_timeout(1200)
        status = opt.evaluate("document.getElementById('status').textContent")
        print("OPTIONS_STATUS:", repr(status))

        # 3) back to fake page -> did position apply?
        page.wait_for_timeout(800)
        applied = page.evaluate("""() => {
            var root = document.getElementById('md-recent-tabs-root');
            var bar = root && root.firstChild;
            return {
                ls: localStorage.getItem('md_tabbar_position'),
                barTop: bar ? (bar.style.top || '(unset)') : '(no bar)'
            };
        }""")
        print("FAKE_PAGE_APPLIED:", applied)
        print("ERRORS:", errors[:15])
        browser.close()
    httpd.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)

if __name__ == "__main__":
    main()
