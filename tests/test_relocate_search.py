# -*- coding: utf-8 -*-
"""
tests/test_relocate_search.py — v1.0.13「找不到画布时自动重定位」回归

夹具：tests/fixtures/mock-modao-design-search.html
  - 左侧画布列表非搜索态**全量渲染**（li.rn-content-item[data-cid]）；
  - 左侧搜索框 placeholder="关键字搜索…" 位于视口顶部；
  - 输入按画布名子串过滤，把不匹配项从 DOM 真正移除（模拟墨刀卸载非命中画布），
    恢复时重建全量；过滤/恢复延迟可通过 __mock.setLatency(ms) 调整。

覆盖用例：
  R1 搜索过滤态点其它画布标签 → 自动清空 → 目标标签保留、画布完成切换、激活态正确
  R2 切换成功后**不再自动恢复**原检索词：搜索框保持清空、列表保持全量
     （需求调整 2026-09-07：原词恢复会让刚打开的画布又被过滤移出视口）
  R3 输入目标名仍找不到的极端场景 → 标签保持 stale 不消失 + toast 出现
  R4 清空轮询期间的连点竞态：点 A（需清空轮询）后 200ms 内点 B → 最终停在 B
  R5 命中即切换路径仍正常（非搜索态不回归）
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
from harness import start_server, Tester, screenshot, new_page

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "mock-modao-design-search.html")
CID = "SCID"


# ---------------------------------------------------------------- 基础设施
def boot(page, base):
    """加载搜索夹具 + 注入真实源码 + 创建控制器。"""
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


def active_tab(page):
    return page.evaluate(
        "() => { var e = document.querySelector('.md-tab.is-active');"
        " return e ? e.getAttribute('data-id') : null; }"
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


def click_tab(page, cid):
    page.evaluate(
        """(cid) => {
            var t = document.querySelector('.md-tab[data-id="' + cid + '"] .md-tab__label');
            if (!t) throw new Error('tab not found: ' + cid);
            t.click();
        }""",
        cid,
    )


def click_close(page, cid):
    page.evaluate(
        """(cid) => {
            var x = document.querySelector('.md-tab[data-id="' + cid + '"] .md-tab__close');
            if (!x) throw new Error('close btn not found: ' + cid);
            x.click();
        }""",
        cid,
    )


# ---------------------------------------------------------------- R1
def test_r1_search_clear_switches(browser, base):
    t = Tester("R1 搜索过滤态点其它画布标签 → 自动清空 → 切换成功 + 激活态正确")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        # 建两个标签：先 c004（订单详情退款）再 c006（航班预订-列表页），激活在 c006
        click_left(page, "c004")
        click_left(page, "c006")
        page.wait_for_timeout(120)
        t.check("c004" in tab_ids(page) and "c006" in tab_ids(page),
                "前置：c004/c006 标签都在 (%s)" % tab_ids(page))

        # 输入「航班」过滤 → c004 被移出 DOM，c006 保留
        set_search(page, "航班")
        page.wait_for_timeout(320)
        t.check(in_dom(page, "c006") is True, "前置：c006（航班）在过滤结果中")
        t.check(in_dom(page, "c004") is False, "前置：c004 被搜索过滤、不在 DOM")
        t.eq(search_value(page), "航班", "前置：搜索框值为「航班」")

        before = clicks_of(page, "c004")
        click_tab(page, "c004")            # 搜索态点目标画布标签 → 自动清空定位
        page.wait_for_timeout(900)         # 清空(~120ms) + 轮询命中（成功后不再恢复原词）

        after = tab_ids(page)
        t.check("c004" in after, "切换后 c004 标签保留 (tabs=%s)" % after)
        t.check("c006" in after, "切换后 c006 标签也保留")
        t.check(clicks_of(page, "c004") > before,
                "c004 左侧项被自动定位并点击（画布完成切换）(%d → %d)"
                % (before, clicks_of(page, "c004")))
        t.eq(title_of(page), "订单详情退款", "画布标题已切到「订单详情退款」")
        t.eq(active_tab(page), "c004", "c004 标签变为激活态")
        t.check(not is_stale(page, "c004"), "定位成功后待定标记已清除")
        # 新语义：切换成功后原检索词「航班」不自动写回，搜索框保持空态、列表为全量
        t.eq(search_value(page), "", "切换后搜索框保持清空（原检索词「航班」未自动回来）")
        vis = visible_cids(page)
        t.check(len(vis) == 16 and "c004" in vis,
                "列表保持全量（16 项、目标 c004 可见，未被原词再次过滤） (vis=%s)" % vis)
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "relocate_r1")
    finally:
        ctx.close()
    return t


# ---------------------------------------------------------------- R2
def test_r2_search_term_not_restored(browser, base):
    """新语义（2026-09-07）：切换成功后不自动恢复原检索词。搜索「航班」过滤掉
    c002 → 点 c002 标签自动清空定位切换 → 搜索框保持为空、列表保持全量
    （刚打开的画布 c002 可见，不被原词再次过滤移出视口）。"""
    t = Tester("R2 切换成功后不恢复原检索词：搜索框清空、列表保持全量")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        # 目标 c002（新增修改说明）不含「航班」；原搜索上下文为「航班」
        click_left(page, "c002")
        click_left(page, "c008")
        page.wait_for_timeout(120)
        set_search(page, "航班")
        page.wait_for_timeout(320)
        t.check(in_dom(page, "c002") is False, "前置：c002 被过滤、不在 DOM")

        click_tab(page, "c002")
        page.wait_for_timeout(900)

        # 实现语义：切换成功后不再把原检索词写回（搜索框保持空态 + 列表全量）
        t.eq(search_value(page), "", "切换后搜索框保持清空（原检索词「航班」未自动回来）")
        t.eq(title_of(page), "新增修改说明", "画布已切到「新增修改说明」")
        t.eq(active_tab(page), "c002", "c002 激活态正确")
        vis = visible_cids(page)
        t.check("c002" in vis and len(vis) == 16,
                "列表为全量（c002 可见、16 项全部在列），未回到原过滤态 (vis=%s)" % vis)
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "relocate_r2")
    finally:
        ctx.close()
    return t


# ---------------------------------------------------------------- R3
def test_r3_search_by_name_fails(browser, base):
    t = Tester("R3 按目标名检索仍找不到 → 标签保持 stale + toast（不删标签）")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        click_left(page, "c013")           # 先建标签
        page.wait_for_timeout(120)
        t.check("c013" in tab_ids(page), "前置：c013 标签存在")
        t.check(in_dom(page, "c013") is True, "前置：c013 在 DOM")

        # 真正删除画布（数据源移除 + 重渲染）→ 即使清空/搜索也无法再定位到
        removed = page.evaluate("() => window.__mock.removeCanvas('c013')")
        t.check(removed is True, "已真正删除画布 c013")
        page.wait_for_timeout(200)
        t.check(in_dom(page, "c013") is False, "删除后 c013 不在 DOM")

        # 点击已删除画布的标签：搜索框为空 → 实现走「按目标名检索」→ 找不到 → 兜底链
        click_tab(page, "c013")
        page.wait_for_timeout(2800)        # 检索轮询预算 ~2s + 兜底扫描/toast

        t.check("c013" in tab_ids(page), "定位失败后标签未被静默删除 (tabs=%s)" % tab_ids(page))
        t.check(is_stale(page, "c013"), "标签保持待定(stale)不消失")
        ts = toast_state(page)
        t.check(ts["visible"], "出现可见提示 toast")
        t.check("未找到画布" in ts["text"], "提示文案说明原因: %r" % ts["text"])
        t.eq(search_value(page), "", "搜索框已还原为空（原值即空）")
        t.check(in_dom(page, "c013") is False, "c013 确实已删除（列表恢复全量也无此行）")

        # 清理路径：手动 × 仍可关闭待定标签
        click_close(page, "c013")
        page.wait_for_timeout(300)
        t.check("c013" not in tab_ids(page), "手动 × 可关闭已删除画布的标签")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "relocate_r3")
    finally:
        ctx.close()
    return t


# ---------------------------------------------------------------- R4
def test_r4_race_clear_polling(browser, base):
    """清空轮询期间的连点竞态：
    搜索「航班」过滤掉 A(c004)；点 A → 清空尚未完成（延迟 600ms）；
    200ms 内再点 B(c006，此刻仍在旧过滤列表中、立即命中) → A 的轮询命中后
    不得覆盖 B，最终必须停在 B。"""
    t = Tester("R4 清空轮询期间连点（A 需轮询 / B 立即可见）→ 最终停在 B")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        click_left(page, "c004")           # A
        click_left(page, "c006")           # B
        page.wait_for_timeout(120)
        # 把清空/恢复的异步延迟调大，制造「A 的轮询仍在飞」的稳定窗口
        page.evaluate("() => { window.__mock.setLatency(600); }")
        set_search(page, "航班")
        page.wait_for_timeout(750)         # 等首次过滤完成（latency=600 后全量渲染）
        t.check(in_dom(page, "c004") is False, "前置：A(c004) 被过滤、不在 DOM")
        t.check(in_dom(page, "c006") is True, "前置：B(c006) 在过滤结果中")

        c4_before = clicks_of(page, "c004")
        click_tab(page, "c004")            # A：触发清空 + 轮询（600ms 后全量列表才渲染出 A）
        page.wait_for_timeout(200)
        click_tab(page, "c006")            # B：立即命中（旧过滤列表里 B 仍在 DOM）
        page.wait_for_timeout(1600)        # 等 A 的轮询彻底跑完/被取消

        t.eq(active_tab(page), "c006", "最终激活标签应为最后点击的 B(c006)")
        t.eq(title_of(page), "航班预订-列表页", "最终画布应为 B（不被 A 的轮询覆盖）")
        t.eq(clicks_of(page, "c004"), c4_before,
             "A(c004) 的定位轮询被取消，未发生误切换 (clicks %d → %d)"
             % (c4_before, clicks_of(page, "c004")))
        after = tab_ids(page)
        t.check("c004" in after and "c006" in after,
                "两个标签均保留 (%s)" % after)
        t.check(not is_stale(page, "c006"), "B 未被标记为待定")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "relocate_r4")
    finally:
        ctx.close()
    return t


# ---------------------------------------------------------------- R5
def test_r5_hit_path_unchanged(browser, base):
    t = Tester("R5 命中即切换路径仍正常（非搜索态不回归）")
    ctx, page = new_page(browser)
    try:
        boot(page, base)
        click_left(page, "c001")
        click_left(page, "c002")
        page.wait_for_timeout(120)
        t.check(in_dom(page, "c001") is True, "前置：c001 在 DOM（无搜索过滤）")
        t.eq(search_value(page), "", "前置：搜索框为空")

        click_tab(page, "c001")
        page.wait_for_timeout(500)

        t.eq(title_of(page), "消息模板管理", "命中即切换：画布标题切到 c001")
        t.eq(active_tab(page), "c001", "c001 激活态正确")
        t.check("c001" in tab_ids(page) and "c002" in tab_ids(page),
                "标签均保留 (%s)" % tab_ids(page))
        t.check(not is_stale(page, "c001"), "命中路径无 stale 标记")
        t.eq(search_value(page), "", "搜索框未被触碰")
        t.check(in_dom(page, "c001") is True, "列表仍为全量（未触发搜索过滤）")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "relocate_r5")
    finally:
        ctx.close()
    return t


def main():
    httpd, base = start_server()
    total_fails = 0
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
            total_fails += test_r1_search_clear_switches(browser, base).summary()
            total_fails += test_r2_search_term_not_restored(browser, base).summary()
            total_fails += test_r3_search_by_name_fails(browser, base).summary()
            total_fails += test_r4_race_clear_polling(browser, base).summary()
            total_fails += test_r5_hit_path_unchanged(browser, base).summary()
            print("\n==== 自动重定位（搜索态）回归总计：%d 失败 ====" % total_fails)
            # 与项目既有约定一致：playwright 收尾偶发阻塞，直接强制退出。
            os._exit(1 if total_fails else 0)
    except Exception:
        import traceback
        traceback.print_exc()
        os._exit(1)


if __name__ == "__main__":
    main()
