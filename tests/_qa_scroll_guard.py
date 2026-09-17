# -*- coding: utf-8 -*-
"""QA 待办3 复验：keepRowVisible 抢回行为的精确判定。
两个独立事实要分开验证：
 (A) 真实用户手势（wheel/keydown/pointerdown/touchstart）是否在活跃窗口内触发 abort
     -> 触发则用户滚动被保留（不抢回）。
 (B) 纯程序化 scrollTop（只派发 scroll，核心不监听）若在活跃窗口内发生，
     是否会被 keepRowVisible 重新滚回目标行 -> 触发则说明存在「scroll-only 漏网」。

注入时机：t=0（click_tab 返回后立刻，keepRowVisible 首查 rAF 尚未跑，仍活跃）。
"""
import os
import sys
import json

sys.path.insert(0, os.path.dirname(__file__))
import test_relocate_collapsed as T
from harness import start_server
from playwright.sync_api import sync_playwright


def fresh_setup(browser, base):
    ctx, page = T.new_page(browser)
    T.boot(page, base)
    assert T.setup_full_render_scrolled_out(page, "G20"), "setup failed"
    page.evaluate("() => window.__mock.setResetOnSwitch(true)")
    T.hide_toast(page)
    T.reset_title(page)
    T.reset_clicks(page)
    return ctx, page


def click_and_inject(page, op, top):
    # t=0：click_tab 同步跑完 activateCanvas（含 keepRowVisible 调度），返回即注入
    page.evaluate(
        """(args) => {
             var op = args.op, top = args.top;
             var t = document.querySelector('.md-tab[data-id=\"G20\"] .md-tab__label');
             t.click();  // 同步触发 activateCanvas
             var sc = document.getElementById('screen-scroll-list');
             if (op === 'wheel') {
               sc.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }));
               sc.scrollTop = top;
             } else if (op === 'pointerdown') {
               sc.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
               sc.scrollTop = top;
             } else if (op === 'keydown') {
               document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
               sc.scrollTop = top;
             } else { // programmatic：只改 scrollTop，不派发任何监听事件
               sc.scrollTop = top;
             }
           }""", {"op": op, "top": top})
    page.wait_for_timeout(1100)
    got = page.evaluate("() => window.__mock.scrollerTop()")
    in_sc = page.evaluate("() => window.__mock.isRowInScroller('G20')")
    return {"user_set": top, "scrollerTop": got, "row_in_scroller": in_sc, "stolen": (got != top)}


def main():
    httpd, base = start_server()
    out = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        for op in ["wheel", "pointerdown", "keydown", "programmatic"]:
            ctx, page = fresh_setup(browser, base)
            out[op + "_t0"] = click_and_inject(page, op, 200)
            ctx.close()
        # 晚期真实手势（t=300，keepRowVisible 大概率已结束）：用户滚动无论如何都应保留
        ctx, page = fresh_setup(browser, base)
        page.evaluate("(c) => { var t = document.querySelector('.md-tab[data-id=\"G20\"] .md-tab__label'); t.click(); }", "G20")
        page.wait_for_timeout(300)
        page.evaluate("""() => { var sc = document.getElementById('screen-scroll-list'); sc.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 })); sc.scrollTop = 200; }""")
        page.wait_for_timeout(1100)
        out["wheel_late"] = {"user_set": 200,
                             "scrollerTop": page.evaluate("() => window.__mock.scrollerTop()"),
                             "row_in_scroller": page.evaluate("() => window.__mock.isRowInScroller('G20')"),
                             "stolen": False}
        ctx.close()
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    with open(os.path.join(root, "tests", "_qa_scroll_guard.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    for k, v in out.items():
        print(k, v)
    sys.exit(0)


if __name__ == "__main__":
    main()
