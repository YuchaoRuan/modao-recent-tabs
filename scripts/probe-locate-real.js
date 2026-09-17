/* =========================================================================
 * scripts/probe-locate-real.js — 真机「未找到画布」取证探针（v2）
 *
 * 为什么有 v2：v1（dump-canvas-dom.js）是**多行**脚本，用户在聊天里复制粘贴时
 * 被折断（第 19 行出现拼接残片 → `Uncaught SyntaxError: Unexpected string`），
 * 脚本根本没执行，白跑一轮。v2 因此同步提供**单行版**
 * `scripts/probe-locate-real.min.js`（无换行、无反引号），从本地编辑器
 * Ctrl+A/Ctrl+C 复制后粘贴最不容易被剪贴板/聊天界面破坏。
 *
 * 用途：真机（内网 10.83.117.101:9080，需登录、无法远程调试）上一次取全证据。
 *   只读 + 一次**可逆**的搜索框试验（写完立即还原原值），不点任何列表项。
 *
 * 用法：
 *   1. 让目标画布保持「折叠 / 不可见」的状态；
 *   2. 打开 DevTools Console，粘贴 min.js 的全部内容，回车；
 *   3. 输出会 console.log 出来并 copy() 到剪贴板，直接 Ctrl+V 回贴。
 *
 * 关键三问（这条脚本存在的全部理由）：
 *   · cidHitTotal      —— 标签存的那个 id，在整份文档里还有几个元素带它？
 *                         0 = 该 id 已不在 DOM（改版换名 / 重新导入 / 只是没渲染）
 *                        >0 = id 在，但标签/类名形态与我们的选择器不符
 *   · nameRowsBefore   —— 不看 id，**按名字**能不能找到行？（含祖先链，判断包装容器）
 *   · nameRowsAfterSearch —— 把名字写进墨刀自己的搜索框后，行是否出现？
 *                         出现且 cid ≠ targetId → 就是「搜索能渲染、但我们仍按旧 id 查」的缺陷
 * ========================================================================= */
(async () => {
  var NAME = "航班座位号查询";   // ← 目标画布名（子串匹配即可，可改）
  var ID = "";                   // ← 留空 = 自动从标签栏按名字取；也可手填 cid

  var q = function (s) { try { return document.querySelectorAll(s).length; } catch (e) { return -1; } };
  var brief = function (n) {
    var c = String(n.className || "").trim().split(/\s+/).filter(Boolean).slice(0, 4).join(".");
    return n.tagName.toLowerCase() + (c ? "." + c : "") + (n.id ? "#" + n.id : "");
  };
  var chain = function (el) {
    var o = [], n = el, i = 0;
    while (n && n.nodeType === 1 && i++ < 8) { o.push(brief(n)); n = n.parentElement; }
    return o;
  };
  var info = function (r) {
    return {
      tag: r.tagName.toLowerCase(),
      cid: r.getAttribute("data-cid"),
      cls: String(r.className || "").slice(0, 90),
      type: r.getAttribute("data-interactive-target-type"),
      layerItem: r.classList.contains("layer-item"),
      vis: !!(r.getClientRects && r.getClientRects().length),
      text: (r.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40),
      chain: chain(r)
    };
  };
  var allRows = function () { return Array.prototype.slice.call(document.querySelectorAll("[data-cid]")); };
  var byName = function () {
    return allRows().filter(function (r) { return (r.textContent || "").indexOf(NAME) >= 0; }).map(info);
  };

  var tabs = Array.prototype.slice.call(document.querySelectorAll(".md-tab")).map(function (t) {
    return { id: t.getAttribute("data-id"), label: (t.textContent || "").trim(), stale: t.hasAttribute("data-stale") };
  });
  var rootEl = document.querySelector("#md-recent-tabs-root");
  var hit = tabs.filter(function (t) { return t.label.indexOf(NAME) >= 0; })[0];
  var targetId = ID || (hit ? hit.id : null);

  var inputs = Array.prototype.slice.call(document.querySelectorAll("input")).slice(0, 12).map(function (b) {
    var r = b.getBoundingClientRect();
    return { ph: b.getAttribute("placeholder"), val: b.value, type: b.type, w: Math.round(r.width), top: Math.round(r.top) };
  });
  // 与扩展 findScreenSearchBox() 完全一致的判定（placeholder 含 搜索/查找/检索 + 宽>40 + top<300）
  var sb = Array.prototype.slice.call(document.querySelectorAll("input")).filter(function (b) {
    var ph = b.getAttribute("placeholder") || "";
    if (!/搜索|查找|检索/.test(ph)) return false;
    var r = b.getBoundingClientRect();
    return r.width > 40 && r.top < 300;
  })[0] || null;

  var before = byName();
  var cidHitTotal = targetId ? q('[data-cid="' + targetId + '"]') : null;

  var afterSearch = null, afterVal = null;
  if (sb) {
    var d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    var orig = sb.value;
    d.set.call(sb, NAME);
    sb.dispatchEvent(new Event("input", { bubbles: true }));
    sb.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(function (r) { setTimeout(r, 1200); });
    afterSearch = byName();
    afterVal = sb.value;
    d.set.call(sb, orig);                       // 还原现场
    sb.dispatchEvent(new Event("input", { bubbles: true }));
  }

  var toggles = Array.prototype.slice.call(document.querySelectorAll('[aria-expanded="false"]')).slice(0, 10).map(brief);
  var proj = (location.pathname.match(/\/proto\/design\/([^\/?#]+)/) || [])[1] || null;
  var hist = proj ? localStorage.getItem("screen-history-onLeave-project-" + proj) : null;

  var out = {
    ts: new Date().toISOString(),
    url: location.href,
    projCid: proj,
    coreVersionAttr: rootEl ? rootEl.getAttribute("data-md-version") : null,   // 先看这行：是不是你以为的那一版
    tabs: tabs,
    targetId: targetId,
    cidHitTotal: cidHitTotal,
    nameRowsBefore: before,
    searchBoxDetected: !!sb,
    searchBoxValueAfterTest: afterVal,
    inputs: inputs,
    nameRowsAfterSearch: afterSearch,
    anchors: {
      canvas: q("#screen-scroll-list,#screen_list,.screen-list-container,#mobile-screen-tree"),
      pageList: q("#mb-enabled-canvas-list,#canvas-scroll-list,.canvas-scroll-list,.canvas-sortable-list"),
      layerTree: q("#mb-enabled-layer-list,#layer-scroll-list,.layer-scroll-list,.layer-sortable-list,#mb-state-list")
    },
    rowTotal: q("[data-cid]"),
    ariaExpandedFalse: toggles,
    screenHistory: hist
  };
  var s = JSON.stringify(out, null, 1);
  console.log(s);
  if (typeof copy === "function") copy(s);
  return out;
})()
