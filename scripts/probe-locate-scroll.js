/* =========================================================================
 * scripts/probe-locate-scroll.js — 真机「点标签后是否定位到画布在列表的位置」取证探针
 *
 * 背景（BUG-0014）：点「最近画布」标签能切换画布，但左栏不跟着滚动到该画布所在位置，
 * 真机表现为「刷新了一下回到了列表顶部」。修复后的期望：切换 + 左栏滚到该行 + 该行带选中态。
 *
 * 与 scripts/probe-locate-real.js 的区别：那个查「为什么找不到画布」（cidHitTotal /
 * nameRowsBefore / nameRowsAfterSearch）；本探针查「找到之后有没有滚过去」，判据是
 * 滚动宿主 scrollTop、目标行是否落在滚动容器可视矩形内、以及选中态标记。
 *
 * 用法：
 *   1. 让画布列表**处于需要滚动的状态**（列表够长；或先把列表滚到底部让若干画布滚出可见区）；
 *   2. 点一个**当前已滚出可见区**的画布标签（这一步由你手动点，脚本只读状态）；
 *   3. 打开 DevTools Console，粘贴 `probe-locate-scroll.min.js` 全部内容，回车；
 *   4. 输出会 console.log 并 copy() 到剪贴板，直接 Ctrl+V 回贴。
 *
 * 判读要点：
 *   · coreVersionAttr        —— 先看这行，必须等于你期望的版本（默认 1.0.20），否则下面结论一律作废；
 *   · scroller.top           —— > 0 表示确实滚到了列表中部/下部（旧版会停在 0，即「回到顶部」）；
 *   · target.inScroller      —— true 表示目标行**确实落在滚动容器可视区内**（与扩展同口径，上下 4px 容差）；
 *   · target.hasOurMarker    —— true 表示我方选中态标记 `md-rt-located` 落在该行；
 *   · selectedStateSource    —— 综合判据，取 "molde" / "ours" / "none"：
 *                               "molde" = 墨刀自己已给该行加了激活类，我方按设计**不加**标记（正常）；
 *                               "ours"  = 墨刀没加，由我方 `md-rt-located` 提供选中态（正常）；
 *                               "none"  = 两边都没有，左栏看不出选中态（这才是问题）。
 *                               → 只要不是 "none" 就算通过，不要只盯 hasOurMarker。
 *   · markerCount            —— 应为 0 或 1（>1 说明标记残留，属缺陷）；
 *   · target.offsetFromScrollerTop —— 该行距滚动容器顶部的像素距离，用于人工看是否「大致居中」；
 *   · target.inCanvasAnchor  —— false 说明目标节点不在画布列容器内（可能点到了页面列同 cid 镜像行）。
 *   · sameCidInScroller      —— 滚动宿主内同 cid 的行有几个。>1 说明存在重复节点（真机上常见），
 *                               探针已自动优先取「带选中标记」的那个，避免误判 hasOurMarker；
 *   · distinctCidCount       —— 去重后的 cid 数，与 canvasRowCount 一起看可发现重复度。
 *
 * 只读脚本：不改任何页面状态，不点任何列表项。
 * ========================================================================= */
(function () {
  var VERSION_EXPECTED = "1.0.20";   // 期望的核心版本；三处版本同升时记得同步改这里
  var TOL = 4;                       // 可视区上下容差（与核心 isRowInScroller 同口径）

  var qa = function (s) { try { return document.querySelectorAll(s); } catch (e) { return []; } };
  var brief = function (n) {
    var c = String(n.className || "").trim().split(/\s+/).filter(Boolean).slice(0, 4).join(".");
    return n.tagName.toLowerCase() + (c ? "." + c : "") + (n.id ? "#" + n.id : "");
  };
  var chain = function (el) {
    var o = [], n = el, i = 0;
    while (n && n.nodeType === 1 && i++ < 8) { o.push(brief(n)); n = n.parentElement; }
    return o;
  };

  var MOLDE_CLASSES = ["active", "is-active", "is-selected", "selected", "current"];
  var moldeClassesOf = function (el) {
    return MOLDE_CLASSES.filter(function (cn) { return el.classList.contains(cn); });
  };
  var isMoldeActive = function (el) {
    if (el.getAttribute("aria-selected") === "true") { return true; }
    return moldeClassesOf(el).length > 0;
  };

  /* 1) 版本（先证版本，再谈结论） */
  var rootEl = document.querySelector("#md-recent-tabs-root");
  var ver = rootEl ? rootEl.getAttribute("data-md-version") : null;

  /* 2) 标签栏当前激活项：data-id 即期望的画布 cid */
  var activeTab = qa("#md-recent-tabs-root .md-tab[aria-selected='true']")[0]
               || qa("#md-recent-tabs-root .md-tab.is-active")[0]
               || null;
  var targetId = activeTab ? activeTab.getAttribute("data-id") : null;

  /* 3) 画布列滚动宿主：与核心 getCanvasScrollContainer() 同口径
     （画布列容器自身 + 其祖先 + 其后代里，overflowY 可滚动且 scrollHeight 明显超出者，取最大） */
  var anchors = ["#screen-scroll-list", ".screen-list-container", "#screen_list", "#mobile-screen-tree"];
  var anchor = null;
  for (var i = 0; i < anchors.length && !anchor; i++) { anchor = document.querySelector(anchors[i]); }

  var scrollable = function (el) {
    if (!el || el.nodeType !== 1) { return null; }
    var cs = getComputedStyle(el);
    if (!/auto|scroll/.test(cs.overflowY)) { return null; }
    if (el.scrollHeight - el.clientHeight <= TOL) { return null; }
    return el;
  };

  var sc = null;
  if (anchor) {
    var cands = [];
    var push = function (el) { if (el && cands.indexOf(el) < 0) { cands.push(el); } };
    var up = anchor;
    while (up && up.nodeType === 1) { push(up); up = up.parentElement; }
    var walk = function (el, d) {
      if (!el || d > 5) { return; }
      push(el);
      var kids = el.children;
      for (var k = 0; k < kids.length; k++) { walk(kids[k], d + 1); }
    };
    walk(anchor, 0);
    for (var j = 0; j < cands.length; j++) {
      var c = scrollable(cands[j]);
      if (c && (!sc || c.scrollHeight > sc.scrollHeight)) { sc = c; }
    }
  }

  /* 4) 画布行（滚动宿主内、排除图层行） */
  var rows = [];
  if (sc) {
    var all = sc.querySelectorAll("[data-cid]");
    for (var r = 0; r < all.length; r++) {
      if (!all[r].classList.contains("layer-item")) { rows.push(all[r]); }
    }
  }

  var scRect = sc ? sc.getBoundingClientRect() : null;
  var scInfo = sc ? {
    tag: brief(sc),
    top: Math.round(sc.scrollTop),
    maxTop: Math.round(Math.max(0, sc.scrollHeight - sc.clientHeight)),
    clientHeight: sc.clientHeight,
    scrollHeight: sc.scrollHeight,
    rectTop: Math.round(scRect.top),
    rectBottom: Math.round(scRect.bottom)
  } : null;

  /* 5) 目标行定位情况
     注意：同一 cid 可能同时存在多个节点（画布列行 + 页面列镜像行 + 被重建的旧节点）。
     选中态只落在其中一个上，所以这里必须**优先取带选中标记的那个节点**，
     否则会误判成 hasOurMarker=false。sameCidInScroller 用来暴露重复。 */
  var target = null;
  var sameCidInScroller = 0;
  var distinctCidCount = 0;
  if (rows.length) {
    var seen = {};
    for (var d = 0; d < rows.length; d++) { seen[rows[d].getAttribute("data-cid")] = 1; }
    distinctCidCount = Object.keys(seen).length;
  }
  if (targetId) {
    var hits = [];
    for (var t = 0; t < rows.length; t++) {
      if (rows[t].getAttribute("data-cid") === targetId) { hits.push(rows[t]); }
    }
    sameCidInScroller = hits.length;
    var hit = null;
    for (var h = 0; h < hits.length; h++) {
      if (hits[h].classList.contains("md-rt-located") || isMoldeActive(hits[h])) { hit = hits[h]; break; }
    }
    if (!hit) { hit = hits[0] || document.querySelector('[data-cid="' + targetId + '"]'); }
    if (hit) {
      var hr = hit.getBoundingClientRect();
      target = {
        rowIndex: rows.indexOf(hit),
        cls: String(hit.className || "").slice(0, 120),
        text: (hit.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40),
        rectTop: Math.round(hr.top),
        rectBottom: Math.round(hr.bottom),
        inScroller: !!(scRect && hr.bottom > scRect.top + TOL && hr.top < scRect.bottom - TOL),
        offsetFromScrollerTop: scRect ? Math.round(hr.top - scRect.top) : null,
        hasOurMarker: hit.classList.contains("md-rt-located"),
        moldeActiveClasses: moldeClassesOf(hit),
        ariaSelected: hit.getAttribute("aria-selected") === "true",
        inCanvasAnchor: !!(anchor && anchor.contains(hit)),
        chain: chain(hit)
      };
    }
  }

  var markers = qa(".md-rt-located");

  /* 6) 选中态来源综合判据：墨刀自带激活类优先（我方按设计不覆盖），否则看我方标记 */
  var selState = null;
  if (target) {
    if ((target.moldeActiveClasses && target.moldeActiveClasses.length) || target.ariaSelected) {
      selState = "molde";
    } else if (target.hasOurMarker) {
      selState = "ours";
    } else {
      selState = "none";
    }
  }

  var out = {
    ts: new Date().toISOString(),
    url: location.href,
    coreVersionAttr: ver,
    expectedVersion: VERSION_EXPECTED,
    versionMatchesExpected: ver === VERSION_EXPECTED,
    tabActiveId: targetId,
    tabActiveLabel: activeTab ? (activeTab.textContent || "").trim() : null,
    tabActiveStale: activeTab ? activeTab.hasAttribute("data-stale") : null,
    scroller: scInfo,
    canvasRowCount: rows.length,
    distinctCidCount: distinctCidCount,
    sameCidInScroller: sameCidInScroller,
    target: target,
    selectedStateSource: selState,
    markerCount: markers.length,
    markerCids: Array.prototype.map.call(markers, function (m) { return m.getAttribute("data-cid"); }),
    locatedStyleTagCount: qa("#md-recent-tabs-located").length,
    anchorsPresent: {
      canvas: qa("#screen-scroll-list,.screen-list-container,#screen_list,#mobile-screen-tree").length,
      pageList: qa("#mb-enabled-canvas-list,#canvas-scroll-list,.canvas-scroll-list,.canvas-sortable-list").length,
      layerTree: qa("#mb-enabled-layer-list,#layer-scroll-list,.layer-scroll-list,#mb-state-list").length
    }
  };

  var s = JSON.stringify(out, null, 1);
  console.log(s);
  if (typeof copy === "function") { copy(s); }
  return out;
})()
