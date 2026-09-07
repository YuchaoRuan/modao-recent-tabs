# -*- coding: utf-8 -*-
"""
tests/test_qa_v1013_edge.py — QA（严过关）对 v1.0.13「搜索框自动重定位」的独立边界回归

与工程师自测（test_relocate_search.py R1-R5）的关系：
  - 不复用同一批交互脚本，独立从零构造；关键场景用**真实鼠标事件**（page.mouse）
    而非 JS .click()，验证底层事件链（mousedown/mouseup/click → onSwitch）。
  - 重点补强竞态与边界：命中分支竞态、双需定位连点、定位成功后不还原原词语义
    （需求调整 2026-09-07）、fallback 还原（失败路径仍还原原词）、destroy 时在飞
    locate 轮询无残留、双载体一致、命中路径无副作用。

场景（Q1-Q7）：
  Q1 命中分支竞态（最关键）：搜索态点 A（需 locateCanvas 清空定位，轮询在飞）
     → 150ms 内真实鼠标再点「立即命中」的 B → 最终必须停在 B；
     A 的异步轮询不得把画面切回 A。直接检验 onSwitch 入口统一 revealToken++ 是否仍在。
  Q2 成功不还原语义：原搜索词 W 非空，点被过滤的标签定位成功 → 搜索框**保持清空**
     （W 不自动回来）、stale 标记清除、列表保持全量（真实鼠标）。
  Q3 连点两个都需定位的标签（A、B 均不在 DOM）→ 停在最后点的 B，A 不误切换。
  Q4 目标名写入搜索框仍找不到（原搜索词非空 + 画布已删除）→ fallback：
     标签保持 stale + toast + 搜索框被清回原值（失败路径仍还原）。
  Q5 destroy 时在飞 locate 轮询无残留：删除画布 → 点标签触发 locate（2s 预算在飞）
     → destroy → 无遗留 setTimeout/interval、document 监听归零、可重新 create。
  Q6 双载体一致：扩展载体（content.js）vs 桌面载体（recent-tabs-bootstrap.js）
     在搜索态点被过滤标签的定位行为一致。
  Q7 命中即切换路径不回归：非搜索态真实鼠标点标签 → 直接切换，搜索框/列表无副作用。

夹具：tests/fixtures/mock-modao-design-search.html
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
from harness import start_server, Tester, screenshot, new_page

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "mock-modao-design-search.html")
CID = "SCID"


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


def boot(page, base, carrier="ext", entry=True):
    """加载搜索夹具 + 注入真实源码。carrier='ext' 用 content.js，'desktop' 用 bootstrap.js。
    entry=False 时不注入入口脚本（供资源计数用例先取基线再自行 create）。"""
    page.goto(base + "/workspace", wait_until="load")
    page.evaluate("() => { localStorage.clear(); }")
    with open(FIXTURE, encoding="utf-8") as f:
        html = f.read()
    page.set_content(html)
    page.evaluate("(cid) => history.replaceState({}, '', '/proto/design/' + cid)", CID)
    src = PROJECT_ROOT if carrier == "ext" else os.path.join(PROJECT_ROOT, "desktop")
    page.add_style_tag(path=os.path.join(src, "tabbar.css"))
    page.add_script_tag(path=os.path.join(src, "tabbar.js"))
    page.add_script_tag(path=os.path.join(src, "recent-tabs-core.js"))
    page.evaluate(
        """() => {
            window.chrome = window.chrome || {
              runtime: { onMessage: { addListener: function (fn) { window.__mdMsgListener = fn; } },
                         lastError: null }
            };
        }"""
    )
    if entry:
        entry_name = "content.js" if carrier == "ext" else "recent-tabs-bootstrap.js"
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


def in_dom(page, cid):
    return page.evaluate(
        '(cid) => !!document.querySelector(\'#rn-list [data-cid="\' + cid + \'"]\')', cid
    )


def visible_cids(page):
    return page.evaluate(
        "() => Array.from(document.querySelectorAll('#rn-list [data-cid]')).map(e => e.getAttribute('data-cid'))"
    )


def search_value(page):
    return page.evaluate("() => document.getElementById('screen-search').value")


def title_of(page):
    return page.evaluate("() => window.__mock.title()")


def clicks_of(page, cid):
    return page.evaluate("(c) => (window.__mock.getClicks()[c] || 0)", cid)


def is_stale(page, cid):
    return page.evaluate(
        '(c) => !!document.querySelector(\'.md-tab[data-id="\' + c + \'"][data-stale]\')', cid
    )


def toast_state(page):
    return page.evaluate(
        """() => { var el = document.querySelector('.md-recent-tabs__toast');
             var tx = document.querySelector('.md-recent-tabs__toast-text');
             return { visible: !!el && el.classList.contains('is-visible'),
                      text: tx ? tx.textContent : '' }; }"""
    )


def set_search(page, term):
    """模拟用户在搜索框输入（与扩展一致的 React 受控输入驱动方式）。"""
    page.evaluate(
        """(term) => {
            var b = document.getElementById('screen-search');
            b.value = term;
            b.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            b.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        }""",
        term,
    )


def set_latency(page, ms):
    page.evaluate("(ms) => { window.__mock.setLatency(ms); }", ms)


def click_left(page, cid):
    page.evaluate(
        """(cid) => {
            var el = document.querySelector('#rn-list [data-cid="' + cid + '"]');
            if (!el) throw new Error('left item not in DOM: ' + cid);
            el.click();
        }""",
        cid,
    )
    page.wait_for_timeout(40)


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


# ---------------------------------------------------------------- Q1 命中分支竞态
def test_q1_hit_branch_race_real_mouse(browser, base):
    """命中分支竞态（最关键）：搜索态下点 A（需 locateCanvas 清空定位、轮询在飞）
    → 约 150ms 内真实鼠标再点「立即命中」的 B → 最终停在 B；A 的异步轮询不得覆盖。
    直接检验 onSwitch 入口无条件 revealToken++ 是否仍在（recent-tabs-core.js:466）。"""
    t = Tester("Q1 命中分支竞态（A 需轮询 / B 立即命中，真实鼠标）→ 停在 B")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        click_left(page, "c004")            # A
        click_left(page, "c006")            # B
        page.wait_for_timeout(120)
        # 拉大清空→全量恢复延迟，制造「A 的 locate 轮询在飞、B 仍在旧过滤列表」的稳定窗口
        set_latency(page, 600)
        set_search(page, "航班")
        page.wait_for_timeout(750)
        t.check(in_dom(page, "c004") is False, "前置：A(c004) 被过滤、不在 DOM")
        t.check(in_dom(page, "c006") is True, "前置：B(c006) 仍在旧过滤列表 DOM 中（可立即命中）")
        t.eq(search_value(page), "航班", "前置：搜索框值为「航班」")

        c4_before = clicks_of(page, "c004")
        c6_before = clicks_of(page, "c006")
        real_click_tab(page, "c004")        # A：locateCanvas 清空 + 轮询（600ms 后才回全量）
        page.wait_for_timeout(150)
        real_click_tab(page, "c006")        # B：立即命中（此刻 B 仍在 DOM）→ 直接 activate
        page.wait_for_timeout(1800)         # 等 A 的轮询彻底被取消 / 预算耗尽

        t.eq(active_tab(page), "c006", "最终激活标签应为最后点击的 B(c006)")
        t.eq(title_of(page), "航班预订-列表页", "最终画布应为 B（不被 A 的轮询覆盖）")
        t.eq(clicks_of(page, "c004"), c4_before,
             "A(c004) 的定位轮询被取消，未发生误切换 (clicks %d → %d)"
             % (c4_before, clicks_of(page, "c004")))
        t.check(clicks_of(page, "c006") > c6_before,
                "B(c006) 经左侧项被真实点击激活 (%d → %d)"
                % (c6_before, clicks_of(page, "c006")))
        after = tab_ids(page)
        t.check("c004" in after and "c006" in after, "两个标签均保留 (%s)" % after)
        t.check(not is_stale(page, "c006"), "B 未被标记为待定")
        t.check(not is_stale(page, "c004"), "A 回到 DOM 后待定标记已被自动撤销")
        # 新语义（2026-09-07）：A 的 locate 被 B 取代而取消，其清空动作已把搜索框
        # 置空，且成功路径不再恢复原词 → 最终稳定为空态（全量列表）
        t.eq(search_value(page), "", "A 的定位被取消后搜索框保持清空（原词「航班」不恢复）")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "v1013_q1")
    finally:
        ctx.close()
    return t


# ---------------------------------------------------------------- Q2 成功不还原语义
def test_q2_success_no_restore_semantics(browser, base):
    """新语义（2026-09-07）：原搜索词 W=航班，点被过滤的 c002（新增修改说明）定位成功
    → 搜索框**保持清空**（W 不自动回来）、stale 标记清除、列表保持全量。真实鼠标。"""
    t = Tester("Q2 定位成功后不再还原原检索词：搜索框清空 + stale 清除 + 列表全量")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        click_left(page, "c002")
        click_left(page, "c008")
        page.wait_for_timeout(120)
        set_search(page, "航班")
        page.wait_for_timeout(320)
        t.check(in_dom(page, "c002") is False, "前置：c002（新增修改说明）被过滤、不在 DOM")

        c2_before = clicks_of(page, "c002")
        real_click_tab(page, "c002")
        page.wait_for_timeout(1000)

        t.eq(search_value(page), "", "切换后搜索框保持清空（原检索词「航班」未自动回来）")
        t.eq(title_of(page), "新增修改说明", "画布已切到「新增修改说明」")
        t.eq(active_tab(page), "c002", "c002 激活态正确")
        t.check(clicks_of(page, "c002") > c2_before,
                "c002 经自动定位被真实点击 (%d → %d)" % (c2_before, clicks_of(page, "c002")))
        t.check(not is_stale(page, "c002"), "定位成功后待定标记已清除")
        vis = visible_cids(page)
        t.check("c002" in vis and len(vis) == 16,
                "列表保持全量（c002 可见、16 项全在列），未回到原过滤态 (vis=%s)" % vis)
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "v1013_q2")
    finally:
        ctx.close()
    return t


# ---------------------------------------------------------------- Q3 两个都需定位
def test_q3_both_need_locate_stop_at_last(browser, base):
    """连点两个都需定位的标签（A、B 均不在当前过滤 DOM）→ 停在最后点的 B，
    先点的 A 被取消、不误切换；全量恢复后 A/B 的 stale 都自动撤销。"""
    t = Tester("Q3 连点两个都需定位（A 后 B 均未命中）→ 停在 B")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        click_left(page, "c004")            # A：订单详情退款（不含「航班」）
        click_left(page, "c002")            # B：新增修改说明（不含「航班」）
        page.wait_for_timeout(120)
        set_latency(page, 600)
        set_search(page, "航班")
        page.wait_for_timeout(750)
        t.check(in_dom(page, "c004") is False, "前置：A(c004) 不在 DOM")
        t.check(in_dom(page, "c002") is False, "前置：B(c002) 不在 DOM")

        c4_before = clicks_of(page, "c004")
        c2_before = clicks_of(page, "c002")
        real_click_tab(page, "c004")        # A：清空 + 轮询在飞
        page.wait_for_timeout(150)
        real_click_tab(page, "c002")        # B：同样需定位，应取代 A 成为赢家
        page.wait_for_timeout(2400)         # 等 B 的 locate 完成 + stale 复核

        t.eq(active_tab(page), "c002", "最终激活标签应为最后点击的 B(c002)")
        t.eq(title_of(page), "新增修改说明", "最终画布应为 B")
        t.check(clicks_of(page, "c002") > c2_before,
                "B(c002) 完成定位并切换 (%d → %d)" % (c2_before, clicks_of(page, "c002")))
        t.eq(clicks_of(page, "c004"), c4_before,
             "A(c004) 的定位被 B 取代，未误切换 (clicks %d → %d)"
             % (c4_before, clicks_of(page, "c004")))
        after = tab_ids(page)
        t.check("c004" in after and "c002" in after, "两个标签均保留 (%s)" % after)
        t.check(not is_stale(page, "c002"), "B 无待定标记")
        t.check(not is_stale(page, "c004"), "A 回到 DOM 后待定标记自动撤销")
        # 新语义：B 定位成功后原检索词「航班」不恢复，搜索框保持清空
        t.eq(search_value(page), "", "切换成功后搜索框保持清空（原词「航班」不恢复）")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "v1013_q3")
    finally:
        ctx.close()
    return t


# ---------------------------------------------------------------- Q4 fallback 还原
def test_q4_name_search_fails_fallback_restores(browser, base):
    """目标名写入搜索框仍找不到（原搜索词非空 + 画布真删除）→ 走 fallback：
    标签保持 stale 不消失 + toast 出现 + 搜索框被清回原值。"""
    t = Tester("Q4 按名检索仍失败 → fallback（stale 保留 + toast + 搜索框还原）")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        click_left(page, "c004")
        click_left(page, "c006")
        page.wait_for_timeout(120)
        set_search(page, "航班")
        page.wait_for_timeout(320)
        t.check(in_dom(page, "c004") is False, "前置：c004 被过滤、不在 DOM")

        removed = page.evaluate("() => window.__mock.removeCanvas('c004')")
        t.check(removed is True, "已真正删除画布 c004（即使清空/检索也无法定位）")
        page.wait_for_timeout(200)

        real_click_tab(page, "c004")
        page.wait_for_timeout(4700)         # 清空轮询 ≤2s + 按名检索 ≤2s + 兜底扫描/toast

        t.check("c004" in tab_ids(page), "定位失败后标签未被静默删除 (tabs=%s)" % tab_ids(page))
        t.check(is_stale(page, "c004"), "标签保持待定(stale)不消失")
        ts = toast_state(page)
        t.check(ts["visible"], "出现可见提示 toast")
        t.check("未找到画布" in ts["text"], "提示文案说明原因: %r" % ts["text"])
        t.eq(search_value(page), "航班", "搜索框已还原为原搜索词「航班」（未被目标名卡住）")
        vis = visible_cids(page)
        t.check("c004" not in vis and "c006" in vis,
                "列表回到原过滤态（按「航班」过滤，c004 已删不在） (vis=%s)" % vis)
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "v1013_q4")
    finally:
        ctx.close()
    return t


# ---------------------------------------------------------------- Q5 destroy 无残留
def test_q5_destroy_during_locate_clean(browser, base):
    """destroy 时在飞 locate 轮询无残留：删除画布 → 点标签触发 locate（2s 预算在飞）
    → destroy → 无遗留 setTimeout/interval、document 监听归零、可重新 create。"""
    t = Tester("Q5 destroy 中断在飞 locate → 无定时器残留 + 可重建")
    ctx, page = new_page(browser)
    try:
        boot(page, base, entry=False)
        instrument(page)
        snap = "() => ({ doc: window.__qa.docListeners, iv: window.__qa.intervals.length, " \
               " to: window.__qa.timeouts.length, mo: window.__qa.moAlive.length })"
        base_counts = page.evaluate(snap)

        page.evaluate("() => { window.__mdRecentTabs = window.MDRecentTabs.create({}); }")
        page.wait_for_timeout(200)
        click_left(page, "c004")
        page.evaluate("() => window.__mock.removeCanvas('c004')")
        page.wait_for_timeout(200)
        made = page.evaluate(snap)
        t.check(made["to"] >= base_counts["to"], "创建后存在 pending timeout 基线之上 (%d ≥ %d)"
                % (made["to"], base_counts["to"]))

        real_click_tab(page, "c004")        # 触发 locateCanvas：清空/按名检索轮询 2s 在飞
        page.wait_for_timeout(250)          # 确保 pollFind 已调度首个 90ms 计时器
        mid = page.evaluate(snap)
        t.check(mid["to"] > made["to"], "locate 进行中新增了轮询计时器 (%d → %d)"
                % (made["to"], mid["to"]))

        page.evaluate("() => window.__mdRecentTabs.destroy()")
        page.wait_for_timeout(700)          # 若 pollFind 未被取消，90ms 间隔会继续加计时器

        after = page.evaluate(snap)
        t.eq(after["doc"], base_counts["doc"], "destroy 后 document 监听全部移除")
        t.eq(after["iv"], base_counts["iv"], "destroy 后 interval 全部清除")
        t.eq(after["mo"], base_counts["mo"], "destroy 后 MutationObserver 全部 disconnect")
        t.eq(after["to"], base_counts["to"], "destroy 后在飞 locate 轮询计时器已清空 (to=%d)"
              % after["to"])
        t.check(page.evaluate("() => !document.getElementById('md-recent-tabs-root')"),
                "根节点已移除")

        # 可重新 create，且旧的定位计时器不影响新实例
        page.evaluate("() => { window.__mdRecentTabs = window.MDRecentTabs.create({}); }")
        page.wait_for_timeout(300)
        t.eq(page.eval_on_selector_all("#md-recent-tabs-root", "els => els.length"), 1,
             "重新 create 后仅 1 个根节点")
        t.check(page.evaluate("() => !!document.querySelector('.md-recent-tabs')"),
                "重新 create 后标签栏渲染正常")
        # destroy 中断了 locate 的 restoreSearch，搜索框可能残留目标名（扩展已销毁，
        # 属应用侧搜索现场，由用户/下次定位自行处理）→ 模拟用户清空后重建历史再验证切换
        set_search(page, "")
        page.wait_for_timeout(200)
        click_left(page, "c001")
        click_left(page, "c006")
        page.wait_for_timeout(120)
        real_click_tab(page, "c001")
        page.wait_for_timeout(400)
        t.eq(title_of(page), "消息模板管理", "重建后可正常点标签切换")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "v1013_q5")
    finally:
        ctx.close()
    return t


# ---------------------------------------------------------------- Q6 双载体一致
def _parity_probe(page, base, carrier):
    boot(page, base, carrier=carrier)
    click_left(page, "c004")
    click_left(page, "c006")
    page.wait_for_timeout(120)
    set_search(page, "航班")
    page.wait_for_timeout(320)
    real_click_tab(page, "c004")            # 被过滤 → 触发 locate 清空定位
    page.wait_for_timeout(1000)
    return {
        "active": active_tab(page),
        "title": title_of(page),
        "search": search_value(page),
        "tabs": tab_ids(page),
        "stale004": is_stale(page, "c004"),
        "toast": toast_state(page)["visible"],
        "vis": visible_cids(page),
    }


def test_q6_carrier_parity_search_locate(browser, base):
    t = Tester("Q6 扩展载体 vs 桌面载体：搜索态点被过滤标签的定位行为一致")
    ctx1, p1 = new_page(browser)
    ctx2, p2 = new_page(browser)
    try:
        ext = _parity_probe(p1, base, "ext")
        desk = _parity_probe(p2, base, "desktop")
        t.eq(ext["active"], desk["active"], "激活标签一致 (ext=%r, desktop=%r)"
             % (ext["active"], desk["active"]))
        t.eq(ext["title"], desk["title"], "画布标题一致 (ext=%r, desktop=%r)"
             % (ext["title"], desk["title"]))
        t.eq(ext["search"], desk["search"], "搜索框还原值一致 (ext=%r, desktop=%r)"
             % (ext["search"], desk["search"]))
        t.eq(ext["tabs"], desk["tabs"], "标签集合一致")
        t.eq(ext["stale004"], desk["stale004"], "stale 行为一致")
        t.eq(ext["toast"], desk["toast"], "toast 行为一致")
        t.eq(ext["vis"], desk["vis"], "可见列表一致")
        t.check(ext["active"] == "c004" and ext["title"] == "订单详情退款",
                "扩展载体真实完成了定位切换 (active=%r, title=%r)" % (ext["active"], ext["title"]))
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(p1, "v1013_q6_ext")
        screenshot(p2, "v1013_q6_desktop")
    finally:
        ctx1.close()
        ctx2.close()
    return t


# ---------------------------------------------------------------- Q7 命中路径无副作用
def test_q7_hit_path_no_search_side_effect(browser, base):
    t = Tester("Q7 命中即切换路径不回归：非搜索态点标签直接切换、无搜索副作用")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        click_left(page, "c001")
        click_left(page, "c002")
        page.wait_for_timeout(120)
        t.check(in_dom(page, "c001") is True, "前置：c001 在 DOM（无搜索过滤）")
        t.eq(search_value(page), "", "前置：搜索框为空")
        full_before = len(visible_cids(page))
        t.eq(full_before, 16, "前置：列表全量渲染 16 项")

        c1_before = clicks_of(page, "c001")
        real_click_tab(page, "c001")
        page.wait_for_timeout(500)

        t.eq(title_of(page), "消息模板管理", "命中即切换：画布标题切到 c001")
        t.eq(active_tab(page), "c001", "c001 激活态正确")
        t.check(clicks_of(page, "c001") > c1_before, "左侧项被点击 (%d → %d)"
                % (c1_before, clicks_of(page, "c001")))
        t.check(not is_stale(page, "c001"), "命中路径无 stale 标记")
        t.eq(search_value(page), "", "搜索框未被触碰")
        t.eq(len(visible_cids(page)), full_before, "列表仍为全量（未触发搜索过滤）")
        ts = toast_state(page)
        t.check(not ts["visible"], "无 toast 提示")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "v1013_q7")
    finally:
        ctx.close()
    return t


def main():
    httpd, base = start_server()
    total_fails = 0
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
            total_fails += test_q1_hit_branch_race_real_mouse(browser, base).summary()
            total_fails += test_q2_success_no_restore_semantics(browser, base).summary()
            total_fails += test_q3_both_need_locate_stop_at_last(browser, base).summary()
            total_fails += test_q4_name_search_fails_fallback_restores(browser, base).summary()
            total_fails += test_q5_destroy_during_locate_clean(browser, base).summary()
            total_fails += test_q6_carrier_parity_search_locate(browser, base).summary()
            total_fails += test_q7_hit_path_no_search_side_effect(browser, base).summary()
            print("\n==== v1.0.13 QA 独立边界回归总计：%d 失败 ====" % total_fails)
            os._exit(1 if total_fails else 0)
    except Exception:
        import traceback
        traceback.print_exc()
        os._exit(1)


if __name__ == "__main__":
    main()
