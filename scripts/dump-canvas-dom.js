/* =========================================================================
 * scripts/dump-canvas-dom.js —— 真机取证脚本（可直接粘贴到 DevTools Console）
 *
 * 用途：内网墨刀（10.83.117.101:9080）需登录、无法远程调试。当没有新版构建、
 *       或想核对「当前页面的 DOM 真相到底是什么」时，把本文件**整段**粘到设计页的
 *       Console 回车，即可一次性 dump：
 *         · 当前加载的核心版本（#md-recent-tabs-root[data-md-version]）
 *         · 各已知锚点（画布 / 图层树 / 页面列）的选择器命中数
 *         · 所有 [data-cid] 通用树项行的签名（tag/class/data-interactive-target-type/
 *           layerItem/visible/kind/被拒原因）与**完整祖先链**（最多 8 层）
 *         · 按名字模糊匹配的候选（可编辑下面的 NAME_QUERY）
 *       输出同时 console.log(JSON.stringify(...)) 与 copy(...) 到剪贴板，便于回贴。
 *
 * 说明：本脚本是被动只读的——不修改 DOM、不点击、不注入全局变量（IIFE 包裹）。
 *       NAME_QUERY 改成想查的画布名（子串匹配）即可看到谁命中了它。
 * ========================================================================= */
(function () {
  "use strict";

  // —— 想按名字模糊匹配的话，在这里填关键词（留空则只 dump 全量行）——
  var NAME_QUERY = "";

  // 锚点集合（与 recent-tabs-core.js 保持一致；改版换名时这些命中数会变成 0）
  var CANVAS_PANEL = [
    "#screen-scroll-list", "#screen_list", ".screen-list-container", "#mobile-screen-tree"
  ];
  var LAYER_TREE = [
    "#mb-enabled-layer-list", "#layer-scroll-list", ".layer-scroll-list",
    ".layer-sortable-list", ".mb-layer-panel",
    "#mb-state-list", "#interaction-tree-container", "#interaction-tree-list"
  ];
  var PAGE_LIST = [
    "#mb-enabled-canvas-list", "#canvas-scroll-list",
    ".canvas-scroll-list", ".canvas-sortable-list"
  ];
  var ROW_SELECTOR = "div.rn-list-item[data-cid], li.rn-content-item[data-cid]";
  var MAX_ROWS = 120;      // 行数上限，避免巨量文本
  var MAX_ANCESTORS = 8;   // 祖先链层数上限

  function countSel(list) {
    var out = {};
    for (var i = 0; i < list.length; i++) {
      try { out[list[i]] = document.querySelectorAll(list[i]).length; }
      catch (e) { out[list[i]] = -1; }   // -1 = 选择器语法非法
    }
    return out;
  }

  function matchAncestor(el, list) {
    if (!el || !el.closest) return false;
    for (var i = 0; i < list.length; i++) {
      try { if (el.closest(list[i])) return true; } catch (e) {}
    }
    return false;
  }

  function brief(el) {
    if (!el || el.nodeType !== 1) return "";
    var tag = (el.tagName || "").toLowerCase();
    var id = el.id ? ("#" + el.id) : "";
    var cls = "";
    if (typeof el.className === "string" && el.className.trim()) {
      cls = "." + el.className.trim().split(/\s+/).slice(0, 3).join(".");
    }
    return tag + id + cls;
  }

  function ancestors(el, max) {
    var out = [], n = el, d = 0;
    while (n && n.nodeType === 1 && d < max) { out.push(brief(n)); n = n.parentElement; d++; }
    return out;
  }

  function panelOf(el) {
    if (matchAncestor(el, CANVAS_PANEL)) return "canvas";
    if (matchAncestor(el, LAYER_TREE)) return "layerTree";
    if (matchAncestor(el, PAGE_LIST)) return "pageList";
    return "none";
  }

  // 行项是否带 layer-item（内层 div.rn-list-item 或本身）。与核心 rowHasLayerItem 同义。
  function rowLayerItem(el) {
    if (!el) return false;
    if (el.classList && el.classList.contains("layer-item")) return true;
    if (!el.querySelector) return false;
    var inner = null;
    try { inner = el.querySelector(":scope > .rn-list-item"); } catch (e) { inner = null; }
    if (!inner) inner = el.querySelector(".rn-list-item");
    return !!(inner && inner.classList && inner.classList.contains("layer-item"));
  }

  // 与核心 findCanvasEl 同义：唯二的拒绝理由是 inLayerTree / layerItem。
  function rejectReason(el) {
    if (matchAncestor(el, LAYER_TREE)) return "inLayerTree";
    if (rowLayerItem(el)) return "layerItem";
    return "none";
  }

  function visible(el) {
    try { return !!(el.getClientRects && el.getClientRects().length > 0); } catch (e) { return false; }
  }

  function readName(el) {
    return ((el && el.textContent) || "").replace(/\s+/g, " ").trim();
  }

  function searchBox() {
    var inputs = document.querySelectorAll("input");
    for (var i = 0; i < inputs.length; i++) {
      var ph = inputs[i].getAttribute ? (inputs[i].getAttribute("placeholder") || "") : "";
      if (/搜索|查找|检索/.test(ph)) {
        var r;
        try { r = inputs[i].getBoundingClientRect(); } catch (e) { r = null; }
        if (r && r.width > 40 && r.top < 300) return { found: true, placeholder: ph };
      }
    }
    return { found: false };
  }

  var report = {
    dumpedAt: new Date().toISOString(),
    url: location.href,
    coreVersion: (function () {
      var r = document.getElementById("md-recent-tabs-root");
      return r ? r.getAttribute("data-md-version") : null;
    })(),
    canvasTitle: (function () {
      var t = document.querySelector(".canvas-title");
      return t ? readName(t) : null;
    })(),
    searchBox: searchBox(),
    anchors: {
      canvasHit: document.querySelectorAll(CANVAS_PANEL.join(",")).length,
      layerTreeHit: document.querySelectorAll(LAYER_TREE.join(",")).length,
      pageListHit: document.querySelectorAll(PAGE_LIST.join(",")).length,
      canvasSelectors: countSel(CANVAS_PANEL),
      layerTreeSelectors: countSel(LAYER_TREE),
      pageListSelectors: countSel(PAGE_LIST)
    },
    cidTotal: document.querySelectorAll("[data-cid]").length,
    rowTotal: document.querySelectorAll(ROW_SELECTOR).length,
    nameQuery: NAME_QUERY,
    rows: [],
    nameMatches: []
  };

  var rows = document.querySelectorAll(ROW_SELECTOR);
  for (var i = 0; i < rows.length && report.rows.length < MAX_ROWS; i++) {
    var el = rows[i];
    var name = readName(el);
    report.rows.push({
      tag: el.tagName,
      cls: String(el.className || "").slice(0, 120),
      cid: el.getAttribute("data-cid"),
      type: el.getAttribute("data-interactive-target-type"),
      layerItem: rowLayerItem(el),
      visible: visible(el),
      panel: panelOf(el),
      rejected: rejectReason(el),      // "inLayerTree" / "layerItem" / "none"
      folder: !!(el.classList && el.classList.contains("folder")),
      name: name.slice(0, 60),
      ancestors: ancestors(el, MAX_ANCESTORS)
    });
  }

  if (NAME_QUERY) {
    var q = String(NAME_QUERY);
    for (var j = 0; j < rows.length; j++) {
      var rn = readName(rows[j]);
      if (rn && rn.indexOf(q) >= 0) {
        report.nameMatches.push({
          cid: rows[j].getAttribute("data-cid"),
          name: rn.slice(0, 60),
          panel: panelOf(rows[j]),
          layerItem: rowLayerItem(rows[j]),
          visible: visible(rows[j]),
          rejected: rejectReason(rows[j])
        });
      }
    }
  }

  var json = JSON.stringify(report, null, 2);
  console.log("[dump-canvas-dom] 版本=" + report.coreVersion +
              " 锚点命中(画布/图层/页面)=" + report.anchors.canvasHit + "/" +
              report.anchors.layerTreeHit + "/" + report.anchors.pageListHit +
              " 树项=" + report.rowTotal);
  console.log(json);
  try {
    copy(json);
    console.log("[dump-canvas-dom] ✅ JSON 已复制到剪贴板，直接粘贴回贴即可。");
  } catch (e) {
    console.log("[dump-canvas-dom] ⚠ copy() 不可用，请手动复制上面的 JSON。");
  }
  return report;
})();
