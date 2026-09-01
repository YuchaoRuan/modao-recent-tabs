# -*- coding: utf-8 -*-
"""
tests/test_tabbar_ui.py — tabbar.js 组件测试（UI 层）
直接加载现有演示页 desktop/index.html（共用同一套 tabbar.js / tabbar.css），
验证组件渲染、点击切换、单标签关闭、画布列表下拉等交互。
"""
import os
import sys
import threading

sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
from harness import start_server, Tester, screenshot, new_page

DEMO = "/desktop/index.html"


def test_demo(browser, base):
    t = Tester("演示页组件：渲染/切换/关闭/下拉")
    ctx, page = new_page(browser)
    try:
        page.goto(base + DEMO, wait_until="networkidle")
        page.wait_for_selector(".md-recent-tabs", state="attached")
        t.check(page.is_visible(".md-recent-tabs"), "标签栏渲染可见")

        total = page.eval_on_selector_all(".md-tab", "els => els.length")
        t.eq(total, 5, "默认渲染 5 个演示画布 (got=%r)" % total)

        # 点击 tab 切换 → 画布标题更新
        page.click('.md-tab[data-id="cb_demo_2"] .md-tab__label')
        title = page.text_content("#cv-title")
        t.eq(title, "新增/修改(说明)", "点标签 → #cv-title 更新为对应画布名")

        # 点 × 关闭一个标签
        before = page.eval_on_selector_all(".md-tab", "els => els.length")
        page.click('.md-tab[data-id="cb_demo_3"] .md-tab__close')
        after = page.eval_on_selector_all(".md-tab", "els => els.length")
        t.eq(after, before - 1, "点 × → 标签数减 1 (before=%r after=%r)" % (before, after))
        t.check(not page.evaluate("!!document.querySelector('.md-tab[data-id=\"cb_demo_3\"]')"),
                "被关闭的标签消失")

        # 画布列表下拉
        page.click(".md-recent-tabs__badge")
        t.check(page.evaluate("document.querySelector('.md-recent-tabs__menu').classList.contains('is-open')"),
                "点击徽标 → 下拉展开")
        items = page.eval_on_selector_all(".md-recent-tabs__menu .md-menu-item", "els => els.length")
        t.eq(items, after, "下拉项数量与当前标签数一致 (got=%r)" % items)
        # 点下拉项切换并收起
        page.click('.md-recent-tabs__menu .md-menu-item[data-id="cb_demo_1"]')
        t.eq(page.text_content("#cv-title"), "消息模板管理", "点下拉项 → 切换画布")
        t.check(not page.evaluate("document.querySelector('.md-recent-tabs__menu').classList.contains('is-open')"),
                "选择后下拉收起")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "ui_demo")
    finally:
        ctx.close()
    return t


def main():
    httpd, base = start_server()
    total_fails = 0
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
            total_fails += test_demo(browser, base).summary()
            print("\n==== UI 组件测试总计：%d 失败 ====" % total_fails)
    except Exception:
        import traceback
        traceback.print_exc()
        total_fails += 1
    # 收尾（Playwright stop / httpd shutdown）偶发阻塞，限时强制退出，避免 CI 卡死
    def _teardown():
        try:
            browser.close()
        except Exception:
            pass
        try:
            httpd.shutdown()
        except Exception:
            pass
    th = threading.Thread(target=_teardown, daemon=True)
    th.start()
    th.join(5)
    os._exit(1 if total_fails else 0)


if __name__ == "__main__":
    main()
