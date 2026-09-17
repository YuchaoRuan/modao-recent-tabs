# -*- coding: utf-8 -*-
"""
tests/test_reveal_gap.py — BUG-0015 回归：长列表「滚动不在可见区」→ 点标签必须定位到画布

被测缺陷（BUG-0015）
--------------------
revealCanvasEl 的「放大分支」在长列表上把 step 放大到远超虚拟列表单次渲染窗口（约
clientHeight + overscan），导致档间留下从未渲染的缝隙，目标行（落在缝隙里）永远查不到
→ 报「未找到画布「X」，请先在左侧画布栏展开或滚动到它，再点击标签切换」。

复现（夹具 ?rows=980，.rn-virtual 写死 600px → clientHeight=600）：
  - 旧核心 step = ceil(maxTop/23) ≈ 1508px，远超渲染窗口 ≈756px，
    档间 338~734px 缝隙从未渲染 → 目标行 P71（行下标 71）落在缝隙里 → 漏扫 → 报「未找到画布」。
  - 修复后 step 恒 ≤ floor(clientHeight*0.75)=450px，与目标行窗口 756px 无缝 → 必中。
  - 实测数学（scripts/_verify_gap_math.py 按夹具公式逐档枚举行下标）：N=980 时旧算法漏扫 502 行（51.2%）。

支持 --core 做 A/B（scripts/regress.py 自动注入历史版本核心）：
  - 旧核心（v1.0.16，含放大分支）：【回归】组必须失败（出现「未找到画布」toast）。
  - 当前修复核心：【回归】组必须全过；【保护】组（末行 P980）两边都必须过。

夹具
----
tests/fixtures/mock-modao-design-virtual.html（?rows=N，默认 40 保证既有 8 个用例不变；
.rn-virtual 高度写死 600px 使 clientHeight 确定）

断言分组（regress.py 按 【回归】/【需求】/【保护】 统计）
--------------------------------------------------------
  【回归】当前修复版行为（旧核心必不满足）：点 P71 不弹「未找到画布」+ 左侧 P71 被点击 + 滚入可视区。
  【需求】画布内容已显示（标题切到「页面 71」）。
  【保护】点列表末行 P980 也能定位（旧核心因末尾显式补 maxTop 也能中——防把末尾补档逻辑改坏）。

A/B 矩阵见 tests/ab_expectations.json（test_reveal_gap.py → v1.0.16 → regression_fail）。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
from harness import start_server, Tester, screenshot, new_page

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "mock-modao-design-virtual.html")
TARGET = "P71"           # 行下标 71（夹具两位零填充：第 71 行 cid="P71"），旧核心漏扫缝隙正中（已验 70±3 同样漏扫）
LAST = "P980"            # 列表末行，旧核心靠末尾显式补 maxTop 才能中（保护项，防改坏末尾补档）
WAIT_MS = 3000           # 新算法档数上限 90 × STEP_MS 27 ≈ 2430ms，留足余量（旧用例 1600ms 不够）

CARRIER = "ext"          # --carrier ext|desktop
CORE_PATH = None         # --core <path>：注入任意版本核心做 A/B（默认用 carrier 目录下的）


def core_file():
    if CORE_PATH:
        return CORE_PATH
    src = PROJECT_ROOT if CARRIER == "ext" else os.path.join(PROJECT_ROOT, "desktop")
    return os.path.join(src, "recent-tabs-core.js")


def boot(page, base):
    # 直接经静态服务器加载夹具并带 ?rows=980（clientHeight 确定 = 600，step 确定 = 450）。
    # 注意：夹具位于 tests/fixtures/ 下（与 harness 的 PROJECT_ROOT 相对），URL 路径须带 tests/。
    page.goto(base + "/tests/fixtures/mock-modao-design-virtual.html?rows=980", wait_until="load")
    page.evaluate("() => { localStorage.clear(); }")
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
        "() => Array.from(document.querySelectorAll('.md-tab')).map(e => e.getAttribute('data-id'))"
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
    """点左栏画布列里的行（与 autoclose 夹具同款：scrollToCid + render + el.click）。
    不用 page.click：虚拟列表里深位行经 page.click 的 scrollIntoView 会把节点顶出渲染窗口致点击落空。"""
    page.evaluate(
        """(cid) => {
            window.__mock.scrollToCid(cid);
            window.__mock.render();       // scroll 事件异步，手动重渲染
            var el = document.querySelector('.rn-list-item[data-cid="' + cid + '"]');
            if (!el) throw new Error('left item not in DOM: ' + cid);
            el.click();
        }""",
        cid,
    )
    page.wait_for_timeout(200)


def build_tab(page, cid):
    """先滚到 cid 使其可见，再点左栏行建标签（任何版本都能建），返回是否建成功。"""
    page.evaluate("(c) => window.__mock.scrollToCid(c)", cid)
    page.wait_for_timeout(120)
    page.evaluate("(c) => window.__mock.scrollToCid(c)", cid)
    page.wait_for_timeout(80)
    if not page.evaluate("(c) => window.__mock.inDom(c)", cid):
        return False
    click_left(page, cid)
    page.wait_for_timeout(250)
    return cid in tab_ids(page)


def toast_visible(page):
    return page.evaluate(
        "() => { var e = document.querySelector('.md-recent-tabs__toast');"
        " return !!e && e.classList.contains('is-visible'); }"
    )


def toast_text(page):
    return page.evaluate(
        "() => { var e = document.querySelector('.md-recent-tabs__toast-text');"
        " return e ? e.textContent : ''; }"
    )


def wait_toast(page, timeout_ms=5000):
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


def reset_clicks(page):
    page.evaluate("() => { window.__mock.state.clickLog = []; }")


def title(page):
    return page.evaluate("() => { var e = document.querySelector('.rn-canvas .canvas-title'); return e ? e.textContent : ''; }")


def click_log(page):
    return page.evaluate("() => window.__mock.clickLog()")


# ----------------------------------------- BUG-0015 主例：长列表滚动不可见 → 必须定位
def test_reveal_p071_scrolled_out(browser, base):
    """【回归】长列表因滚动不在可见区域（未渲染）→ 点标签必须滚动定位并切过去。
    v1.0.16（含放大分支）必须失败（漏扫 P071 → 弹「未找到画布」）。"""
    t = Tester("BUG-0015 长列表滚动不可见 → 点标签定位到画布并切换")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        t.check(build_tab(page, TARGET), "前置：P071 标签已建立 (tabs=%s)" % tab_ids(page))
        # 滚回顶部 → P071 行滚出渲染窗口（不在 DOM）
        page.evaluate("() => { document.querySelector('.rn-virtual').scrollTop = 0; window.__mock.render(); }")
        page.wait_for_timeout(150)
        t.check(page.evaluate("(c) => window.__mock.inDom(c)", TARGET) is False,
                "前置：P071 行因滚出视口未渲染（不在 DOM）")
        reset_clicks(page)

        click_tab(page, TARGET)
        page.wait_for_timeout(WAIT_MS)

        # —— 【回归】当前修复版行为（旧核心必不满足）——
        seen_toast = wait_toast(page, 5000)
        t.check("未找到画布" not in seen_toast,
                "【回归】点 P071 标签后未弹「未找到画布」提示 (toast=%r)" % seen_toast)
        hits = [c for c in click_log(page) if c["cid"] == TARGET]
        t.check(bool(hits), "【回归】点 P071 标签后左侧 P071 行被点击（定位成功） (log=%s)" % click_log(page))
        t.check(all(c["panel"] == "canvas" for c in hits),
                "【回归】被点击的是「画布」列行 (got=%s)" % [c["panel"] for c in hits])
        t.check(page.evaluate("(c) => window.__mock.isVisible(c)", TARGET),
                "【回归】P071 行被滚入可视区（定位到画布所在位置）")

        # —— 【需求】画布内容已显示 ——
        t.check("页面 71" in title(page),
                "【需求】画布内容已显示（标题切到「页面 71」）(title=%r)" % title(page))
        t.check(TARGET in tab_ids(page), "【需求】标签仍在 (tabs=%s)" % tab_ids(page))
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "reveal_p071")
    finally:
        ctx.close()
    return t


# ----------------------------------------- 【保护】列表末行（P980）也必须能定位
def test_reveal_last_row_p980(browser, base):
    """【保护】点列表末行（P980）标签也要能定位——旧核心靠 positions 末尾显式补 maxTop 才能中，
    这条防把「末尾补档」逻辑改坏（新核心同样靠它命中末行）。"""
    t = Tester("BUG-0015 列表末行 P980 → 点标签也能定位（保护末尾补档逻辑）")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        t.check(build_tab(page, LAST), "前置：P980 标签已建立 (tabs=%s)" % tab_ids(page))
        page.evaluate("() => { document.querySelector('.rn-virtual').scrollTop = 0; window.__mock.render(); }")
        page.wait_for_timeout(150)
        t.check(page.evaluate("(c) => window.__mock.inDom(c)", LAST) is False,
                "前置：P980 行因滚出视口未渲染（不在 DOM）")
        reset_clicks(page)

        click_tab(page, LAST)
        page.wait_for_timeout(WAIT_MS)

        seen_toast = wait_toast(page, 5000)
        hits = [c for c in click_log(page) if c["cid"] == LAST]
        t.check(bool(hits) or "未找到画布" in seen_toast,
                "【保护】点列表末行 P980 标签也能定位到画布（旧核心靠末尾补 maxTop 也能中）"
                " (log=%s, toast=%r)" % (click_log(page), seen_toast))
        t.check("P980" in tab_ids(page), "【保护】标签仍在 (tabs=%s)" % tab_ids(page))
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "reveal_p980")
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
    print("  v1.0.16 核心（含放大分支）：【回归】组必须失败（出现「未找到画布」）")
    print("  当前修复核心            ：【回归】组必须全过；【保护】组（末行 P980）两边都必须过")
    assert os.path.isfile(core_file()), "core not found: %s" % core_file()

    httpd, base = start_server()
    total_fails = 0
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
            total_fails += test_reveal_p071_scrolled_out(browser, base).summary()
            total_fails += test_reveal_last_row_p980(browser, base).summary()
            print("\n==== BUG-0015 长列表定位回归总计：%d 失败 ====" % total_fails)
            os._exit(1 if total_fails else 0)
    except Exception:
        import traceback
        traceback.print_exc()
        os._exit(1)


if __name__ == "__main__":
    main()
