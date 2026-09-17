# -*- coding: utf-8 -*-
"""QA 独立探针：在**不加载扩展核心**的前提下直接驱动折叠夹具，
证明 (a) 全量渲染开关确实建模了「行仍在渲染树、只是被 overflow 裁掉」的真机形态；
     (b) 复位开关确实把 scroller.scrollTop 打到 0 并重建行；
     (c) 记录「滚动条拖拽 / 键盘 PageDown / 程序化滚动 / 惯性」各自会派发哪些事件，
         用以判断核心 keepRowVisible 的 4 个解绑监听是否存在漏网路径。
本脚本不 import harness 的注入逻辑（harness 会加载核心），只用原始 __mock API。
"""
import os
import sys
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(HERE, "fixtures", "mock-modao-design-collapsed.html")

results = []


def chk(cond, msg):
    s = "PASS" if cond else "FAIL"
    results.append((s, msg))
    print("  [%s] %s" % (s, msg), flush=True)
    return cond


def main():
    print("QA_FIXTURE_PROBE START", flush=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        ctx = browser.new_context()
        page = ctx.new_page()
        page.on("pageerror", lambda e: print("  [PAGEERROR]", e))
        with open(FIXTURE, encoding="utf-8") as f:
            page.set_content(f.read())
        page.wait_for_function("() => !!window.__mock")

        # ---------- A. 虚拟渲染 vs 全量渲染：滚出可视区的行是否还在渲染树 ----------
        page.evaluate("() => window.__mock.setGroupOpen(true)")
        page.evaluate("() => window.__mock.setFullRender(false)")
        page.wait_for_timeout(80)
        chk(page.evaluate("() => window.__mock.isFullRender()") is False,
            "[A1] setFullRender(false) 生效 (isFullRender=False)")
        page.evaluate("() => { document.getElementById('screen-scroll-list').scrollTop = 0; }")
        page.evaluate("() => window.__mock.render()")
        page.wait_for_timeout(80)
        in_dom_virt = page.evaluate("() => window.__mock.inDom('G30')")
        chk(in_dom_virt is False,
            "[A2] 虚拟渲染：滚出视口的 G30 不在 DOM (inDom=%r)" % in_dom_virt)

        page.evaluate("() => window.__mock.setFullRender(true)")
        page.wait_for_timeout(80)
        # 全量渲染下把 G30 滚出可视区
        page.evaluate("() => { document.getElementById('screen-scroll-list').scrollTop = 0; }")
        page.wait_for_timeout(80)
        full = page.evaluate(
            """() => {
                 var row = document.querySelector('[data-qa="canvas-G30"]');
                 var sc = document.getElementById('screen-scroll-list');
                 var rr = row ? row.getBoundingClientRect() : null;
                 var cr = sc.getBoundingClientRect();
                 return {
                   inDom: !!row,
                   rectCount: row ? row.getClientRects().length : 0,
                   rowTop: rr ? rr.top : null,
                   rowBottom: rr ? rr.bottom : null,
                   scTop: cr.top, scBottom: cr.bottom,
                   scrollTop: sc.scrollTop
                 };
               }"""
        )
        chk(full["inDom"] is True, "[A3] 全量渲染：G30 滚出可视区后**仍在 DOM**")
        chk(full["rectCount"] > 0,
            "[A4] 全量渲染：滚出可视区的 G30 仍有布局盒 getClientRects()>0 (=%d) —— 真机形态被建模"
            % full["rectCount"])
        chk(not page.evaluate("() => window.__mock.isRowInScroller('G30')"),
            "[A5] 全量渲染：G30 不在 scroller 可视矩形内 (isRowInScroller=False)")
        box_out = full["rowBottom"] is not None and full["rowBottom"] <= full["scBottom"]
        chk(not box_out,
            "[A6] G30 行盒确实落在可视区外 (rowBottom=%r <= scBottom=%r)"
            % (full["rowBottom"], full["scBottom"]))

        # ---------- B. 复位开关：切换后 scrollTop 归零 + 重建行 ----------
        page.evaluate("() => window.__mock.setResetOnSwitch(true)")
        chk(page.evaluate("() => window.__mock.isResetOnSwitch()") is True,
            "[B1] setResetOnSwitch(true) 生效 (isResetOnSwitch=True)")
        page.evaluate("() => { document.getElementById('screen-scroll-list').scrollTop = 300; }")
        page.wait_for_timeout(60)
        before = page.evaluate("() => window.__mock.scrollerTop()")
        # 点画布列的分组标题行之外的一个真画布行 → 触发切换（夹具 click 监听）
        page.evaluate(
            """() => {
                 var row = document.querySelector('[data-qa="canvas-G10"] > div.rn-list-item');
                 row.click();
               }"""
        )
        page.wait_for_timeout(60)
        after = page.evaluate("() => window.__mock.scrollerTop()")
        chk(before != 0 and after == 0,
            "[B2] 复位开关开启时切换画布 → scrollTop 被归零 (before=%r, after=%r)" % (before, after))

        # ---------- C. 事件派发路径侦察（决定 keepRowVisible 是否漏网） ----------
        page.evaluate("() => window.__mock.setResetOnSwitch(false)")
        page.evaluate("() => window.__mock.setGroupOpen(true)")
        page.evaluate("() => window.__mock.setFullRender(true)")
        page.wait_for_timeout(80)
        page.evaluate(
            """() => {
                 window.__ev = {};
                 var bump = function (n) { window.__ev[n] = (window.__ev[n] || 0) + 1; };
                 var sc = document.getElementById('screen-scroll-list');
                 ['wheel','keydown','pointerdown','touchstart','scroll','mousedown'].forEach(function (n) {
                   document.addEventListener(n, function () { bump('doc:' + n); }, true);
                   sc.addEventListener(n, function () { bump('sc:' + n); }, true);
                 });
                 window.__resetEv = function () { window.__ev = {}; };
                 window.__sc = sc;
               }"""
        )

        # C1 程序化滚动（模拟 scrollbar 拖拽/惯性的纯 scroll 结果）
        page.evaluate("() => { window.__resetEv(); window.__sc.scrollTop = 150; }")
        page.wait_for_timeout(60)
        ev_prog = page.evaluate("() => Object.assign({}, window.__ev)")
        chk(bool(ev_prog.get("sc:scroll") or ev_prog.get("doc:scroll")),
            "[C1] 程序化 scrollTop 只产生 scroll 事件 (ev=%s)" % ev_prog)
        chk(not any(k in ev_prog for k in ("sc:wheel", "doc:wheel", "sc:keydown", "doc:keydown",
                                           "sc:pointerdown", "doc:pointerdown",
                                           "sc:touchstart", "doc:touchstart")),
            "[C1b] 程序化滚动**不**派发 wheel/keydown/pointerdown/touchstart (ev=%s)" % ev_prog)

        # C2 键盘 PageDown（模拟键盘滚动）
        page.evaluate(
            """() => {
                 window.__resetEv();
                 var sc = window.__sc;
                 sc.setAttribute('tabindex', '-1'); sc.focus();
                 sc.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'PageDown' }));
               }"""
        )
        page.wait_for_timeout(40)
        ev_key = page.evaluate("() => Object.assign({}, window.__ev)")
        chk(any("keydown" in k for k in ev_key),
            "[C2] 键盘 PageDown 会派发 keydown（被核心监听） (ev=%s)" % ev_key)

        # C3 真实鼠标拖拽滚动条（关键：拖动滚动条是否派发 pointerdown？）
        page.evaluate("() => { window.__resetEv(); window.__sc.scrollTop = 0; }")
        page.wait_for_timeout(60)
        bbox = page.evaluate(
            """() => { var r = window.__sc.getBoundingClientRect();
                       return {x: r.x, y: r.y, w: r.width, h: r.height}; }"""
        )
        x = bbox["x"] + bbox["w"] - 4   # 贴近右边滚动条
        page.mouse.move(x, bbox["y"] + 120)
        page.mouse.down()
        page.mouse.move(x, bbox["y"] + 240, steps=8)
        page.mouse.move(x, bbox["y"] + 300, steps=8)
        page.mouse.up()
        page.wait_for_timeout(80)
        ev_drag = page.evaluate("() => Object.assign({}, window.__ev)")
        chk(any("pointerdown" in k for k in ev_drag) or any("mousedown" in k for k in ev_drag),
            "[C3] 鼠标拖拽滚动条是否派发 pointerdown/mousedown（供判断漏网） (ev=%s)" % ev_drag)

        # C4 trackpad 惯性：连续 wheel 事件
        page.evaluate("() => { window.__resetEv(); }")
        page.evaluate(
            """() => {
                 var sc = window.__sc;
                 for (var i = 0; i < 5; i++) {
                   sc.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 40 }));
                 }
               }"""
        )
        page.wait_for_timeout(40)
        ev_wheel = page.evaluate("() => Object.assign({}, window.__ev)")
        chk(any("wheel" in k for k in ev_wheel),
            "[C4] 惯性/滚轮会派发 wheel（被核心监听） (ev=%s)" % ev_wheel)

        fails = sum(1 for s, _ in results if s == "FAIL")
        print("  -> %d/%d passed" % (len(results) - fails, len(results)), flush=True)
        os._exit(1 if fails else 0)


if __name__ == "__main__":
    try:
        main()
    except BaseException:
        import traceback
        traceback.print_exc()
        os._exit(2)
