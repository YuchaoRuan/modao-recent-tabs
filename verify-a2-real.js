/* verify-a2-real.js — 真实墨刀 A2 左右侧栏避让核验探针（v1.0.8）
 *
 * 面向核心补丁：recent-tabs-core.js v1.0.7
 * 新增：缩放/重排后自动复检下推是否存活（v1.0.7 baseTop 幂等回归）
 *
 * 用法：
 *   1. 已对墨刀 resources/app.asar 应用 v1.0.7 补丁（apply-patch.cmd）并彻底重启墨刀（含托盘退出）。
 *   2. 打开任一设计文件页 http://<host>/proto/design/<cid> 并登录。
 *   3. 确保顶部「最近画布」标签栏处于【固定(pinned)】模式——点一下标签栏上的图钉图标，
 *      使其常驻显示（class 含 is-float 表示浮动/悬停才显，那种模式下 A2 不下推，属正常）。
 *   4. F12 → Console，把本文件全部内容粘贴进去回车。
 *   5. 把控制台打印的两段 JSON（「A2 真实环境核验」+「A2 重排存活自检」）一并发回。
 *
 * 判定方法学（重要）：
 *   补丁 applyContentOffset() 对命中的区域容器设置 inline style marginTop = 44px（TAB_H），
 *   设置后这些区域 live top 由 48 变为 92。因此「按 live top≈48 反查」会失效。
 *   本探针以【inline/computed marginTop≈44px】作为「被 A2 下推」的权威证据，
 *   再独立扫描「顶边仍贴在 hb、却无 44px 下推」的候选作为潜在漏推，二者交叉验证。
 *
 * 重排存活自检：
 *   粘贴后自动 dispatch 一次 window 'resize' 事件（驱动补丁 refreshLayout，即 v1.0.7 幂等修复的回归路径），
 *   延迟 ~350ms 让布局引擎与 MutationObserver 重排落定，再重跑一次 scanA2 对比：
 *   下推区域数不变、全部仍避让标签栏、且无新增漏推 → relayoutSurvived=true（A2 重排不塌陷）。
 */
(function () {
  function rectOf(el) { return el.getBoundingClientRect(); }
  function csOf(el) { return getComputedStyle(el); }
  function trunc(s, n) { s = (s == null ? "" : String(s)); return s.length > n ? s.slice(0, n) + "…" : s; }

  function detectHeaderBottom() {
    var max = 0;
    var sels = ["header", "[class*='topbar' i]", "[class*='header' i]", "[class*='toolbar' i]", "[class*='navbar' i]"];
    document.querySelectorAll(sels.join(",")).forEach(function (el) {
      var cs = csOf(el);
      var pos = cs.position;
      if (pos !== "fixed" && pos !== "sticky" && pos !== "absolute" && pos !== "relative") return;
      if (el.id === "md-recent-tabs-root" || (typeof el.className === "string" && /md-recent-tabs/.test(el.className))) return;
      var r = rectOf(el);
      if (r.top > 60) return;
      if (r.height < 16 || r.height > 160) return;
      if (r.width < 200) return;
      max = Math.max(max, Math.round(r.bottom));
    });
    return max;
  }

  var bar = document.querySelector(".md-recent-tabs");
  if (!bar) {
    console.log(JSON.stringify({ error: "未找到 .md-recent-tabs：请确认(1)已应用 v1.0.7 补丁并重启墨刀；(2)当前在 /proto/design/<cid> 设计文件页；(3)已触发过标签栏渲染" }, null, 2));
    return;
  }

  var isFloat = bar.classList.contains("is-float");
  var barRect = rectOf(bar);
  var barBottom = Math.round(barRect.bottom);
  var hb = detectHeaderBottom();

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

    // 权威集合：被补丁下推（marginTop≈44px）的区域
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
      if (isNaN(mt) || mt < 43.5) continue;            // 仅认补丁注入的 44px 下推
      pushed.push(el);
    }

    // 漏推扫描：顶边仍贴在 hb、却无 44px 下推（absolute/relative、高≥30）
    var nodes2 = shell.querySelectorAll("*");
    for (var j = 0; j < nodes2.length; j++) {
      var e2 = nodes2[j];
      if (e2.id === "md-recent-tabs-root") continue;
      if (typeof e2.className === "string" && /md-recent-tabs/.test(e2.className)) continue;
      var c2 = csOf(e2);
      if (c2.position !== "absolute" && c2.position !== "relative") continue;
      var rr = rectOf(e2);
      if (rr.height < 30) continue;
      if (Math.abs(rr.top - hb) > 4) continue;          // 仍贴在工具栏底边（未被下推的特征）
      var m2 = parseFloat(c2.marginTop);
      if (!isNaN(m2) && m2 >= 43.5) continue;           // 已下推的跳过
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

  // ===== 静态核验（基线）=====
  var s0 = scanA2();
  var pushedInfo = s0.pushed.map(describe);
  var missedInfo = s0.missed.map(describe);

  var leftPushed = pushedInfo.filter(function (x) { return x.band === "left"; });
  var rightPushed = pushedInfo.filter(function (x) { return x.band === "right"; });
  var centerPushed = pushedInfo.filter(function (x) { return x.band === "center"; });
  var allPushedAvoid = pushedInfo.length > 0 && pushedInfo.every(function (x) { return x.avoidsTabBar; });
  var baselineMt = pushedInfo.length ? pushedInfo[0].marginTop : null;

  var verdict = {
    url: location.href,
    isDesignPage: /\/proto\/design\//.test(location.href),
    patchLoaded: true,
    tabBarMode: isFloat ? "float(悬停才显，A2 不应下推)" : "fixed(pinned 常驻，A2 应下推)",
    tabBar_top: Math.round(barRect.top),
    tabBar_height: Math.round(barRect.height),
    tabBar_bottom: barBottom,
    detectHeaderBottom_hb: hb,
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
      : (allPushedAvoid && missedInfo.length === 0 && pushedInfo.length > 0)
  };

  console.log("=== A2 真实环境核验（v1.0.8，marginTop 权威判定）===");
  console.log(JSON.stringify(verdict, null, 2));
  if (isFloat) {
    console.log("结论：float 模式——不应有下推（pushed=0）且无漏推（pass=" + verdict.pass + "）");
  } else {
    console.log("结论：fixed 模式——所有贴近顶部的区域应被下推 44px、top≥标签栏底边 " + barBottom +
      "，且无漏推（pass=" + verdict.pass + "）");
    if (leftPushed.length === 0) console.log("提示：左带未检出被下推元素——请确认该设计页确实存在左侧栏（页面/图层面板）。");
    if (rightPushed.length === 0) console.log("提示：右带未检出被下推元素——请确认该设计页确实存在右侧栏（属性/检查面板）。");
  }

  // ===== 重排存活自检（v1.0.7 baseTop 幂等回归）=====
  function triggerReflow() {
    // 真实回归触发：resize 事件驱动补丁 refreshLayout（v1.0.7 幂等修复的回归路径）
    try { window.dispatchEvent(new Event("resize")); } catch (e) {}
    // 强制同步重排，确保布局引擎刷新
    try { void (shell || document.body).offsetHeight; } catch (e) {}
  }

  triggerReflow();
  setTimeout(function () {
    var s1 = scanA2();
    var p1 = s1.pushed.map(describe);
    var m1 = s1.missed.map(describe);
    var survived = p1.length === pushedInfo.length
      && m1.length === 0
      && p1.every(function (x) { return x.avoidsTabBar; });
    var rl = {
      triggeredBy: "window 'resize' 事件（驱动补丁 refreshLayout，v1.0.7 幂等回归路径）",
      baseline: { pushedCount: pushedInfo.length, marginTop: baselineMt, missedCount: missedInfo.length },
      afterReflow: {
        pushedCount: p1.length,
        pushedRegions: p1,
        missedCount: m1.length,
        missedRegions: m1
      },
      relayoutSurvived: survived,
      note: survived
        ? "重排后下推仍存活：区域保持 44px 下推且避让标签栏，v1.0.7 baseTop 幂等修复生效。"
        : "重排后下推失效/塌陷：区域回退到贴顶或漏推，疑似 v1.0.7 幂等修复未生效或回归。请检查 recent-tabs-core.js 的 refreshLayout。",
      pass: isFloat
        ? (p1.length === 0 && m1.length === 0)
        : (survived && p1.length > 0)
    };
    console.log("=== A2 重排存活自检（v1.0.8，resize 触发 refreshLayout 后复检）===");
    console.log(JSON.stringify(rl, null, 2));
  }, 350);

  return verdict;
})();
