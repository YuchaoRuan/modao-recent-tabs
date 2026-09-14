# -*- coding: utf-8 -*-
"""
tests/test_canvas_panel_only.py — v1.0.17「只有『画布』列能建标签」独立验证

被测 BUG
--------
点击「页面」列（左栏下部面板的「页面」标签，条目名带序号）或「图层」列的条目，
会在顶部「最近画布」标签栏错误生成无效标签页。
期望：**只有点击左栏上部「画布」列（#screen-scroll-list，条目名不带序号）才创建标签页**；
点页面 / 图层不产生任何标签页；且不产生空标签、不产生重复标签。

★ 界面语义（2026-09-14 用户真机核对，此前在这里搞反过一次，务必看清）★
  「画布」= 左栏**上部**那列，容器 #screen-scroll-list，条目名不带序号，
            内层 div.rn-list-item.page + data-interactive-target-type="page"。
            → 夹具里 data-qa="canvas-*"，**点它应当建标签**。
  「页面」= 左栏**下部**面板的「页面」标签，容器 #mb-enabled-canvas-list，
            条目名带序号（如「1 首页画布」），内层 div.rn-list-item.layer-item
            + data-interactive-target-type="canvasList"。
            → 夹具里 data-qa="page-*"，**点它不得建标签**。
  「图层」= 左栏下部面板的「图层」标签，容器 #mb-enabled-layer-list → data-qa="layer-*"。

与工程师自测的区别（避免"夹具即结论"）
--------------------------------------
  - 使用 QA 自写夹具 tests/fixtures/mock-modao-design-panels.html，**严格照真机
    DOM 契约**构造三个列表：三者**共用** li.rn-content-item / div.rn-list-item 与
    data-cid（layer-item 在「页面」列与「图层」列都出现）—— 这是原 BUG 能被触发的
    前提条件；若夹具给三列用不同类名，测试将永远假通过。
  - 「图层」列里**故意放置与「画布」列共用 data-cid 的节点**（真机图层树里的画板
    节点就是这种形态），专杀"按 cid 定位"的实现。
  - 点击一律使用**真实鼠标事件**（page.click / page.mouse），不用 el.click() 合成。
  - T0 为夹具自检：断言夹具确实具备触发原 BUG 的条件（对抗性充分性）。

场景
----
  T0 夹具契约自检（对抗性充分性）
  T1 点「页面」列（下部）项 → 不新增任何标签
  T2 点「图层」列项 → 不新增标签；同 cid 图层节点不污染已有标签名称 / 不建标签
  T3 点「画布」列（上部）项 → 新增标签并置顶；连续点击同一画布 → 不产生重复标签
  T4 空名称画布项 → 不产生空标签
  T5 .is-active 收窄：页面项 is-active 不建标签；自动带出只发生一次
  T6 点标签切换 → 实际点击的是**「画布」列**里的节点（不是图层/页面同 cid 节点）
  T7 仅「画布」列渲染（图层列不渲染）
  T8 仅「图层」列渲染（画布列不渲染）：图层/页面项一律不建标签
  T9 兼容降级：无任何列表容器的旧 DOM → 旧行为仍在（历史项进标签 / 点项建标签 / .folder 排除）
  T10 名称前缀歧义（"首页画布" / "首页画布 副本"）→ 不产生重复标签
  T11 画布列已卸载时点标签 → 绝不误点到「图层」列的同 cid 节点
  T12 反向对照（屏蔽归属判定后原 BUG 必现）
  T13 无画布列锚点时黑名单仍生效
  T14 仅进入文件时带出一次当前画布；之后切页不再自动建标签
  T15 进入文件按 canvas-title 唯一命中带出当前画布（歧义则不带出）
  T16 标题命中同名歧义 → 不带出
  T17 「画布」列容器锚点失效（模拟改版）→ 仍能建标签，页面/图层仍被拒
  T18 只派发 mousedown（click 被重排吞掉）→ 仍能建标签且不重复
  T19 画布名带序号前缀时，标题反查仍能带出
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
from harness import start_server, Tester, screenshot, new_page

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PANEL_FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "mock-modao-design-panels.html")
LEGACY_FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "mock-modao-design.html")
CID = "PANELCID"

# 真机取证：三面板容器锚点（严格模式判定锚点集合）
STRICT_ANCHORS = (
    "#mb-enabled-canvas-list, #canvas-scroll-list, .canvas-scroll-list,"
    "#mb-enabled-layer-list, #layer-scroll-list, .layer-scroll-list"
)


# ------------------------------------------------------------------ 基础设施
def boot(page, base, cid=CID, fixture=PANEL_FIXTURE, history=None, carrier="ext", patch=None):
    """加载指定夹具 → 伪装成 /proto/design/<cid> → 注入真实源码 → create()。
    history: list[str] 时按 JSON 数组写入 screen-history-onLeave-project-<cid>。
    patch: (old, new) 源码字符串替换 —— 仅供「反向对照」用例在内存中还原旧行为，
           不改动磁盘上的 recent-tabs-core.js。"""
    page.goto(base + "/workspace", wait_until="load")
    page.evaluate("() => { localStorage.clear(); }")
    with open(fixture, encoding="utf-8") as f:
        html = f.read()
    page.set_content(html)
    page.evaluate("(c) => history.replaceState({}, '', '/proto/design/' + c)", cid)
    if history is not None:
        page.evaluate(
            """([c, h]) => {
                localStorage.setItem('screen-history-onLeave-project-' + c, JSON.stringify(h));
            }""",
            [cid, history],
        )
    src = PROJECT_ROOT if carrier == "ext" else os.path.join(PROJECT_ROOT, "desktop")
    page.add_style_tag(path=os.path.join(src, "tabbar.css"))
    page.add_script_tag(path=os.path.join(src, "tabbar.js"))
    core_path = os.path.join(src, "recent-tabs-core.js")
    if patch:
        with open(core_path, encoding="utf-8") as f:
            core_src = f.read()
        old, new = patch
        assert old in core_src, "反向对照补丁锚点未命中，源码可能已改版：%r" % old
        page.add_script_tag(content=core_src.replace(old, new, 1))
    else:
        page.add_script_tag(path=core_path)
    page.evaluate(
        """() => {
            window.chrome = window.chrome || {
              runtime: { onMessage: { addListener: function (fn) { window.__mdMsgListener = fn; } },
                         lastError: null }
            };
            window.__ctrl = MDRecentTabs.create({ enableMessageListener: true });
        }"""
    )
    page.wait_for_selector(".md-recent-tabs", state="attached")


def tabs(page):
    """[{id, name}] —— DOM 顺序即"最近"顺序（tabbar 按 updatedAt 倒序）。"""
    return page.evaluate(
        """() => Array.from(document.querySelectorAll('.md-tab')).map(function(e){
             var l = e.querySelector('.md-tab__label');
             return { id: e.getAttribute('data-id'), name: l ? l.textContent : '' };
           })"""
    )


def tab_ids(page):
    return [t["id"] for t in tabs(page)]


def tab_names(page):
    return [t["name"] for t in tabs(page)]


def active_tab(page):
    return page.evaluate(
        "() => { var e = document.querySelector('.md-tab.is-active');"
        " return e ? e.getAttribute('data-id') : null; }"
    )


def click_item(page, qa, target="inner"):
    """真实鼠标点击指定项。target='inner' 点内层 div.rn-list-item，
    'li' 点外层 li.rn-content-item 的内边距区域（两种都是真机可能的目标元素）。"""
    if target == "li":
        page.locator('[data-qa="%s"]' % qa).click(position={"x": 2, "y": 2})
    else:
        page.click('[data-qa="%s"] > div.rn-list-item' % qa)


def click_tab(page, tid):
    page.click('.md-tab[data-id="%s"] .md-tab__label' % tid)


def click_log(page):
    return page.evaluate("() => window.__mock ? window.__mock.clickLog() : []")


def reset_clicks(page):
    page.evaluate("() => window.__mock && window.__mock.resetClicks()")


def poke(page):
    """触发一次 body childList 变更 —— 等价于墨刀 SPA 重绘，
    让 MutationObserver → rAF → syncActiveScreen 立刻跑一遍（免等 2s 轮询）。"""
    page.evaluate(
        """() => { var d = document.createElement('div'); d.id='__qa_poke';
                   document.body.appendChild(d); d.parentNode.removeChild(d); }"""
    )
    page.wait_for_timeout(250)


def wait_poll(page):
    """等满一个 2s 轮询周期（真实扩展就是靠它兜底同步）。"""
    page.wait_for_timeout(2400)


# ------------------------------------------------------------------ T0 夹具自检
def test_t0_fixture_contract(browser, base):
    t = Tester("T0 夹具契约自检（对抗性充分性：旧版按 [data-cid] 匹配必然误命中）")
    ctx, page = new_page(browser)
    try:
        page.goto(base + "/workspace", wait_until="load")
        with open(PANEL_FIXTURE, encoding="utf-8") as f:
            page.set_content(f.read())

        probe = page.evaluate(
            """() => {
                var CANVAS_ITEM = 'div.rn-list-item[data-cid], li.rn-content-item[data-cid]';
                var all = Array.from(document.querySelectorAll(CANVAS_ITEM));
                function inPanel(el, sel){ return !!(el && el.closest && el.closest(sel)); }
                // 变量名按**界面文案**（真机 2026-09-14 核对）：
                //   canvas = 左栏上部「画布」列（#screen-scroll-list，条目名不带序号）
                //   page   = 左栏下部「页面」标签（#mb-enabled-canvas-list，条目名带序号）
                var canvas = all.filter(function(e){ return inPanel(e, '#screen-scroll-list, .screen-list-container'); });
                var page = all.filter(function(e){ return inPanel(e, '#canvas-scroll-list, #mb-enabled-canvas-list, .canvas-sortable-list'); });
                var layer = all.filter(function(e){ return inPanel(e, '#layer-scroll-list, #mb-enabled-layer-list, .layer-sortable-list'); });
                function info(list){ return list.map(function(e){
                    return { tag: e.tagName.toLowerCase(), cls: e.className,
                             cid: e.getAttribute('data-cid'),
                             qa: e.getAttribute('data-qa') }; }); }
                // 共用 cid 的集合：画布列与图层列都出现的 cid
                var cc = {}, lc = {};
                canvas.forEach(function(e){ cc[e.getAttribute('data-cid')] = 1; });
                layer.forEach(function(e){ lc[e.getAttribute('data-cid')] = 1; });
                var shared = Object.keys(cc).filter(function(k){ return lc[k]; });
                // 旧逻辑（只按 [data-cid] 匹配 + 排除 .folder）会接受的项数：
                // 若该数远大于画布列项数，说明收窄一旦失效就必然复现原 BUG。
                var legacyAccepted = all.filter(function(e){
                  return !(e.classList && e.classList.contains('folder')); }).length;
                function innerCls(e){ var d = e.querySelector('div.rn-list-item');
                  return d ? d.className : ''; }
                function innerType(e){ var d = e.querySelector('div.rn-list-item');
                  return d ? (d.getAttribute('data-interactive-target-type') || '') : null; }
                return {
                  total: all.length,
                  legacyAccepted: legacyAccepted,
                  page: info(page), canvas: info(canvas), layer: info(layer),
                  sharedCids: shared,
                  pageInnerClass: page.length ? innerCls(page[0]) : '',
                  pageInnerType: page.length ? innerType(page[0]) : null,
                  canvasInnerClass: canvas.length ? innerCls(canvas[0]) : '',
                  canvasInnerType: canvas.length ? innerType(canvas[0]) : null,
                  layerInnerClass: layer.length ? innerCls(layer[0]) : '',
                  layerInnerType: layer.length ? innerType(layer[0]) : null,
                  hasPageContainer: !!document.querySelector('#canvas-scroll-list.canvas-scroll-list'),
                  hasPageSortable: !!document.querySelector('#canvas-scroll-list > .canvas-sortable-list > ul#mb-enabled-canvas-list'),
                  hasLayerContainer: !!document.querySelector('#layer-scroll-list.layer-scroll-list'),
                  hasLayerSortable: !!document.querySelector('#layer-scroll-list > .layer-sortable-list > ul#mb-enabled-layer-list'),
                  hasCanvasContainer: !!document.querySelector('.screen-list-container > #screen-scroll-list'),
                  // 关键：三个列表是否共用通用树类名（原 BUG 前提）
                  allHaveRnClass: all.every(function(e){
                    return /(^|\\s)rn-(list|content)-item(\\s|$)/.test(e.className); }),
                  allHaveCid: all.every(function(e){ return !!e.getAttribute('data-cid'); }),
                  layerItemInPageColumn: page.some(function(e){ return /layer-item/.test(e.className); }),
                  folderInPageColumn: page.some(function(e){ return /folder/.test(e.className); }),
                  emptyCanvasItem: !!document.querySelector('[data-qa="canvas-CEMPTY"] > div.rn-list-item'),
                  emptyNameIsBlank: (function(){
                    var e = document.querySelector('[data-qa="canvas-CEMPTY"] > div.rn-list-item');
                    return e ? (e.textContent || '').trim() === '' : false; })(),
                  hasCanvasTitle: !!document.querySelector('.canvas-title'),
                  hasStyledTopBar: !!document.querySelector("[class*='StyledTopBar']"),
                  strictAnchors: !!document.querySelector("%s")
                };
            }""" % STRICT_ANCHORS
        )

        t.check(probe["total"] >= 12, "三个列表共渲染 ≥12 个通用树项 (got=%d)" % probe["total"])
        t.check(probe["allHaveRnClass"], "所有项都带通用树类名 .rn-list-item / .rn-content-item（原 BUG 前提）")
        t.check(probe["allHaveCid"], "所有项都带 data-cid（旧版选择器会全部命中 → 原 BUG 前提）")
        t.check(len(probe["canvas"]) >= 3, "「画布」列 ≥3 项 (got=%d)" % len(probe["canvas"]))
        t.check(len(probe["page"]) >= 3, "「页面」列 ≥3 项 (got=%d)" % len(probe["page"]))
        t.check(len(probe["layer"]) >= 3, "「图层」列 ≥3 项 (got=%d)" % len(probe["layer"]))
        t.check(probe["folderInPageColumn"], "「页面」列含 .folder 文件夹项")
        t.check(probe["layerItemInPageColumn"], "「页面」列的项也带 layer-item 类名（无法靠 class 区分归属）")
        # 真机契约：内层 div 的类名 / data-interactive-target-type
        #   上部「画布」列：div.rn-list-item.page + type=page
        #   下部「页面」列：div.rn-list-item.layer-item.interactive-target-hotspot + type=canvasList
        t.check("page" in probe["canvasInnerClass"],
                "「画布」列（上部）内层为 div.rn-list-item.page (got=%r)" % probe["canvasInnerClass"])
        t.eq(probe["canvasInnerType"], "page",
             "「画布」列内层 data-interactive-target-type=page (got=%r)" % probe["canvasInnerType"])
        t.check("layer-item" in probe["pageInnerClass"]
                and "interactive-target-hotspot" in probe["pageInnerClass"],
                "「页面」列（下部）内层为 div.rn-list-item.layer-item.interactive-target-hotspot (got=%r)"
                % probe["pageInnerClass"])
        t.eq(probe["pageInnerType"], "canvasList",
             "「页面」列内层 data-interactive-target-type=canvasList (got=%r)" % probe["pageInnerType"])
        t.check("layer-item" in probe["layerInnerClass"],
                "「图层」列内层为 div.rn-list-item.layer-item (got=%r)" % probe["layerInnerClass"])
        t.eq(probe["layerInnerType"], "",
             "「图层」列内层 data-interactive-target-type 为空 (got=%r)" % probe["layerInnerType"])
        # 对抗性充分性：旧逻辑会接受远多于画布列的项 → 收窄失效必现 BUG
        t.check(probe["legacyAccepted"] > len(probe["canvas"]),
                "旧逻辑会接受 %d 项 >> 「画布」列 %d 项 → 收窄失效必然复现原 BUG"
                % (probe["legacyAccepted"], len(probe["canvas"])))
        t.eq(sorted(probe["sharedCids"]), ["C1", "C3"],
             "「图层」列存在与「画布」列共用 data-cid 的节点 (got=%s)" % sorted(probe["sharedCids"]))
        t.check(probe["hasPageContainer"] and probe["hasPageSortable"], "「页面」列容器链与真机一致")
        t.check(probe["hasLayerContainer"] and probe["hasLayerSortable"], "「图层」列容器链与真机一致")
        t.check(probe["hasCanvasContainer"], "「画布」列容器链与真机一致")
        t.check(probe["emptyCanvasItem"] and probe["emptyNameIsBlank"], "存在名称为空的画布项（空标签防御用）")
        t.check(probe["hasCanvasTitle"], "存在 .canvas-title（名称反查兜底用）")
        t.check(probe["hasStyledTopBar"], "存在 [class*='StyledTopBar'] 顶栏（避让逻辑用）")
        t.check(probe["strictAnchors"], "存在列表容器锚点")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "panel_t0")
    finally:
        ctx.close()
    return t


# ------------------------------------------------------------------ T1 页面列
def test_t1_click_page_no_tab(browser, base):
    t = Tester("T1 点「页面」面板项 → 不新增任何标签")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        t.eq(tab_ids(page), [], "初始无标签（页面项未激活、canvas-title 反查不新建）")

        click_item(page, "page-P1", "inner")          # 点内层 div.rn-list-item.page
        page.wait_for_timeout(200)
        t.eq(tab_ids(page), [], "点页面项内层 div.rn-list-item.page → 标签集合仍为空")

        click_item(page, "page-P2", "li")             # 点外层 li.rn-content-item
        page.wait_for_timeout(200)
        t.eq(tab_ids(page), [], "点页面项外层 li.rn-content-item → 标签集合仍为空")

        click_item(page, "page-P3", "inner")
        page.wait_for_timeout(200)
        t.eq(tab_ids(page), [], "再点第三个页面项 → 标签集合仍为空")

        # 夹具确实把激活态加到了页面项上（验证 getActiveScreen 这条路径也被走到）
        act = page.evaluate(
            "() => { var e = document.querySelector('.rn-list-item.is-active');"
            " return e ? e.closest('li').getAttribute('data-qa') : null; }"
        )
        t.eq(act, "page-P3", "页面项确实拿到了 .is-active（激活建标签路径已被触发）(got=%r)" % act)

        # 文件夹项（页面列内）也不建标签
        click_item(page, "page-PF", "inner")
        page.wait_for_timeout(200)
        t.eq(tab_ids(page), [], "点页面列里的 .folder 文件夹 → 不建标签")

        wait_poll(page)
        t.eq(tab_ids(page), [], "等满 2s 轮询后仍无标签（同步路径未从页面项建标签）")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "panel_t1")
    finally:
        ctx.close()
    return t


# ------------------------------------------------------------------ T2 图层面板
def test_t2_click_layer_no_tab(browser, base):
    t = Tester("T2 点「图层」面板项 → 不新增标签；同 cid 图层节点不污染已有标签")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        click_item(page, "canvas-C1", "inner")
        page.wait_for_timeout(250)
        base_ids = tab_ids(page)
        base_names = tab_names(page)
        t.eq(base_ids, ["C1"], "前置：点画布 C1 建出标签 (got=%s)" % base_ids)
        t.eq(base_names, ["首页画布"], "前置：标签名为画布名 (got=%s)" % base_names)

        page.wait_for_timeout(150)
        click_item(page, "layer-L3", "inner")
        page.wait_for_timeout(250)
        t.eq(tab_ids(page), base_ids, "点普通图层项（cid=L3）→ 标签集合不变 (got=%s)" % tab_ids(page))

        click_item(page, "layer-L4", "li")
        page.wait_for_timeout(250)
        t.eq(tab_ids(page), base_ids, "点图层项外层 li → 标签集合不变 (got=%s)" % tab_ids(page))

        # ★ 与画布 C1 共用 data-cid 的图层节点
        click_item(page, "layer-C1", "inner")
        page.wait_for_timeout(250)
        t.eq(tab_ids(page), base_ids, "点「与画布同 cid」的图层节点 → 不新增标签 (got=%s)" % tab_ids(page))
        t.eq(tab_names(page), ["首页画布"],
             "点同 cid 图层节点 → 已有标签名称不被图层名污染 (got=%s)" % tab_names(page))
        t.eq(active_tab(page), "C1", "点同 cid 图层节点 → 激活标签仍为 C1")

        # 与画布 C3 同 cid 的图层节点（C3 此时还没有标签）
        click_item(page, "layer-C3", "inner")
        page.wait_for_timeout(250)
        t.eq(tab_ids(page), base_ids,
             "点「与画布 C3 同 cid」的图层节点 → 不凭空造出 C3 标签 (got=%s)" % tab_ids(page))

        wait_poll(page)
        t.eq(tab_ids(page), base_ids, "等满 2s 轮询后标签集合仍不变 (got=%s)" % tab_ids(page))
        t.eq(tab_names(page), ["首页画布"], "轮询后标签名称仍未被污染 (got=%s)" % tab_names(page))

        log = click_log(page)
        t.check(all(c["panel"] == "layer" for c in log[1:]),
                "点击流水显示后续点击都落在图层面板 (got=%s)" % [c["qa"] for c in log[1:]])
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "panel_t2")
    finally:
        ctx.close()
    return t


# ------------------------------------------------------------------ T3 画布列
def test_t3_click_canvas_creates_tab(browser, base):
    t = Tester("T3 点「画布」面板项 → 新增标签并置顶；连点不产生重复标签")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        t.eq(tab_ids(page), [], "初始无标签")

        click_item(page, "canvas-C1", "inner")
        page.wait_for_timeout(250)
        t.eq(tab_ids(page), ["C1"], "点画布项（内层 div）→ 新增标签 (got=%s)" % tab_ids(page))
        t.eq(tab_names(page), ["首页画布"], "标签名取画布名 (got=%s)" % tab_names(page))
        t.eq(active_tab(page), "C1", "新标签为激活态")

        page.wait_for_timeout(150)
        click_item(page, "canvas-C3", "li")
        page.wait_for_timeout(250)
        t.eq(tab_ids(page), ["C3", "C1"], "再点另一个画布项 → 新标签置顶（最近在前）(got=%s)" % tab_ids(page))
        t.eq(active_tab(page), "C3", "最新点击的画布为激活标签")

        # 连续点击同一画布 3 次 → 不产生重复标签
        page.wait_for_timeout(150)
        for _ in range(3):
            click_item(page, "canvas-C1", "inner")
            page.wait_for_timeout(180)
        ids = tab_ids(page)
        t.eq(len(ids), len(set(ids)), "连点同一画布 3 次 → 无重复标签 (got=%s)" % ids)
        t.eq(sorted(ids), ["C1", "C3"], "标签集合正确 (got=%s)" % sorted(ids))
        t.eq(ids[0], "C1", "最后点击的画布置顶 (got=%s)" % ids)
        t.eq(active_tab(page), "C1", "连点后激活标签为 C1")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "panel_t3")
    finally:
        ctx.close()
    return t


# ------------------------------------------------------------------ T4 空名称
def test_t4_empty_name_no_tab(browser, base):
    t = Tester("T4 空名称画布项 → 不产生空标签")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        click_item(page, "canvas-C1", "inner")
        page.wait_for_timeout(250)
        before = tab_ids(page)
        t.eq(before, ["C1"], "前置：C1 标签已建立 (got=%s)" % before)

        click_item(page, "canvas-CEMPTY", "inner")
        page.wait_for_timeout(300)
        ids = tab_ids(page)
        names = tab_names(page)
        t.eq(ids, before, "点空名称画布项 → 不新增标签 (got=%s)" % ids)
        t.check(all(n.strip() for n in names), "标签栏不存在空名称标签 (got=%r)" % names)
        wait_poll(page)
        t.eq(tab_ids(page), before, "轮询后仍无空标签 (got=%s)" % tab_ids(page))
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "panel_t4")
    finally:
        ctx.close()
    return t


# ------------------------------------------------------------------ T5 is-active
def test_t5_active_state_narrowed(browser, base):
    t = Tester("T5 .is-active 收窄：页面项激活不建标签，画布项激活正常置顶")
    ctx, page = new_page(browser)
    try:
        boot(page, base)

        # ① 页面项 .is-active（初始化阶段 lastActiveId=null）
        page.evaluate("() => window.__mock.setActive('page-P2')")
        poke(page)
        wait_poll(page)
        t.eq(tab_ids(page), [], "给页面项加 .is-active → 不由此生成标签 (got=%s)" % tab_ids(page))

        # ② 先点画布建立 lastActiveId，再让页面项激活
        click_item(page, "canvas-C1", "inner")
        page.wait_for_timeout(250)
        t.eq(tab_ids(page), ["C1"], "前置：C1 标签已建立 (got=%s)" % tab_ids(page))

        page.evaluate("() => window.__mock.setActive('page-P1')")
        poke(page)
        wait_poll(page)
        t.eq(tab_ids(page), ["C1"], "已有画布标签时给页面项加 .is-active → 标签集合不变 (got=%s)" % tab_ids(page))

        # ③ 图层项 .is-active（同 cid 节点最容易骗过按 cid 定位的实现）
        page.evaluate("() => window.__mock.setActive('layer-C1')")
        poke(page)
        wait_poll(page)
        t.eq(tab_ids(page), ["C1"], "给同 cid 的图层节点加 .is-active → 不新建/不改标签 (got=%s)" % tab_ids(page))
        t.eq(tab_names(page), ["首页画布"], "标签名仍为画布名（未被图层名污染）(got=%s)" % tab_names(page))

        # ④ 画布项 .is-active：自动带出只允许「进入文件时一次」，此处种子已用掉
        #    （②③ 之前已经有过一次点击建标签）→ 不应再自动新增（新需求，见 T14）
        page.wait_for_timeout(200)
        page.evaluate("() => window.__mock.setActive('canvas-C3')")
        poke(page)
        wait_poll(page)
        ids = tab_ids(page)
        t.eq(ids, ["C1"], "自动带出只发生一次：已有点击后再让画布激活 → 不再自动新增 (got=%s)" % ids)
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "panel_t5")
    finally:
        ctx.close()
    return t


# ------------------------------------------------------------------ T6 点标签
def test_t6_switch_clicks_canvas_node(browser, base):
    t = Tester("T6 点标签切换 → 实际点击的是画布列里的节点（不是图层/页面同名同 cid 节点）")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        click_item(page, "canvas-C1", "inner")
        page.wait_for_timeout(250)
        click_item(page, "canvas-C3", "inner")
        page.wait_for_timeout(250)
        t.eq(sorted(tab_ids(page)), ["C1", "C3"], "前置：两个画布标签已建立 (got=%s)" % tab_ids(page))

        # C1 / C3 在图层面板里都有同 cid 的兄弟节点 → 切错就会被点击流水抓到
        reset_clicks(page)
        click_tab(page, "C1")
        page.wait_for_timeout(500)
        log = click_log(page)
        hits = [c for c in log if c["cid"] == "C1"]
        t.check(len(hits) >= 1, "点 C1 标签确实触发了左侧项点击 (log=%s)" % log)
        t.check(all(c["panel"] == "canvas" for c in hits),
                "被点击的节点位于画布列 (got=%s)" % [(c["qa"], c["panel"]) for c in hits])
        t.check(all(c["qa"] == "canvas-C1" for c in hits),
                "被点击的是画布列的 C1 节点，而非图层面板的同 cid 节点 (got=%s)" % [c["qa"] for c in hits])
        t.check(not [c for c in log if c["panel"] == "layer"],
                "未误点到图层面板任何节点 (got=%s)" % [c["qa"] for c in log if c["panel"] == "layer"])
        t.check(not [c for c in log if c["panel"] == "page"],
                "未误点到页面列任何节点 (got=%s)" % [c["qa"] for c in log if c["panel"] == "page"])
        t.eq(active_tab(page), "C1", "切换后激活标签为 C1")
        t.eq(page.evaluate("() => window.__mock.title()"), "首页画布",
             "切换后画布标题变为 C1 的名称（证明点到的是真画布节点）")

        # 再切一次 C3
        page.wait_for_timeout(200)
        reset_clicks(page)
        click_tab(page, "C3")
        page.wait_for_timeout(500)
        log = click_log(page)
        hits = [c for c in log if c["cid"] == "C3"]
        t.check(len(hits) >= 1, "点 C3 标签触发了左侧项点击 (log=%s)" % log)
        t.check(all(c["qa"] == "canvas-C3" for c in hits),
                "被点击的是画布列的 C3 节点 (got=%s)" % [c["qa"] for c in hits])
        t.eq(page.evaluate("() => window.__mock.title()"), "订单详情", "切换后画布标题为 C3 名称")
        t.eq(sorted(tab_ids(page)), ["C1", "C3"], "切换不产生新标签 (got=%s)" % tab_ids(page))
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "panel_t6")
    finally:
        ctx.close()
    return t


# ------------------------------------------------------------------ T7 仅画布列
def test_t7_only_canvas_panel(browser, base):
    t = Tester("T7 仅画布列渲染（图层面板不渲染 = 用户在「画布」tab）")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        page.evaluate("() => window.__mock.setPanels({ page: true, canvas: true, layer: false })")
        pan = page.evaluate("() => window.__mock.panels()")
        t.check(pan["canvas"] and not pan["layer"] and pan["page"], "面板渲染状态：页面+画布，图层不渲染 (got=%s)" % pan)
        t.check(page.evaluate("(s) => !!document.querySelector(s)", STRICT_ANCHORS),
                "严格模式判定锚点仍在（画布列存在）")

        click_item(page, "page-P1", "inner")
        page.wait_for_timeout(250)
        t.eq(tab_ids(page), [], "点页面项 → 不建标签 (got=%s)" % tab_ids(page))

        click_item(page, "canvas-C1", "inner")
        page.wait_for_timeout(250)
        t.eq(tab_ids(page), ["C1"], "点画布项 → 正常建标签 (got=%s)" % tab_ids(page))

        # 无归属孤立项：判据为「只排除页面/图层」，故无归属项按通用树项接受
        #（v1.0.17 最终判据；旧的"严格模式拒绝无归属项"会把真实画布点击一起拒掉，
        # 已由真机回归证明是错的）
        click_item(page, "orphan-ORPHAN", "inner")
        page.wait_for_timeout(250)
        t.eq(sorted(tab_ids(page)), ["C1", "ORPHAN"],
             "无归属通用树项按「只排除页面/图层」判据接受 (got=%s)" % tab_ids(page))

        wait_poll(page)
        t.eq(sorted(tab_ids(page)), ["C1", "ORPHAN"],
             "轮询后标签集合稳定 (got=%s)" % tab_ids(page))
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "panel_t7")
    finally:
        ctx.close()
    return t


# ------------------------------------------------------------------ T8 仅图层面板
def test_t8_only_layer_panel(browser, base):
    t = Tester("T8 仅图层面板渲染（画布列不渲染 = 用户在「图层」tab）：图层/页面项一律不建标签")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        page.evaluate("() => window.__mock.setPanels({ page: true, canvas: false, layer: true })")
        pan = page.evaluate("() => window.__mock.panels()")
        t.check(pan["layer"] and not pan["canvas"], "面板渲染状态：仅图层（画布不渲染）(got=%s)" % pan)
        t.check(page.evaluate("(s) => !!document.querySelector(s)", STRICT_ANCHORS),
                "严格模式判定锚点仍在（图层面板存在）")

        click_item(page, "layer-L3", "inner")
        page.wait_for_timeout(250)
        t.eq(tab_ids(page), [], "点图层项 → 不建标签 (got=%s)" % tab_ids(page))

        click_item(page, "layer-C1", "inner")
        page.wait_for_timeout(250)
        t.eq(tab_ids(page), [], "点图层里的画板节点（cid 与画布相同）→ 不建标签 (got=%s)" % tab_ids(page))

        click_item(page, "page-P2", "inner")
        page.wait_for_timeout(250)
        t.eq(tab_ids(page), [], "点页面项 → 不建标签 (got=%s)" % tab_ids(page))

        click_item(page, "orphan-ORPHAN", "inner")
        page.wait_for_timeout(250)
        t.eq(tab_ids(page), ["ORPHAN"],
             "无归属通用树项按「只排除页面/图层」判据接受 (got=%s)" % tab_ids(page))

        wait_poll(page)
        t.eq(tab_ids(page), ["ORPHAN"],
             "轮询后标签集合稳定（页面/图层项始终不建标签）(got=%s)" % tab_ids(page))
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "panel_t8")
    finally:
        ctx.close()
    return t


# ------------------------------------------------------------------ T9 兼容降级
def test_t9_fallback_legacy_dom(browser, base):
    t = Tester("T9 兼容降级：无面板容器的旧 DOM → 旧行为仍在")
    ctx, page = new_page(browser)
    try:
        boot(page, base, fixture=LEGACY_FIXTURE, history=["S1", "S2"])
        t.check(not page.evaluate("(s) => !!document.querySelector(s)", STRICT_ANCHORS),
                "旧夹具不含任何面板容器锚点 → 走兼容降级")

        ids = tab_ids(page)
        t.check(set(["S1", "S2"]).issubset(set(ids)), "历史项仍进标签栏 (got=%s)" % ids)

        # 点普通项 → 建标签（旧行为）
        page.click('[data-cid="S3"]')
        page.wait_for_timeout(250)
        t.check("S3" in tab_ids(page), "降级：点画布项仍建标签 (got=%s)" % tab_ids(page))

        # .folder 仍被排除
        page.click('[data-cid="SF"]')
        page.wait_for_timeout(250)
        t.check("SF" not in tab_ids(page), "降级：.folder 仍被排除 (got=%s)" % tab_ids(page))

        # 点标签仍能切回左侧项（旧行为不变）
        page.wait_for_timeout(150)
        page.click('.md-tab[data-id="S1"] .md-tab__label')
        page.wait_for_timeout(500)
        t.eq(active_tab(page), "S1", "降级：点标签仍能切换 (got=%r)" % active_tab(page))
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "panel_t9")
    finally:
        ctx.close()
    return t


# ------------------------------------------------------------------ T10 名称歧义
def test_t10_name_prefix_no_duplicate(browser, base):
    t = Tester("T10 名称前缀歧义（首页画布 / 首页画布 副本）→ 不产生重复标签")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        click_item(page, "canvas-C1", "inner")
        page.wait_for_timeout(250)
        click_item(page, "canvas-C2", "inner")     # 名称以 C1 名称为前缀
        page.wait_for_timeout(250)
        ids = tab_ids(page)
        t.eq(sorted(ids), ["C1", "C2"], "两个前缀同名画布各建一个标签 (got=%s)" % ids)
        t.eq(len(ids), len(set(ids)), "无重复标签 (got=%s)" % ids)

        # 名称反查兜底：标题设为 C1 名称 → 不应凭空造第二个同名标签
        page.evaluate("() => window.__mock.setTitle('首页画布')")
        poke(page)
        wait_poll(page)
        ids = tab_ids(page)
        t.eq(sorted(ids), ["C1", "C2"], "名称反查命中已有画布 → 标签集合不变 (got=%s)" % ids)
        t.eq(len(ids), len(set(ids)), "仍无重复标签 (got=%s)" % ids)

        # 再点一次 C1 → 仍不重复
        click_item(page, "canvas-C1", "inner")
        page.wait_for_timeout(250)
        ids = tab_ids(page)
        t.eq(len(ids), len(set(ids)), "再次点击 C1 → 无重复标签 (got=%s)" % ids)
        t.eq(ids[0], "C1", "C1 置顶 (got=%s)" % ids)
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "panel_t10")
    finally:
        ctx.close()
    return t


def test_t11_canvas_panel_unmounted_switch(browser, base):
    t = Tester("T11 画布列已卸载时点标签 → 绝不误点到图层面板的同 cid 节点")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        click_item(page, "canvas-C1", "inner")
        page.wait_for_timeout(250)
        t.eq(tab_ids(page), ["C1"], "前置：C1 标签已建立 (got=%s)" % tab_ids(page))

        # 用户切到「图层」tab：画布列被卸载（图层面板渲染，且含与 C1 同 cid 的节点）
        page.evaluate("() => window.__mock.setPanels({ page: true, canvas: false, layer: true })")
        pan = page.evaluate("() => window.__mock.panels()")
        t.check(pan["layer"] and not pan["canvas"], "画布列已卸载、图层面板已渲染 (got=%s)" % pan)

        reset_clicks(page)
        click_tab(page, "C1")
        page.wait_for_timeout(3500)          # 等定位链（搜索定位 2s + 滚动扫描）跑完
        log = click_log(page)
        t.check(not [c for c in log if c["panel"] == "layer"],
                "未误点到图层面板任何节点 (got=%s)" % [c["qa"] for c in log])
        t.check(not [c for c in log if c["panel"] == "page"],
                "未误点到页面列任何节点 (got=%s)" % [c["qa"] for c in log])
        t.check("C1" in tab_ids(page), "标签未被删除（定位失败只标待定/提示，不静默删标签）(got=%s)" % tab_ids(page))
        t.check("首页画布" in tab_names(page), "标签名称保持不变 (got=%s)" % tab_names(page))
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "panel_t11")
    finally:
        ctx.close()
    return t


def test_t12_negative_control(browser, base):
    """反向对照（negative control）：把 isCanvasPanelItem 在**内存中**还原为 v1.0.16
    的无条件接受（不改动磁盘源码），验证本夹具 + 断言确实能捕获原 BUG。
    若本用例也「不建标签」，说明 T1/T2 的通过是假通过（夹具不具对抗性）。"""
    t = Tester("T12 反向对照：屏蔽面板判定后，点页面/图层应复现原 BUG（证明 T1/T2 非假通过）")
    ctx, page = new_page(browser)
    try:
        patch = ("function isCanvasPanelItem(el, strict) {",
                 "function isCanvasPanelItem(el, strict) { return !!el; /* QA negative control */")
        boot(page, base, patch=patch)
        t.eq(tab_ids(page), [], "对照起点：无标签 (got=%s)" % tab_ids(page))

        click_item(page, "page-P1", "inner")
        page.wait_for_timeout(300)
        t.check("P1" in tab_ids(page),
                "对照：屏蔽面板判定后，点「页面」项复现原 BUG（长出无效标签）(got=%s)" % tab_ids(page))

        click_item(page, "layer-C1", "inner")
        page.wait_for_timeout(300)
        ids = tab_ids(page)
        t.check("C1" in ids, "对照：点「图层」项复现原 BUG（长出无效标签）(got=%s)" % ids)
        t.check("首页画布 / 矩形 1" in tab_names(page),
                "对照：图层节点名被写进标签栏（原 BUG 表现）(got=%s)" % tab_names(page))
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "panel_t12")
    finally:
        ctx.close()
    return t


def test_t13_blacklist_holds_without_strict(browser, base):
    """只剩「页面」列（「画布」列与「图层」列都未渲染）。
    此时**黑名单必须仍然无条件生效**：页面项依旧不能建标签，否则原 BUG 会在
    「画布列尚未渲染」这个真实存在的窗口期（首屏 / 面板折叠）复现。"""
    t = Tester("T13 画布列未渲染时，页面列项仍被黑名单拒绝")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        page.evaluate("() => window.__mock.setPanels({ page: true, canvas: false, layer: false })")
        pan = page.evaluate("() => window.__mock.panels()")
        t.check(pan["page"] and not pan["canvas"] and not pan["layer"],
                "仅页面列渲染 (got=%s)" % pan)
        t.check(not page.evaluate("() => !!document.querySelector('#screen-scroll-list, .screen-list-container')"),
                "「画布」列容器确实未渲染")

        click_item(page, "page-P1", "inner")
        page.wait_for_timeout(300)
        t.eq(tab_ids(page), [], "画布列未渲染时点页面项 → 仍被黑名单拒绝，不建标签 (got=%s)" % tab_ids(page))

        page.evaluate("() => window.__mock.setActive('page-P2')")
        poke(page)
        wait_poll(page)
        t.eq(tab_ids(page), [], "画布列未渲染时页面项 .is-active → 仍不建标签 (got=%s)" % tab_ids(page))

        # 判据语义锁定：无归属的通用树项按「只排除页面/图层」接受
        click_item(page, "orphan-ORPHAN", "inner")
        page.wait_for_timeout(300)
        t.eq(tab_ids(page), ["ORPHAN"],
             "无归属通用树项按「只排除」判据接受 (got=%s)" % tab_ids(page))
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "panel_t13")
    finally:
        ctx.close()
    return t


def test_t14_seed_once_then_no_autotab(browser, base):
    """真机 2026-09-11 发现的第二个缺陷：点页面 → 切页 → 新页画板变成 active、
    canvas-title 随之变化 → 名称反查兜底把新页画板建成了标签（用户看到「点页面
    后长出画板名标签」）。新语义（用户选定）：自动带出当前画板**只允许一次**
    （进入设计文件时），之后切页不再自动建标签，只有点击画布列才建。"""
    t = Tester("T14 仅进入文件时带出一次当前画板；之后切页不再自动建标签")
    ctx, page = new_page(browser)
    try:
        boot(page, base)

        # ① 进入文件：画布项 .is-active → 带出一次
        page.evaluate("() => window.__mock.setActive('canvas-C2')")
        poke(page)
        wait_poll(page)
        t.eq(tab_ids(page), ["C2"], "进入文件时带出当前画板一次 (got=%s)" % tab_ids(page))

        # ② 模拟「点页面切页」：标题变化 + 另一个画板变成激活
        page.evaluate(
            """() => {
                 window.__mock.setActive('canvas-C3');
                 window.__mock.setTitle('首页画布 副本');
               }"""
        )
        poke(page)
        wait_poll(page)
        t.eq(tab_ids(page), ["C2"],
             "切页后（画板激活变化 + canvas-title 变化）不自动新建标签 (got=%s)" % tab_ids(page))

        # ③ 页面项激活 → 不建标签（面板限定 + 种子已用掉，双重保险）
        page.evaluate("() => window.__mock.setActive('page-P1')")
        poke(page)
        wait_poll(page)
        t.eq(tab_ids(page), ["C2"], "页面项激活仍不建标签 (got=%s)" % tab_ids(page))

        # ④ 用户显式点画布 → 正常建标签（自动带出闸门不影响点击路径）
        click_item(page, "canvas-C3", "inner")
        page.wait_for_timeout(300)
        ids = tab_ids(page)
        t.check("C3" in ids, "点击画布仍正常建标签 (got=%s)" % ids)
        t.eq(len(ids), len(set(ids)), "无重复标签 (got=%s)" % ids)
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "panel_t14")
    finally:
        ctx.close()
    return t


def test_t15_seed_by_unique_title(browser, base):
    """进入设计文件时带出「当前画板」：
    - canvas-title 唯一命中画布列某一项 → 带出该画板（真机打开文件时画板项
      可能还没拿到 active class，只能靠标题反查）；
    - 命中同名歧义（多个画板同名）→ 不带出（避免「设备导入」式重标签幻影）；
    - 之后用户点页面切页（标题变化）→ 不再自动建标签。"""
    t = Tester("T15 进入文件按 canvas-title 唯一命中带出当前画板（歧义则不带出）")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        t.eq(tab_ids(page), [], "初始标题不匹配任何画板 → 不带出标签 (got=%s)" % tab_ids(page))

        # ① 标题指向唯一画板 C3（"订单详情"）→ 种子带出
        page.evaluate("() => window.__mock.setTitle('订单详情')")
        poke(page)
        wait_poll(page)
        t.eq(tab_ids(page), ["C3"], "标题唯一命中画板 → 进入文件带出该画板 (got=%s)" % tab_ids(page))

        # ② 点页面切页（标题变化）→ 种子窗口已关闭，不再自动建
        page.evaluate("() => window.__mock.setTitle('首页画布')")
        poke(page)
        wait_poll(page)
        t.eq(tab_ids(page), ["C3"], "切页后标题变化不再自动建标签 (got=%s)" % tab_ids(page))

        # ③ 点击画布仍然正常建
        click_item(page, "canvas-C1", "inner")
        page.wait_for_timeout(300)
        ids = tab_ids(page)
        t.check("C1" in ids, "点击画布仍正常建标签 (got=%s)" % ids)
        t.eq(len(ids), len(set(ids)), "无重复标签 (got=%s)" % ids)
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "panel_t15")
    finally:
        ctx.close()
    return t


def test_t16_seed_ambiguous_title_refused(browser, base):
    """标题反查命中「同名歧义」时不得带出（否则会凭空造出重标签）。
    夹具画布列里放入两个同名画板（C1/C2 均名「同名画板」），标题指向该名。"""
    t = Tester("T16 标题命中同名歧义 → 不带出（不制造重标签）")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        page.evaluate(
            """() => {
                 var ul = document.querySelector('#screen-scroll-list');
                 ['C1', 'C2'].forEach(function (cid) {
                   var li = ul.querySelector('li[data-cid="' + cid + '"]');
                   li.querySelector('.rn-list-item').textContent = '同名画板';
                 });
                 window.__mock.setTitle('同名画板');
               }"""
        )
        poke(page)
        wait_poll(page)
        t.eq(tab_ids(page), [], "同名歧义（两个画板同名）→ 不以标题反查带出标签 (got=%s)" % tab_ids(page))

        # 用户显式点其中之一 → 正常建（且只有一个）
        click_item(page, "canvas-C1", "inner")
        page.wait_for_timeout(300)
        t.eq(tab_ids(page), ["C1"], "显式点击同名画板之一 → 只建 1 个标签 (got=%s)" % tab_ids(page))
        t.check("同名画板" in tab_names(page), "标签名取自被点画板 (got=%s)" % tab_names(page))
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "panel_t16")
    finally:
        ctx.close()
    return t


def test_t17_canvas_item_without_whitelist_container(browser, base):
    """回归锁定（真机 2026-09-11）：画布项**不在**白名单容器里（模拟墨刀改版 /
    另一套画布列布局 / 挂载时机不同）也必须能建标签。
    反例即 v1.0.17 首次实现：判据要求「必须命中画布列白名单」，白名单一旦失配，
    真正的画布点击被全部拒掉 —— 用户实测「点画布不长标签」，比原 BUG 更严重。
    判据最终定为「只排除页面/图层」。"""
    t = Tester("T17 画布项不在白名单容器内 → 仍能建标签（白名单不得成为硬门槛）")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        # 摘掉「画布」列自身的容器锚点（模拟墨刀改版：该列容器 id/class 变了），条目本身不变。
        # 判据是「只排除页面/图层」，因此这不影响画布列的识别。
        page.evaluate(
            """() => {
                 var sc = document.querySelector('#screen-scroll-list');
                 if (sc) sc.removeAttribute('id');
                 var box = document.querySelector('.screen-list-container');
                 if (box) box.className = 'unknown-panel';
               }"""
        )
        page.wait_for_timeout(60)
        t.check(not page.evaluate("() => !!document.querySelector('#screen-scroll-list')"),
                "「画布」列容器锚点已失效")

        click_item(page, "canvas-C1", "inner")
        page.wait_for_timeout(250)
        t.eq(tab_ids(page), ["C1"], "锚点失效后点画布列仍能建标签 (got=%s)" % tab_ids(page))

        click_item(page, "canvas-C3", "inner")
        page.wait_for_timeout(250)
        t.eq(sorted(tab_ids(page)), ["C1", "C3"],
             "切换到另一个画布 → 新增第 2 个标签 (got=%s)" % tab_ids(page))

        # 同时页面列/图层列仍必须被拒（黑名单不依赖画布列锚点）
        click_item(page, "page-P1", "inner")
        click_item(page, "layer-L3", "inner")
        page.wait_for_timeout(250)
        t.eq(sorted(tab_ids(page)), ["C1", "C3"],
             "锚点失效时点页面/图层依然不建标签 (got=%s)" % tab_ids(page))
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "panel_t17")
    finally:
        ctx.close()
    return t


def test_t18_mousedown_path(browser, base):
    """回归锁定（真机 2026-09-14）：墨刀切换画板发生在按下阶段并会重渲染左栏，
    节点若在 mousedown 与 mouseup 之间被替换，浏览器**不会派发 click**
    （本项目早前也踩过同类「重排吞掉 click」的坑）→ 点画布没有任何标签。
    修复：同时监听 mousedown 与 click（touch 幂等，不会产生重复标签）。"""
    t = Tester("T18 只派发 mousedown（无 click）时，画布项也要建标签")
    ctx, page = new_page(browser)
    try:
        boot(page, base)

        # 只派发 mousedown（模拟 click 被重排吞掉）
        page.evaluate(
            """() => {
                 var el = document.querySelector('[data-qa="canvas-C1"] .rn-list-item');
                 var r = el.getBoundingClientRect();
                 var opt = { bubbles: true, cancelable: true, view: window,
                             clientX: Math.round(r.left + r.width / 2),
                             clientY: Math.round(r.top + r.height / 2) };
                 el.dispatchEvent(new MouseEvent('mousedown', opt));
               }"""
        )
        page.wait_for_timeout(300)
        t.eq(tab_ids(page), ["C1"], "仅 mousedown → 仍建出标签 (got=%s)" % tab_ids(page))

        # 页面项的 mousedown 仍不得建标签
        page.evaluate(
            """() => {
                 var el = document.querySelector('[data-qa="page-P1"] .rn-list-item');
                 el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
               }"""
        )
        page.wait_for_timeout(250)
        t.eq(tab_ids(page), ["C1"], "页面项 mousedown → 不建标签 (got=%s)" % tab_ids(page))

        # mousedown + click 都被派发（真实情况）→ 不得产生重复标签
        click_item(page, "canvas-C1", "inner")
        page.wait_for_timeout(300)
        t.eq(tab_ids(page), ["C1"], "mousedown+click 同一次交互 → 无重复标签 (got=%s)" % tab_ids(page))

        # 另一个画布：mousedown 路径同样生效
        page.evaluate(
            """() => {
                 var el = document.querySelector('[data-qa="canvas-C3"] .rn-list-item');
                 el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
               }"""
        )
        page.wait_for_timeout(300)
        t.eq(sorted(tab_ids(page)), ["C1", "C3"], "切换到另一个画布（仅 mousedown）→ 新增标签 (got=%s)" % tab_ids(page))
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "panel_t18")
    finally:
        ctx.close()
    return t


def test_t19_title_name_with_ordinal_prefix(browser, base):
    """真机 2026-09-14：画板项名字带序号前缀（「1 行李RFID标签编码规则」），
    而 .canvas-title 是不带前缀的名字 → 旧实现按原样字符串相等必然失配，
    「打开设计文件带出当前画板」因此不生效。修复：比对前归一化去掉序号前缀。"""
    t = Tester("T19 画板名带序号前缀时，标题反查仍能带出当前画板")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        # 把画布项名字改成带序号前缀的形态（真机形态），标题保持无前缀
        page.evaluate(
            """() => {
                 var ul = document.querySelector('#screen-scroll-list');
                 ul.querySelector('li[data-cid="C3"] .rn-list-item').textContent = '1 订单详情';
                 window.__mock.setTitle('订单详情');
               }"""
        )
        poke(page)
        wait_poll(page)
        t.eq(tab_ids(page), ["C3"],
             "标题「订单详情」匹配画板名「1 订单详情」（忽略序号前缀）→ 带出 C3 (got=%s)" % tab_ids(page))
        t.eq(tab_names(page), ["1 订单详情"], "标签名取自画板项 (got=%s)" % tab_names(page))
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "panel_t19")
    finally:
        ctx.close()
    return t


def main():
    httpd, base = start_server()
    total_fails = 0
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
            total_fails += test_t0_fixture_contract(browser, base).summary()
            total_fails += test_t1_click_page_no_tab(browser, base).summary()
            total_fails += test_t2_click_layer_no_tab(browser, base).summary()
            total_fails += test_t3_click_canvas_creates_tab(browser, base).summary()
            total_fails += test_t4_empty_name_no_tab(browser, base).summary()
            total_fails += test_t5_active_state_narrowed(browser, base).summary()
            total_fails += test_t6_switch_clicks_canvas_node(browser, base).summary()
            total_fails += test_t7_only_canvas_panel(browser, base).summary()
            total_fails += test_t8_only_layer_panel(browser, base).summary()
            total_fails += test_t9_fallback_legacy_dom(browser, base).summary()
            total_fails += test_t10_name_prefix_no_duplicate(browser, base).summary()
            total_fails += test_t11_canvas_panel_unmounted_switch(browser, base).summary()
            total_fails += test_t12_negative_control(browser, base).summary()
            total_fails += test_t13_blacklist_holds_without_strict(browser, base).summary()
            total_fails += test_t14_seed_once_then_no_autotab(browser, base).summary()
            total_fails += test_t15_seed_by_unique_title(browser, base).summary()
            total_fails += test_t16_seed_ambiguous_title_refused(browser, base).summary()
            total_fails += test_t17_canvas_item_without_whitelist_container(browser, base).summary()
            total_fails += test_t18_mousedown_path(browser, base).summary()
            total_fails += test_t19_title_name_with_ordinal_prefix(browser, base).summary()
            print("\n==== 三面板收窄验证总计：%d 失败 ====" % total_fails)
            os._exit(1 if total_fails else 0)
    except Exception:
        import traceback
        traceback.print_exc()
        os._exit(1)


if __name__ == "__main__":
    main()
