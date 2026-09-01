# -*- coding: utf-8 -*-
"""
tests/test_core_logic.py — recent-tabs-core.js 自动化测试
用本地模拟墨刀设计文件页（harness 注入真实源码 + 调用 MDRecentTabs.create），
覆盖 README.browser.md 自测清单 8 项 + SPA 跨文件切换 + MD_CLEAR_CLOSED 消息。
"""
import os
import sys
import threading

sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
from harness import start_server, inject_and_create, Tester, screenshot, new_page

CID = "TESTCID"
# 默认 fixture 用兼容路径（JSON 数组）—— UI 用例（如 close_others / dropdown）需多个标签；
# 真实格式（localStorage 单值字符串 "rbpVRNr<base62>"，2026-08-28 用户探针已确认）
# 由专项用例 test_real_format_parse 校验。
HIST = ["S5", "S4", "S1"]  # 顶部=最近
HIST_REAL = "rbpVRNrGAXIFlsc15"  # 真实单值（最近画布 → 对应左侧 S5）


def test_appears(browser, base):
    t = Tester("标签栏出现 / 非设计页隐藏")
    ctx, page = new_page(browser)
    try:
        page.goto(base + "/proto/design/" + CID, wait_until="load")
        inject_and_create(page, CID, HIST, active_cid="S5", canvas_title="首页Banner配置")
        page.wait_for_selector("#md-recent-tabs-root .md-recent-tabs", state="attached")
        disp = page.evaluate("getComputedStyle(document.getElementById('md-recent-tabs-root')).display")
        t.check(disp != "none", "设计文件页：根节点可见 (display=%r)" % disp)
        t.check(page.evaluate("!!document.querySelector('#md-recent-tabs-root .md-recent-tabs')"),
                "标签栏 DOM 已挂载")

        # 非设计页（/workspace）→ cid 为空 → 隐藏
        c2, p2 = new_page(browser)
        p2.goto(base + "/workspace", wait_until="load")
        inject_and_create(p2, CID, HIST, active_cid="S5")
        disp2 = p2.evaluate("getComputedStyle(document.getElementById('md-recent-tabs-root')).display")
        t.check(disp2 == "none", "非设计页(/workspace)：根节点 display=none (got=%r)" % disp2)
        c2.close()
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "core_appears")
    finally:
        ctx.close()
    return t


def test_ordering(browser, base):
    t = Tester("按最近顺序排序（兼容数组路径）")
    ctx, page = new_page(browser)
    try:
        page.goto(base + "/proto/design/" + CID, wait_until="load")
        inject_and_create(page, CID, HIST, active_cid="S5")
        page.wait_for_selector(".md-tab")
        labels = page.eval_on_selector_all(".md-tab .md-tab__label", "els => els.map(e => e.textContent)")
        t.eq(labels, ["首页Banner配置", "订单详情退款", "消息模板管理"], "标签顺序按历史倒序")
        t.check(not page.evaluate("!!document.querySelector('.md-tab[data-id=\"SF\"]')"),
                "文件夹 SF 被排除")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "core_ordering")
    finally:
        ctx.close()
    return t


def test_real_format_parse(browser, base):
    """真实格式专项：localStorage 单值字符串 → 仅渲染该 id 标签。
    由 2026-08-28 用户在内网墨刀控制台贴回的真实探针结果确认：
      localStorage['screen-history-onLeave-project-pb2msfg4ie1f8gv9w']
        = "rbpVRNrGAXIFlsc15"  （切换前 G9ovkoxf7t，切换后 GAXIFlsc15）
      左侧 .rn-list-item[data-cid] 全部为 rbpVRNr...，与 history 同源。
    """
    t = Tester("真实格式解析（rbpVRNr<base62> 单值）")
    ctx, page = new_page(browser)
    try:
        page.goto(base + "/proto/design/" + CID, wait_until="load")
        # 仿照真实环境：history 单值 → 左侧面板里有该画布
        page.evaluate(
            """
            (function(){
              var sb = document.querySelector('.rn-sidebar');
              // 已有 S1~S5 画布项，补充一个用真实 id 的项
              var d = document.createElement('div');
              d.className='rn-list-item'; d.setAttribute('data-cid','rbpVRNrGAXIFlsc15'); d.textContent='首页Banner配置（真实id）';
              sb.appendChild(d);
              localStorage.setItem('screen-history-onLeave-project-TESTCID', 'rbpVRNrGAXIFlsc15');
            })();
            """
        )
        # harness 不覆盖 localStorage（history=None）
        inject_and_create(page, CID, None, active_cid="rbpVRNrGAXIFlsc15")
        page.wait_for_selector('.md-tab[data-id="rbpVRNrGAXIFlsc15"]')
        ids = page.eval_on_selector_all(".md-tab", "els => els.map(e => e.getAttribute('data-id'))")
        t.eq(ids, ["rbpVRNrGAXIFlsc15"],
             "非 JSON 单值 'rbpVRNrGAXIFlsc15' 正确解析为 1 个标签（修复 C 还原 + 真实数据源生效）")
        # 验证 harness 未二次 JSON 化（localStorage 原值仍是裸字符串）
        raw = page.evaluate("localStorage.getItem('screen-history-onLeave-project-TESTCID')")
        t.eq(raw, "rbpVRNrGAXIFlsc15", "localStorage 原值未被破坏（harness 按真实格式写入）")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "core_real_format_parse")
    finally:
        ctx.close()
    return t


def test_switch(browser, base):
    t = Tester("点标签切换画布")
    ctx, page = new_page(browser)
    try:
        page.goto(base + "/proto/design/" + CID, wait_until="load")
        inject_and_create(page, CID, HIST, active_cid="S5")
        page.wait_for_selector('.md-tab[data-id="S1"] .md-tab__label')
        page.click('.md-tab[data-id="S1"] .md-tab__label')
        clicks = page.evaluate("window.__clicks['S1'] || 0")
        t.check(clicks >= 1, "点标签 S1 → 对应左侧画布项收到 click (count=%r)" % clicks)
        active = page.eval_on_selector(".md-tab.is-active", "e => e.getAttribute('data-id')") \
            if page.query_selector(".md-tab.is-active") else None
        t.eq(active, "S1", "切换后 S1 为激活标签")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "core_switch")
    finally:
        ctx.close()
    return t


def test_close_single(browser, base):
    t = Tester("点×关闭单标签 + 持久化")
    ctx, page = new_page(browser)
    try:
        page.goto(base + "/proto/design/" + CID, wait_until="load")
        inject_and_create(page, CID, HIST, active_cid="S5")
        page.wait_for_selector('.md-tab[data-id="S4"] .md-tab__close')
        page.click('.md-tab[data-id="S4"] .md-tab__close')
        page.wait_for_selector('.md-tab[data-id="S4"]', state="detached", timeout=2000)
        t.check(page.evaluate("!document.querySelector('.md-tab[data-id=\"S4\"]')"), "关闭后 S4 标签消失")
        closed = page.evaluate("JSON.parse(localStorage.getItem('md_closed_screens') || '[]')")
        t.check("S4" in closed, "S4 写入 md_closed_screens (got=%r)" % closed)

        page.reload(wait_until="load")
        inject_and_create(page, CID, HIST, active_cid="S5")
        page.wait_for_selector(".md-recent-tabs")
        t.check(page.evaluate("!document.querySelector('.md-tab[data-id=\"S4\"]')"),
                "刷新后 S4 仍不出现（本地记录生效）")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "core_close_single")
    finally:
        ctx.close()
    return t


def test_close_others(browser, base):
    t = Tester("关闭其他")
    ctx, page = new_page(browser)
    try:
        page.goto(base + "/proto/design/" + CID, wait_until="load")
        inject_and_create(page, CID, HIST, active_cid="S5")
        page.wait_for_selector('.md-tab[data-id="S1"] .md-tab__label')
        page.click('.md-tab[data-id="S1"] .md-tab__label')
        # 等 S1 成为激活态（setActive 经 setTimeout 异步渲染），避免点关闭其他时 activeId 时机不稳
        page.wait_for_selector('.md-tab[data-id="S1"].is-active', timeout=2000)
        page.click('.md-icon-btn[title="关闭其他画布"]')
        page.wait_for_timeout(50)
        count = page.eval_on_selector_all(".md-tab", "els => els.length")
        t.eq(count, 1, "关闭其他后仅剩 1 个标签 (got=%r)" % count)
        active = page.eval_on_selector(".md-tab.is-active", "e => e.getAttribute('data-id')") \
            if page.query_selector(".md-tab.is-active") else None
        t.eq(active, "S1", "保留的标签为当前激活 S1")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "core_close_others")
    finally:
        ctx.close()
    return t


def test_dropdown(browser, base):
    t = Tester("画布列表下拉")
    ctx, page = new_page(browser)
    try:
        page.goto(base + "/proto/design/" + CID, wait_until="load")
        inject_and_create(page, CID, HIST, active_cid="S5")
        page.wait_for_selector(".md-recent-tabs__badge")
        page.click(".md-recent-tabs__badge")
        t.check(page.evaluate("document.querySelector('.md-recent-tabs__menu').classList.contains('is-open')"),
                "点击徽标 → 下拉菜单展开")
        items = page.eval_on_selector_all(".md-recent-tabs__menu .md-menu-item", "els => els.length")
        t.eq(items, 3, "下拉列出 3 个画布（排除文件夹）")
        page.click('.md-recent-tabs__menu .md-menu-item[data-id="S4"]')
        active = page.eval_on_selector(".md-tab.is-active", "e => e.getAttribute('data-id')") \
            if page.query_selector(".md-tab.is-active") else None
        t.eq(active, "S4", "点下拉项 S4 → 切换激活")
        t.check(not page.evaluate("document.querySelector('.md-recent-tabs__menu').classList.contains('is-open')"),
                "选择后下拉收起")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "core_dropdown")
    finally:
        ctx.close()
    return t


def test_pin_float(browser, base):
    t = Tester("图钉：固定/浮动显隐")
    ctx, page = new_page(browser)
    try:
        page.goto(base + "/proto/design/" + CID, wait_until="load")
        inject_and_create(page, CID, HIST, active_cid="S5")
        page.wait_for_selector(".md-pin-btn")
        page.click(".md-pin-btn")
        t.check(page.evaluate("document.querySelector('.md-recent-tabs').classList.contains('is-float')"),
                "点击图钉 → 进入浮动模式(is-float)")
        t.check(page.evaluate("!!document.querySelector('.md-recent-tabs-hotspot')"),
                "浮动模式创建滑出热点(hotspot)")
        t.eq(page.evaluate("localStorage.getItem('md_display_mode')"), "float", "显示模式持久化为 float")
        # 浮动模式通过注入的 <style id=md-recent-tabs-offset> 设置 body padding-top
        pad = page.evaluate("getComputedStyle(document.body).paddingTop")
        t.check(pad not in ("0px", ""), "body padding-top 已设置 (computed=%r)" % pad)
        page.dispatch_event(".md-recent-tabs-hotspot", "mouseenter")
        t.check(page.evaluate("document.querySelector('.md-recent-tabs').classList.contains('is-visible')"),
                "鼠标移入热点 → 标签栏滑出(is-visible)")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "core_pin_float")
    finally:
        ctx.close()
    return t


def test_default_canvas(browser, base):
    t = Tester("进入文件默认画布出现")
    ctx, page = new_page(browser)
    try:
        page.goto(base + "/proto/design/" + CID, wait_until="load")
        # 历史不含 S3，靠 is-active 默认激活 → 应出现
        inject_and_create(page, CID, ["S5", "S4"], active_cid="S3", canvas_title="登录页手机号")
        page.wait_for_selector(".md-recent-tabs")
        t.check(page.evaluate("!!document.querySelector('.md-tab[data-id=\"S3\"]')"),
                "默认激活画布 S3 出现在标签栏")
        t.check(page.evaluate("!!document.querySelector('.md-tab[data-id=\"S5\"]')"), "历史画布 S5 出现")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "core_default_canvas")
    finally:
        ctx.close()
    return t


def test_spa_switch(browser, base):
    t = Tester("SPA 跨设计文件切换（cid 重置，不串号）")
    ctx, page = new_page(browser)
    try:
        page.goto(base + "/proto/design/" + CID, wait_until="load")
        inject_and_create(page, CID, HIST, active_cid="S5")
        page.wait_for_selector(".md-tab")
        t.check(page.eval_on_selector_all(".md-tab", "els => els.length") == 3, "切换前 TESTCID 有 3 个标签")

        # 模拟 SPA 切到 OTHERCID：墨刀会重渲染左侧栏 + 画布标题，并加载 OTHERCID 自身历史
        page.evaluate(
            """
            (function(){
              var sb = document.querySelector('.rn-sidebar');
              document.querySelectorAll('.rn-list-item').forEach(function(e){ e.remove(); });
              ['O1:OTHER首页','O2:OTHER详情'].forEach(function(p){
                var kv = p.split(':');
                var d = document.createElement('div');
                d.className='rn-list-item'; d.setAttribute('data-cid', kv[0]); d.textContent=kv[1];
                sb.appendChild(d);
              });
              var ct = document.querySelector('.canvas-title'); if(ct) ct.textContent='OTHER首页';
              localStorage.setItem('screen-history-onLeave-project-OTHERCID', JSON.stringify(['O2','O1']));
            })();
            """
        )
        page.wait_for_timeout(60)  # 让 MutationObserver 先消化换栏，避免与后续轮询竞态
        # 模拟 SPA 导航：墨刀会 pushState 并同步重渲染左侧栏 + 画布标题 + 加载 OTHERCID 历史
        page.evaluate("history.pushState({}, '', '/proto/design/OTHERCID')")
        # 真实扩展无路由事件监听，靠 2s 轮询 refreshCid 检测 cid 变化并重渲染；此处等待其生效
        try:
            page.wait_for_function(
                "Array.from(document.querySelectorAll('.md-tab')).map(function(e){return e.getAttribute('data-id');}).join(',') === 'O2,O1'",
                timeout=4500,
            )
        except Exception:
            pass
        ids = page.eval_on_selector_all(".md-tab", "els => els.map(e => e.getAttribute('data-id'))")
        t.check(
            "S1" not in ids and "S4" not in ids and "S5" not in ids,
            "TESTCID 标签未串号进入 OTHERCID (ids=%r)" % ids,
        )
        t.eq(sorted(ids), ["O1", "O2"], "OTHERCID 仅显示自身画布 (ids=%r)" % ids)
        active = page.eval_on_selector(".md-tab.is-active", "e => e.getAttribute('data-id')") \
            if page.query_selector(".md-tab.is-active") else None
        # renderList 重建时取历史最新项(list[0])为激活：OTHERCID 历史 [O2,O1] → O2 最新
        t.eq(active, "O2", "OTHERCID 重建后激活其最近画布（历史最新项 O2）")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "core_spa_switch")
    finally:
        ctx.close()
    return t


def test_clear_closed(browser, base):
    t = Tester("清除已关闭标签(MD_CLEAR_CLOSED)")
    ctx, page = new_page(browser)
    try:
        page.goto(base + "/proto/design/" + CID, wait_until="load")
        inject_and_create(page, CID, HIST, active_cid="S5")
        page.wait_for_selector('.md-tab[data-id="S4"] .md-tab__close')
        page.click('.md-tab[data-id="S4"] .md-tab__close')
        page.wait_for_selector('.md-tab[data-id="S4"]', state="detached", timeout=2000)
        t.check(page.evaluate("!document.querySelector('.md-tab[data-id=\"S4\"]')"), "先关闭 S4")
        page.evaluate("window.__mdMsgListener({type:'MD_CLEAR_CLOSED'}, {}, function(){})")
        page.wait_for_timeout(60)
        t.check(page.evaluate("!!document.querySelector('.md-tab[data-id=\"S4\"]')"), "清除后 S4 恢复出现")
        t.eq(page.evaluate("JSON.parse(localStorage.getItem('md_closed_screens') || '[]')"), [],
             "md_closed_screens 清空")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "core_clear_closed")
    finally:
        ctx.close()
    return t


def test_destroy_cleanup(browser, base):
    t = Tester("destroy() 清理资源（不泄漏/不重复挂载）")
    ctx, page = new_page(browser)
    try:
        page.goto(base + "/proto/design/" + CID, wait_until="load")
        inject_and_create(page, CID, HIST, active_cid="S5")
        page.wait_for_selector(".md-recent-tabs")
        t.check(page.evaluate("!!document.getElementById('md-recent-tabs-root')"), "创建后根节点存在")
        page.evaluate("window.__ctrl.destroy()")
        t.check(page.evaluate("!document.getElementById('md-recent-tabs-root')"),
                "destroy 后根节点移除（修复 A）")
        t.check(page.evaluate("!document.getElementById('md-recent-tabs-offset')"),
                "destroy 后 offset <style> 移除（修复 A）")
        # 清理后再次 create 不应出现双根（MO/interval/监听已随 destroy 拆除）
        page.evaluate("window.__ctrl2 = MDRecentTabs.create({ enableMessageListener: true });")
        t.eq(page.eval_on_selector_all("#md-recent-tabs-root", "els => els.length"), 1,
             "destroy 后再次 create 仅 1 个根节点（无重复挂载）")
        page.evaluate("window.__ctrl2.destroy()")
        t.eq(page.eval_on_selector_all("#md-recent-tabs-root", "els => els.length"), 0,
             "二次 destroy 后根节点归零")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "core_destroy_cleanup")
    finally:
        ctx.close()
    return t


def test_mo_sync(browser, base):
    t = Tester("MutationObserver 节流后仍同步新增画布（修复 B）")
    ctx, page = new_page(browser)
    try:
        page.goto(base + "/proto/design/" + CID, wait_until="load")
        inject_and_create(page, CID, HIST, active_cid="S5")
        page.wait_for_selector(".md-tab")
        # 动态新增左侧画布项 + 写入历史 → 触发 MutationObserver 同步
        page.evaluate(
            """
            (function(){
              var sb = document.querySelector('.rn-sidebar');
              var d = document.createElement('div');
              d.className='rn-list-item'; d.setAttribute('data-cid','NEWX'); d.textContent='新增画布X';
              sb.appendChild(d);
              var key='screen-history-onLeave-project-TESTCID';
              var arr=JSON.parse(localStorage.getItem(key)||'[]');
              arr.unshift('NEWX');
              localStorage.setItem(key, JSON.stringify(arr));
            })();
            """
        )
        page.wait_for_selector('.md-tab[data-id="NEWX"]', timeout=3000)
        t.check(page.evaluate("!!document.querySelector('.md-tab[data-id=\"NEWX\"]')"),
                "新增画布 NEWX 经 MutationObserver 进入标签栏（rAF 节流未丢事件）")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "core_mo_sync")
    finally:
        ctx.close()
    return t


def test_idempotent_create(browser, base):
    t = Tester("幂等：重复 create 不重复挂载（P2-3）")
    ctx, page = new_page(browser)
    try:
        page.goto(base + "/proto/design/" + CID, wait_until="load")
        inject_and_create(page, CID, HIST, active_cid="S5")
        page.wait_for_selector(".md-recent-tabs")
        # 二次 create（不 destroy）→ 应复用既有实例，不新建 root
        page.evaluate("window.__ctrl2 = MDRecentTabs.create({ enableMessageListener: true });")
        t.eq(page.eval_on_selector_all("#md-recent-tabs-root", "els => els.length"), 1,
             "重复 create 仅 1 个根节点（无重复挂载）")
        t.check(page.evaluate("window.__ctrl === window.__ctrl2"),
                "二次 create 返回同一实例引用")
        # destroy 后实例缓存清空，可再次新建
        page.evaluate("window.__ctrl.destroy()")
        page.evaluate("window.__ctrl3 = MDRecentTabs.create({ enableMessageListener: true });")
        t.eq(page.eval_on_selector_all("#md-recent-tabs-root", "els => els.length"), 1,
             "destroy 后可再次 create 且仍仅 1 个根")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "core_idempotent")
    finally:
        ctx.close()
    return t


def test_a11y(browser, base):
    t = Tester("标签可访问性（P3-1）")
    ctx, page = new_page(browser)
    try:
        page.goto(base + "/proto/design/" + CID, wait_until="load")
        inject_and_create(page, CID, HIST, active_cid="S5")
        page.wait_for_selector(".md-tab")
        t.eq(page.evaluate("document.querySelector('.md-recent-tabs').getAttribute('role')"), "tablist",
             "容器 role=tablist")
        roles = page.eval_on_selector_all(".md-tab", "els => els.map(e => e.getAttribute('role'))")
        t.check(all(r == "tab" for r in roles), "每个标签 role=tab (got=%r)" % roles)
        act = page.eval_on_selector(".md-tab.is-active",
            "e => ({ti: e.getAttribute('tabindex'), as: e.getAttribute('aria-selected')})")
        t.eq(act, {"ti": "0", "as": "true"}, "激活标签 tabindex=0 aria-selected=true")
        others = page.eval_on_selector_all(".md-tab:not(.is-active)",
            "els => els.map(e => ({ti: e.getAttribute('tabindex'), as: e.getAttribute('aria-selected')}))")
        t.check(all(o["ti"] == "-1" and o["as"] == "false" for o in others),
                "非激活标签 tabindex=-1 aria-selected=false")
        t.eq(page.evaluate("document.querySelector('.md-tab__close').getAttribute('role')"), "button",
             "关闭按钮 role=button")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "core_a11y")
    finally:
        ctx.close()
    return t


def test_switch_missing_canvas(browser, base):
    t = Tester("切换已删除画布 → 清理失效标签（P3-2）")
    ctx, page = new_page(browser)
    try:
        page.goto(base + "/proto/design/" + CID, wait_until="load")
        inject_and_create(page, CID, HIST, active_cid="S5")
        page.wait_for_selector('.md-tab[data-id="S1"]')
        # 模拟画布 S1 已从左侧栏被删除（真实环境墨刀已移除该项）
        page.evaluate("document.querySelector('[data-cid=\"S1\"]').remove()")
        # 通过下拉菜单点 S1 → 触发 onSwitch
        page.click(".md-recent-tabs__badge")
        page.wait_for_selector('.md-recent-tabs__menu.is-open')
        page.click('.md-recent-tabs__menu .md-menu-item[data-id="S1"]')
        page.wait_for_selector('.md-tab[data-id="S1"]', state="detached", timeout=2000)
        t.check(page.evaluate("!document.querySelector('.md-tab[data-id=\"S1\"]')"),
                "失效画布 S1 被清理（已删除，不占位误导）")
        t.check(page.evaluate("!!document.querySelector('.md-tab[data-id=\"S5\"]')"),
                "其余标签不受影响")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "core_switch_missing")
    finally:
        ctx.close()
    return t


def test_duplicate_name_one_tab(browser, base):
    """同名画布：点击其一仅生成 1 个标签（修复「设备导入」重标签 BUG）。
    构造两个同名 rn-list-item（D2 在前、D1 在后），canvas_title=同名 →
    强制走名称反查分支；点击 D1 后经 refresh() 触发 syncActiveScreen，
    反查命中 D2 但属同名歧义 → 应忽略，不得凭空生成第 2 个标签。"""
    t = Tester("同名画布点击仅 1 标签（BUG 锁定）")
    ctx, page = new_page(browser)
    try:
        page.goto(base + "/proto/design/" + CID, wait_until="load")
        # 注入两个同名画布项：D2 在前（DOM 顺序）、D1 在后，名称均为「设备导入」
        page.evaluate(
            """
            (function(){
              var sb = document.querySelector('.rn-sidebar');
              function add(id){
                var d = document.createElement('div');
                d.className='rn-list-item'; d.setAttribute('data-cid', id); d.textContent='设备导入';
                sb.appendChild(d);
              }
              add('D2'); add('D1');
            })();
            """
        )
        # 不传 active_cid → 不走 class 分支；canvas_title=同名 → 走名称反查分支（真实墨刀现状）
        # history=None 且名称反查不再于初始化阶段造标签 → 初始无标签，符合预期
        inject_and_create(page, CID, None, canvas_title="设备导入")
        # 点击用户实际打开的那个画布 D1（点击即生成标签页）
        page.click('[data-cid="D1"]')
        page.wait_for_selector(".md-tab", timeout=3000)
        # 模拟墨刀切换后 MutationObserver/poll 触发的 refresh → syncActiveScreen
        page.evaluate("window.__ctrl.refresh()")
        page.wait_for_timeout(30)
        ids = page.eval_on_selector_all(".md-tab", "els => els.map(e => e.getAttribute('data-id'))")
        t.eq(ids, ["D1"], "点击 D1 后仅 1 个标签且为 D1（无同名重标签）")
        labels = page.eval_on_selector_all(".md-tab .md-tab__label", "els => els.map(e => e.textContent)")
        t.eq(labels, ["设备导入"], "标签文本为「设备导入」")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "core_dup_name_one")
    finally:
        ctx.close()
    return t


def test_duplicate_name_both_clicks(browser, base):
    """同名画布：用户真点遍两个 → 正确显示 2 个标签（无过度抑制）。"""
    t = Tester("同名画布点两个 → 2 标签（行为保持）")
    ctx, page = new_page(browser)
    try:
        page.goto(base + "/proto/design/" + CID, wait_until="load")
        page.evaluate(
            """
            (function(){
              var sb = document.querySelector('.rn-sidebar');
              function add(id){
                var d = document.createElement('div');
                d.className='rn-list-item'; d.setAttribute('data-cid', id); d.textContent='设备导入';
                sb.appendChild(d);
              }
              add('D2'); add('D1');
            })();
            """
        )
        inject_and_create(page, CID, None, canvas_title="设备导入")
        page.click('[data-cid="D1"]')
        page.wait_for_selector(".md-tab", timeout=3000)
        page.wait_for_timeout(30)
        page.evaluate("window.__ctrl.refresh()")
        page.wait_for_timeout(30)
        page.click('[data-cid="D2"]')
        page.wait_for_timeout(30)
        page.evaluate("window.__ctrl.refresh()")
        page.wait_for_timeout(30)
        ids = sorted(page.eval_on_selector_all(".md-tab", "els => els.map(e => e.getAttribute('data-id'))"))
        t.eq(ids, ["D1", "D2"], "点遍两个同名画布 → 2 个标签（D1、D2 均真实存在）")
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "core_dup_name_both")
    finally:
        ctx.close()
    return t


def test_toolbar_avoidance(browser, base):
    """顶部工具栏避让（修复「标签栏遮挡墨刀工具栏」）：
    fixture 工具栏为 styled-components 风格 div（styles__StyledTopBar-…，模拟真实墨刀），
    高度 48px；标签栏 top 应下移至 48px、body padding-top = 44+48 = 92px，不再压住工具栏。"""
    t = Tester("标签栏避让顶部工具栏（fixed 模式）")
    ctx, page = new_page(browser)
    try:
        page.goto(base + "/proto/design/" + CID, wait_until="load")
        inject_and_create(page, CID, HIST, active_cid="S5")
        page.wait_for_selector(".md-recent-tabs")
        top = page.evaluate("document.querySelector('.md-recent-tabs').style.top")
        t.eq(top, "48px", "标签栏 top 下移至工具栏底部 48px (got=%r)" % top)
        pad = page.evaluate("getComputedStyle(document.body).paddingTop")
        t.eq(pad, "92px", "body padding-top = 44+48 (got=%r)" % pad)
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "core_toolbar_avoid")
    finally:
        ctx.close()
    return t


def test_toolbar_ignores_mid_page(browser, base):
    """页面中部 fixed 元素不参与避让（只认视口顶部 60px 内的横带）。"""
    t = Tester("页面中部固定元素不干扰避让")
    ctx, page = new_page(browser)
    try:
        page.goto(base + "/proto/design/" + CID, wait_until="load")
        inject_and_create(page, CID, HIST, active_cid="S5")
        page.wait_for_selector(".md-recent-tabs")
        # 插入 top=200px 的固定元素 → 触发 MutationObserver → refreshLayout
        page.evaluate(
            "(function(){var d=document.createElement('div');"
            "d.style.cssText='position:fixed;top:200px;left:0;right:0;height:44px;';"
            "document.body.appendChild(d);})()"
        )
        page.wait_for_timeout(200)  # 等 rAF + refreshLayout 消化
        top = page.evaluate("document.querySelector('.md-recent-tabs').style.top")
        t.eq(top, "48px", "中部固定元素(top=200)不抬高避让高度 (got=%r)" % top)
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "core_toolbar_mid")
    finally:
        ctx.close()
    return t


def test_toolbar_height_change(browser, base):
    """工具栏高度变化（SPA 重渲染/尺寸调整）→ 2s 轮询动态重测并刷新避让。"""
    t = Tester("工具栏高度变化后动态刷新避让")
    ctx, page = new_page(browser)
    try:
        page.goto(base + "/proto/design/" + CID, wait_until="load")
        inject_and_create(page, CID, HIST, active_cid="S5")
        page.wait_for_selector(".md-recent-tabs")
        # 改工具栏高度 48 → 60（style 变化不触发 MO childList，靠 2s 轮询 refreshLayout）
        page.evaluate("document.querySelector('.app-header').style.height='60px'")
        page.wait_for_function(
            "document.querySelector('.md-recent-tabs').style.top === '60px'", timeout=4500
        )
        top = page.evaluate("document.querySelector('.md-recent-tabs').style.top")
        t.eq(top, "60px", "高度变 60px 后标签栏 top 跟随 (got=%r)" % top)
        pad = page.evaluate("getComputedStyle(document.body).paddingTop")
        t.eq(pad, "104px", "body padding-top 刷新为 44+60=104px (got=%r)" % pad)
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "core_toolbar_height")
    finally:
        ctx.close()
    return t


def test_detect_header_relative_toolbar(browser, base):
    """真实墨刀顶部工具栏为 position:relative（styled-components 生成），
    detectHeaderBottom 必须接受 relative；旧版只认 fixed/sticky/absolute，
    导致真实环境 hb=0（用户探针实测「返回 null」）。本用例显式强制 relative 兜底。"""
    t = Tester("真实工具栏 position:relative 也能被避让检测到")
    ctx, page = new_page(browser)
    try:
        page.goto(base + "/proto/design/" + CID, wait_until="load")
        inject_and_create(page, CID, HIST, active_cid="S5")
        page.wait_for_selector(".md-recent-tabs")
        # 强制真实环境特征：relative 定位（fixture 默认已是 relative，这里再保险一次）
        page.evaluate("document.querySelector('.app-header').style.position='relative'")
        page.wait_for_timeout(2200)  # 等 2s 轮询 refreshLayout 重测
        top = page.evaluate("document.querySelector('.md-recent-tabs').style.top")
        t.eq(top, "48px", "relative 工具栏 → 标签栏 top=48px (got=%r)" % top)
        pad = page.evaluate("getComputedStyle(document.body).paddingTop")
        t.eq(pad, "92px", "relative 工具栏 → body padding-top=92px (got=%r)" % pad)
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "core_toolbar_relative")
    finally:
        ctx.close()
    return t


def test_content_offset_fixed_pushes_canvas(browser, base):
    """A2（v1.0.6 扩展）：fixed 模式标签栏占据 48–92，画布视口与各侧栏面板
    (.rn-canvas / .rn-sidebar / .rn-right-panel) 应整体下推 TAB_H(44)，使其始于标签栏之下，
    toolbar(0–48) 不受影响。"""
    t = Tester("A2 fixed 模式：画布与左右面板内容下推避让标签栏")
    ctx, page = new_page(browser)
    try:
        page.goto(base + "/proto/design/" + CID, wait_until="load")
        inject_and_create(page, CID, HIST, active_cid="S5")
        page.wait_for_selector(".md-recent-tabs")
        top = page.evaluate("document.querySelector('.md-recent-tabs').style.top")
        t.eq(top, "48px", "标签栏 top=48 (got=%r)" % top)
        for sel in [".rn-canvas", ".rn-sidebar", ".rn-right-panel"]:
            cv_top = page.evaluate("document.querySelector('%s').getBoundingClientRect().top" % sel)
            t.eq(round(cv_top), 92, "%s top 下推至 92 (48+44) (got=%r)" % (sel, cv_top))
            mt = page.evaluate("getComputedStyle(document.querySelector('%s')).marginTop" % sel)
            t.eq(mt, "44px", "%s marginTop=44px (got=%r)" % (sel, mt))
        tb_top = page.evaluate("document.querySelector('.app-header').getBoundingClientRect().top")
        t.eq(round(tb_top), 0, "toolbar 仍在视口顶部 0（未被下推）(got=%r)" % tb_top)
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "core_a2_fixed")
    finally:
        ctx.close()
    return t


def test_content_offset_float_clears(browser, base):
    """A2：float 模式标签栏默认隐藏（仅悬停热点可见），画布与各侧栏内容不应被下推（marginTop 还原）。"""
    t = Tester("A2 float 模式：画布与左右面板内容还原（不下推）")
    ctx, page = new_page(browser)
    try:
        page.goto(base + "/proto/design/" + CID, wait_until="load")
        inject_and_create(page, CID, HIST, active_cid="S5", display_mode="float")
        page.wait_for_selector(".md-recent-tabs")
        is_float = page.evaluate("document.querySelector('.md-recent-tabs').classList.contains('is-float')")
        t.check(is_float, "标签栏处于 float 模式")
        for sel in [".rn-canvas", ".rn-sidebar", ".rn-right-panel"]:
            cv_top = page.evaluate("document.querySelector('%s').getBoundingClientRect().top" % sel)
            t.eq(round(cv_top), 48, "float 模式 %s 回到 top=48 (got=%r)" % (sel, cv_top))
            mt = page.evaluate("getComputedStyle(document.querySelector('%s')).marginTop" % sel)
            t.eq(mt, "0px", "float 模式 %s marginTop=0（已还原）(got=%r)" % (sel, mt))
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "core_a2_float")
    finally:
        ctx.close()
    return t


def test_content_offset_fixed_to_float_restores(browser, base):
    """A2 鲁棒性：页面内 fixed→float 切换（点 pin 按钮）后，所有已下推区域容器 marginTop 还原。"""
    t = Tester("A2 fixed→float 切换：侧栏/画布下推还原")
    ctx, page = new_page(browser)
    try:
        page.goto(base + "/proto/design/" + CID, wait_until="load")
        inject_and_create(page, CID, HIST, active_cid="S5", display_mode="fixed")
        page.wait_for_selector(".md-recent-tabs")
        mt0 = page.evaluate("getComputedStyle(document.querySelector('.rn-sidebar')).marginTop")
        t.eq(mt0, "44px", "切换前 sidebar marginTop=44px (got=%r)" % mt0)
        # 点 pin 切换为 float
        page.evaluate("document.querySelector('.md-recent-tabs .md-pin-btn').click()")
        page.wait_for_function(
            "document.querySelector('.md-recent-tabs').classList.contains('is-float')", timeout=3000
        )
        for sel in [".rn-canvas", ".rn-sidebar", ".rn-right-panel"]:
            mt = page.evaluate("getComputedStyle(document.querySelector('%s')).marginTop" % sel)
            t.eq(mt, "0px", "切换 float 后 %s marginTop 还原 0 (got=%r)" % (sel, mt))
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "core_a2_fixed_to_float")
    finally:
        ctx.close()
    return t


def test_content_offset_relayout_survives(browser, base):
    """A2 鲁棒性（v1.0.7 幂等修复回归）：SPA 重渲染导致工具栏短暂消失(hb→0)再恢复(hb→48)时，
    MutationObserver 触发 refreshLayout，区域容器不得被永久清空（塌陷回 top=48 压住标签栏），
    终态应仍被下推 top=92 / marginTop=44px。"""
    t = Tester("A2 relayout 存活：工具栏短暂消失再恢复后区域仍下推")
    ctx, page = new_page(browser)
    try:
        page.goto(base + "/proto/design/" + CID, wait_until="load")
        inject_and_create(page, CID, HIST, active_cid="S5", display_mode="fixed")
        page.wait_for_selector(".md-recent-tabs")
        mt0 = page.evaluate("getComputedStyle(document.querySelector('.rn-sidebar')).marginTop")
        t.eq(mt0, "44px", "初始 sidebar 已下推 marginTop=44px (got=%r)" % mt0)
        # 模拟工具栏短暂移除（SPA 重渲染）——真实 DOM 变更会自动触发 MutationObserver
        page.evaluate("""
            var h = document.querySelector('.app-header');
            if (h && h.parentNode) h.parentNode.removeChild(h);
        """)
        page.wait_for_timeout(250)
        # 恢复工具栏（真实节点插入即触发 observer）
        page.evaluate("""
            var shell = document.querySelector('.app-shell') || document.body;
            var restored = document.createElement('header');
            restored.className = 'app-header';
            restored.style.cssText = 'position:relative;top:0;left:0;right:0;height:48px;';
            shell.insertBefore(restored, shell.firstChild);
        """)
        # 等待 observer 重测并将区域重新下推
        page.wait_for_function(
            "getComputedStyle(document.querySelector('.rn-sidebar')).marginTop === '44px'",
            timeout=3000
        )
        page.wait_for_timeout(150)
        for sel in [".rn-canvas", ".rn-sidebar", ".rn-right-panel"]:
            cv_top = page.evaluate("document.querySelector('%s').getBoundingClientRect().top" % sel)
            t.eq(round(cv_top), 92, "relayout 后 %s 仍下推至 top=92 (got=%r)" % (sel, cv_top))
            mt = page.evaluate("getComputedStyle(document.querySelector('%s')).marginTop" % sel)
            t.eq(mt, "44px", "relayout 后 %s marginTop 仍=44px（未塌陷）(got=%r)" % (sel, mt))
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "core_a2_relayout")
    finally:
        ctx.close()
    return t


def main():
    httpd, base = start_server()
    total_fails = 0
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
            for fn in [test_appears, test_ordering, test_real_format_parse, test_switch, test_close_single,
                   test_close_others, test_dropdown, test_pin_float, test_default_canvas,
                   test_spa_switch, test_clear_closed, test_destroy_cleanup, test_mo_sync,
                   test_idempotent_create, test_a11y, test_switch_missing_canvas,
                   test_duplicate_name_one_tab, test_duplicate_name_both_clicks,
                   test_toolbar_avoidance, test_toolbar_ignores_mid_page, test_toolbar_height_change,
                   test_detect_header_relative_toolbar,
                   test_content_offset_fixed_pushes_canvas, test_content_offset_float_clears,
                   test_content_offset_fixed_to_float_restores, test_content_offset_relayout_survives]:
                total_fails += fn(browser, base).summary()
            # 汇总在收尾（Playwright stop / httpd shutdown）之前打印，避免收尾偶发阻塞吞掉结果
            print("\n==== 核心逻辑测试总计：%d 失败 ====" % total_fails)
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
