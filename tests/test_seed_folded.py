# -*- coding: utf-8 -*-
"""
tests/test_seed_folded.py — BUG-0022 回归：种子画布（进入文件默认带出的那个）被折叠进画布树 +
父级文件滚出可见区后，点其标签必须能展开定位并切换（真机契约：折叠=ul 出 DOM + 无搜索框）。

被测缺陷（用户 2026-09-18）：
  进入设计文件时默认带出的画布（= autoSeed 路径建标签），把它**收缩折叠进画布树**且**父级文件
  滚出可见区**后，点它的标签提示「找不到画布」；而之后点过的画布切换正常。
根因：autoSeed 只调 touch() 建标签，从未 collectGroupPath()，导致 groupPath[id] 为空；
  真机折叠 + 无搜索框下，唯一能重新展开的 expandRecordedPath() 依赖 groupPath → 缺链即失败。
  点击路径 trackCanvasFromEvent 有记录，故只有种子标签坏。
修复：syncActiveScreen 的种子建立处补录父文件夹链（进入文件时画布正可见，必能取到）。

夹具：tests/fixtures/mock-modao-design-collapsed.html
  - GFOLD 分组（含 G01..G30）建模「画布被折叠进画布树」
  - 在核心注入前把 state.active 设为分组内画布 G05，让 autoSeed 把它当成「进入文件默认画布」带出
  - setToggleMode("expander") + setCollapsedUnrendered(true) + setCollapsedDetached(true)
    + setSearchBoxMissing(true) 建模真机契约（BUG-0019）：折叠在 DOM 零痕迹、无搜索框、
    唯一展开入口是文件夹行内的 a.expander

用例
----
  S1 【回归】种子画布 G05 折叠+detach+无搜索框后，点其标签必须展开 GFOLD 并切过去（title 命中）
  S2 【保护】种子画布折叠+detach 后点标签：不得删标签、分组须重新展开、G05 须重新可见
            （断言并入 test_s1_seed_folded_switch，不单列函数）
  S3 【保护】记录父文件夹链不得凭空长出 GFOLD 标签（种子标签集合 == [G05]）
  S4 【保护】autoSeed「只带出一次」闸门不被本修复改动（之后再 refresh 不得补带出 C0）

启动要点（boot_seed）
--------------------
  · 必须 `history.replaceState` 把 URL 改成 `/proto/design/<cid>`：核心 `refreshCid()` 从
    `location.pathname` 取项目 cid，取不到（如停在 /workspace）即判非设计页 → `root.style.display="none"`
    且**从不调用 syncActiveScreen()` → 种子标签根本不生成（tab_ids 恒为 []）。与 test_locate_hidden.boot() 同一处置。
  · 前置断言「G05 画布行脱离 DOM」必须用 `canvas_row_in_dom()`（限画布列容器）——夹具的「图层」列
    与「画布」列共用同 data-cid（layer-G05），`__mock.inDom()` 是全局面查询会被污染而恒为真。

判读（A/B）
  v1.0.18 修复版（locate-robust.9）            ：S1~S4 必须全过
  v1.0.18 修复前核心（locate-robust.8 或更早） ：S1 必失败（点标签 → 未找到画布），证明这是回归
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
from harness import start_server, Tester, screenshot, new_page

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "mock-modao-design-collapsed.html")
CID = "SEEDCID"          # 项目 cid：核心靠 URL /proto/design/<cid> 取它，缺则标签栏整个不工作
CARRIER = "ext"          # --carrier ext|desktop
CORE_PATH = None         # --core <path>：注入任意版本核心做 A/B（默认用 carrier 目录下的）


def core_file():
    if CORE_PATH:
        return CORE_PATH
    src = PROJECT_ROOT if CARRIER == "ext" else os.path.join(PROJECT_ROOT, "desktop")
    return os.path.join(src, "recent-tabs-core.js")


def boot_seed(page, base, seed_cid):
    """把 seed_cid 设为「进入文件默认画布」（在核心注入前改 active），让 autoSeed 带出它。"""
    page.goto(base + "/workspace", wait_until="load")
    page.evaluate("() => { localStorage.clear(); }")
    with open(FIXTURE, encoding="utf-8") as f:
        page.set_content(f.read())
    # ⚠ 必须把 URL 改成 /proto/design/<cid>：核心 refreshCid() 从 location.pathname 取项目
    #   cid，匹配不到（如停在 /workspace）就判为非设计页 → root.style.display="none" 且
    #   **从不调用 syncActiveScreen()** → 种子标签根本不生成（tab_ids 恒为 []）。
    #   与 test_locate_hidden.boot() 同一处置，缺此行则 S1/S3/S4 全部假失败。
    page.evaluate("(c) => history.replaceState({}, '', '/proto/design/' + c)", CID)
    # 核心注入前把激活画布设为分组内画布 seed_cid（G05），并立即重渲染使其带 is-active。
    page.evaluate("(c) => { window.__mock.state.active = c; window.__mock.render(); }", seed_cid)
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
    # 强制触发一次 autoSeed，确保种子标签已生成
    page.evaluate("() => { if (window.__ctrl && window.__ctrl.refresh) window.__ctrl.refresh(); }")


def tab_ids(page):
    return page.evaluate(
        "() => Array.from(document.querySelectorAll('.md-tab')).map(function(e){"
        " return e.getAttribute('data-id'); })"
    )


def canvas_row_in_dom(page, cid):
    """仅查「画布」列内该 cid 是否在 DOM。
    ⚠ 夹具的「图层」列与「画布」列**共用同 data-cid**（layer-G05，专为「同 cid 不误点」设计），
    裸 document.querySelector('[data-cid]') 会被图层列节点污染而恒为真 —— 必须限定画布列容器。"""
    return page.evaluate(
        "(c) => { var sc = document.getElementById('screen-scroll-list');"
        " return !!(sc && sc.querySelector('[data-cid=\"' + c + '\"]')); }",
        cid,
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


def title(page):
    return page.evaluate("() => window.__mock.title()")


def wait_title(page, sub, timeout_ms=4000):
    deadline = time.time() + timeout_ms / 1000.0
    while time.time() < deadline:
        if sub in title(page):
            return True
        time.sleep(0.05)
    return sub in title(page)


def test_s1_seed_folded_switch(browser, base):
    t = Tester("S1【回归】种子画布折叠+detach+无搜索框 → 点标签展开定位并切换")
    ctx, page = new_page(browser)
    try:
        boot_seed(page, base, "G05")
        # 前置：种子标签已生成，且只有它（不得凭空长出 GFOLD）
        t.eq(tab_ids(page), ["G05"], "前置：仅 G05 种子标签生成 (got=%s)" % tab_ids(page))
        # 建模真机契约：折叠零痕迹 + 无搜索框 + 唯一展开入口 a.expander
        page.evaluate("() => window.__mock.setToggleMode('expander')")
        page.evaluate("() => window.__mock.setCollapsedUnrendered(true)")
        page.evaluate("() => window.__mock.setCollapsedDetached(true)")
        page.evaluate("() => window.__mock.setSearchBoxMissing(true)")
        page.evaluate("() => window.__mock.setGroupOpen(false)")
        page.evaluate("() => window.__mock.scrollToCid('G05')")
        page.evaluate("() => window.__mock.render()")
        # 前置：折叠+detach 后 G05 的**画布列行**确实脱离 DOM（真机形态）
        # 用 canvas_row_in_dom 而非 __mock.inDom：后者是全局面查询，会被图层列同 cid 节点污染。
        t.check(not canvas_row_in_dom(page, "G05"),
                "前置：折叠+detach 后 G05 画布行已脱离 DOM（画布列内无 G05）")
        # 点种子标签 → 必须展开 GFOLD 并切过去
        click_tab(page, "G05")
        ok = wait_title(page, "历史画布 05", timeout_ms=4000)
        t.check(ok, "【回归】点种子标签后画布已切换 (title=%r)" % title(page))
        # 保护：折叠分组被重新展开、G05 回到 DOM 且可见、标签未被删
        t.check(page.evaluate("() => window.__mock.isVisible('G05')"), "【保护】展开后 G05 行重新可见")
        t.check(page.evaluate("() => window.__mock.isGroupOpen()"), "【保护】GFOLD 分组被重新展开")
        t.eq(tab_ids(page), ["G05"], "【保护】种子标签未被删除 (got=%s)" % tab_ids(page))
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "seed_s1")
    finally:
        ctx.close()
    return t


def test_s3_no_phantom_tab(browser, base):
    """S3【保护】记录父文件夹链不得凭空长出 GFOLD 标签（种子标签集合 == [G05]）。"""
    t = Tester("S3【保护】记录父文件夹链不得长出 GFOLD 标签")
    ctx, page = new_page(browser)
    try:
        boot_seed(page, base, "G05")
        # collectGroupPath(G05) 会记录 GFOLD，但绝不能为 GFOLD 建标签
        t.eq(tab_ids(page), ["G05"], "种子标签集合 == [G05]，无 GFOLD 幻影 (got=%s)" % tab_ids(page))
        # 进一步确认 GFOLD 在画布列里存在但未被当成画布建标签
        t.check(page.evaluate("() => !!document.querySelector('[data-qa=\"canvas-GFOLD\"]')"),
                "GFOLD 分组行仍存在于画布列（只是未被建标签）")
    except Exception as e:
        t.check(False, "异常: %r" % e)
    finally:
        ctx.close()
    return t


def test_s4_autoseed_once_gate(browser, base):
    """S4【保护】autoSeed「只带出一次」闸门不被本修复改动。"""
    t = Tester("S4【保护】autoSeed 只带出一次（本修复不改闸门）")
    ctx, page = new_page(browser)
    try:
        boot_seed(page, base, "G05")
        t.eq(tab_ids(page), ["G05"], "前置：仅 G05 种子标签 (got=%s)" % tab_ids(page))
        # 之后把激活画布切到 C0 并再次 refresh —— 闸门应阻止再自动带出
        page.evaluate("() => window.__mock.setActive('C0')")
        page.evaluate("() => { if (window.__ctrl && window.__ctrl.refresh) window.__ctrl.refresh(); }")
        t.eq(tab_ids(page), ["G05"], "再次 refresh 后不得补带出 C0 (got=%s)" % tab_ids(page))
    except Exception as e:
        t.check(False, "异常: %r" % e)
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
    print("A/B 判读：")
    print("  v1.0.18 修复前核心（locate-robust.8 或更早）：S1 必失败（点种子标签 → 未找到画布）")
    print("  v1.0.18 修复版（locate-robust.9）            ：S1~S4 必须全过")
    assert os.path.isfile(core_file()), "core not found: %s" % core_file()

    httpd, base = start_server()
    total_fails = 0
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
            total_fails += test_s1_seed_folded_switch(browser, base).summary()
            total_fails += test_s3_no_phantom_tab(browser, base).summary()
            total_fails += test_s4_autoseed_once_gate(browser, base).summary()
            print("\n==== BUG-0022 种子折叠回归总计：%d 失败 ====" % total_fails)
            os._exit(1 if total_fails else 0)
    except Exception:
        import traceback
        traceback.print_exc()
        os._exit(1)


if __name__ == "__main__":
    main()
