/* =========================================================================
 * scripts/probe-tab-rows.js — 真机「标签的 cid 在左栏有没有对应的行」取证探针（v2）
 *
 * 用途：日志里出现「未找到画布「XXX」」时，用它一次性看清失败属于哪一种：
 *   A. cid 不匹配     —— 行在 DOM 里，但 cid 与标签存的不一样（画布被重新导入/复制过）
 *   B. 行被卸载       —— 按名字也找不到任何行（折叠分组卸载了子树 / 不在当前文件）
 *   C. 被搜索框过滤   —— searchBox.value 非空，非命中画布被移出 DOM
 *   D. 判定被拒       —— 行在 DOM 且 cid 也对，但落在图层树 / 带 layer-item（我们的规则会拒绝）
 *
 * v2 相对 v1 新增（v1 只能看出「cid 在不在 DOM」，不足以定根因）：
 *   · tabs[].nameMatches  —— 不看 cid，按**名字**反查行，回答「同名行是否存在、它的 cid 是什么」；
 *   · searchBox           —— 左侧搜索框是否存在（与扩展 findScreenSearchBox 同口径）及其**当前值**；
 *   · inputs              —— 前 8 个 input 的 placeholder/value/宽度/位置（判定条件不满足时看这里）；
 *   · collapsedToggleCount—— 文档里 aria-expanded="false" 的折叠开关数量。
 *
 * 用法：出现「未找到画布」提示时（或任意时刻）打开 DevTools Console，
 *       粘贴 `probe-tab-rows.min.js` 全部内容，回车，然后 Ctrl+V 回贴结果。
 *
 * 只读脚本：不改任何页面状态，不点任何列表项（不写搜索框）。
 * ========================================================================= */
(function () {
  var VERSION_EXPECTED = "1.0.20";   // 期望的核心版本；三处版本同升时记得同步改这里

  var qa = function (s) { try { return document.querySelectorAll(s); } catch (e) { return []; } };
  var brief = function (n) {
    var c = String(n.className || "").trim().split(/\s+/).filter(Boolean).slice(0, 4).join(".");
    return n.tagName.toLowerCase() + (c ? "." + c : "") + (n.id ? "#" + n.id : "");
  };
  var chainOf = function (el, max) {
    var o = [], n = el, i = 0;
    while (n && n.nodeType === 1 && i++ < (max || 6)) { o.push(brief(n)); n = n.parentElement; }
    return o;
  };
  // 与核心 normalizeName 同口径：去掉开头「序号 + 分隔符」与首尾空白
  var normName = function (s) {
    return String(s == null ? "" : s).replace(/\s+/g, " ").trim()
      .replace(/^\d+\s*[.、:：\-)\]]*\s*/, "").trim();
  };

  var SEL = {
    canvas: "#screen-scroll-list,.screen-list-container,#screen_list,#mobile-screen-tree",
    pageList: "#mb-enabled-canvas-list,#canvas-scroll-list,.canvas-scroll-list,.canvas-sortable-list",
    layerTree: "#mb-enabled-layer-list,#layer-scroll-list,.layer-scroll-list,.layer-sortable-list,#mb-state-list"
  };
  var canvasRoot = document.querySelector(SEL.canvas);
  var pageRoots = qa(SEL.pageList);
  var layerRoots = qa(SEL.layerTree);
  var inAny = function (roots, el) {
    for (var i = 0; i < roots.length; i++) { if (roots[i].contains(el)) { return true; } }
    return false;
  };

  var rootEl = document.querySelector("#md-recent-tabs-root");
  var ver = rootEl ? rootEl.getAttribute("data-md-version") : null;

  /* 左侧搜索框：与核心 findScreenSearchBox 完全同口径（placeholder 含 搜索/查找/检索
     + 宽 > 40 + 视口顶部 300px 内）。同时列出前 8 个 input，便于看清判定为何不满足。 */
  var allInputs = qa("input");
  var inputBrief = [];
  var searchBox = null;
  for (var i0 = 0; i0 < allInputs.length; i0++) {
    var b = allInputs[i0];
    var ph = b.getAttribute("placeholder") || "";
    var r = { left: 0, top: 0, width: 0 };
    try { var rr = b.getBoundingClientRect(); r = { left: Math.round(rr.left), top: Math.round(rr.top), width: Math.round(rr.width) }; } catch (e) {}
    if (i0 < 8) {
      inputBrief.push({ ph: ph, val: String(b.value || "").slice(0, 30), type: b.type, top: r.top, left: r.left, width: r.width });
    }
    if (searchBox) { continue; }
    if (!/搜索|查找|检索/.test(ph)) { continue; }
    if (r.width <= 40) { continue; }
    if (r.top >= 300) { continue; }
    searchBox = b;
  }
  var searchBoxInfo = searchBox
    ? { found: true, value: String(searchBox.value || ""), placeholder: searchBox.getAttribute("placeholder") || "" }
    : { found: false, value: null, placeholder: null };

  var collapsedToggleCount = qa('[aria-expanded="false"]').length;
  var allCidNodes = qa("[data-cid]");

  var tabs = qa("#md-recent-tabs-root .md-tab");
  var list = [];
  for (var i = 0; i < tabs.length; i++) {
    var id = tabs[i].getAttribute("data-id");
    var label = (tabs[i].textContent || "").trim();
    var els = id ? qa('[data-cid="' + id + '"]') : [];
    var hits = [];
    for (var j = 0; j < els.length && j < 4; j++) {
      var el = els[j];
      hits.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className || "").slice(0, 90),
        hasLayerItem: el.classList.contains("layer-item"),
        inCanvas: !!(canvasRoot && canvasRoot.contains(el)),
        inPageList: inAny(pageRoots, el),
        inLayerTree: inAny(layerRoots, el),
        vis: !!(el.getClientRects && el.getClientRects().length),
        text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 30),
        chain: chainOf(el, 6)
      });
    }

    /* 按名字反查（不看 cid）：判定「同名行是否存在」以及它的真实 cid 是什么。
       这是区分「cid 不匹配」与「行不在 DOM」的唯一手段。 */
    var nameMatches = [];
    var nm = normName(label);
    if (nm.length >= 2) {
      for (var m = 0; m < allCidNodes.length && nameMatches.length < 3; m++) {
        var nd = allCidNodes[m];
        var t = normName(nd.textContent || "");
        if (!t) { continue; }
        if (t.indexOf(nm) >= 0 || (t.length >= 4 && nm.indexOf(t) >= 0)) {
          nameMatches.push({
            cid: nd.getAttribute("data-cid"),
            tag: nd.tagName.toLowerCase(),
            cls: String(nd.className || "").slice(0, 90),
            hasLayerItem: nd.classList.contains("layer-item"),
            inCanvas: !!(canvasRoot && canvasRoot.contains(nd)),
            inPageList: inAny(pageRoots, nd),
            inLayerTree: inAny(layerRoots, nd),
            vis: !!(nd.getClientRects && nd.getClientRects().length),
            text: t.slice(0, 40),
            chain: chainOf(nd, 5)
          });
        }
      }
    }

    list.push({
      id: id,
      label: label,
      stale: tabs[i].hasAttribute("data-stale"),
      hitTotal: els.length,
      hits: hits,
      nameMatches: nameMatches
    });
  }

  var out = {
    ts: new Date().toISOString(),
    url: location.href,
    coreVersionAttr: ver,
    expectedVersion: VERSION_EXPECTED,
    versionMatchesExpected: ver === VERSION_EXPECTED,
    tabCount: list.length,
    searchBox: searchBoxInfo,
    searchBoxDetected: !!searchBox,
    collapsedToggleCount: collapsedToggleCount,
    inputs: inputBrief,
    anchorsPresent: {
      canvas: qa(SEL.canvas).length,
      pageList: pageRoots.length,
      layerTree: layerRoots.length
    },
    docCidNodes: allCidNodes.length,
    tabs: list
  };

  var s = JSON.stringify(out, null, 1);
  console.log(s);
  if (typeof copy === "function") { copy(s); }
  return out;
})()
