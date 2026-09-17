# -*- coding: utf-8 -*-
"""
QA-BUG0015 V5 独立取证：diagnoseLocateFailure.rowFoundButHidden 的真实行为
手法（与实现者不同）：直接用埋点核心暴露出的 diagnoseLocateFailure 真函数做两种场景，
再加一个端到端失败用例确认 notifyUnreachable 调用它时不会抛异常吞掉用户提示。

- 场景A「行找到但不可见」：折叠态（mock-modao-design-collapsed.html open=false），
  G 分组 30 行常驻 DOM 但外层 display:none 隐藏 -> findCanvasEl 能取到行、但 isRowVisible=false
  -> rowFoundButHidden 应为 true。
- 场景B「行根本不存在 / 被拒」：cid 不在列表（G99）、或在页面列（P1，带 layer-item 被拒）
  -> rowFoundButHidden 应为 false。
- 两场景 + 端到端失败：diagnoseLocateFailure 都不抛异常（否则会吞掉用户提示）。
"""
import os, sys, json, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright
from harness import start_server, Tester, screenshot, new_page

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
VIRTUAL = "tests/fixtures/mock-modao-design-virtual.html"
COLLAPSED = "tests/fixtures/mock-modao-design-collapsed.html"
CUR_CORE = os.path.join(PROJECT_ROOT, "recent-tabs-core.js")
INST_CORE = os.path.join(PROJECT_ROOT, "tests", "_qa_bug0015_core_inst.js")

OBSERVER_JS = """
() => {
  var v = document.getElementById('rn-virtual');
  function mark(){ var els = v.querySelectorAll('.rn-list-item[data-cid]'); for (var i=0;i<els.length;i++) els[i].classList.add('layer-item'); }
  mark();
  window.__qa_mo = new MutationObserver(function(){ mark(); });
  window.__qa_mo.observe(v, {childList:true, subtree:true});
}
"""


def boot(page, base, fixture, core_path, carrier="ext"):
    page.goto(base + "/" + fixture, wait_until="load")
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


def diag(page, cid, name):
    """直接调用埋点核心暴露的 diagnoseLocateFailure 真函数（包 try/catch 返回异常信息）。"""
    return page.evaluate(
        """(args) => {
            try {
                if (typeof window.__qa_diag !== 'function') return { __err: 'no __qa_diag' };
                var d = window.__qa_diag(args.cid, args.name);
                return { __ok: true, rowFoundButHidden: d.rowFoundButHidden, picked: d.picked ? d.picked.kind : null, cidHitTotal: d.cidHitTotal, rowHitTotal: d.rowHitTotal };
            } catch (e) { return { __err: String(e) }; }
        }""", {"cid": cid, "name": name})


def main():
    httpd, base = start_server()
    report = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])

        # ---------- 场景 A / B + 不抛异常：折叠态夹具 ----------
        t = Tester("V5 rowFoundButHidden（折叠态夹具，直接调 diagnoseLocateFailure）")
        ctx, page = new_page(browser)
        try:
            boot(page, base, COLLAPSED, INST_CORE)
            # 默认 open=false（折叠）：G 分组行常驻 DOM 但外层 display:none
            folded = page.evaluate("() => window.__mock.isGroupOpen()")
            t.check(folded is False, "前置：分组处于折叠态（open=false）isGroupOpen=%s" % folded)
            in_dom = page.evaluate("() => window.__mock.inDom('G05')")
            t.check(in_dom is True, "前置：G05 行在 DOM 中（折叠但节点仍在）inDom(G05)=%s" % in_dom)

            dA = diag(page, "G05", "历史画布 05")
            t.check("__err" not in dA, "场景A：diagnoseLocateFailure(G05) 未抛异常 (err=%s)" % dA.get("__err"))
            t.check(dA.get("rowFoundButHidden") is True, "场景A：行找到但不可见 -> rowFoundButHidden=true (diag=%s)" % dA)
            t.check(dA.get("picked") is not None, "场景A：picked 非空（确实找到了那一行）picked=%s" % dA.get("picked"))

            dB = diag(page, "G99", "不存在的画布")
            t.check("__err" not in dB, "场景B：diagnoseLocateFailure(G99) 未抛异常 (err=%s)" % dB.get("__err"))
            t.check(dB.get("rowFoundButHidden") is False, "场景B：行根本不存在 -> rowFoundButHidden=false (diag=%s)" % dB)

            dP = diag(page, "P1", "页面列画布")
            t.check("__err" not in dP, "场景B2：diagnoseLocateFailure(P1 页面列) 未抛异常 (err=%s)" % dP.get("__err"))
            t.check(dP.get("rowFoundButHidden") is False, "场景B2：页面列被拒行 -> rowFoundButHidden=false (diag=%s)" % dP)

            report["v5_scenarios"] = {"A_folded_G05": dA, "B_absent_G99": dB, "B2_page_P1": dP}
        except Exception as e:
            t.check(False, "异常: %r" % e)
            screenshot(page, "qa_v5")
        finally:
            ctx.close()

        # ---------- 场景 C：端到端失败，确认 notifyUnreachable 调用诊断不吞提示 ----------
        tc = Tester("V5c 端到端失败：notifyUnreachable→diagnose 不抛异常、提示照常弹出")
        ctx, page = new_page(browser)
        try:
            boot(page, base, VIRTUAL + "?rows=980", CUR_CORE)
            console_diag = []
            page.on("console", lambda m: console_diag.append(m.text) if "定位失败诊断" in m.text else None)
            TARGET = "P71"
            t.check(build_tab(page, TARGET), "前置：P71 标签已建立")
            page.evaluate("() => { document.querySelector('.rn-virtual').scrollTop = 0; window.__mock.render(); }")
            page.wait_for_timeout(150)
            page.evaluate(OBSERVER_JS)  # 持久拒绝所有行 -> 扫描必失败
            click_tab(page, TARGET)
            toast = ""
            waited = 0
            while waited < 15000:
                if toast_visible(page):
                    toast = toast_text(page)
                    if toast:
                        break
                page.wait_for_timeout(100)
                waited += 100
            t.check("未找到画布" in toast, "端到端失败仍弹出「未找到画布」提示（说明诊断未抛异常吞掉提示）(toast=%r)" % toast)
            diag_seen = any("定位失败诊断" in c for c in console_diag)
            t.check(diag_seen, "端到端：console.warn 输出了『定位失败诊断』对象（diagnoseLocateFailure 成功执行）captured=%d" % len(console_diag))
            report["v5_e2e"] = {"toast": toast, "diag_logged": diag_seen}
        except Exception as e:
            tc.check(False, "异常: %r" % e)
            screenshot(page, "qa_v5c")
        finally:
            ctx.close()

    # 打印汇总：必须在 browser.close() 之前，本环境 close() 可能挂起
    t.summary()
    tc.summary()
    outp = os.path.join(os.path.dirname(__file__), "_qa_bug0015_v5_report.json")
    with open(outp, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print("\n[REPORT JSON] ->", outp)
    # 关闭浏览器（可能挂起，不阻塞判定）
    try:
        browser.close()
    except Exception:
        pass
    # 强制退出，避免 close 挂起导致进程不结束
    import os as _os
    _os._exit(0)


if __name__ == "__main__":
    main()
