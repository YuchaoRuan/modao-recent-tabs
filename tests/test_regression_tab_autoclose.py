# -*- coding: utf-8 -*-
"""
tests/test_regression_tab_autoclose.py — 「点标签 → 标签被自动关闭且画布未切换」BUG 回归

复现环境：tests/fixtures/mock-modao-design-virtual.html
  - 左侧画布栏为**虚拟化长列表**（40 页 + 折叠文件夹「归档」），
    只有进入视口的行才真正存在于 DOM —— 与真实墨刀长列表一致。
  - 点击左侧项会整栏重渲染（模拟墨刀 SPA 重绘，DOM 节点被替换）。

覆盖用例：
  1. 点标签（其左侧项因虚拟滚动未渲染）→ 标签保留 + 画布完成切换
  2. 定位不到时（折叠文件夹内画布）→ 标签保留 + 出现可见提示 + 不静默删除
  3. 画布项重新出现后 → 待定标记自动撤销（轮询复核）
  4. 多标签点击不再丢失 click（节点复用后 mousedown/mouseup 之间重排仍生效）
  5. setItems 先排序再截断（>max 时保留最近的一批，而非最早的一批）
  6. 关闭按钮起笔保护：pointerdown 在标签主体、mouseup 落在 × 上 → 不关闭
  7. × 仍可正常关闭标签（真实鼠标点击）
"""
import os
import sys
import threading

sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
from harness import start_server, Tester, screenshot, new_page

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "mock-modao-design-virtual.html")
CID = "VCID"


def boot(page, base):
    """加载虚拟滚动夹具 + 注入真实源码 + 创建控制器。"""
    page.goto(base + "/workspace", wait_until="load")
    page.evaluate("() => { localStorage.clear(); }")
    with open(FIXTURE, encoding="utf-8") as f:
        html = f.read()
    page.set_content(html)
    page.evaluate("(cid) => history.replaceState({}, '', '/proto/design/' + cid)", CID)
    page.add_style_tag(path=os.path.join(PROJECT_ROOT, "tabbar.css"))
    page.add_script_tag(path=os.path.join(PROJECT_ROOT, "tabbar.js"))
    page.add_script_tag(path=os.path.join(PROJECT_ROOT, "recent-tabs-core.js"))
    page.evaluate(
        """() => {
            window.chrome = window.chrome || {
              runtime: { onMessage: { addListener: function(){} }, lastError: null }
            };
            window.__ctrl = MDRecentTabs.create({ enableMessageListener: true });
        }"""
    )
    page.wait_for_selector(".md-recent-tabs", state="attached")


def tab_ids(page):
    return page.evaluate(
        "() => Array.from(document.querySelectorAll('.md-tab')).map(e => e.getAttribute('data-id'))"
    )


def click_left(page, cid):
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
    page.wait_for_timeout(120)


def click_tab(page, cid):
    page.evaluate(
        """(cid) => {
            var t = document.querySelector('.md-tab[data-id="' + cid + '"] .md-tab__label');
            if (!t) throw new Error('tab not found: ' + cid);
            t.click();
        }""",
        cid,
    )


# ---------------------------------------------------------------- 用例 1
def test_switch_keeps_tab(browser, base):
    t = Tester("回归：点标签（左侧项未渲染）→ 标签不消失且完成切换")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        for cid in ["P01", "P10", "P25", "P40"]:
            click_left(page, cid)
        click_left(page, "P10")          # 视口停在 P07..P26，P01/P40 不在 DOM
        page.wait_for_timeout(150)

        before = tab_ids(page)
        t.check("P01" in before, "前置：P01 标签存在 (%s)" % before)
        t.check(
            page.evaluate("() => window.__mock.inDom('P01')") is False,
            "前置：P01 的左侧画布项当前不在 DOM（虚拟滚动未渲染）",
        )

        clicks_before = page.evaluate("(c) => window.__mock.getClicks()[c] || 0", "P01")
        click_tab(page, "P01")
        page.wait_for_timeout(800)       # 等待滚动扫描定位（最多 ~600ms）

        after = tab_ids(page)
        t.check("P01" in after, "点标签后 P01 标签仍在（不再被误删）(after=%s)" % after)
        t.eq(len(after), len(before), "标签总数不变")
        clicks_after = page.evaluate("(c) => window.__mock.getClicks()[c] || 0", "P01")
        t.check(clicks_after > clicks_before,
                "左侧画布项被点击 → 画布完成切换 (clicks %d → %d)" % (clicks_before, clicks_after))
        t.eq(page.text_content(".rn-canvas .canvas-title"), "页面 01", "画布标题已切到「页面 01」")
        t.check(
            page.evaluate("() => document.querySelector('.md-tab[data-id=\"P01\"]').classList.contains('is-active')"),
            "P01 标签变为激活态",
        )
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "reg_switch_keeps_tab")
    finally:
        ctx.close()
    return t


# ---------------------------------------------------------------- 用例 2
def test_unreachable_not_deleted(browser, base):
    t = Tester("回归：定位不到（折叠文件夹内画布）→ 保留标签 + 可见提示")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        # 展开「归档」文件夹，点开 A2 形成标签，再折叠文件夹 → A2 不在 DOM
        page.evaluate("() => { window.__mock.state.archOpen = true; window.__mock.render(); }")
        click_left(page, "A2")
        page.evaluate("() => { window.__mock.state.archOpen = false; window.__mock.render(); }")
        page.wait_for_timeout(150)
        t.check("A2" in tab_ids(page), "前置：A2 标签存在")
        t.check(page.evaluate("() => window.__mock.inDom('A2')") is False,
                "前置：折叠后 A2 左侧项不在 DOM")

        click_tab(page, "A2")
        page.wait_for_timeout(900)
        t.check("A2" in tab_ids(page), "定位失败时标签未被静默删除 (tabs=%s)" % tab_ids(page))
        t.check(
            page.evaluate("() => !!document.querySelector('.md-tab[data-id=\"A2\"][data-stale]')"),
            "标签被标记为待定(stale)",
        )
        t.check(
            page.evaluate("() => { var el = document.querySelector('.md-recent-tabs__toast');"
                          " return !!el && el.classList.contains('is-visible'); }"),
            "出现可见提示（toast），而非静默删标签",
        )
        toast_txt = page.evaluate(
            "() => { var el = document.querySelector('.md-recent-tabs__toast-text');"
            " return el ? el.textContent : ''; }"
        )
        t.check("未找到画布" in toast_txt, "提示文案说明原因: %r" % toast_txt)

        # 展开文件夹后轮询复核 → 待定标记应自动撤销
        page.evaluate("() => { window.__mock.state.archOpen = true; window.__mock.render(); }")
        page.wait_for_timeout(2600)
        t.check(
            page.evaluate("() => !document.querySelector('.md-tab[data-id=\"A2\"][data-stale]')"),
            "画布项重新出现后，待定标记自动撤销（2s 轮询复核）",
        )
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "reg_unreachable")
    finally:
        ctx.close()
    return t


# ---------------------------------------------------------------- 用例 3
def test_no_lost_click_on_reorder(browser, base):
    t = Tester("回归：列表重排不再吞掉 click（节点复用）")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        for cid in ["P01", "P02", "P03"]:
            click_left(page, cid)
        page.wait_for_timeout(150)
        t.eq(len(tab_ids(page)), 3, "前置：3 个标签")

        # 记录标签节点身份：render 前后应复用同一节点
        marked = page.evaluate(
            """() => {
                Array.from(document.querySelectorAll('.md-tab')).forEach(function(e, i){ e.__id = 'n' + i; });
                return true;
            }"""
        )
        t.check(marked, "已给标签节点打标记")
        click_left(page, "P04")           # 触发一次 render（touch 后重排）
        page.wait_for_timeout(200)
        kept = page.evaluate(
            """() => Array.from(document.querySelectorAll('.md-tab'))
                 .filter(function(e){ return !!e.__id; }).length"""
        )
        t.eq(kept, 3, "重排后原有 3 个标签节点被复用（未重建）")

        # 真实鼠标：mousedown 在标签主体 → 期间强制重排 → mouseup → click 仍生效
        box = page.evaluate(
            """() => {
                var el = document.querySelector('.md-tab[data-id="P01"] .md-tab__label');
                var r = el.getBoundingClientRect();
                return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
            }"""
        )
        before_clicks = page.evaluate("(c) => window.__mock.getClicks()[c] || 0", "P01")
        page.mouse.move(box["x"], box["y"])
        page.mouse.down()
        page.evaluate("() => window.__ctrl.refresh()")     # 触发重排/重渲染
        page.mouse.up()
        page.wait_for_timeout(300)
        after_clicks = page.evaluate("(c) => window.__mock.getClicks()[c] || 0", "P01")
        t.check(after_clicks > before_clicks,
                "mousedown→重排→mouseup 后 click 仍生效（切换未被吞掉）(%d → %d)"
                % (before_clicks, after_clicks))
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "reg_lost_click")
    finally:
        ctx.close()
    return t


# ---------------------------------------------------------------- 用例 4
def test_set_items_sort_then_slice(browser, base):
    t = Tester("回归：setItems 先排序再截断（>max 保留最近的一批）")
    ctx, page = new_page(browser)
    try:
        page.set_content("""<!doctype html><html><body><div id="r"></div></body></html>""")
        page.add_script_tag(path=os.path.join(PROJECT_ROOT, "tabbar.js"))
        res = page.evaluate(
            """() => {
                var bar = new RecentTabsBar(document.getElementById('r'), { max: 20 });
                var items = [];
                for (var i = 1; i <= 25; i++) items.push({ id: 'P' + i, name: 'P' + i, updatedAt: i * 1000 });
                bar.setItems(items);
                return bar.items.map(function (it) { return it.id; });
            }"""
        )
        t.eq(res[0], "P25", "保留最近项 P25 在首位 (got=%r)" % res[0])
        t.eq(res[-1], "P6", "保留第 20 近的 P6 (got=%r)" % res[-1])
        t.eq(len(res), 20, "截断到 max=20")
        t.check("P1" not in res and "P5" not in res, "最旧的 P1..P5 被淘汰（而非淘汰最新的 P21..P25）")
    except Exception as e:
        t.check(False, "异常: %r" % e)
    finally:
        ctx.close()
    return t


# ---------------------------------------------------------------- 用例 5
def test_close_btn_guard(browser, base):
    t = Tester("回归：× 关闭按钮起笔保护 / 正常关闭仍可用")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        for cid in ["P01", "P02", "P03"]:
            click_left(page, cid)
        page.wait_for_timeout(150)
        n0 = len(tab_ids(page))
        t.eq(n0, 3, "前置：3 个标签")

        # (a) pointerdown 在标签主体 → 拖动到 × 上 mouseup → 不应关闭
        label_box = page.evaluate(
            """() => { var r = document.querySelector('.md-tab[data-id="P02"] .md-tab__label')
                 .getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }"""
        )
        close_box = page.evaluate(
            """() => { var r = document.querySelector('.md-tab[data-id="P02"] .md-tab__close')
                 .getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }"""
        )
        page.mouse.move(label_box["x"], label_box["y"])
        page.mouse.down()
        page.mouse.move(close_box["x"], close_box["y"])
        page.mouse.up()
        page.wait_for_timeout(250)
        t.eq(len(tab_ids(page)), n0, "起笔在标签主体、落笔在 × → 标签未被误关 (tabs=%s)" % tab_ids(page))

        # (b) 真实点击 × → 正常关闭
        #     注意：(a) 的点击会触发切换并重排，必须重新量取 × 的坐标再点
        close_box = page.evaluate(
            """() => { var r = document.querySelector('.md-tab[data-id="P02"] .md-tab__close')
                 .getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }"""
        )
        page.mouse.move(close_box["x"], close_box["y"])
        page.mouse.down()
        page.mouse.up()
        page.wait_for_timeout(250)
        t.eq(len(tab_ids(page)), n0 - 1, "真实点击 × → 标签数减 1 (tabs=%s)" % tab_ids(page))
        t.check("P02" not in tab_ids(page), "被关闭的是 P02")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "reg_close_guard")
    finally:
        ctx.close()
    return t


def main():
    httpd, base = start_server()
    total_fails = 0
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
            total_fails += test_switch_keeps_tab(browser, base).summary()
            total_fails += test_unreachable_not_deleted(browser, base).summary()
            total_fails += test_no_lost_click_on_reorder(browser, base).summary()
            total_fails += test_set_items_sort_then_slice(browser, base).summary()
            total_fails += test_close_btn_guard(browser, base).summary()
            print("\n==== 标签自动关闭 BUG 回归总计：%d 失败 ====" % total_fails)
            # 与项目既有约定一致：playwright 收尾偶发阻塞，直接强制退出，
            # 且必须在 with 块内退出，避免 sync_playwright 的 stop() 挂住。
            os._exit(1 if total_fails else 0)
    except Exception:
        import traceback
        traceback.print_exc()
        os._exit(1)


if __name__ == "__main__":
    main()
