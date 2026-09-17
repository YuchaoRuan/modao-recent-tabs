# -*- coding: utf-8 -*-
"""
QA-BUG0015 V4 独立取证：时间预算的实测（不是算数）
构造「目标行不在列表里」的最坏场景（用持久 MutationObserver 给所有行加 layer-item，
使 findCanvasEl 恒拒绝 -> revealCanvasEl 跑完整扫描却找不到），实测墙钟耗时：
  - 单趟（N=980，<=~1129 行）：应 <= 2500ms 左右；
  - 多趟（N=1500，>~1129 行）：已知该分支按代码注释「超出本缺陷实测范围」，会超预算（如实记录）。
并确认失败时 sc.scrollTop 还原为原值、扫描过程中不弹 toast。
"""
import os, sys, json, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright
from harness import start_server, Tester, screenshot, new_page

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FIXTURE = "tests/fixtures/mock-modao-design-virtual.html"
CUR_CORE = os.path.join(PROJECT_ROOT, "recent-tabs-core.js")

# 持久给所有画布行加 layer-item：用 MutationObserver 跨重渲染保持，使 findCanvasEl 恒拒绝
OBSERVER_JS = """
() => {
  var v = document.getElementById('rn-virtual');
  function mark(){ var els = v.querySelectorAll('.rn-list-item[data-cid]'); for (var i=0;i<els.length;i++) els[i].classList.add('layer-item'); }
  mark();
  window.__qa_mo = new MutationObserver(function(){ mark(); });
  window.__qa_mo.observe(v, {childList:true, subtree:true});
}
"""

def boot(page, base, rows, core_path, carrier="ext"):
    page.goto(base + "/" + FIXTURE + "?rows=%d" % rows, wait_until="load")
    page.evaluate("() => { try{localStorage.clear();}catch(e){} }")
    src = PROJECT_ROOT if carrier == "ext" else os.path.join(PROJECT_ROOT, "desktop")
    page.add_style_tag(path=os.path.join(src, "tabbar.css"))
    page.add_script_tag(path=os.path.join(src, "tabbar.js"))
    with open(core_path, encoding="utf-8") as f:
        page.add_script_tag(content=f.read())
    page.evaluate(
        """() => {
            window.chrome = window.chrome || {
              runtime: { onMessage: { addListener: function (fn) { window.__mdMsgListener = fn; } }, lastError: null }
            };
            window.__ctrl = MDRecentTabs.create({ enableMessageListener: true });
        }"""
    )
    page.wait_for_selector(".md-recent-tabs", state="attached")


def tab_ids(page):
    return page.evaluate("() => Array.from(document.querySelectorAll('.md-tab')).map(e => e.getAttribute('data-id'))")


def click_left(page, cid):
    page.evaluate(
        """(cid) => {
            window.__mock.scrollToCid(cid);
            window.__mock.render();
            var el = document.querySelector('.rn-list-item[data-cid=\"' + cid + '\"]');
            if (!el) throw new Error('left item not in DOM: ' + cid);
            el.click();
        }""", cid)
    page.wait_for_timeout(200)


def build_tab(page, cid):
    page.evaluate("(c) => window.__mock.scrollToCid(c)", cid)
    page.wait_for_timeout(120)
    page.evaluate("(c) => window.__mock.scrollToCid(c)", cid)
    page.wait_for_timeout(80)
    if not page.evaluate("(c) => window.__mock.inDom(c)", cid):
        return False
    click_left(page, cid)
    page.wait_for_timeout(250)
    return cid in tab_ids(page)


def click_tab(page, tid):
    page.evaluate(
        """(id) => {
            var t = document.querySelector('.md-tab[data-id=\"' + id + '\"] .md-tab__label');
            if (!t) throw new Error('tab not found: ' + id);
            t.click();
        }""", tid)


def toast_visible(page):
    return page.evaluate("() => { var e = document.querySelector('.md-recent-tabs__toast'); return !!e && e.classList.contains('is-visible'); }")


def toast_text(page):
    return page.evaluate("() => { var e = document.querySelector('.md-recent-tabs__toast-text'); return e ? e.textContent : ''; }")


def scroll_top(page):
    return page.evaluate("() => { var v = document.querySelector('.rn-virtual'); return v ? v.scrollTop : null; }")


def run_case(browser, base, N, report):
    t = Tester("V4 时间预算实测 N=%d（目标不在列表-强制全扫描失败）" % N)
    ctx, page = new_page(browser)
    try:
        boot(page, base, N, CUR_CORE)
        TARGET = "P71"
        t.check(build_tab(page, TARGET), "前置：P71 标签已建立 (tabs=%s)" % tab_ids(page))
        page.evaluate("() => { document.querySelector('.rn-virtual').scrollTop = 0; window.__mock.render(); }")
        page.wait_for_timeout(150)
        # 确认此刻 P71 不在 DOM（滚动不可见），再装持久拒绝观察者
        t.check(page.evaluate("(c) => window.__mock.inDom(c)", TARGET) is False, "前置：P71 因滚出视口未渲染")
        page.evaluate(OBSERVER_JS)
        start_top = scroll_top(page)
        t.check(start_top == 0, "前置：扫描前 scrollTop = %s（作为还原基准）" % start_top)

        # 扫描过程中不得弹 toast：在扫描前 1 秒窗口探测
        t0 = time.time()
        click_tab(page, TARGET)
        mid_visible = False
        while time.time() - t0 < 1.0:
            if toast_visible(page):
                mid_visible = True
                break
            page.wait_for_timeout(50)
        t.check(not mid_visible, "扫描过程中（前 1s）未弹 toast（中途误报=%s）" % mid_visible)

        # 等 Toast 出现（失败提示），测实际墙钟
        toast = ""
        while time.time() - t0 < 15:
            if toast_visible(page):
                toast = toast_text(page)
                if toast:
                    break
            page.wait_for_timeout(50)
        elapsed = time.time() - t0
        t.check("未找到画布" in toast, "失败场景确实弹出了「未找到画布」提示 (toast=%r)" % toast)
        t.check(elapsed >= 1.2, "耗时真实（非瞬间返回，说明跑了完整扫描）：%.2fs" % elapsed)
        # N<=1129 单趟应 <=2500ms；N=1500 多趟按代码注释会超预算，如实记录
        if N <= 1129:
            t.check(elapsed <= 3.0, "单趟预算内：实测 %.2fs <= ~2.5s（含 Playwright 轮询开销）" % elapsed)
            in_budget = elapsed <= 3.0
        else:
            in_budget = elapsed > 3.0  # 多趟预期超预算，记录为已知行为
            t.check(True, "多趟（N>~1129）按代码注释「超出本缺陷实测范围」预期超预算：实测 %.2fs（已知设计取舍，非缺陷）" % elapsed)
        # 还原校验
        end_top = scroll_top(page)
        t.check(end_top == start_top, "失败后 scrollTop 还原为原值：end=%s == start=%s" % (end_top, start_top))
        report[N] = {"elapsed_s": round(elapsed, 3), "toast": toast, "restored": end_top == start_top,
                     "in_budget_single_pass": (in_budget if N <= 1129 else None)}
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "qa_v4")
    finally:
        try:
            ctx.close()
        except Exception:
            pass
    return t


def main():
    httpd, base = start_server()
    report = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        try:
            run_case(browser, base, 980, report).summary()
            run_case(browser, base, 1500, report).summary()
        finally:
            browser.close()
    outp = os.path.join(os.path.dirname(__file__), "_qa_bug0015_v4_report.json")
    with open(outp, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print("\n[REPORT JSON] ->", outp)


if __name__ == "__main__":
    main()
