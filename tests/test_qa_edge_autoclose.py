# -*- coding: utf-8 -*-
"""
tests/test_qa_edge_autoclose.py — QA（严过关）独立边界回归验证

与工程师自测的区别：
  - 使用 QA 自写夹具 tests/fixtures/mock-modao-design-qa.html（200 页虚拟滚动，
    支持真正删除画布 / 切换 li.rn-content-item 形态），不复用工程师夹具，避免"夹具即结论"。
  - 关键场景一律使用**真实鼠标事件**（page.mouse）而非 JS .click()。
  - 覆盖工程师未覆盖的错误路径与竞态。

场景：
  E1 虚拟滚动下真实鼠标点击视口外标签 → 标签不消失 + 完成切换
  E2 画布确实已删除 → 清理路径仍可达（无永久死标签）
  E3 快速连点：A 需扫描 / B 立即可见 → B 的结果不被 A 的扫描覆盖（revealToken 竞态）
  E4 标签数 > max(20) → 保留最近的一批
  E5 点标签主体时 mousedown/mouseup 跨渲染 → click 不被吞、不误关
  E6 × 起笔保护（含合成事件级验证）+ 真实鼠标点击 × 仍能关闭
  E7 destroy() 后无残留（DOM / 定时器 / document 监听 / MutationObserver）+ 可重新 create
  E8 浏览器扩展载体 vs 桌面载体行为一致

已知缺陷锁定（当前必然 FAIL，等待工程师修复后应转为 PASS）：
  E3  —— 竞态：先点需扫描的标签、再点立即可见的标签，前者扫描完成后会覆盖后者
         （recent-tabs-core.js:293-311 onSwitch 未在立即命中分支递增 revealToken）
  E9  —— 列表末尾（最后一屏）画布扫描不到，点标签始终无法切换
         （recent-tabs-core.js:171/176-177 扫描位置序列从未访问 maxTop）
这两个用例是缺陷的可执行证据，修复前请勿改为宽松断言。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
from harness import start_server, Tester, screenshot, new_page

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "mock-modao-design-qa.html")
CID = "QACID"


# ------------------------------------------------------------------ 基础设施
def instrument(page):
    """在注入业务代码前挂钩，统计 document 监听 / interval / timeout / MutationObserver。"""
    page.evaluate(
        """() => {
            window.__qa = { docListeners: 0, intervals: [], timeouts: [], moAlive: [] };
            var addEL = EventTarget.prototype.addEventListener;
            var rmEL = EventTarget.prototype.removeEventListener;
            EventTarget.prototype.addEventListener = function (type, fn, opts) {
              if (this === document) window.__qa.docListeners++;
              return addEL.apply(this, arguments);
            };
            EventTarget.prototype.removeEventListener = function (type, fn, opts) {
              if (this === document) window.__qa.docListeners--;
              return rmEL.apply(this, arguments);
            };
            var si = window.setInterval, ci = window.clearInterval;
            window.setInterval = function () {
              var id = si.apply(window, arguments);
              window.__qa.intervals.push(id);
              return id;
            };
            window.clearInterval = function (id) {
              var i = window.__qa.intervals.indexOf(id);
              if (i >= 0) window.__qa.intervals.splice(i, 1);
              return ci.apply(window, arguments);
            };
            var st = window.setTimeout, ct = window.clearTimeout;
            window.setTimeout = function (fn, ms) {
              var id, args = Array.prototype.slice.call(arguments, 2);
              var wrapped = function () {
                var i = window.__qa.timeouts.indexOf(id);
                if (i >= 0) window.__qa.timeouts.splice(i, 1);
                if (typeof fn === 'function') fn.apply(null, args);
              };
              id = st.call(window, wrapped, ms);
              window.__qa.timeouts.push(id);
              return id;
            };
            window.clearTimeout = function (id) {
              var i = window.__qa.timeouts.indexOf(id);
              if (i >= 0) window.__qa.timeouts.splice(i, 1);
              return ct.apply(window, arguments);
            };
            var MO = window.MutationObserver;
            if (MO) {
              var ob = MO.prototype.observe, dc = MO.prototype.disconnect;
              MO.prototype.observe = function () {
                if (window.__qa.moAlive.indexOf(this) < 0) window.__qa.moAlive.push(this);
                return ob.apply(this, arguments);
              };
              MO.prototype.disconnect = function () {
                var i = window.__qa.moAlive.indexOf(this);
                if (i >= 0) window.__qa.moAlive.splice(i, 1);
                return dc.apply(this, arguments);
              };
            }
        }"""
    )


def boot_qa(page, base, carrier="ext", instrumented=False, entry=True):
    """carrier: 'ext'=浏览器扩展（content.js）/ 'desktop'=桌面注入（bootstrap.js）
    entry=False 时不注入入口脚本（供资源计数用例先取基线再自行 create）。"""
    page.goto(base + "/workspace", wait_until="load")
    page.evaluate("() => { localStorage.clear(); }")
    with open(FIXTURE, encoding="utf-8") as f:
        html = f.read()
    page.set_content(html)
    page.evaluate("(cid) => history.replaceState({}, '', '/proto/design/' + cid)", CID)
    if instrumented:
        instrument(page)
    src = PROJECT_ROOT if carrier == "ext" else os.path.join(PROJECT_ROOT, "desktop")
    page.add_style_tag(path=os.path.join(src, "tabbar.css"))
    page.add_script_tag(path=os.path.join(src, "tabbar.js"))
    page.add_script_tag(path=os.path.join(src, "recent-tabs-core.js"))
    entry_name = "content.js" if carrier == "ext" else "recent-tabs-bootstrap.js"
    page.evaluate(
        """() => {
            window.chrome = window.chrome || {
              runtime: { onMessage: { addListener: function (fn) { window.__mdMsgListener = fn; } },
                         lastError: null }
            };
        }"""
    )
    if entry:
        page.add_script_tag(path=os.path.join(src, entry_name))
        page.wait_for_selector(".md-recent-tabs", state="attached")


def tab_ids(page):
    return page.evaluate(
        "() => Array.from(document.querySelectorAll('.md-tab')).map(e => e.getAttribute('data-id'))"
    )


def active_tab(page):
    return page.evaluate(
        "() => { var e = document.querySelector('.md-tab.is-active'); return e ? e.getAttribute('data-id') : null; }"
    )


def click_left(page, cid):
    page.evaluate(
        """(cid) => {
            window.__mock.scrollToCid(cid);
            window.__mock.render();
            var el = document.querySelector('#rn-virtual [data-cid="' + cid + '"]');
            if (!el) throw new Error('left item not in DOM: ' + cid);
            el.click();
            return true;
        }""",
        cid,
    )
    page.wait_for_timeout(35)


def box_of(page, cid, part):
    sel = '.md-tab[data-id="%s"] .md-tab__%s' % (cid, part)
    return page.evaluate(
        """(sel) => { var e = document.querySelector(sel);
             if (!e) throw new Error('no element: ' + sel);
             var r = e.getBoundingClientRect();
             return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; }""",
        sel,
    )


def real_click_tab(page, cid):
    """真实鼠标点击标签主体（move → down → up）。"""
    b = box_of(page, cid, "label")
    page.mouse.click(b["x"], b["y"])


def clicks_of(page, cid):
    return page.evaluate("(c) => (window.__mock.getClicks()[c] || 0)", cid)


def title_of(page):
    return page.evaluate("() => window.__mock.title()")


def toast_state(page):
    return page.evaluate(
        """() => { var el = document.querySelector('.md-recent-tabs__toast');
             var tx = document.querySelector('.md-recent-tabs__toast-text');
             return { visible: !!el && el.classList.contains('is-visible'),
                      text: tx ? tx.textContent : '' }; }"""
    )


def is_stale(page, cid):
    return page.evaluate(
        '(c) => !!document.querySelector(\'.md-tab[data-id="\' + c + \'"][data-stale]\')', cid
    )


# ------------------------------------------------------------------ E1
def test_e1_real_mouse_virtual_scroll(browser, base):
    t = Tester("E1 真实鼠标点击（画布在虚拟滚动视口外）→ 标签不消失 + 完成切换")
    ctx, page = new_page(browser)
    try:
        boot_qa(page, base)
        for cid in ["P001", "P002", "P003"]:
            click_left(page, cid)
        # 滚到远处，使 P001 不在 DOM
        page.evaluate("() => { window.__mock.scrollToCid('P100'); window.__mock.render(); }")
        page.wait_for_timeout(150)

        before = tab_ids(page)
        t.check("P001" in before, "前置：P001 标签存在 (%s)" % before)
        t.check(page.evaluate("() => window.__mock.inDom('P001')") is False,
                "前置：P001 左侧项不在 DOM（虚拟滚动未渲染）")

        c_before = clicks_of(page, "P001")
        real_click_tab(page, "P001")          # 真实鼠标
        page.wait_for_timeout(900)            # 等滚动扫描（最多 ~600ms）

        after = tab_ids(page)
        t.check("P001" in after, "真实鼠标点击后 P001 标签仍在 (after=%s)" % after)
        t.eq(len(after), len(before), "标签总数不变")
        c_after = clicks_of(page, "P001")
        t.check(c_after > c_before,
                "左侧画布项被真实点击 → 完成切换 (clicks %d → %d)" % (c_before, c_after))
        t.eq(title_of(page), "页面 1", "画布标题切到「页面 1」")
        t.eq(active_tab(page), "P001", "P001 变为激活态")
        t.check(not is_stale(page, "P001"), "定位成功后待定标记已清除")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "qa_e1")
    finally:
        ctx.close()
    return t


# ------------------------------------------------------------------ E2
def test_e2_genuine_delete_cleanup(browser, base):
    t = Tester("E2 画布确实已删除 → 清理路径仍可达（不留永久死标签）")
    ctx, page = new_page(browser)
    try:
        boot_qa(page, base)
        click_left(page, "P007")
        page.wait_for_timeout(120)
        t.check("P007" in tab_ids(page), "前置：P007 标签存在")

        removed = page.evaluate("() => window.__mock.remove('P007')")
        t.check(removed is True, "已真正删除画布 P007（数据源移除）")
        page.wait_for_timeout(150)
        t.check(page.evaluate("() => window.__mock.inDom('P007')") is False,
                "删除后 P007 左侧项确实不存在")

        # 点该标签 → 定位失败：保留标签 + 可见提示（不静默删除，设计如此）
        real_click_tab(page, "P007")
        page.wait_for_timeout(900)
        t.check("P007" in tab_ids(page), "删除的画布标签未被静默删除（保留待用户处置）")
        t.check(is_stale(page, "P007"), "被标记为待定(stale)")
        ts = toast_state(page)
        t.check(ts["visible"], "给出可见提示 toast")
        t.check("未找到画布" in ts["text"], "提示文案说明原因: %r" % ts["text"])

        # 清理路径 1：手动 × 关闭
        b = box_of(page, "P007", "close")
        page.mouse.click(b["x"], b["y"])
        page.wait_for_timeout(300)
        t.check("P007" not in tab_ids(page), "手动 × 可关闭已删除画布的标签 (tabs=%s)" % tab_ids(page))

        # 清理路径 2：重载/重建后不复活（无永久死标签）
        page.evaluate("() => window.__mdRecentTabs.destroy()")
        page.wait_for_timeout(120)
        page.evaluate("() => { window.__mdRecentTabs = window.MDRecentTabs.create({}); }")
        page.wait_for_timeout(300)
        t.check("P007" not in tab_ids(page),
                "重建后已删除画布未复活为死标签 (tabs=%s)" % tab_ids(page))
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "qa_e2")
    finally:
        ctx.close()
    return t


# ------------------------------------------------------------------ E3
def test_e3_race_reveal_token(browser, base):
    """A=P150（不在 DOM，需约 290ms 滚动扫描且**可被找到**），B=P002（立即命中）。
    点 A 后立刻点 B：A 的扫描结果不得覆盖 B。"""
    t = Tester("E3 快速连点竞态（A 需扫描 / B 立即可见）→ B 的结果不被 A 覆盖")
    ctx, page = new_page(browser)
    try:
        boot_qa(page, base)
        click_left(page, "P002")
        click_left(page, "P150")
        page.evaluate("() => { window.__mock.scrollToCid('P005'); window.__mock.render(); }")
        page.wait_for_timeout(150)

        t.check(page.evaluate("() => window.__mock.inDom('P150')") is False,
                "前置：P150 不在 DOM（点击需滚动扫描）")
        t.check(page.evaluate("() => window.__mock.inDom('P002')") is True,
                "前置：P002 在 DOM（点击立即命中）")

        before = tab_ids(page)
        t.check("P150" in before and "P002" in before, "前置：两个标签都在 (%s)" % before)

        # 先点 P150（启动扫描，约 290ms 后才定位到），立刻点 P002（立即命中）
        real_click_tab(page, "P150")
        b2 = box_of(page, "P002", "label")
        page.mouse.click(b2["x"], b2["y"])
        page.wait_for_timeout(60)
        # 中间态：证明 B 的点击确实生效了（不是没点中）
        t.eq(title_of(page), "页面 2", "中间态：B(P002) 的点击已生效")
        t.eq(active_tab(page), "P002", "中间态：B 已激活")

        page.wait_for_timeout(1500)          # 等 A 的扫描彻底跑完
        final_title = title_of(page)
        final_active = active_tab(page)
        after = tab_ids(page)
        t.eq(final_title, "页面 2", "最终画布仍应为最后点击的 P002，不被 A 的扫描覆盖")
        t.eq(final_active, "P002", "最终激活标签应为 P002")
        t.eq(len(after), len(before), "标签总数不变（无丢失）")
        t.eq(len(set(after)), len(after), "无重复标签")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "qa_e3")
    finally:
        ctx.close()
    return t


def test_e3b_scan_works_alone(browser, base):
    t = Tester("E3b 对照：只点 P150（无打断）→ 扫描应能定位并切换")
    ctx, page = new_page(browser)
    try:
        boot_qa(page, base)
        click_left(page, "P150")
        click_left(page, "P002")
        page.evaluate("() => { window.__mock.scrollToCid('P005'); window.__mock.render(); }")
        page.wait_for_timeout(150)
        real_click_tab(page, "P150")
        page.wait_for_timeout(1500)
        t.eq(title_of(page), "页面 150", "未被打断时 P150 扫描定位成功并完成切换")
        t.eq(active_tab(page), "P150", "P150 激活")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "qa_e3b")
    finally:
        ctx.close()
    return t


def test_e3c_race_both_need_scan(browser, base):
    t = Tester("E3c 连点两个都需扫描的标签 → 先点者被取消，不误切换")
    ctx, page = new_page(browser)
    try:
        boot_qa(page, base)
        click_left(page, "P100")
        click_left(page, "P150")
        page.evaluate("() => { window.__mock.scrollToCid('P005'); window.__mock.render(); }")
        page.wait_for_timeout(150)
        before = tab_ids(page)
        c100_before = clicks_of(page, "P100")
        real_click_tab(page, "P100")
        b = box_of(page, "P150", "label")
        page.mouse.click(b["x"], b["y"])
        page.wait_for_timeout(1600)
        after = tab_ids(page)
        t.eq(len(after), len(before), "标签总数不变 (%s)" % after)
        t.eq(len(set(after)), len(after), "无重复标签")
        t.eq(clicks_of(page, "P100"), c100_before,
             "先点的 P100 被 revealToken 取消，未发生误切换")
        t.eq(title_of(page), "页面 150", "最后点击的 P150 完成切换")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "qa_e3c")
    finally:
        ctx.close()
    return t


def test_e9_tail_of_list_unreachable(browser, base):
    """已知缺陷锁定：列表末尾（最后一屏）的画布，滚动扫描覆盖不到 → 点标签仍无法切换。

    根因：recent-tabs-core.js:171 的 `pos > maxTop` 在**滚动到 pos 之前**判定，
    且 pos 以 step(0.75*clientHeight) 递增，最后一个可达位置 maxTop 从未被访问，
    导致列表尾部若干行在整个扫描过程中从未被渲染 → findCanvasEl 永远为 null。
    """
    t = Tester("E9（已知缺陷）列表末尾画布点标签应能切换")
    ctx, page = new_page(browser)
    try:
        boot_qa(page, base)
        click_left(page, "P200")
        click_left(page, "P002")
        page.evaluate("() => { window.__mock.scrollToCid('P005'); window.__mock.render(); }")
        page.wait_for_timeout(150)
        t.check(page.evaluate("() => window.__mock.inDom('P200')") is False,
                "前置：P200 不在 DOM（列表末尾）")

        # 手动滚到底 → P200 确实存在且可渲染（证明不是夹具没有这行）
        page.evaluate("() => { var v = document.getElementById('rn-virtual');"
                      " v.scrollTop = v.scrollHeight; window.__mock.render(); }")
        t.check(page.evaluate("() => window.__mock.inDom('P200')") is True,
                "对照：手动滚到底后 P200 在 DOM 中（画布确实存在）")
        page.evaluate("() => { window.__mock.scrollToCid('P005'); window.__mock.render(); }")
        page.wait_for_timeout(150)

        real_click_tab(page, "P200")
        page.wait_for_timeout(1500)
        t.eq(title_of(page), "页面 200", "点末尾画布标签应能滚动定位并切换")
        t.eq(active_tab(page), "P200", "P200 应变为激活态")
        t.check(not is_stale(page, "P200"), "不应停留在待定态")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "qa_e9")
    finally:
        ctx.close()
    return t


# ------------------------------------------------------------------ E4
def test_e4_over_max(browser, base):
    t = Tester("E4 标签数 > max(20) → 保留最近的一批，淘汰最旧的")
    ctx, page = new_page(browser)
    try:
        boot_qa(page, base)
        for i in range(1, 26):
            click_left(page, "P%03d" % i)
        page.wait_for_timeout(300)
        tabs = tab_ids(page)
        t.eq(len(tabs), 20, "截断到 max=20 (got=%d)" % len(tabs))
        expect = ["P%03d" % i for i in range(25, 5, -1)]   # P025..P006（最近在前）
        t.eq(tabs, expect, "保留最近 20 个且按最近排序 (got=%s)" % tabs)
        oldest = ["P%03d" % i for i in range(1, 6)]
        t.check(all(o not in tabs for o in oldest), "最旧的 P001..P005 被淘汰")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "qa_e4")
    finally:
        ctx.close()
    return t


# ------------------------------------------------------------------ E5
def test_e5_click_across_rerender(browser, base):
    t = Tester("E5 点标签主体时 mousedown/mouseup 跨渲染 → click 生效且不误关")
    ctx, page = new_page(browser)
    try:
        boot_qa(page, base)
        for cid in ["P001", "P002", "P003"]:
            click_left(page, cid)
        page.wait_for_timeout(150)
        n0 = len(tab_ids(page))
        t.eq(n0, 3, "前置：3 个标签 (%s)" % tab_ids(page))

        b = box_of(page, "P003", "label")
        c_before = clicks_of(page, "P003")
        page.mouse.move(b["x"], b["y"])
        page.mouse.down()
        page.evaluate("() => window.__mdRecentTabs.refresh()")   # 强制重渲染
        page.mouse.up()
        page.wait_for_timeout(400)
        c_after = clicks_of(page, "P003")
        t.check(c_after > c_before, "跨渲染后 click 未被吞掉（切换生效）(%d → %d)" % (c_before, c_after))
        t.eq(len(tab_ids(page)), n0, "未误关标签 (tabs=%s)" % tab_ids(page))
        t.eq(active_tab(page), "P003", "P003 激活态正确")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "qa_e5")
    finally:
        ctx.close()
    return t


# ------------------------------------------------------------------ E6
def test_e6_close_guard(browser, base):
    t = Tester("E6 × 起笔保护（合成事件级）+ 真实点击 × 仍可关闭")
    ctx, page = new_page(browser)
    try:
        boot_qa(page, base)
        for cid in ["P001", "P002", "P003"]:
            click_left(page, cid)
        page.wait_for_timeout(150)
        n0 = len(tab_ids(page))
        t.eq(n0, 3, "前置：3 个标签")

        # (a) 起笔在标签主体、click 却落在 × 上 → 必须忽略
        page.evaluate(
            """() => {
                var tab = document.querySelector('.md-tab[data-id="P002"]');
                var label = tab.querySelector('.md-tab__label');
                var close = tab.querySelector('.md-tab__close');
                label.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
                close.click();
            }"""
        )
        page.wait_for_timeout(300)
        t.check("P002" in tab_ids(page),
                "起笔在主体 + click 落在 × → 未误关 (tabs=%s)" % tab_ids(page))

        # (b) 起笔确实在 × 上 → 允许关闭（合成事件）
        page.evaluate(
            """() => {
                var tab = document.querySelector('.md-tab[data-id="P002"]');
                var close = tab.querySelector('.md-tab__close');
                close.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
                close.click();
            }"""
        )
        page.wait_for_timeout(300)
        t.check("P002" not in tab_ids(page),
                "起笔在 × 上 → 正常关闭 (tabs=%s)" % tab_ids(page))
        t.eq(len(tab_ids(page)), n0 - 1, "标签数减 1")

        # (c) 真实鼠标点击 × → 仍必须能关闭（防误关不得挡住正常关闭）
        b = box_of(page, "P001", "close")
        page.mouse.click(b["x"], b["y"])
        page.wait_for_timeout(300)
        t.check("P001" not in tab_ids(page),
                "真实鼠标点击 × → 正常关闭 (tabs=%s)" % tab_ids(page))
        t.eq(len(tab_ids(page)), n0 - 2, "标签数再减 1")

        # (d) 真实鼠标：起笔主体 → 滑到 × 抬起 → 不关闭
        remain = tab_ids(page)
        cid = remain[0]
        lb = box_of(page, cid, "label")
        cb = box_of(page, cid, "close")
        n_before = len(tab_ids(page))
        page.mouse.move(lb["x"], lb["y"])
        page.mouse.down()
        page.mouse.move(cb["x"], cb["y"])
        page.mouse.up()
        page.wait_for_timeout(300)
        t.eq(len(tab_ids(page)), n_before,
             "起笔主体→滑到 × 抬起 → 未误关 (tabs=%s)" % tab_ids(page))
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "qa_e6")
    finally:
        ctx.close()
    return t


# ------------------------------------------------------------------ E7
def test_e7_destroy_clean(browser, base):
    t = Tester("E7 destroy() 后无残留（DOM / 定时器 / document 监听 / MO）")
    ctx, page = new_page(browser)
    try:
        # entry=False：先注入源码但不创建实例，取到干净基线后再自行 create，
        # 避免把 Playwright 自身（wait_for_selector 等）创建的 MutationObserver 算进来。
        boot_qa(page, base, instrumented=True, entry=False)
        snap = "() => ({ doc: window.__qa.docListeners, iv: window.__qa.intervals.length, " \
               " to: window.__qa.timeouts.length, mo: window.__qa.moAlive.length })"
        base_counts = page.evaluate(snap)
        t.eq(base_counts["doc"], 0, "基线：create 前无 document 监听")
        t.eq(base_counts["iv"], 0, "基线：create 前无 interval")
        # 注：Playwright 自身（add_script_tag / 选择器轮询）可能已创建 MutationObserver，
        # 故基线不断言 0，改为断言「create 恰好新增 1 个、destroy 后回到基线」。
        t.eq(base_counts["mo"], base_counts["mo"], "基线已记录 MutationObserver 数 = %d（含测试框架自有）"
             % base_counts["mo"])

        page.evaluate("() => { window.__mdRecentTabs = window.MDRecentTabs.create({}); }")
        page.wait_for_timeout(200)
        for cid in ["P001", "P002"]:
            click_left(page, cid)
        page.wait_for_timeout(150)

        made = page.evaluate(snap)
        t.check(made["doc"] >= 3, "创建后 document 监听已注册 (%d)" % made["doc"])
        t.check(made["iv"] >= 1, "创建后 2s 轮询 interval 已启动 (%d)" % made["iv"])
        t.eq(made["mo"], base_counts["mo"] + 1, "创建后恰好新增 1 个 MutationObserver")

        # 记录下推副作用是否存在（fixed 模式会下推内容）
        pushed_before = page.evaluate(
            "() => { var e = document.querySelector('.rn-canvas'); return e.style.marginTop; }"
        )
        t.check(pushed_before == "44px", "destroy 前内容容器已下推 (marginTop=%r)" % pushed_before)

        page.evaluate("() => window.__mdRecentTabs.destroy()")
        page.wait_for_timeout(400)   # 等待已排队 timer 全部结算

        after = page.evaluate(snap)
        t.eq(after["doc"], base_counts["doc"], "destroy 后 document 监听全部移除")
        t.eq(after["iv"], base_counts["iv"], "destroy 后 interval 全部清除")
        t.eq(after["mo"], base_counts["mo"], "destroy 后 MutationObserver 全部 disconnect")
        t.eq(after["to"], base_counts["to"], "destroy 后无遗留 pending timeout (%d)" % after["to"])

        t.check(page.evaluate("() => !document.getElementById('md-recent-tabs-root')"),
                "根节点已移除")
        t.check(page.evaluate("() => !document.getElementById('md-recent-tabs-offset')"),
                "offset <style> 已移除")
        t.check(page.evaluate("() => !document.querySelector('.md-recent-tabs-hotspot')"),
                "浮动热点已移除")
        t.eq(page.evaluate("() => document.querySelector('.rn-canvas').style.marginTop"), "",
             "内容容器下推已还原")
        t.eq(page.evaluate("() => document.querySelector('.app-header').style.marginTop"), "",
             "工具栏下沉已还原")
        t.eq(page.evaluate("() => getComputedStyle(document.body).paddingTop"), "0px",
             "body padding-top 已还原")

        # 可重新 create
        page.evaluate("() => { window.__mdRecentTabs = window.MDRecentTabs.create({}); }")
        page.wait_for_timeout(300)
        t.eq(page.eval_on_selector_all("#md-recent-tabs-root", "els => els.length"), 1,
             "destroy 后可重新 create 且仅 1 个根节点")
        t.check(page.evaluate("() => !!document.querySelector('.md-recent-tabs')"),
                "重新 create 后标签栏渲染正常")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "qa_e7")
    finally:
        ctx.close()
    return t


# ------------------------------------------------------------------ E8
def _carrier_probe(page, base, carrier):
    """在指定载体下完成同一组交互，返回可比对的状态快照。"""
    boot_qa(page, base, carrier=carrier)
    for cid in ["P001", "P002", "P003"]:
        click_left(page, cid)
    page.wait_for_timeout(150)
    snap = {
        "tabs": tab_ids(page),
        "active": active_tab(page),
        "title": title_of(page),
        "hasRoot": page.evaluate("() => !!document.getElementById('md-recent-tabs-root')"),
        "msgListener": page.evaluate("() => !!window.__mdMsgListener"),
        "brandText": page.text_content(".md-recent-tabs__brand"),
    }
    # 点一个不在 DOM 里的标签（P050）→ 两个载体行为应一致
    page.evaluate("() => { window.__mock.scrollToCid('P050'); window.__mock.render(); }")
    click_left(page, "P050")
    page.evaluate("() => { window.__mock.scrollToCid('P005'); window.__mock.render(); }")
    page.wait_for_timeout(150)
    real_click_tab(page, "P050")
    page.wait_for_timeout(900)
    snap["afterTitle"] = title_of(page)
    snap["afterTabs"] = tab_ids(page)
    snap["stale"] = is_stale(page, "P050")
    snap["toast"] = toast_state(page)["visible"]
    # × 关闭
    b = box_of(page, "P050", "close")
    page.mouse.click(b["x"], b["y"])
    page.wait_for_timeout(300)
    snap["afterClose"] = tab_ids(page)
    return snap


def test_e8_carrier_parity(browser, base):
    t = Tester("E8 浏览器扩展载体 vs 桌面载体行为一致")
    ctx1, p1 = new_page(browser)
    ctx2, p2 = new_page(browser)
    try:
        ext = _carrier_probe(p1, base, "ext")
        desk = _carrier_probe(p2, base, "desktop")

        t.check(ext["hasRoot"] and desk["hasRoot"], "两个载体均成功挂载标签栏")
        t.eq(ext["tabs"], desk["tabs"], "初始标签集合一致 (ext=%s, desktop=%s)"
             % (ext["tabs"], desk["tabs"]))
        t.eq(ext["active"], desk["active"], "初始激活标签一致")
        t.eq(ext["title"], desk["title"], "画布标题一致")
        t.eq(ext["afterTitle"], desk["afterTitle"],
             "点击视口外标签后切换结果一致 (ext=%r, desktop=%r)" % (ext["afterTitle"], desk["afterTitle"]))
        t.eq(ext["afterTabs"], desk["afterTabs"], "切换后标签集合一致")
        t.eq(ext["stale"], desk["stale"], "待定标记行为一致")
        t.eq(ext["toast"], desk["toast"], "定位失败提示行为一致")
        t.eq(ext["afterClose"], desk["afterClose"], "× 关闭行为一致")
        # 已知且应为有意差异：仅扩展侧启用扩展消息监听
        t.eq(ext["msgListener"], True, "扩展侧注册了 chrome.runtime.onMessage 监听")
        t.eq(desk["msgListener"], False, "桌面侧未注册扩展消息监听（设计如此，非缺陷）")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(p1, "qa_e8_ext")
        screenshot(p2, "qa_e8_desktop")
    finally:
        ctx1.close()
        ctx2.close()
    return t


def main():
    httpd, base = start_server()
    total_fails = 0
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
            total_fails += test_e1_real_mouse_virtual_scroll(browser, base).summary()
            total_fails += test_e2_genuine_delete_cleanup(browser, base).summary()
            total_fails += test_e3_race_reveal_token(browser, base).summary()
            total_fails += test_e3b_scan_works_alone(browser, base).summary()
            total_fails += test_e3c_race_both_need_scan(browser, base).summary()
            total_fails += test_e9_tail_of_list_unreachable(browser, base).summary()
            total_fails += test_e4_over_max(browser, base).summary()
            total_fails += test_e5_click_across_rerender(browser, base).summary()
            total_fails += test_e6_close_guard(browser, base).summary()
            total_fails += test_e7_destroy_clean(browser, base).summary()
            total_fails += test_e8_carrier_parity(browser, base).summary()
            print("\n==== QA 边界验证总计：%d 失败 ====" % total_fails)
            os._exit(1 if total_fails else 0)
    except Exception:
        import traceback
        traceback.print_exc()
        os._exit(1)


if __name__ == "__main__":
    main()
