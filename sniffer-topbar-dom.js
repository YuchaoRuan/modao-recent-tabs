// 墨刀顶部工具栏 + 主内容/编辑区 真实 DOM 探查（DevTools Console 运行，无需扩展）
// 用途：为 v1.0.3 的 A2「内容下推」优化，精确锁定真实顶部工具栏与编辑区容器
//       的「类名 / 定位方式 / 高度」，解决原 detectHeaderBottom 可能漏检导致返回 0/null 的问题。
// 用法：在真实设计文件页 /proto/design/<cid> 打开时，F12 → Console → 粘贴本文件全部内容 → 回车，
//       把下方打印出的 JSON（以及最后一行返回的对象）发回即可。
(function () {
  "use strict";

  function rectOf(el) {
    var r = el.getBoundingClientRect();
    return {
      top: Math.round(r.top), left: Math.round(r.left),
      width: Math.round(r.width), height: Math.round(r.height), bottom: Math.round(r.bottom)
    };
  }
  function info(el) {
    if (!el) return null;
    var cs = getComputedStyle(el);
    return {
      tag: el.tagName,
      cls: (typeof el.className === "string" ? el.className : "").slice(0, 160),
      pos: cs.position,
      z: cs.zIndex,
      rect: rectOf(el),
      txt: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40)
    };
  }

  // 1) 显式候选：常见工具栏类名（与原 detectHeaderBottom 选择器一致，仅作对照）
  var candidateSels = [
    "header",
    "[class*='topbar' i]", "[class*='header' i]",
    "[class*='toolbar' i]", "[class*='navbar' i]",
    "[class*='top-bar' i]", "[class*='TopBar' i]"
  ];
  var candidates = [];
  document.querySelectorAll(candidateSels.join(",")).forEach(function (el) {
    candidates.push(info(el));
  });

  // 2) 全文档宽扫描：任何 fixed/sticky/absolute 且位于视口顶部(width>=200)的横带
  //    注意：这里**不做** 16~160 的高度裁剪，避免真实工具栏因高度不符被漏掉。
  var all = Array.prototype.slice.call(document.querySelectorAll("*"));
  var topBands = [];
  all.forEach(function (el) {
    var cs = getComputedStyle(el);
    if (cs.position !== "fixed" && cs.position !== "sticky" && cs.position !== "absolute") return;
    var r = el.getBoundingClientRect();
    if (r.top > 120) return;       // 只取视口顶部 120px 内
    if (r.width < 200) return;     // 横贯顶部的宽条
    topBands.push(info(el));
  });
  topBands.sort(function (a, b) { return b.rect.bottom - a.rect.bottom; });

  // 3) 复算当前 detectHeaderBottom 逻辑（对照用，看它现在到底算出多少）
  var hb = 0;
  document.querySelectorAll(candidateSels.join(",")).forEach(function (el) {
    var cs = getComputedStyle(el);
    if (cs.position !== "fixed" && cs.position !== "sticky" && cs.position !== "absolute") return;
    var r = el.getBoundingClientRect();
    if (r.top > 60) return;
    if (r.height < 16 || r.height > 160) return;
    hb = Math.max(hb, Math.round(r.bottom));
  });

  // 4) 主内容/编辑区容器：面积最大的可见元素（通常就是画布编辑区）
  var content = null, maxArea = 0;
  all.forEach(function (el) {
    if (el === document.body || el === document.documentElement) return;
    var cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return;
    var r = el.getBoundingClientRect();
    if (r.width < 300 || r.height < 200) return;
    var area = r.width * r.height;
    if (area > maxArea) { maxArea = area; content = info(el); }
  });

  var result = {
    url: location.href,
    path: location.pathname,
    isDesignPage: /\/proto\/design\//.test(location.pathname),
    detectHeaderBottom_now: hb,            // 当前逻辑算出的避让基准（0 = 漏检）
    explicitCandidates: candidates,        // 显式类名命中项
    topBands: topBands.slice(0, 12),       // 顶部所有宽横带（按 bottom 降序）
    mainContentContainer: content          // 主编辑区容器（A2 下推目标）
  };
  console.log("%c[顶部工具栏 + 内容容器探查]", "color:#d2691e;font-weight:bold");
  console.log(JSON.stringify(result, null, 2));
  return result;   // 末尾会再回显一次，便于你直接复制
})();
