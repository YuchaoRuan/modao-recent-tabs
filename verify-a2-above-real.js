/* verify-a2-above-real.js — 真实墨刀「上方模式(above)」A2 避让核验探针（v1.0.8）
 *
 * 面向核心补丁：recent-tabs-core.js v1.0.8（新增 above/below 位置可配置）
 * 本探针不改变 verify-a2-real.js 的 v1.0.7 基线语义，仅在其上叠加 above 模式专属核验：
 *   - 读取 localStorage['md_tabbar_position'] 判定当前位置模式（above / below / 默认 below）
 *   - above 模式专属断言：标签栏贴顶(bar.top≈0)、固定模式工具栏下沉(marginTop=44px, 视口 top≈44)
 *   - 漏推扫描基线修正为 naturalBottom=48（above+fixed 工具栏下沉后 live hb 变 92，
 *     但内容命中的「自然底边」恒为下沉前的 48，避免误判漏推——对应核心 naturalBottom 修复 R1/R5）
 *   - 保留 v1.0.7 的「重排存活自检」：resize 触发 refreshLayout 后自动复检下推是否存活
 *
 * 用法：
 *   1. 已对墨刀 resources/app.asar 应用 v1.0.8 补丁并彻底重启墨刀（含托盘退出）。
 *   2. 打开任一设计文件页 http://<host>/proto/design/<cid> 并登录。
 *   3. 确保顶部「最近画布」标签栏处于【固定(pinned)】模式（class 含 is-float 表示浮动，属正常不下推）。
 *   4. （可选）先在设置页把「标签栏位置」切到「上方」，或控制台执行
 *      localStorage.setItem('md_tabbar_position','above') 后刷新本页以验证上方模式。
 *   5. F12 → Console，把本文件全部内容粘贴进去回车。
 *   6. 把控制台打印的两段 JSON（「A2 上方模式核验」+「A2 重排存活自检」）一并发回。
 */
(function () {
  function rectOf(el) { return el.getBoundingClientRect(); }
  function csOf(el) { return getComputedStyle(el); }
  function trunc(s, n) { s = (s == null ? "" : String(s)); return s.length > n ? s.slice(0, n) + "…" : s; }

  var TAB_H = 44; // 与 recent-tabs-core.js TOPBAR_H 一致

  // 工具栏候选选择器（与核心 getToolbarInfo 对齐）
  var TOOLBAR_SELS = ["header", "[class*='topbar' i]", "[class*='header' i]", "[class*='toolbar' i]", "[class*='navbar' i]"];

  function detectToolbar() {
    var best = null, bestBottom = 0;
    document.querySelectorAll(TOOLBAR_SELS.join(",")).forEach(function (el) {
      var cs = csOf(el);
      var pos = cs.position;
      if (pos !== "fixed" && pos !== "sticky" && pos !== "absolute" && pos !== "relative") return;
      if (el.id === "md-recent-tabs-root" || (typeof el.className === "string" && /md-recent-tabs/.test(el.className))) return;
      var r = rectOf(el);
      if (r.top > 60) return;
      if (r.height < 16 || r.height > 160) return;
      if (r.width < 200) return;
      var b = Math.round(r.bottom);
      if (b > bestBottom) { bestBottom = b; best = el; }
    });
    return { el: best, hb: bestBottom };
  }

  var bar = document.querySelector(".md-recent-tabs");
  if (!bar) {
    console.log(JSON.stringify({ error: "未找到 .md-recent-tabs：请确认(1)已应用 v1.0.8 补丁并重启墨刀；(2)当前在 /proto/design/<cid> 设计文件页；(3)已触发过标签栏渲染" }, null, 2));
    return;
  }

  // 位置模式（above / below）
  var positionMode = "below";
  try { positionMode = localStorage.getItem("md_tabbar_position") || "below"; } catch (e) {}
  if (positionMode !== "above") positionMode = "below";

  var isFloat = bar.classList.contains("is-float");
  var barRect = rectOf(bar);
  var barTop = Math.round(barRect.top);
  var barBottom = Math.round(barRect.bottom);
  var tb = detectToolbar();
  var hb = tb.hb;
  // above+fixed 工具栏下沉 TAB_H，故 live hb 变 hb_sunk；内容命中基线用 naturalBottom（下沉前 48）
  var sink = (positionMode === "above" && !isFloat) ? TAB_H : 0;
  var naturalBottom = Math.max(0, hb - sink); // above+fixed: 92-44=48；其它: 48

  var shell = document.querySelector("[class*='example-app' i]") || document.querySelector(".app-shell");
  var shellW = shell ? rectOf(shell).width : window.innerWidth;

  function bandOf(r) {
    if (r.left < shellW * 0.30) return "left";
    if (r.left > shellW * 0.70) return "right";
    return "center";
  }

  // ---- 可复用扫描：返回被下推(pushed)与漏推(missed)的元素集合 ----
  function scanA2() {
    var pushed = [], missed = [];
    if (!shell) return { pushed: pushed, missed: missed };

    // 权威集合：被补丁下推（marginTop≈TAB_H）的区域
    var nodes = shell.querySelectorAll("*");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.id === "md-recent-tabs-root") continue;
      if (typeof el.className === "string" && /md-recent-tabs/.test(el.className)) continue;
      var cs = csOf(el);
      if (cs.position !== "absolute" && cs.position !== "relative") continue;
      var r = rectOf(el);
      if (r.height < 30) continue;
      var mt = parseFloat(cs.marginTop);
      if (isNaN(mt) || mt < TAB_H - 0.5) continue;          // 仅认补丁注入的 44px 下推
      pushed.push(el);
    }

    // 漏推扫描：顶边仍贴在「自然底边 naturalBottom」、却无 TAB_H 下推（absolute/relative、高≥30）
    var nodes2 = shell.querySelectorAll("*");
    for (var j = 0; j < nodes2.length; j++) {
      var e2 = nodes2[j];
      if (e2.id === "md-recent-tabs-root") continue;
      if (typeof e2.className === "string" && /md-recent-tabs/.test(e2.className)) continue;
      var c2 = csOf(e2);
      if (c2.position !== "absolute" && c2.position !== "relative") continue;
      var rr = rectOf(e2);
      if (rr.height < 30) continue;
      if (Math.abs(rr.top - naturalBottom) > 4) continue;     // 仍贴在自然底边（未被下推的特征）
      var m2 = parseFloat(c2.marginTop);
      if (!isNaN(m2) && m2 >= TAB_H - 0.5) continue;          // 已下推的跳过
      // 是否被某个已下推元素包含（内嵌子元素，正常）→ 跳过
      var contained = false, pp = e2.parentElement;
      while (pp) { if (pushed.indexOf(pp) !== -1) { contained = true; break; } pp = pp.parentElement; }
      if (contained) continue;
      missed.push(e2);
    }
    return { pushed: pushed, missed: missed };
  }

  function describe(el) {
    var r = rectOf(el);
    var mt = csOf(el).marginTop;
    var liveTop = Math.round(r.top);
    return {
      tag: el.tagName,
      cls: trunc(el.className && el.className.toString(), 70),
      text: trunc(el.textContent, 22),
      band: bandOf(r),
      liveTop: liveTop,
      marginTop: mt,
      avoidsTabBar: liveTop >= barBottom - 2
    };
  }

  // ===== 上方模式专属断言 =====
  function aboveChecks() {
    var checks = {};
    // 标签栏贴顶：above 模式 bar.top≈0；below 模式 bar.top≈hb(48)
    var expectBarTop = (positionMode === "above") ? 0 : hb;
    checks.barTopMatchesPosition = (Math.abs(barTop - expectBarTop) <= 2);
    // 工具栏下沉（仅 above+fixed）：marginTop=TAB_H px；float 与 below 不应下沉
    var tbMt = tb.el ? csOf(tb.el).marginTop : "";
    var expectSink = (positionMode === "above" && !isFloat);
    checks.toolbarSunkAsExpected =
      expectSink ? (parseFloat(tbMt) >= TAB_H - 0.5) : (tbMt === "" || parseFloat(tbMt) < 0.5);
    // 工具栏视口 top：above+fixed 应≈TAB_H(44)
    var tbTop = tb.el ? Math.round(rectOf(tb.el).top) : null;
    checks.toolbarTopMatchesSink = expectSink ? (tbTop === TAB_H) : true;
    return { expectBarTop: expectBarTop, expectSink: expectSink, toolbarMarginTop: tbMt, toolbarTop: tbTop, checks: checks };
  }

  // ===== 静态核验（基线）=====
  var s0 = scanA2();
  var pushedInfo = s0.pushed.map(describe);
  var missedInfo = s0.missed.map(describe);
  var ac = aboveChecks();

  var leftPushed = pushedInfo.filter(function (x) { return x.band === "left"; });
  var rightPushed = pushedInfo.filter(function (x) { return x.band === "right"; });
  var centerPushed = pushedInfo.filter(function (x) { return x.band === "center"; });
  var allPushedAvoid = pushedInfo.length > 0 && pushedInfo.every(function (x) { return x.avoidsTabBar; });

  var verdict = {
    url: location.href,
    isDesignPage: /\/proto\/design\//.test(location.href),
    patchLoaded: true,
    positionMode: positionMode,
    tabBarMode: isFloat ? "float(悬停才显，A2 不应下推)" : "fixed(pinned 常驻，A2 应下推)",
    tabBar_top: barTop,
    tabBar_height: Math.round(barRect.height),
    tabBar_bottom: barBottom,
    detectHeaderBottom_hb: hb,
    naturalBottom_baseline: naturalBottom,
    above: {
      expectBarTop: ac.expectBarTop,
      barTopMatchesPosition: ac.checks.barTopMatchesPosition,
      expectSink: ac.expectSink,
      toolbarMarginTop: ac.toolbarMarginTop,
      toolbarTop: ac.toolbarTop,
      toolbarTopMatchesSink: ac.checks.toolbarTopMatchesSink,
      toolbarSunkAsExpected: ac.checks.toolbarSunkAsExpected
    },
    pushedCount: pushedInfo.length,
    pushedRegions: pushedInfo,
    missedCount: missedInfo.length,
    missedRegions_maybeNotPushed: missedInfo,
    summary: {
      leftBandPushed: leftPushed.length > 0,
      rightBandPushed: rightPushed.length > 0,
      centerBandPushed: centerPushed.length > 0,
      allPushedAvoidTabBar: allPushedAvoid,
      noMissedSidePanels: missedInfo.length === 0
    },
    relayoutCheck: "pending — 见下方「A2 重排存活自检」输出（粘贴后 ~350ms 自动触发）",
    pass: isFloat
      ? (pushedInfo.length === 0 && missedInfo.length === 0)
      : (allPushedAvoid && missedInfo.length === 0 && pushedInfo.length > 0
         && ac.checks.barTopMatchesPosition && ac.checks.toolbarSunkAsExpected)
  };

  console.log("=== A2 上方模式核验（v1.0.8，position=" + positionMode + "，marginTop 权威判定）===");
  console.log(JSON.stringify(verdict, null, 2));
  if (isFloat) {
    console.log("结论：float 模式——不应有下推（pushed=0）且无漏推（pass=" + verdict.pass + "）");
  } else {
    console.log("结论：" + positionMode + " 固定模式——所有贴近顶部的区域应被下推 " + TAB_H + "px、top≥标签栏底边 " + barBottom +
      "，且无漏推（pass=" + verdict.pass + "）");
    console.log("  标签栏位置：" + (positionMode === "above"
      ? ("上方（bar.top=" + barTop + "，工具栏下沉 marginTop=" + ac.toolbarMarginTop + "）")
      : ("下方（bar.top=" + barTop + "，工具栏不沉）")));
    if (leftPushed.length === 0) console.log("提示：左带未检出被下推元素——请确认该设计页确实存在左侧栏（页面/图层面板）。");
    if (rightPushed.length === 0) console.log("提示：右带未检出被下推元素——请确认该设计页确实存在右侧栏（属性/检查面板）。");
  }

  // ===== 重排存活自检（v1.0.7 baseTop 幂等回归）=====
  function triggerReflow() {
    try { window.dispatchEvent(new Event("resize")); } catch (e) {}
    try { void (shell || document.body).offsetHeight; } catch (e) {}
  }

  triggerReflow();
  setTimeout(function () {
    var s1 = scanA2();
    var p1 = s1.pushed.map(describe);
    var m1 = s1.missed.map(describe);
    var ac1 = aboveChecks();
    var survived = p1.length === pushedInfo.length
      && m1.length === 0
      && p1.every(function (x) { return x.avoidsTabBar; });
    var rl = {
      triggeredBy: "window 'resize' 事件（驱动补丁 refreshLayout，v1.0.7 幂等回归路径）",
      positionMode: positionMode,
      baseline: { pushedCount: pushedInfo.length, marginTop: pushedInfo.length ? pushedInfo[0].marginTop : null, missedCount: missedInfo.length },
      afterReflow: {
        pushedCount: p1.length,
        pushedRegions: p1,
        missedCount: m1.length,
        missedRegions: m1,
        above: {
          barTopMatchesPosition: ac1.checks.barTopMatchesPosition,
          toolbarMarginTop: ac1.toolbarMarginTop,
          toolbarSunkAsExpected: ac1.checks.toolbarSunkAsExpected
        }
      },
      relayoutSurvived: survived,
      note: survived
        ? "重排后下推仍存活：区域保持 " + TAB_H + "px 下推且避让标签栏，v1.0.7 baseTop 幂等修复生效。"
        : "重排后下推失效/塌陷：区域回退到贴顶或漏推，疑似 v1.0.7 幂等修复未生效或回归。请检查 recent-tabs-core.js 的 refreshLayout。",
      pass: isFloat
        ? (p1.length === 0 && m1.length === 0)
        : (survived && p1.length > 0
           && ac1.checks.barTopMatchesPosition && ac1.checks.toolbarSunkAsExpected)
    };
    console.log("=== A2 重排存活自检（v1.0.8，resize 触发 refreshLayout 后复检）===");
    console.log(JSON.stringify(rl, null, 2));
  }, 350);

  return verdict;
})();
