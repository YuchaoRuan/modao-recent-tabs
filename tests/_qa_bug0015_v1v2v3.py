# -*- coding: utf-8 -*-
"""
QA-BUG0015 独立取证脚本（V1 / V2 / V3）
与实现者不同的证据链：用「页面内 hook 渲染过程记录的被渲染行下标全集」证明漏档/覆盖，
用独立构造的 N=1500 多趟交错场景验证实现者用例抓不到的分支，而非只重跑他的用例。

输出：tests/_qa_bug0015_v1v2v3_report.json + 控制台结构化报告。
"""
import os, sys, json, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright
from harness import start_server, Tester, screenshot, new_page

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FIXTURE = "tests/fixtures/mock-modao-design-virtual.html"
CUR_CORE = os.path.join(PROJECT_ROOT, "recent-tabs-core.js")
INST_CORE = os.path.join(PROJECT_ROOT, "tests", "_qa_bug0015_core_inst.js")
OLD_1016 = os.path.join(PROJECT_ROOT, "tests", "_qa_old_v1.0.16.js")
OLD_1013 = os.path.join(PROJECT_ROOT, "tests", "_qa_old_v1.0.13.js")
OLD_5f08557 = os.path.join(PROJECT_ROOT, "tests", "_qa_old_5f08557.js")

# 页面内：记录扫描期间被渲染过的行 cid 集合 + scroll 事件计数（非侵入，不依赖核心内部变量）。
# 用 MutationObserver 兜底捕捉「scrollTop 不变导致的无 scroll 事件」渲染（首屏 / 末尾档），
# 否则边界行（如 P01..P10 / P1491..P1500）虽被渲染却因没触发 scroll 事件而漏记，造成假阴性的「漏扫」。
INSTRUMENT_RENDER = """
() => {
  window.__rendered = {};
  window.__scrollCount = 0;
  var vp = document.getElementById('rn-virtual');
  function rec(){
    var els = vp.querySelectorAll('.rn-list-item[data-cid]');
    for (var i=0;i<els.length;i++){
      var c = els[i].getAttribute('data-cid');
      window.__rendered[c] = (window.__rendered[c]||0)+1;
    }
  }
  if (vp) {
    vp.addEventListener('scroll', function(){ window.__scrollCount++; rec(); });
    window.__qa_mo = new MutationObserver(function(){ rec(); });
    window.__qa_mo.observe(vp, {childList:true, subtree:true});
    rec();
  }
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
    page.evaluate(INSTRUMENT_RENDER)
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
    return page.evaluate(
        "() => Array.from(document.querySelectorAll('.md-tab')).map(e => e.getAttribute('data-id'))"
    )


def click_tab(page, tid):
    page.evaluate(
        """(id) => {
            var t = document.querySelector('.md-tab[data-id=\"' + id + '\"] .md-tab__label');
            if (!t) throw new Error('tab not found: ' + id);
            t.click();
        }""",
        tid,
    )


def click_left(page, cid):
    page.evaluate(
        """(cid) => {
            window.__mock.scrollToCid(cid);
            window.__mock.render();
            var el = document.querySelector('.rn-list-item[data-cid=\"' + cid + '\"]');
            if (!el) throw new Error('left item not in DOM: ' + cid);
            el.click();
        }""",
        cid,
    )
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


def reset_clicks(page):
    page.evaluate("() => { window.__mock.state.clickLog = []; }")


def title(page):
    return page.evaluate(
        "() => { var e = document.querySelector('.rn-canvas .canvas-title'); return e ? e.textContent : ''; }"
    )


def click_log(page):
    return page.evaluate("() => window.__mock.clickLog()")


def rendered_nums(page):
    """返回扫描期间被渲染过的 P 行号集合（解析 'P12' -> 12）。"""
    rd = page.evaluate("() => window.__rendered || {}")
    nums = set()
    for c in rd:
        if c.startswith("P") and c[1:].isdigit():
            nums.add(int(c[1:]))
    return nums


def reset_render_rec(page):
    page.evaluate("() => { window.__rendered = {}; window.__scrollCount = 0; }")


# ----------------------------------------------------------------------------
def v1(browser, base, report):
    """V1: 构造 N=1500 必然触发多趟交错；独立验证分支执行 + 全量覆盖 0 漏扫 + 目标行可定位。"""
    t = Tester("V1 多趟交错分支（N=1500）独立取证")
    ctx, page = new_page(browser)
    try:
        # 用埋点的核心，直接取 revealCanvasEl 内部算出的 passes / positionsLen
        boot(page, base, 1500, INST_CORE)
        TARGET = "P1480"  # 接近列表末、旧放大步长(step=2324)必落缝的目标行
        t.check(build_tab(page, TARGET), "前置：P1480 标签已建立 (tabs=%s)" % tab_ids(page))
        page.evaluate("() => { document.querySelector('.rn-virtual').scrollTop = 0; window.__mock.render(); }")
        page.wait_for_timeout(150)
        t.check(page.evaluate("(c) => window.__mock.inDom(c)", TARGET) is False,
                "前置：P1480 行因滚出视口未渲染（不在 DOM）")
        reset_render_rec(page)
        reset_clicks(page)
        t0 = time.time()
        click_tab(page, TARGET)
        page.wait_for_timeout(9000)  # 多趟交错 N=1500 约 239 停靠点 × 27ms ≈ 6.5s
        elapsed = time.time() - t0

        rev = page.evaluate("() => window.__qa_reveal || null")
        sc = page.evaluate("() => window.__scrollCount")
        seen_toast = ""
        waited = 0
        while waited < 5000:
            if toast_visible(page):
                seen_toast = toast_text(page)
                if seen_toast:
                    break
            page.wait_for_timeout(100)
            waited += 100
        hits = [c for c in click_log(page) if c["cid"] == TARGET]

        t.check(rev is not None and rev.get("passes") == 2,
                "多趟交错分支确实执行：window.__qa_reveal.passes=%s (need=%s, positionsLen=%s)" %
                (rev.get("passes") if rev else None, rev.get("need") if rev else None, rev.get("positionsLen") if rev else None))
        # 注意：step=450 单趟已能覆盖全部行，故扫描在 pass0 找到目标即停（约 119 停靠点），
        # 不会走到 pass1 的偏移停靠点——这是「步长恒≤窗口」决定的，不是分支没执行。
        # 分支「代码真的跑到」的硬证据是 positionsLen=239（k=0、k=1 两趟都参与了位置预计算）。
        t.check(rev is not None and rev.get("positionsLen") == 239,
                "多趟交错位置预计算确实跑了两趟：positionsLen=%s（单趟仅 ~119，两趟交错去重后 239 证明 k=1 偏移分支执行过）" % sc)
        t.check(sc >= 100, "扫描停靠点数量远超单趟常规规模：scrollCount=%s（证明不是只跑了几档就停）" % sc)
        t.check("未找到画布" not in seen_toast,
                "【定位成功】点 P1480 标签未弹「未找到画布」(toast=%r)" % seen_toast)
        t.check(bool(hits), "【定位成功】左侧 P1480 行被点击 (log=%s)" % click_log(page))
        t.check(page.evaluate("(c) => window.__mock.isVisible(c)", TARGET), "【定位成功】P1480 行被滚入可视区")
        t.check("页面 1480" in title(page), "【需求】画布内容已显示（标题切到「页面 1480」）(title=%r)" % title(page))
        t.check(TARGET in tab_ids(page), "【需求】标签仍在 (tabs=%s)" % tab_ids(page))
        report["v1_reveal"] = rev
        report["v1_scrollCount"] = sc
        report["v1_elapsed_s"] = round(elapsed, 2)
        report["v1_toast"] = seen_toast

        # ---- 覆盖率（0 漏扫）探针：用「强制全扫描」记录被渲染行全集 ----
        # 用持久 MutationObserver 给所有行持续加 layer-item（跨重渲染保持），使 findCanvasEl 恒拒绝 ->
        # revealCanvasEl 必须跑完所有停靠点（全扫描），渲染过程仍照常发生，记录 P01..P1500 是否都被渲染过。
        page.evaluate("""() => {
            var v = document.getElementById('rn-virtual');
            function mark(){ var els = v.querySelectorAll('.rn-list-item[data-cid]'); for (var i=0;i<els.length;i++) els[i].classList.add('layer-item'); }
            mark();
            window.__qa_mo_lay = new MutationObserver(function(){ mark(); });
            window.__qa_mo_lay.observe(v, {childList:true, subtree:true});
        }""")
        # 预置 scrollTop=450 再重置记录：这样扫描首个停靠点(0)会因 scrollTop 从 450->0 触发重渲染，
        # 把首屏 P01..P19 也计入「被渲染集合」，避免边界行漏记造成假阴性。
        page.evaluate("() => { var v=document.querySelector('.rn-virtual'); v.scrollTop = 450; window.__mock.render(); }")
        reset_render_rec(page)
        click_tab(page, TARGET)
        page.wait_for_timeout(9000)
        nums = rendered_nums(page)
        covered = len(nums)
        full = (nums == set(range(1, 1501)))
        t.check(covered == 1500 and full,
                "【0 漏扫】强制全扫描后被渲染行下标集合大小=%d / 期望 1500，且首末均覆盖 (min=%s max=%s, 完整覆盖=%s)"
                % (covered, min(nums) if nums else None, max(nums) if nums else None, full))
        report["v1_coverage"] = {"rendered_count": covered, "full_coverage": full}

        # ---- 对照：旧核心 v1.0.16 在 N=1500 必失败（证明此规模下确有缝隙）----
        ctx.close()
        ctx, page = new_page(browser)
        boot(page, base, 1500, OLD_1016)
        t.check(build_tab(page, TARGET), "对照-前置：旧核心下 P1480 标签已建立")
        page.evaluate("() => { document.querySelector('.rn-virtual').scrollTop = 0; window.__mock.render(); }")
        page.wait_for_timeout(150)
        reset_clicks(page)
        click_tab(page, TARGET)
        page.wait_for_timeout(9000)
        seen_toast2 = ""
        waited = 0
        while waited < 6000:
            if toast_visible(page):
                seen_toast2 = toast_text(page)
                if seen_toast2:
                    break
            page.wait_for_timeout(100)
            waited += 100
        hits2 = [c for c in click_log(page) if c["cid"] == TARGET]
        vis2 = page.evaluate("(c) => window.__mock.isVisible(c)", TARGET)
        # 注意：title 在 build_tab 点左栏行时即被设为「页面 1480」，不能用作失败判据；
        # 正确判据是「扫描期间核心是否点击了目标行」与「目标行是否被滚入可视区」。
        t.check((not hits2) and (not vis2),
                "对照：旧核心 v1.0.16 在 N=1500 点 P1480 定位失败（扫描期间未点击目标行、目标行未被滚入可视区）-> 印证此规模确有漏扫缝隙 (hits=%s, visible=%s, toast=%r)"
                % (bool(hits2), vis2, seen_toast2))
    except Exception as e:
        t.check(False, "异常: %r" % e)
        screenshot(page, "qa_v1")
    finally:
        try:
            ctx.close()
        except Exception:
            pass
    return t


# ----------------------------------------------------------------------------
def v2(browser, base, report):
    """V2: 观测「被渲染行下标全集」证明漏档；旧核心 P71 不在集合，当前核心在集合。"""
    t = Tester("V2 渲染集合证明漏档（N=980, 目标 P71）")
    findings = {}
    for label, core in [("current", CUR_CORE), ("old_v1.0.16", OLD_1016)]:
        ctx, page = new_page(browser)
        try:
            boot(page, base, 980, core)
            TARGET = "P71"
            t.check(build_tab(page, TARGET), "[%s] 前置：P71 标签已建立" % label)
            page.evaluate("() => { document.querySelector('.rn-virtual').scrollTop = 0; window.__mock.render(); }")
            page.wait_for_timeout(150)
            reset_render_rec(page)
            reset_clicks(page)
            click_tab(page, TARGET)
            page.wait_for_timeout(4000)
            nums = rendered_nums(page)
            in_set = 71 in nums
            t.check(in_set if label == "current" else (not in_set),
                    "[%s] 扫描期间行下标 71（P71）%s 被渲染集合 (集合大小=%d)"
                    % (label, "在" if in_set else "不在", len(nums)))
            findings[label] = {"p71_in_rendered": in_set, "rendered_count": len(nums)}
        except Exception as e:
            t.check(False, "[%s] 异常: %r" % (label, e))
        finally:
            ctx.close()
    # 交叉断言：当前核心能渲染 P71、旧核心不能 -> 这才是修复带来的差异
    cur_ok = findings.get("current", {}).get("p71_in_rendered") is True
    old_ok = findings.get("old_v1.0.16", {}).get("p71_in_rendered") is False
    t.check(cur_ok and old_ok,
            "交叉结论：当前核心渲染了 P71、旧核心没渲染 -> 漏档确由修复消除（current=%s old=%s）"
            % (cur_ok, old_ok))
    report["v2"] = findings
    return t


# ----------------------------------------------------------------------------
def v3(browser, base, report):
    """V3: 模糊测试 规模 × 目标行下标，每次点标签都须定位成功且不弹未找到画布。"""
    t = Tester("V3 模糊测试 规模×目标行下标")
    sizes = [500, 700, 980, 1500]
    fails = []
    total = 0
    for N in sizes:
        # 取首/中/末 + 中间若干，覆盖列表不同位置
        # 注意夹具两位零填充：P1..P9 -> P01..P09，P10+ -> P10..Pn（用 %02d 统一得到正确 cid）
        targets = [2, N // 4, N // 2, 3 * N // 4, N - 2]
        targets = ["P%02d" % x for x in targets if x >= 1 and x <= N]
        wait = 9000 if N >= 1500 else 4000
        for TARGET in targets:
            total += 1
            ctx, page = new_page(browser)
            try:
                boot(page, base, N, CUR_CORE)
                if not build_tab(page, TARGET):
                    t.check(False, "[N=%d %s] 前置建标签失败" % (N, TARGET))
                    fails.append((N, TARGET, "build_tab failed"))
                    continue
                page.evaluate("() => { document.querySelector('.rn-virtual').scrollTop = 0; window.__mock.render(); }")
                page.wait_for_timeout(150)
                reset_clicks(page)
                click_tab(page, TARGET)
                page.wait_for_timeout(wait)
                seen_toast = ""
                waited = 0
                while waited < 5000:
                    if toast_visible(page):
                        seen_toast = toast_text(page)
                        if seen_toast:
                            break
                    page.wait_for_timeout(100)
                    waited += 100
                hits = [c for c in click_log(page) if c["cid"] == TARGET]
                ok = ("未找到画布" not in seen_toast) and bool(hits) and \
                     page.evaluate("(c) => window.__mock.isVisible(c)", TARGET) and \
                     (TARGET in tab_ids(page))
                if not ok:
                    fails.append((N, TARGET, "toast=%r hits=%s visible=%s" %
                                  (seen_toast, bool(hits), page.evaluate("(c) => window.__mock.isVisible(c)", TARGET))))
                t.check(ok, "[N=%d %s] 点标签定位成功且不弹未找到画布 (toast=%r)" % (N, TARGET, seen_toast))
            except Exception as e:
                t.check(False, "[N=%d %s] 异常: %r" % (N, TARGET, e))
                fails.append((N, TARGET, "exception %r" % e))
            finally:
                ctx.close()
    t.check(len(fails) == 0, "模糊测试全部通过：%d 个(N,目标)组合，失败 %d 个" % (total, len(fails)))
    report["v3"] = {"total": total, "fails": [list(x) for x in fails]}
    return t


def main():
    httpd, base = start_server()
    report = {"meta": {"core_inst": INST_CORE, "cur_core": CUR_CORE}}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        try:
            report["v1"] = {}
            v1(browser, base, report["v1"]).summary()
            report["v2_out"] = {}
            v2(browser, base, report["v2_out"]).summary()
            report["v3_out"] = {}
            v3(browser, base, report["v3_out"]).summary()
        finally:
            browser.close()
    outp = os.path.join(os.path.dirname(__file__), "_qa_bug0015_v1v2v3_report.json")
    with open(outp, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print("\n[REPORT JSON] ->", outp)


if __name__ == "__main__":
    main()
