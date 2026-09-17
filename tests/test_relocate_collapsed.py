# -*- coding: utf-8 -*-
"""
tests/test_relocate_collapsed.py — 折叠/滚动场景「定位与左栏选中态」回归与需求锁定

被测缺陷 1：v1.0.17 引入的「未找到画布」（BUG-0012 / BUG-0013，C/D 组）
--------------------------------------------------------------------
用户原话（2026-09-16）：
「曾经打开的画布仍在左侧顶部画布列表中，只是被收缩折叠不可见，点击画布标签提示：
未找到画布，请先在左侧画布栏展开或滚动到它，再点击标签切换。」
需求：列表中的画布**无论被收缩折叠、还是因滚动不在可见区域**，点画布标签都要能
      定位到它在左栏的位置并显示画布内容。

被测缺陷 2：点标签后「左栏列表刷新回到顶部」（BUG-0014，E 组）
------------------------------------------------------------
用户真机现象（2026-09-16 追问确认）：「点标签能切换但不定位到画布在画布列表的位置」，
追问后明确「（左栏列表）刷新了一下回到了列表顶部」；期望「滚动 + 设为左栏选中态」。
根因：原实现只在**点击前**滚一次（scrollIntoView），墨刀切换画布时重渲染左栏并把
滚动容器 scrollTop 复位（含重建行节点）→ 刚滚到位立刻被冲掉 → 列表回到顶部；且
isRowVisible 只判「是否在渲染树」，不判「是否在滚动容器可视区内」。
修复：新增 isRowInScroller / getRowScroller / scrollRowIntoView / keepRowVisible
      （点击后再滚 + 复查 + 用户手动滚动即放弃）+ 改进 getCanvasScrollContainer
      起点 + 落左栏选中态 md-rt-located。

版本归属
--------
v1.0.16 及更早：正常。v1.0.17：引入（BUG-0012）。
根因（v1.0.16→v1.0.17 源码差异推导）：v1.0.17 把「下部页面列」的容器类名
（#canvas-scroll-list / .canvas-scroll-list / .canvas-sortable-list /
#mb-enabled-canvas-list）放进 findCanvasEl 黑名单，一律拒绝其中的同 cid 行；
真机上「画布」列在**存在分组或需要滚动**时行的外层会被同一个 sortable 列表组件
包住 → 类名命中黑名单 → 行即使在 DOM 里也永远查不到。

夹具
----
tests/fixtures/mock-modao-design-collapsed.html（真机三面板 DOM 契约 + 分组折叠 +
滚动虚拟渲染 + 分组行外层为 `div.canvas-sortable-list`＝黑名单名容器）

用例（断言按三组标注，A/B 判读见文件末尾 LEGEND）
----
  C0 夹具契约自检（对抗性充分性：分组行确实嵌在黑名单名容器里、折叠后不可见）
  C1 【回归主例】被收缩折叠不可见 → 点标签必须展开定位 + 切过去
  C2 【回归主例】因滚动不在可见区域（未渲染）→ 点标签必须滚动定位 + 切过去
  C3 【回归】折叠分组内的行点它也要能建标签（防「点画布不长标签」）
  C4 【保护】图层列同 cid 节点 → 点标签绝不误点图层（v1.0.17 成果不得回退）
  C5 【保护】画布列整体卸载 → 绝不误点页面/图层列；标签保留 + 待定 + 可见提示（v1.0.17 成果）
  D1 【回归】画布列容器锚点被改版换名 + 行被 sortable 容器包住 → 点标签必须定位并切换
  D2 【回归】锚点改名 + 行折叠隐藏 → 点标签必须展开定位并切换
  D3 【保护】锚点改名时，带 layer-item 的页面列/图层列同 cid 节点仍不得被点
  D4 【回归】锚点改名时，未知面板里同 cid 的杂散行（无 layer-item）不得抢占真画布行
  E1 【回归】全量渲染 + 目标行滚出可视区（仍在 DOM）→ 点标签必须滚回可视区并切换
  E2 【需求】叠加「切换后重渲染左栏 + 滚动归零」→ 目标行仍须在可视区（锁用户真机现象
             「刷新了一下回到了列表顶部」，BUG-0014）
  E3 【需求】点标签后左栏目标行呈选中态（md-rt-located），且标记可逆、无残留
  E4 【保护】切换后用户立刻手动滚动 → 我方纠偏必须立即放弃，不得抢回
  E5 【保护】全量渲染下点标签不得点到页面列/图层列同 cid 行

断言分组
--------
  【回归】v1.0.16 与当前修复版行为必须一致；v1.0.17 必须失败  ← 用于证明「本次是回归」
  【需求】本版新增的行为（切换复位后保持定位 / 左栏选中态）；v1.0.16 不满足属预期
  【保护】v1.0.17 建立的收窄（不误点页面/图层、不静默删标签）+ 本版新增保护
          （用户手动滚动不被抢回）；v1.0.16 不满足属预期
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
from harness import start_server, Tester, screenshot, new_page

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "mock-modao-design-collapsed.html")
CID = "FOLDCID"

CARRIER = "ext"          # --carrier ext|desktop
CORE_PATH = None         # --core <path>：注入任意版本核心做 A/B（默认用 carrier 目录下的）


def core_file():
    if CORE_PATH:
        return CORE_PATH
    src = PROJECT_ROOT if CARRIER == "ext" else os.path.join(PROJECT_ROOT, "desktop")
    return os.path.join(src, "recent-tabs-core.js")


def boot(page, base):
    page.goto(base + "/workspace", wait_until="load")
    page.evaluate("() => { localStorage.clear(); }")
    with open(FIXTURE, encoding="utf-8") as f:
        page.set_content(f.read())
    page.evaluate("(c) => history.replaceState({}, '', '/proto/design/' + c)", CID)
    src = PROJECT_ROOT if CARRIER == "ext" else os.path.join(PROJECT_ROOT, "desktop")
    page.add_style_tag(path=os.path.join(src, "tabbar.css"))
    page.add_script_tag(path=os.path.join(src, "tabbar.js"))
    with open(core_file(), encoding="utf-8") as f:
        page.add_script_tag(content=f.read())
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


def tab_ids(page):
    return page.evaluate(
        "() => Array.from(document.querySelectorAll('.md-tab')).map(function(e){"
        " return e.getAttribute('data-id'); })"
    )


def click_tab(page, tid):
    page.evaluate(
        """(id) => {
            var t = document.querySelector('.md-tab[data-id="' + id + '"] .md-tab__label');
            if (!t) throw new Error('tab not found: ' + id);
            t.click();
        }""",
        tid,
    )


def click_left(page, cid):
    """点左栏画布列里的行（真实鼠标；调用前该行必须可见）。"""
    page.click('[data-qa="canvas-%s"] > div.rn-list-item' % cid)


def make_tab(page, cid):
    """在**未被 sortable 容器包住**的状态下点左栏行建标签（任何版本都能建），
    然后回到「被包住」的真实态（真机只在分组 / 需要滚动时复用该组件）。
    这样 C1/C2 的起点（标签已存在）与版本无关，定位失败才归因于 v1.0.17 的黑名单收窄。"""
    page.evaluate("() => window.__mock.setWrapped(false)")
    page.evaluate("() => window.__mock.setGroupOpen(true)")
    ok = page.evaluate("(c) => window.__mock.scrollToCid(c)", cid)
    page.wait_for_timeout(120)
    if not ok:
        return False
    click_left(page, cid)
    page.wait_for_timeout(250)
    page.evaluate("() => window.__mock.setWrapped(true)")
    return cid in tab_ids(page)


def build_tab_unwrapped(page, cid):
    """D1/D2/D3/D4 的起点构造：在「画布列锚点已被改版换名」+「行未被 sortable 容器包住」
    态点左栏行建标签。此态下 classify 结果为 other，**各版本都能建标签**（含 v1.0.16 /
    v1.0.17），故起点与版本无关；随后调用方再切到目标态（被包住 / 折叠隐藏）点标签，
    定位失败才归因于「定位依赖容器锚点识别」这一缺陷（BUG-0013）。"""
    page.evaluate("() => window.__mock.setAnchorRenamed(true)")
    page.evaluate("() => window.__mock.setWrapped(false)")
    page.evaluate("() => window.__mock.setGroupOpen(true)")
    ok = page.evaluate("(c) => window.__mock.scrollToCid(c)", cid)
    page.wait_for_timeout(120)
    if not ok:
        return False
    click_left(page, cid)
    page.wait_for_timeout(250)
    return cid in tab_ids(page)


def anchors_renamed_gone(page):
    """当前文档里是否**没有任何已知「画布」列容器锚点**匹配（模拟改版换名）。"""
    return page.evaluate(
        "() => !document.querySelector('#screen-scroll-list, #screen_list,"
        " .screen-list-container, #mobile-screen-tree')"
    )


def toast_text(page):
    return page.evaluate(
        "() => { var e = document.querySelector('.md-recent-tabs__toast-text');"
        " return e ? e.textContent : ''; }"
    )


def toast_visible(page):
    return page.evaluate(
        "() => { var e = document.querySelector('.md-recent-tabs__toast');"
        " return !!e && e.classList.contains('is-visible'); }"
    )


def wait_toast(page, timeout_ms=5000):
    """轮询等待 toast 出现（toast 数秒后自动淡出，只在末尾查会漏判）。
    返回出现过且可见时的文案；从未出现返回空串。"""
    seen = ""
    waited = 0
    while waited < timeout_ms:
        if toast_visible(page):
            seen = toast_text(page)
            if seen:
                return seen
        page.wait_for_timeout(100)
        waited += 100
    return seen


def hide_toast(page):
    page.evaluate(
        "() => { var e = document.querySelector('.md-recent-tabs__toast');"
        " if (e) e.classList.remove('is-visible'); }"
    )


def reset_title(page, t="未切换（点标签前）"):
    """把画布标题改成一个不可能撞车的值，避免「标题本来就等于目标名」造成假通过。"""
    page.evaluate("(v) => window.__mock.setTitle(v)", t)


def is_stale(page, cid):
    return page.evaluate(
        "() => !!document.querySelector('.md-tab[data-id=\"%s\"][data-stale]')" % cid
    )


def click_log(page):
    return page.evaluate("() => window.__mock.clickLog()")


def reset_clicks(page):
    page.evaluate("() => window.__mock.resetClicks()")


# ------------------------------------------------------------------ C0 夹具自检
def test_c0_fixture_contract(browser, base):
    t = Tester("C0 夹具契约自检（分组行嵌在黑名单名容器内、折叠后不可见）")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        probe = page.evaluate(
            """() => {
                 var p = window.__mock.panels();
                 var wrap = document.getElementById('group-rows-wrap');
                 var row = document.querySelector('[data-qa="canvas-G05"]');
                 var blacklist = ['#mb-enabled-canvas-list', '#canvas-scroll-list',
                                  '.canvas-scroll-list', '.canvas-sortable-list'];
                 var hit = null;
                 for (var i = 0; i < blacklist.length; i++) {
                   if (row.closest(blacklist[i])) { hit = blacklist[i]; break; }
                 }
                 return {
                   panels: p,
                   inCanvasColumn: !!row.closest('#screen-scroll-list, .screen-list-container'),
                   blacklistHit: hit,
                   wrapCls: wrap.className,
                   inDomWhileCollapsed: !!document.querySelector('[data-qa="canvas-G05"]'),
                   visibleWhileCollapsed: window.__mock.isVisible('G05'),
                   scrollerMax: window.__mock.scrollerMax(),
                   wrappedByDefault: window.__mock.isWrapped(),
                   topLevelDistinct: !!document.querySelector('[data-qa="canvas-C0"]')
                 };
            }"""
        )
        t.check(probe["panels"]["canvas"] and probe["panels"]["page"] and probe["panels"]["layer"],
                "三列（画布 / 页面 / 图层）同时渲染 (got=%s)" % probe["panels"])
        t.check(probe["inCanvasColumn"], "分组行在「画布」列容器内（#screen-scroll-list）")
        t.check(probe["blacklistHit"] == ".canvas-sortable-list",
                "分组行外层命中 v1.0.17 黑名单名容器（对抗性前提）(got=%r)" % probe["blacklistHit"])
        t.check(probe["inDomWhileCollapsed"],
                "折叠态下分组行**仍在 DOM**（复现「折叠但节点存在」）")
        t.check(not probe["visibleWhileCollapsed"],
                "折叠态下分组行不可见（复现「被收缩折叠不可见」）")
        t.check(probe["wrappedByDefault"], "默认处于「被 sortable 容器包住」状态（真机分组态）")
        page.evaluate("() => window.__mock.setGroupOpen(true)")
        page.wait_for_timeout(80)
        t.check(page.evaluate("() => window.__mock.scrollerMax()") > 8,
                "画布列可滚动（滚动虚拟渲染场景前提）(got=%s)"
                % page.evaluate("() => window.__mock.scrollerMax()"))
        t.check(not page.evaluate("() => window.__mock.inDom('G30')"),
                "展开后滚出视口的行未被渲染（滚动不可见场景前提）")
        page.evaluate("() => window.__mock.setWrapped(false)")
        t.check(not page.evaluate("() => !!document.querySelector('#group-rows-wrap.canvas-sortable-list')"),
                "可切换到「未被包住」状态（供与版本无关地建标签）")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "fold_c0")
    finally:
        ctx.close()
    return t


# ------------------------------------------------------- C1 折叠不可见 → 必须可定位
def test_c1_collapsed_hidden_relocate(browser, base):
    t = Tester("C1 被收缩折叠不可见 → 点标签必须定位到左栏并切过去")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        t.check(make_tab(page, "G05"), "前置：G05 标签已建立 (tabs=%s)" % tab_ids(page))
        page.evaluate("() => window.__mock.setGroupOpen(false)")
        page.wait_for_timeout(150)
        t.check(page.evaluate("() => window.__mock.inDom('G05')"),
                "前置：折叠后 G05 行仍在 DOM")
        t.check(not page.evaluate("() => window.__mock.isVisible('G05')"),
                "前置：折叠后 G05 行不可见")
        hide_toast(page)
        reset_title(page)
        reset_clicks(page)

        click_tab(page, "G05")
        page.wait_for_timeout(1200)

        t.check("历史画布 05" in page.evaluate("() => window.__mock.title()"),
                "【回归】点标签后画布已切换（显示画布内容）(title=%r)"
                % page.evaluate("() => window.__mock.title()"))
        t.check(not wait_toast(page, 1500),
                "【回归】不再弹「未找到画布」提示")
        t.check("G05" in tab_ids(page), "【回归】标签仍在 (tabs=%s)" % tab_ids(page))
        hits = [c for c in click_log(page) if c["cid"] == "G05"]
        t.check(bool(hits), "【回归】确实点到了左侧 G05 行 (log=%s)" % click_log(page))
        t.check(all(c["panel"] == "canvas" for c in hits),
                "【保护】点击落在「画布」列 (got=%s)" % [c["panel"] for c in hits])
        t.check(page.evaluate("() => window.__mock.isVisible('G05')"),
                "【需求】被折叠的行被自动展开并定位到可见（定位到画布所在位置）")
        t.check(page.evaluate("() => window.__mock.isGroupOpen()"),
                "【需求】包含该行的分组已被展开")
        t.check(not is_stale(page, "G05"), "【需求】定位成功后标签未被标记为待定")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "fold_c1")
    finally:
        ctx.close()
    return t


# ------------------------------------------------- C2 滚动不在可见区域 → 必须可定位
def test_c2_scrolled_out_relocate(browser, base):
    t = Tester("C2 因滚动不在可见区域（未渲染）→ 点标签必须滚动定位并切过去")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        t.check(make_tab(page, "G30"), "前置：G30 标签已建立 (tabs=%s)" % tab_ids(page))
        # 滚回顶部 → G30 行滚出渲染窗口（不在 DOM）
        page.evaluate(
            """() => { document.getElementById('screen-scroll-list').scrollTop = 0;
                       window.__mock.render(); }"""
        )
        page.wait_for_timeout(150)
        t.check(page.evaluate("() => window.__mock.isGroupOpen()"), "前置：分组处于展开态")
        t.check(not page.evaluate("() => window.__mock.inDom('G30')"),
                "前置：G30 行因滚出视口未渲染（不在 DOM）")
        hide_toast(page)
        reset_title(page)
        reset_clicks(page)

        click_tab(page, "G30")
        page.wait_for_timeout(1600)      # 滚动扫描最多 ~24 步 × 24ms + 定位轮询余量

        t.check("历史画布 30" in page.evaluate("() => window.__mock.title()"),
                "【回归】点标签后画布已切换 (title=%r)" % page.evaluate("() => window.__mock.title()"))
        t.check(not wait_toast(page, 1500), "【回归】不再弹「未找到画布」提示")
        t.check("G30" in tab_ids(page), "【回归】标签仍在 (tabs=%s)" % tab_ids(page))
        hits = [c for c in click_log(page) if c["cid"] == "G30"]
        t.check(bool(hits), "【回归】确实点到了左侧 G30 行 (log=%s)" % click_log(page))
        t.check(page.evaluate("() => window.__mock.isVisible('G30')"),
                "【需求】滚动把 G30 带回可见区域（定位到画布所在位置）")
        t.check(not is_stale(page, "G30"), "【需求】定位成功后标签未被标记为待定")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "fold_c2")
    finally:
        ctx.close()
    return t


# ------------------------------------------------- C3 分组内的行也能建标签（判据补充）
def test_c3_group_row_creates_tab(browser, base):
    t = Tester("C3 画布列内、被 sortable 容器包住的分组行 → 点它也要能建标签")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        page.evaluate("() => window.__mock.setGroupOpen(true)")
        page.evaluate("() => window.__mock.scrollToCid('G07')")
        page.wait_for_timeout(120)
        click_left(page, "G07")
        page.wait_for_timeout(300)
        t.check("G07" in tab_ids(page),
                "【回归】折叠分组内的画布行点它仍能建标签（防「点画布不长标签」）(tabs=%s)"
                % tab_ids(page))
        t.check("历史画布 07" in page.evaluate(
            "() => { var e = document.querySelector('.md-tab[data-id=\"G07\"] .md-tab__label');"
            " return e ? e.textContent : ''; }"),
            "【回归】标签名取自该画布")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "fold_c3")
    finally:
        ctx.close()
    return t


# --------------------------------------------- C4 图层列同 cid 节点绝不误点（不得回退）
def test_c4_never_click_layer_node(browser, base):
    t = Tester("C4 图层列存在同 cid 节点 → 点标签绝不误点图层（v1.0.17 成果）")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        t.check(make_tab(page, "G05"), "前置：G05 标签已建立 (tabs=%s)" % tab_ids(page))
        page.evaluate("() => window.__mock.setGroupOpen(false)")
        page.wait_for_timeout(120)
        t.check(page.evaluate("() => !!document.querySelector('[data-qa=\"layer-G05\"]')"),
                "图层列里存在与 G05 同 cid 的节点")
        reset_title(page)
        reset_clicks(page)

        click_tab(page, "G05")
        page.wait_for_timeout(1000)

        log = click_log(page)
        t.check(not [c for c in log if c["panel"] == "layer"],
                "【保护】未误点图层列任何节点 (log=%s)" % log)
        t.check(not [c for c in log if c["panel"] == "page"],
                "【保护】未误点页面列任何节点 (log=%s)" % log)
        t.check("G05" in tab_ids(page), "【保护】标签仍在 (tabs=%s)" % tab_ids(page))
        t.check("历史画布 05" in page.evaluate("() => window.__mock.title()"),
                "【回归】画布已切换 (title=%r)" % page.evaluate("() => window.__mock.title()"))
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "fold_c4")
    finally:
        ctx.close()
    return t


# --------------------------------- C5 画布列整体卸载 → 不得误点其它列 + 保留标签与提示
def test_c5_canvas_column_unmounted(browser, base):
    t = Tester("C5 画布列整体卸载 → 绝不误点页面/图层层；标签保留 + 待定 + 可见提示")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        t.check(make_tab(page, "G05"), "前置：G05 标签已建立 (tabs=%s)" % tab_ids(page))
        page.evaluate("() => window.__mock.setPanels({ canvas: false, page: true, layer: true })")
        page.wait_for_timeout(120)
        t.check(not page.evaluate("() => window.__mock.panels()['canvas']"),
                "前置：画布列已卸载")
        reset_clicks(page)

        click_tab(page, "G05")
        seen_toast = wait_toast(page, 5000)
        page.wait_for_timeout(200)

        log = click_log(page)
        t.check(not [c for c in log if c["panel"] == "layer"],
                "【保护】未误点图层列任何节点 (log=%s)" % log)
        t.check(not [c for c in log if c["panel"] == "page"],
                "【保护】未误点页面列任何节点 (log=%s)" % log)
        t.check("G05" in tab_ids(page), "【保护】标签未被静默删除 (tabs=%s)" % tab_ids(page))
        t.check(is_stale(page, "G05"), "【保护】标签被标记为待定 (stale)")
        t.check("未找到画布" in seen_toast,
                "【保护】出现可见提示且文案说明原因 (toast=%r)" % seen_toast)
        # 画布列恢复渲染 → 待定应被轮询复核撤销
        page.evaluate("() => window.__mock.setPanels({ canvas: true })")
        page.wait_for_timeout(2600)
        t.check(page.evaluate("() => window.__mock.panels()['canvas']"),
                "画布列已恢复渲染")
        t.check(not is_stale(page, "G05"),
                "【需求】画布列恢复后待定标记自动撤销")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "fold_c5")
    finally:
        ctx.close()
    return t


# ======================= D1 锚点改名 + 被 sortable 容器包住 → 必须定位 =======================
def test_d1_renamed_anchor_wrapped_relocate(browser, base):
    """BUG-0013 锁定用例：把「画布」列的**容器锚点**改版换名（模拟墨刀改版），真画布行
    依旧存在、且仍被 `.canvas-sortable-list`（黑名单名容器）包住 —— 此时点标签必须仍能
    定位并切换。v1.0.16 通过、v1.0.18（含 v1.0.17）失败：证明定位不得依赖容器锚点识别。"""
    t = Tester("D1 画布列锚点被改版换名 + 行被 sortable 容器包住 → 点标签必须定位并切换")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        t.check(build_tab_unwrapped(page, "G05"), "前置：G05 标签已建立 (tabs=%s)" % tab_ids(page))
        page.evaluate("() => window.__mock.setWrapped(true)")
        page.wait_for_timeout(120)
        t.check(anchors_renamed_gone(page),
                "前置：无任何已知「画布」列容器锚点匹配（模拟改版换名）")
        t.check(page.evaluate("() => window.__mock.inDom('G05')"), "前置：G05 行仍在 DOM")
        t.check(page.evaluate("() => window.__mock.isVisible('G05')"), "前置：G05 行可见（被包住但展开）")
        hide_toast(page)
        reset_title(page)
        reset_clicks(page)

        click_tab(page, "G05")
        page.wait_for_timeout(1400)

        t.check("历史画布 05" in page.evaluate("() => window.__mock.title()"),
                "【回归】点标签后画布已切换 (title=%r)" % page.evaluate("() => window.__mock.title()"))
        t.check(not wait_toast(page, 1500), "【回归】不再弹「未找到画布」提示")
        t.check("G05" in tab_ids(page), "【回归】标签仍在 (tabs=%s)" % tab_ids(page))
        hits = [c for c in click_log(page) if c["cid"] == "G05"]
        t.check(bool(hits), "【回归】确实点到了左侧 G05 行 (log=%s)" % click_log(page))
        t.check(all(c["panel"] == "canvas" for c in hits),
                "【保护】点击落在「画布」列 (got=%s)" % [c["panel"] for c in hits])
        t.check(not [c for c in click_log(page) if c["panel"] in ("layer", "page")],
                "【保护】未误点页面/图层列任何节点 (log=%s)" % click_log(page))
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "fold_d1")
    finally:
        ctx.close()
    return t


# ======================= D2 锚点改名 + 折叠隐藏 → 必须展开定位 =======================
def test_d2_renamed_anchor_collapsed_relocate(browser, base):
    """锚点改名 + 行被收缩折叠不可见 → 点标签必须展开分组、定位到可见并切换。"""
    t = Tester("D2 画布列锚点改名 + 行折叠隐藏 → 点标签必须展开定位并切换")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        t.check(build_tab_unwrapped(page, "G05"), "前置：G05 标签已建立 (tabs=%s)" % tab_ids(page))
        page.evaluate("() => window.__mock.setWrapped(true)")
        page.evaluate("() => window.__mock.setGroupOpen(false)")
        page.wait_for_timeout(150)
        t.check(anchors_renamed_gone(page), "前置：画布列锚点已失效")
        t.check(page.evaluate("() => window.__mock.inDom('G05')"), "前置：折叠后 G05 行仍在 DOM")
        t.check(not page.evaluate("() => window.__mock.isVisible('G05')"),
                "前置：折叠后 G05 行不可见")
        hide_toast(page)
        reset_title(page)
        reset_clicks(page)

        click_tab(page, "G05")
        page.wait_for_timeout(1400)

        t.check("历史画布 05" in page.evaluate("() => window.__mock.title()"),
                "【回归】点标签后画布已切换 (title=%r)" % page.evaluate("() => window.__mock.title()"))
        t.check(not wait_toast(page, 1500), "【回归】不再弹「未找到画布」提示")
        t.check("G05" in tab_ids(page), "【回归】标签仍在 (tabs=%s)" % tab_ids(page))
        hits = [c for c in click_log(page) if c["cid"] == "G05"]
        t.check(bool(hits), "【回归】确实点到了左侧 G05 行 (log=%s)" % click_log(page))
        t.check(all(c["panel"] == "canvas" for c in hits),
                "【保护】点击落在「画布」列 (got=%s)" % [c["panel"] for c in hits])
        t.check(not [c for c in click_log(page) if c["panel"] in ("layer", "page")],
                "【保护】未误点页面/图层列任何节点 (log=%s)" % click_log(page))
        t.check(page.evaluate("() => window.__mock.isVisible('G05')"),
                "【需求】被折叠的行被自动展开并定位到可见")
        t.check(page.evaluate("() => window.__mock.isGroupOpen()"),
                "【需求】包含该行的分组已被展开")
        t.check(not is_stale(page, "G05"), "【需求】定位成功后标签未被标记为待定")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "fold_d2")
    finally:
        ctx.close()
    return t


# ============ D3 锚点改名时，带 layer-item 的页面/图层列同 cid 节点绝不误点 ============
def test_d3_renamed_anchor_protection(browser, base):
    """锚点改名（容器识别失灵）时，仍必须靠**行签名（layer-item）**把带 layer-item 的
    「页面」列 / 「图层」列同 cid 节点拒掉 —— 这是 v1.0.17 成果不得回退的底线。"""
    t = Tester("D3 锚点改名时，带 layer-item 的页面列/图层列同 cid 节点仍不得被点")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        t.check(build_tab_unwrapped(page, "G05"), "前置：G05 标签已建立 (tabs=%s)" % tab_ids(page))
        page.evaluate("() => window.__mock.setWrapped(true)")
        page.evaluate("() => window.__mock.setGroupOpen(true)")
        page.evaluate("(c) => window.__mock.scrollToCid(c)", "G05")
        page.wait_for_timeout(150)
        t.check(anchors_renamed_gone(page), "前置：画布列锚点已失效（模拟改版换名）")
        t.check(page.evaluate("() => !!document.querySelector('[data-qa=\"layer-G05\"]')"),
                "前置：图层列存在与 G05 同 cid 的节点（对抗性前提）")
        t.check(page.evaluate("() => document.querySelector('[data-qa=\"layer-G05\"] .rn-list-item')"
                              ".classList.contains('layer-item')"),
                "前置：该图层同 cid 节点行项带 layer-item")
        reset_title(page)
        reset_clicks(page)

        click_tab(page, "G05")
        page.wait_for_timeout(1200)

        log = click_log(page)
        t.check(not [c for c in log if c["panel"] == "layer"],
                "【保护】未误点图层列任何节点 (log=%s)" % log)
        t.check(not [c for c in log if c["panel"] == "page"],
                "【保护】未误点页面列任何节点 (log=%s)" % log)
        t.check("G05" in tab_ids(page), "【保护】标签仍在 (tabs=%s)" % tab_ids(page))
        t.check("历史画布 05" in page.evaluate("() => window.__mock.title()"),
                "【回归】画布已切换到「画布」列的 G05 节点 (title=%r)"
                % page.evaluate("() => window.__mock.title()"))
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "fold_d3")
    finally:
        ctx.close()
    return t


# ====== D4 未知面板里同 cid 的杂散行不得抢占真画布行（优先级不得反转）======
def test_d4_stray_same_cid_not_preferred(browser, base):
    """QA 复核 BUG-0013 发现：若优先级把「无归属」的 other 排在画布列行之前，则
    「未知面板里、无 layer-item、不在任何已知容器内、且与目标同 cid」的杂散行会被误点。
    本用例注入这样一条杂散行，断言点标签仍命中「画布」列的真 G05 行。"""
    t = Tester("D4 锚点改名时，未知面板里同 cid 的杂散行不得抢占真画布行")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        t.check(build_tab_unwrapped(page, "G05"), "前置：G05 标签已建立 (tabs=%s)" % tab_ids(page))
        page.evaluate("() => window.__mock.setWrapped(true)")
        page.evaluate("() => window.__mock.setGroupOpen(true)")
        page.evaluate("(c) => window.__mock.scrollToCid(c)", "G05")
        page.wait_for_timeout(120)
        # 注入「未知面板」里的同 cid 杂散行：无 layer-item、不在任何已知画布/图层/页面列容器内
        page.evaluate(
            """() => {
                 var box = document.createElement('div');
                 box.className = 'unknown-panel';
                 box.id = 'stray-panel';
                 var li = document.createElement('li');
                 li.className = 'rn-content-item';
                 li.setAttribute('data-cid', 'G05');
                 li.setAttribute('data-qa', 'stray-G05');
                 var inner = document.createElement('div');
                 inner.className = 'rn-list-item';
                 inner.setAttribute('data-cid', 'G05');
                 inner.setAttribute('data-interactive-target-type', '');
                 inner.textContent = '杂散 05';
                 li.appendChild(inner);
                 box.appendChild(li);
                 document.querySelector('.rn-sidebar').appendChild(box);
               }"""
        )
        page.wait_for_timeout(80)
        t.check(page.evaluate("() => !!document.querySelector('[data-qa=\"stray-G05\"]')"),
                "前置：未知面板里的同 cid 杂散行已注入（对抗性前提）")
        reset_title(page)
        reset_clicks(page)

        click_tab(page, "G05")
        page.wait_for_timeout(1200)

        title = page.evaluate("() => window.__mock.title()")
        t.check("历史画布 05" in title,
                "【回归】点到的是「画布」列的真 G05 行，而非未知面板杂散行 (title=%r)" % title)
        hits = [c for c in click_log(page) if c["cid"] == "G05"]
        t.check(bool(hits), "【回归】确实点到了左侧 G05 行 (log=%s)" % click_log(page))
        t.check(all(c["panel"] == "canvas" for c in hits),
                "【保护】被点的 G05 行位于「画布」列 (got=%s)" % [c["panel"] for c in hits])
        t.check(not [c for c in click_log(page) if c.get("panel") == "orphan"],
                "【保护】未点到未知面板里的杂散行 (log=%s)" % click_log(page))
        t.check("G05" in tab_ids(page), "【保护】标签仍在 (tabs=%s)" % tab_ids(page))
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "fold_d4")
    finally:
        ctx.close()
    return t


# =================== E 组：点标签后「定位到列表位置 + 左栏选中态」（BUG-0014） ===================
# 用户真机现象（2026-09-16 追问确认）：「点标签能切换但不定位到画布在画布列表的位置」，
#   追问后明确「（左栏列表）刷新了一下回到了列表顶部」；期望「滚动 + 设为左栏选中态」。
# 根因：原实现只在**点击前**滚一次（scrollIntoView），墨刀切换画布时重渲染左栏并把
#   滚动容器 scrollTop 复位（含重建行节点）→ 刚滚到位立刻被冲掉 → 列表回到顶部；
#   且 isRowVisible 只判「是否在渲染树」，不判「是否在滚动容器可视区内」。
# 起点构造与版本无关：先在「未包住」态点行建标签，再切到全量渲染并滚回顶部。


def setup_full_render_scrolled_out(page, cid):
    """E 组起点：标签已建立 + 全量渲染 + 目标行滚出可视区（仍在 DOM）。"""
    page.evaluate("() => window.__mock.setWrapped(false)")
    page.evaluate("() => window.__mock.setGroupOpen(true)")
    ok = page.evaluate("(c) => window.__mock.scrollToCid(c)", cid)
    page.wait_for_timeout(120)
    if not ok:
        return False
    click_left(page, cid)
    page.wait_for_timeout(250)
    page.evaluate("() => window.__mock.setWrapped(true)")
    page.evaluate("() => window.__mock.setFullRender(true)")
    page.evaluate("() => { document.getElementById('screen-scroll-list').scrollTop = 0; }")
    page.wait_for_timeout(120)
    return cid in tab_ids(page)


def test_e1_full_render_scrolled_out_relocate(browser, base):
    """E1【回归】全量渲染 + 目标行滚出可视区（仍在 DOM）→ 点标签必须滚回可视区并切换。
    v1.0.16 已能（一次 scrollIntoView 即可）；v1.0.17 因黑名单定位失败 → 本组失败。"""
    t = Tester("E1 全量渲染 + 目标行滚出可视区 → 点标签必须滚回可视区并切换")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        t.check(setup_full_render_scrolled_out(page, "G20"), "前置：G20 标签已建立 (tabs=%s)" % tab_ids(page))
        t.check(page.evaluate("() => window.__mock.isFullRender()"), "前置：全量渲染已开启")
        t.check(page.evaluate("() => window.__mock.inDom('G20')"), "前置：G20 行仍在 DOM")
        t.check(not page.evaluate("() => window.__mock.isRowInScroller('G20')"),
                "前置：G20 行不在滚动容器可视区（对抗性前提）")
        hide_toast(page)
        reset_title(page)
        reset_clicks(page)

        click_tab(page, "G20")
        page.wait_for_timeout(1200)

        t.check("历史画布 20" in page.evaluate("() => window.__mock.title()"),
                "【回归】点标签后画布已切换 (title=%r)" % page.evaluate("() => window.__mock.title()"))
        t.check(not wait_toast(page, 1500), "【回归】不再弹「未找到画布」提示")
        t.check(page.evaluate("() => window.__mock.isRowInScroller('G20')"),
                "【回归】目标行被滚回滚动容器可视区（定位到列表位置）")
        hits = [c for c in click_log(page) if c["cid"] == "G20"]
        t.check(bool(hits), "【回归】确实点到了左侧 G20 行 (log=%s)" % click_log(page))
        t.check(all(c["panel"] == "canvas" for c in hits),
                "【保护】点击落在「画布」列 (got=%s)" % [c["panel"] for c in hits])
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "fold_e1")
    finally:
        ctx.close()
    return t


def test_e2_reset_on_switch_keeps_row_visible(browser, base):
    """E2【需求】叠加「切换后重渲染左栏 + 滚动归零」→ 点标签后目标行**仍须**在可视区。
    直接锁用户真机现象「刷新了一下回到了列表顶部」。此行为 v1.0.16/v1.0.17/v1.0.18(旧定位)
    均无（无 keepRowVisible），故断言按【需求】组（新增能力）。"""
    t = Tester("E2 切换后重渲染+滚动归零 → 目标行仍须在可视区（锁真机现象）")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        t.check(setup_full_render_scrolled_out(page, "G20"), "前置：G20 标签已建立 (tabs=%s)" % tab_ids(page))
        page.evaluate("() => window.__mock.setResetOnSwitch(true)")
        t.check(page.evaluate("() => window.__mock.isResetOnSwitch()"), "前置：切换复位已开启")
        hide_toast(page)
        reset_title(page)
        reset_clicks(page)

        click_tab(page, "G20")
        page.wait_for_timeout(1600)      # 等 keepRowVisible 的 rAF/+60/+180/+400/+800 复查窗口跑完

        t.check("历史画布 20" in page.evaluate("() => window.__mock.title()"),
                "【需求】点标签后画布已切换 (title=%r)" % page.evaluate("() => window.__mock.title()"))
        t.check(page.evaluate("() => window.__mock.isRowInScroller('G20')"),
                "【需求】即使墨刀切换复位了滚动，目标行仍被滚回可视区（scrollerTop=%s）"
                % page.evaluate("() => window.__mock.scrollerTop()"))
        t.check("G20" in tab_ids(page), "【需求】标签仍在 (tabs=%s)" % tab_ids(page))
        hits = [c for c in click_log(page) if c["cid"] == "G20"]
        t.check(bool(hits) and all(c["panel"] == "canvas" for c in hits),
                "【保护】点击落在「画布」列 (log=%s)" % click_log(page))
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "fold_e2")
    finally:
        ctx.close()
    return t


def located_cids(page):
    """当前文档里带我方 md-rt-located 标记的「画布列行」cid 列表（去重、按 DOM 顺序）。"""
    return page.evaluate(
        """() => {
             var out = [];
             document.querySelectorAll('.md-rt-located').forEach(function (e) {
               var li = e.closest ? e.closest('.rn-content-item[data-cid]') : null;
               var cid = li ? li.getAttribute('data-cid') : (e.getAttribute('data-cid') || null);
               if (cid && out.indexOf(cid) < 0) out.push(cid);
             });
             return out;
           }"""
    )


def test_e3_selected_state_moves_and_no_residue(browser, base):
    """E3【需求】点标签后左栏目标行呈选中态（md-rt-located），且标记可逆、无残留。
    对抗性：关闭墨刀自身激活类（setMoldeActive(false)）→ 选中态只能由我方提供，
    这样断言才真正考察我方实现（而非被墨刀自身标记带过）。"""
    t = Tester("E3 点标签后左栏目标行呈选中态，且标记可逆、无残留")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        page.evaluate("() => window.__mock.setMoldeActive(false)")   # 选中态只能由我方提供
        t.check(setup_full_render_scrolled_out(page, "G20"), "前置：G20 标签已建立 (tabs=%s)" % tab_ids(page))
        page.evaluate("() => window.__mock.setResetOnSwitch(true)")
        hide_toast(page)
        reset_title(page)
        reset_clicks(page)

        click_tab(page, "G20")
        page.wait_for_timeout(1200)

        t.eq(page.evaluate("() => window.__mock.activeRowCid()"), "G20",
             "【需求】点标签后左栏目标行呈选中态")
        t.eq(located_cids(page), ["G20"], "【需求】仅目标行带我方标记，无其它行残留")

        # 再建一个标签并切换 → 标记应从旧行移到新行（可逆，不叠加）
        page.evaluate("() => window.__mock.setWrapped(false)")
        page.evaluate("() => window.__mock.setFullRender(false)")
        ok = page.evaluate("(c) => window.__mock.scrollToCid(c)", "G25")
        page.wait_for_timeout(120)
        t.check(ok, "前置：可定位到 G25")
        click_left(page, "G25")
        page.wait_for_timeout(250)
        page.evaluate("() => window.__mock.setWrapped(true)")
        page.evaluate("() => window.__mock.setFullRender(true)")
        reset_clicks(page)
        click_tab(page, "G25")
        page.wait_for_timeout(1200)

        t.eq(located_cids(page), ["G25"], "【需求】切到另一标签后标记移到新行，旧行不残留")
        t.eq(page.evaluate("() => window.__mock.activeRowCid()"), "G25",
             "【需求】新目标行呈选中态")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "fold_e3")
    finally:
        ctx.close()
    return t


def test_e4_user_scroll_not_stolen(browser, base):
    """E4【保护】切换后用户立刻手动滚动 → 我方纠偏必须立即放弃，滚动位置保持用户所设。
    防止新的 keepRowVisible 把用户的手动滚动「抢回去」。"""
    t = Tester("E4 切换后用户手动滚动 → 不得被抢回")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        t.check(setup_full_render_scrolled_out(page, "G20"), "前置：G20 标签已建立 (tabs=%s)" % tab_ids(page))
        page.evaluate("() => window.__mock.setResetOnSwitch(true)")
        hide_toast(page)
        reset_title(page)
        reset_clicks(page)

        click_tab(page, "G20")
        page.wait_for_timeout(80)
        # 用户手动滚动：设一个自定义位置并派发真实 wheel 事件 → 我方纠偏应立即放弃
        page.evaluate(
            """() => {
                 var sc = document.getElementById('screen-scroll-list');
                 sc.scrollTop = 137;
                 sc.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }));
               }"""
        )
        page.wait_for_timeout(1100)      # 覆盖 keepRowVisible 的全部复查时间点

        t.eq(page.evaluate("() => window.__mock.scrollerTop()"), 137,
             "【保护】滚动位置保持用户所设（未被抢回）(scrollerTop=%s)"
             % page.evaluate("() => window.__mock.scrollerTop()"))
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "fold_e4")
    finally:
        ctx.close()
    return t


def test_e5_full_render_no_page_layer_click(browser, base):
    """E5【保护】全量渲染下点标签，不得点到「页面」列 / 「图层」列的同 cid 行（复用 click_log 口径）。"""
    t = Tester("E5 全量渲染下点标签不得点到页面列/图层列同 cid 行")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        t.check(setup_full_render_scrolled_out(page, "G20"), "前置：G20 标签已建立 (tabs=%s)" % tab_ids(page))
        page.evaluate("() => window.__mock.setResetOnSwitch(true)")
        # 对抗性前提：页面列/图层列存在与 G20 不同的同 cid 行（图层列放 G05；这里用 G20 的兄弟行做对照）
        t.check(page.evaluate("() => !!document.querySelector('[data-qa=\"layer-G05\"]')"),
                "前置：图层列存在同 cid 节点（G05）")
        reset_clicks(page)
        click_tab(page, "G20")
        page.wait_for_timeout(1200)

        log = click_log(page)
        t.check(not [c for c in log if c["panel"] == "layer"],
                "【保护】未误点图层列任何节点 (log=%s)" % log)
        t.check(not [c for c in log if c["panel"] == "page"],
                "【保护】未误点页面列任何节点 (log=%s)" % log)
        hits = [c for c in log if c["cid"] == "G20"]
        t.check(bool(hits) and all(c["panel"] == "canvas" for c in hits),
                "【保护】被点的 G20 行位于「画布」列 (log=%s)" % log)
        t.check(page.evaluate("() => window.__mock.isRowInScroller('G20')"),
                "【需求】目标行在可视区")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "fold_e5")
    finally:
        ctx.close()
    return t


def main():
    global CARRIER, CORE_PATH
    argv = sys.argv[1:]
    i = 0
    while i < len(argv):
        if argv[i] == "--carrier" and i + 1 < len(argv):
            CARRIER = argv[i + 1]; i += 2; continue
        if argv[i] == "--core" and i + 1 < len(argv):
            CORE_PATH = os.path.abspath(argv[i + 1]); i += 2; continue
        print("unknown arg:", argv[i]); os._exit(2)

    print("carrier =", CARRIER)
    print("core    =", core_file())
    print("A/B 判读（断言按 【回归】/【需求】/【保护】 分组）：")
    print("  v1.0.17 原样核心：必须复现用户原话（点标签 → 未找到画布；分组行点它不长标签）")
    print("  v1.0.16 核心    ：【回归】组必须全过；【需求】/【保护】组失败属预期（后续版本才加）")
    print("  旧定位核心(勿混淆)：C/D 用例仍失败（锚点被改版换名时定位被 canvasPanelPresent 压制）")
    print("  v1.0.18 修复版  ：必须全过（含 E 组：点标签后滚回目标行 + 左栏选中态）")
    assert os.path.isfile(core_file()), "core not found: %s" % core_file()

    httpd, base = start_server()
    total_fails = 0
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
            total_fails += test_c0_fixture_contract(browser, base).summary()
            total_fails += test_c1_collapsed_hidden_relocate(browser, base).summary()
            total_fails += test_c2_scrolled_out_relocate(browser, base).summary()
            total_fails += test_c3_group_row_creates_tab(browser, base).summary()
            total_fails += test_c4_never_click_layer_node(browser, base).summary()
            total_fails += test_c5_canvas_column_unmounted(browser, base).summary()
            total_fails += test_d1_renamed_anchor_wrapped_relocate(browser, base).summary()
            total_fails += test_d2_renamed_anchor_collapsed_relocate(browser, base).summary()
            total_fails += test_d3_renamed_anchor_protection(browser, base).summary()
            total_fails += test_d4_stray_same_cid_not_preferred(browser, base).summary()
            total_fails += test_e1_full_render_scrolled_out_relocate(browser, base).summary()
            total_fails += test_e2_reset_on_switch_keeps_row_visible(browser, base).summary()
            total_fails += test_e3_selected_state_moves_and_no_residue(browser, base).summary()
            total_fails += test_e4_user_scroll_not_stolen(browser, base).summary()
            total_fails += test_e5_full_render_no_page_layer_click(browser, base).summary()
            print("\n==== 折叠/滚动定位回归总计：%d 失败 ====" % total_fails)
            os._exit(1 if total_fails else 0)
    except Exception:
        import traceback
        traceback.print_exc()
        os._exit(1)


if __name__ == "__main__":
    main()
