/* =========================================================================
 * scripts/probe-left-inputs.js — 真机「为什么 findScreenSearchBox 返回 null」取证探针
 *
 * 背景：v1.0.13 引入「用左侧搜索框兜底定位」，入口 locateCanvas 第一行
 *   入口 locateCanvas 第一行即探测搜索框，探测不到就 fail 走滚动扫描兜底。
 * 真机上 findScreenSearchBox 返回 null，整条兜底路径死掉，只剩脆弱的滚动扫描。
 *
 * findScreenSearchBox 判定（recent-tabs-core.js:625-641，v1.0.13→当前零改动）：
 *   1. placeholder 含 /搜索|查找|检索/
 *   2. 宽 > 40px
 *   3. 视口顶部 300px 内（top < 300）
 * 失效只可能是：(a) 墨刀 UI 变了（搜索框挪到 top≥300 / 换成非 input 元素 /
 *   placeholder 不含中文关键词）；或 (b) 早期真机取样不足（只看前 8 个 input）。
 *
 * 本探针把三个条件逐层剥开，一次分清到底卡在哪个条件：
 *   · coreVersion        版本指纹，先证版本；不是 1.0.20 本轮结论一律作废
 *   · searchLike         命中关键词的所有 input（决定「关键词不匹配」还是「压根不是 input」）
 *   · placeholderTop300  顶部 300px 内所有 input 的 placeholder 原文（暴露「关键词写法变了」）
 *   · topInputs          前 15 个 input 全字段（暴露「没 placeholder / 是英文」）
 *   · contentEditables   contenteditable 元素（墨刀可能用 contenteditable 做搜索）
 *   · allCandidateBoxes  顶部 300px + 宽>40 的 input/contenteditable/searchbox/textbox，
 *                         不加关键词过滤（直接指出是哪个条件卡掉的）
 *   · leftPanelProbe     对 #screen-scroll-list 向上 6 层祖先，看搜索框 top 是否被面板头部推到 300 以下
 *
 * 只读脚本：不改 DOM、不点击、不滚动、不改任何状态。
 * 用法：打开目标画布页 → F12 Console → 粘贴 probe-left-inputs.min.js → 复制输出 JSON 回贴。
 * ========================================================================= */
(function () {
  var VERSION_EXPECTED = "1.0.20";   // 期望的核心版本；三处版本同升时记得同步改这里
  var KEY_RE = /搜索|查找|检索/;       // 与核心 findScreenSearchBox 同口径的关键词

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
  var rectOf = function (el) {
    var r = { top: 0, left: 0, width: 0, height: 0 };
    try {
      var b = el.getBoundingClientRect();
      r = { top: Math.round(b.top), left: Math.round(b.left), width: Math.round(b.width), height: Math.round(b.height) };
    } catch (e) {}
    return r;
  };
  // 标准字段（与 searchLike / topInputs / contentEditables / allCandidateBoxes 同口径）
  var fieldsOf = function (el) {
    var r = rectOf(el);
    var tag = el.tagName.toLowerCase();
    var tp = (tag === "input") ? el.type : (el.getAttribute("role") || "");
    var ph = el.getAttribute ? (el.getAttribute("placeholder") || "") : "";
    return {
      tag: tag,
      type: tp,
      placeholder: ph,
      width: r.width,
      height: r.height,
      top: r.top,
      left: r.left,
      visible: (r.width > 0 && r.height > 0),
      ancestorChain: chainOf(el, 5),
      keyHitField: null
    };
  };
  // 判断一个 input 命中关键词的字段名（命中顺序：placeholder > value > aria-label > name > id > className）
  var keyHitFieldOf = function (el) {
    var fields = [
      ["placeholder", el.getAttribute ? (el.getAttribute("placeholder") || "") : ""],
      ["value", (typeof el.value === "string") ? el.value : ""],
      ["aria-label", el.getAttribute ? (el.getAttribute("aria-label") || "") : ""],
      ["name", el.getAttribute ? (el.getAttribute("name") || "") : ""],
      ["id", el.id || ""],
      ["className", String(el.className || "")]
    ];
    for (var k = 0; k < fields.length; k++) {
      if (KEY_RE.test(fields[k][1])) { return fields[k][0]; }
    }
    return null;
  };

  var rootEl = document.querySelector("#md-recent-tabs-root");
  var ver = rootEl ? rootEl.getAttribute("data-md-version") : null;

  var allInputs = qa("input");
  var total = allInputs.length;

  // searchLike：所有「关键词命中」的 input（决定是「关键词不匹配」还是「压根不是 input」）
  var searchLike = [];
  // placeholderTop300：顶部 300px 内所有 input 的 placeholder 原文（暴露「关键词写法变了」）
  var placeholderTop300 = [];
  for (var i = 0; i < allInputs.length; i++) {
    var el = allInputs[i];
    var r = rectOf(el);
    var ph = el.getAttribute ? (el.getAttribute("placeholder") || "") : "";
    if (r.top < 300) { placeholderTop300.push(ph); }
    var hit = keyHitFieldOf(el);
    if (hit) {
      var so = fieldsOf(el);
      so.keyHitField = hit;
      searchLike.push(so);
    }
  }

  // topInputs：前 15 个 input 全字段，不做关键词过滤（暴露「没 placeholder / 是英文」）
  var topInputs = [];
  for (var j = 0; j < allInputs.length && j < 15; j++) {
    var to = fieldsOf(allInputs[j]);
    to.keyHitField = keyHitFieldOf(allInputs[j]);
    topInputs.push(to);
  }

  // contentEditables：contenteditable="true" 元素（墨刀可能用 contenteditable 做搜索）；限量 10 个
  var ces = qa('[contenteditable="true"]');
  var contentEditables = [];
  for (var c = 0; c < ces.length && c < 10; c++) {
    contentEditables.push(fieldsOf(ces[c]));
  }

  // allCandidateBoxes：顶部 300px + 宽>40 的 input/contenteditable/searchbox/textbox，
  // 不加 placeholder 关键词过滤 —— 把 findScreenSearchBox 的三个条件逐层剥开
  var candEls = qa('input, [contenteditable], [role="searchbox"], [role="textbox"]');
  var allCandidateBoxes = [];
  for (var m = 0; m < candEls.length && allCandidateBoxes.length < 200; m++) {
    var ce = candEls[m];
    var cr = rectOf(ce);
    if (cr.top < 300 && cr.width > 40) { allCandidateBoxes.push(fieldsOf(ce)); }
  }

  // leftPanelProbe：对 #screen-scroll-list（真机实测画布列滚动宿主）向上取 6 层祖先链，
  // 看搜索框的 top 是否被面板头部推到 300px 以下（头号怀疑原因）
  var screenList = document.querySelector("#screen-scroll-list");
  var leftPanelProbe = null;
  if (screenList) {
    var chain = [];
    var n = screenList, idx = 0;
    while (n && n.nodeType === 1 && idx < 6) {
      var nr = rectOf(n);
      var cs = null;
      try { cs = window.getComputedStyle(n); } catch (e) {}
      chain.push({
        node: brief(n),
        overflowY: cs ? (cs.overflowY || "") : "",
        top: nr.top,
        height: nr.height
      });
      n = n.parentElement;
      idx++;
    }
    leftPanelProbe = chain;
  }

  var out = {
    ts: new Date().toISOString(),
    url: location.href,
    coreVersion: ver,
    expectedVersion: VERSION_EXPECTED,
    versionMatchesExpected: ver === VERSION_EXPECTED,
    total: total,
    searchLike: searchLike,
    placeholderTop300: placeholderTop300,
    topInputs: topInputs,
    contentEditables: contentEditables,
    allCandidateBoxes: allCandidateBoxes,
    leftPanelProbe: leftPanelProbe
  };

  var s = JSON.stringify(out, null, 1);
  console.log(s);
  if (typeof copy === "function") { copy(s); }
  return out;
})()
