# -*- coding: utf-8 -*-
"""探针自验：在 collapsed 夹具上跑 scripts/probe-locate-scroll.min.js，
确认脚本可执行、无 pageerror、关键字段齐全（尤其 scroller 能被找到）。

仅为交付前自检，不是回归用例。输出直接写 _probe_selftest.txt（脚本内重定向，
不依赖 shell 重定向：本环境 PowerShell 对原生命令的 stdout 重定向不可靠）。
"""
import json
import os
import sys
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(HERE, ".."))
LOG_PATH = os.path.join(PROJECT_ROOT, "_probe_selftest.txt")

_log = open(LOG_PATH, "w", encoding="utf-8", buffering=1)
sys.stdout = _log
sys.stderr = _log

sys.path.insert(0, HERE)
from playwright.sync_api import sync_playwright  # noqa: E402
from harness import start_server, new_page  # noqa: E402

FIXTURE = os.path.join(HERE, "fixtures", "mock-modao-design-collapsed.html")
PROBE_MIN = os.path.join(PROJECT_ROOT, "scripts", "probe-locate-scroll.min.js")
PROBE_SRC_JS = os.path.join(PROJECT_ROOT, "scripts", "probe-locate-scroll.js")
PROBE_TABROWS_MIN = os.path.join(PROJECT_ROOT, "scripts", "probe-tab-rows.min.js")
CID = "FOLDCID"


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


def build_tab(page, cid):
    """在「未被 sortable 包住 + 分组展开」态点左栏行建标签，再回到真机态。"""
    page.evaluate("() => window.__mock.setWrapped(false)")
    page.evaluate("() => window.__mock.setGroupOpen(true)")
    ok = page.evaluate("(c) => window.__mock.scrollToCid(c)", cid)
    page.wait_for_timeout(150)
    if not ok:
        return False
    page.click('[data-qa="canvas-%s"] > div.rn-list-item' % cid)
    page.wait_for_timeout(300)
    page.evaluate("() => window.__mock.setWrapped(true)")
    return page.evaluate(
        "(c) => Array.from(document.querySelectorAll('.md-tab'))"
        ".some(function(e){ return e.getAttribute('data-id') === c; })",
        cid,
    )


def click_tab(page, cid):
    page.evaluate(
        """(id) => {
            var t = document.querySelector('.md-tab[data-id="' + id + '"] .md-tab__label');
            if (!t) { throw new Error('tab not found: ' + id); }
            t.click();
        }""",
        cid,
    )


def main():
    print("START")
    errs = []
    checks = []
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

            rows = page.evaluate("() => window.__mock.rows().map(function(r){ return r.cid; })")
            print("fixture rows    = %s" % rows)
            print("mock api keys   = %s" % page.evaluate("() => Object.keys(window.__mock).sort()"))

            page.evaluate(
                "() => { window.__mock.setFullRender(true);"
                " window.__mock.setResetOnSwitch(true);"
                " window.__mock.setMoldeActive(false); }"
            )
            print("isFullRender    = %s" % page.evaluate("() => window.__mock.isFullRender()"))
            print("isResetOnSwitch = %s" % page.evaluate("() => window.__mock.isResetOnSwitch()"))
            print("isMoldeActive   = %s" % page.evaluate("() => window.__mock.isMoldeActive()"))

            target = rows[-1]
            built = build_tab(page, target)
            print("")
            print("target cid      = %s   tab built = %s" % (target, built))

            min_src = open(PROBE_MIN, encoding="utf-8").read()
            src_src = open(PROBE_SRC_JS, encoding="utf-8").read()
            print("min bytes       = %d   readable bytes = %d" % (len(min_src), len(src_src)))

            before = page.evaluate(min_src)
            print("")
            print("--- A. 点击前 ---")
            print(json.dumps(before, ensure_ascii=False, indent=1))

            click_tab(page, target)
            page.wait_for_timeout(1200)
            after = page.evaluate(min_src)
            print("")
            print("--- B. 点击后（等 1.2s 让 keepRowVisible 复查跑完）---")
            print(json.dumps(after, ensure_ascii=False, indent=1))

            tgt = after.get("target") or {}

            # --- probe-tab-rows：标签栏每个标签的 cid 在左栏有没有对应的行 ---
            tr_src = open(PROBE_TABROWS_MIN, encoding="utf-8").read()
            tr = page.evaluate(tr_src)
            print("")
            print("--- C. probe-tab-rows ---")
            print(json.dumps(tr, ensure_ascii=False, indent=1))
            tr_tabs = tr.get("tabs") or []

            checks = [
                ("脚本可执行且返回对象", isinstance(after, dict)),
                ("coreVersionAttr 存在", bool(after.get("coreVersionAttr"))),
                ("expectedVersion = 1.0.18", after.get("expectedVersion") == "1.0.18"),
                ("versionMatchesExpected", after.get("versionMatchesExpected") is True),
                ("scroller 非空（找到滚动宿主）", after.get("scroller") is not None),
                ("canvasRowCount > 0", (after.get("canvasRowCount") or 0) > 0),
                ("target 非空（按 data-id 找到行）", after.get("target") is not None),
                ("target.inScroller = True", bool(tgt.get("inScroller"))),
                ("target.inCanvasAnchor = True", bool(tgt.get("inCanvasAnchor"))),
                ("selectedStateSource == 'ours'（已关掉墨刀激活类，故应由我方提供）",
                 after.get("selectedStateSource") == "ours"),
                ("markerCount == 1", after.get("markerCount") == 1),
                ("locatedStyleTagCount == 1", after.get("locatedStyleTagCount") == 1),
                ("tab-rows 探针可执行且返回对象", isinstance(tr, dict)),
                ("tab-rows: tabCount > 0", (tr.get("tabCount") or 0) > 0),
                ("tab-rows: 每个 tab 的 hitTotal > 0",
                 bool(tr_tabs) and all((t.get("hitTotal") or 0) > 0 for t in tr_tabs)),
                ("tab-rows: 至少一个命中节点在画布列",
                 any(h.get("inCanvas") for t in tr_tabs for h in (t.get("hits") or []))),
                ("tab-rows: 至少一个 tab 的 nameMatches 非空",
                 any(t.get("nameMatches") for t in tr_tabs)),
                ("tab-rows: 输出 searchBox / collapsedToggleCount 字段",
                 "searchBox" in tr and "collapsedToggleCount" in tr),
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
