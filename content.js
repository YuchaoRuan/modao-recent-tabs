/* =========================================================================
 * 墨刀企业版（内网）「最近画布」— 浏览器扩展内容脚本
 * --------------------------------------------------------------------------
 * 数据来源与交互逻辑移植自桌面客户端已验证通过的 recent-tabs-bootstrap.js：
 *   - 画布 = 设计文件内的 screen（非 /workspace/recent 的设计文件列表）
 *   - 最近画布取自同源 localStorage: screen-history-onLeave-project-<cid>
 *   - 名称取自左侧画布栏 DOM: div.rn-list-item.page[data-cid]
 *   - 切换画布 = 点击左侧画布项（内部状态，URL 不变）
 * UI 复用共享组件 RecentTabsBar（tabbar.js）。
 * P0 合规：图标全 SVG，无 emoji、无紫粉渐变。
 * ========================================================================= */
;(function () {
  "use strict";

  // 幂等保护：避免通过工具栏按钮重复注入时重复挂载
  if (document.getElementById("md-recent-tabs-root")) return;
  if (!document.documentElement) return;

  var CLOSED_KEY = "md_closed_screens";
  var DISPLAY_MODE_KEY = "md_display_mode";
  var TOPBAR_H = 44;

  var cid = null;            // 当前设计文件 id（可随 SPA 路由变化）
  var lastCid = null;
  var closed = readClosed(); // 已关闭（仅本地）的画布 id
  var seen = {};             // 内存累积的最近画布: id -> { id, name, ts }

  /* ----------------------------- 工具函数 ----------------------------- */
  function readClosed() {
    try { return JSON.parse(localStorage.getItem(CLOSED_KEY) || "[]"); } catch (e) { return []; }
  }
  function persistClosed() {
    try { localStorage.setItem(CLOSED_KEY, JSON.stringify(closed)); } catch (e) {}
  }

  // 当前设计文件最近打开的画布 id（screen-history-onLeave-project-<cid>）
  function getRecentIds() {
    if (!cid) return [];
    var raw = localStorage.getItem("screen-history-onLeave-project-" + cid);
    if (!raw) return [];
    try {
      var a = JSON.parse(raw);
      if (Array.isArray(a)) return a.map(String);
    } catch (e) {}
    var r = raw.match(/rbpVRNr[A-Za-z0-9]+/g);
    return r || [];
  }

  // 从画布项 DOM 提取名称（textContent 优先，input/title 兜底）
  function readName(el) {
    if (!el) return "";
    var n = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (n) return n;
    if (el.querySelector) {
      var inp = el.querySelector("input[value], textarea");
      if (inp && (inp.value || inp.textContent)) {
        return (inp.value || inp.textContent).replace(/\s+/g, " ").trim();
      }
    }
    var ti = el.getAttribute ? el.getAttribute("title") : null;
    return ti ? ti.trim() : "";
  }

  // 左侧画布栏：id -> name（排除文件夹 folder）
  function getScreenMap() {
    var map = {};
    var els = document.querySelectorAll("div.rn-list-item[data-cid]");
    for (var i = 0; i < els.length; i++) {
      if (els[i].classList && els[i].classList.contains("folder")) continue;
      var id = els[i].getAttribute("data-cid");
      var name = readName(els[i]);
      if (id && name && !(id in map)) map[id] = name;
    }
    return map;
  }

  // 把一个画布标记为最近（置顶）。若之前在关闭列表，则重新打开（移除关闭记录）。
  function touch(id, name) {
    if (!id) return false;
    var ci = closed.indexOf(id);
    if (ci >= 0) {
      closed.splice(ci, 1);
      persistClosed();
    }
    if (!name) {
      var el = document.querySelector('div.rn-list-item[data-cid="' + id + '"]');
      if (el) name = readName(el);
    }
    if (!name) return false;
    seen[id] = { id: id, name: name, ts: Date.now() };
    return true;
  }

  // 从 screen-history 同步（初始 + 打开/离开文件时兜底）。返回是否有新画布出现。
  function syncFromHistory() {
    var ids = getRecentIds();
    var map = getScreenMap();
    var changed = false;
    var base = Date.now();
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      if (!map[id]) continue;
      if (!(id in seen)) {
        seen[id] = { id: id, name: map[id], ts: base - i * 1000 };
        changed = true;
      }
    }
    return changed;
  }

  // 检测当前激活画布（编辑器里正打开的那个）。优先激活态 class，其次 canvas-title 文本反查。
  function getActiveScreen() {
    var sels = [
      "div.rn-list-item[data-cid].is-active",
      "div.rn-list-item[data-cid].is-selected",
      "div.rn-list-item[data-cid].selected",
      "div.rn-list-item[data-cid].current",
      "div.rn-list-item[data-cid][aria-selected='true']"
    ];
    for (var i = 0; i < sels.length; i++) {
      var el = document.querySelector(sels[i]);
      if (el) {
        var id = el.getAttribute("data-cid");
        if (id) return { id: id, name: readName(el) };
      }
    }
    var titleEl = document.querySelector(".canvas-title");
    if (titleEl) {
      var name = readName(titleEl);
      if (name) {
        var els = document.querySelectorAll("div.rn-list-item[data-cid]");
        for (var j = 0; j < els.length; j++) {
          if (els[j].classList && els[j].classList.contains("folder")) continue;
          if (readName(els[j]) === name) {
            return { id: els[j].getAttribute("data-cid"), name: name };
          }
        }
      }
    }
    return null;
  }

  var lastActiveId = null;

  // 激活画布变化时置顶进标签栏（覆盖“进入文件默认打开的画布”）
  function syncActiveScreen() {
    var active = getActiveScreen();
    if (!active || !active.id) return false;
    if (active.id === lastActiveId) return false;
    lastActiveId = active.id;
    return touch(active.id, active.name);
  }

  /* ------------------------------ 挂载 UI ------------------------------ */
  var root = document.createElement("div");
  root.id = "md-recent-tabs-root";
  document.documentElement.appendChild(root);

  function closeId(id) {
    if (closed.indexOf(id) < 0) closed.push(id);
    delete seen[id];
  }

  var bar = new RecentTabsBar(root, {
    max: 20,
    onSwitch: function (item) {
      if (!item || !item.id) return;
      var el = document.querySelector('div.rn-list-item[data-cid="' + item.id + '"]');
      if (!el) return;
      touch(item.id, item.name);
      scheduleRender();
      try { el.scrollIntoView({ block: "nearest" }); } catch (e) {}
      try { el.click(); } catch (e) {}   // 模拟点击左侧画布项 → 墨刀内部切换
      bar.setActive(item.id);
    },
    onClose: function (item) {
      closeId(item.id);
      persistClosed();
      scheduleRender();
    },
    onCloseOthers: function () {
      var keep = bar.activeId;
      Object.keys(seen).forEach(function (id) {
        if (id !== keep) closeId(id);
      });
      persistClosed();
      scheduleRender();
    },
    onTogglePin: function () {
      displayMode = displayMode === "float" ? "fixed" : "float";
      persistDisplayMode();
      applyDisplayMode();
    }
  });

  var renderTimer = null;
  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = setTimeout(function () { renderTimer = null; renderList(); }, 0);
  }

  function renderList() {
    var list = Object.keys(seen)
      .filter(function (id) { return closed.indexOf(id) < 0; })
      .map(function (id) { return { id: id, name: seen[id].name, ts: seen[id].ts }; })
      .sort(function (a, b) { return b.ts - a.ts; })
      .slice(0, bar.max);
    bar.setItems(list.map(function (it) {
      return { id: it.id, name: it.name, updatedAt: it.ts };
    }));
    bar.setBadge(list.length ? "画布 " + list.length : "画布");
    var stillActive = bar.activeId && list.some(function (it) { return it.id === bar.activeId; });
    if (!stillActive) bar.setActive(list.length ? list[0].id : null);
  }

  /* --------------------------- 显示模式（固定/浮动） --------------------------- */
  var displayMode = "fixed";
  try { displayMode = localStorage.getItem(DISPLAY_MODE_KEY) || "fixed"; } catch (e) {}
  if (displayMode !== "float") displayMode = "fixed";

  var offsetStyle = null;
  var hotspot = null;

  function persistDisplayMode() {
    try { localStorage.setItem(DISPLAY_MODE_KEY, displayMode); } catch (e) {}
  }

  function ensureHotspot() {
    var hb = detectHeaderBottom();
    if (hotspot) {
      hotspot.style.height = (hb > 0 ? hb : 8) + "px";
      return;
    }
    hotspot = document.createElement("div");
    hotspot.className = "md-recent-tabs-hotspot";
    document.body.appendChild(hotspot);
    var hideTimer = null;
    function show() {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      bar.barEl.classList.add("is-visible");
    }
    function hide() {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(function () {
        bar.barEl.classList.remove("is-visible");
        hideTimer = null;
      }, 250);
    }
    hotspot.addEventListener("mouseenter", show);
    hotspot.addEventListener("mouseleave", hide);
    bar.barEl.addEventListener("mouseenter", show);
    bar.barEl.addEventListener("mouseleave", hide);
    hotspot.style.height = (hb > 0 ? hb : 8) + "px";
  }

  function removeHotspot() {
    if (hotspot && hotspot.parentNode) hotspot.parentNode.removeChild(hotspot);
    hotspot = null;
    bar.barEl.classList.remove("is-visible");
  }

  function applyDisplayMode() {
    var hb = detectHeaderBottom();
    var isFloat = displayMode === "float";
    bar.barEl.classList.toggle("is-float", isFloat);
    bar.barEl.classList.remove("is-visible");
    bar.setPinned(!isFloat);
    bar.barEl.style.top = hb + "px";
    bar.barEl.style.setProperty("--md-hide-offset", hb + "px");
    if (!offsetStyle) {
      offsetStyle = document.createElement("style");
      offsetStyle.id = "md-recent-tabs-offset";
      document.head.appendChild(offsetStyle);
    }
    if (isFloat) {
      offsetStyle.textContent = hb > 0 ? "body{padding-top:" + hb + "px !important;}" : "body{padding-top:0 !important;}";
      ensureHotspot();
    } else {
      offsetStyle.textContent = hb > 0 ? "body{padding-top:" + (TOPBAR_H + hb) + "px !important;}" : "body{padding-top:" + TOPBAR_H + "px !important;}";
      removeHotspot();
    }
  }

  applyDisplayMode();

  function detectHeaderBottom() {
    var max = 0;
    document.querySelectorAll("header, [class*='header'], [class*='topbar'], [class*='navbar']").forEach(function (el) {
      var cs = getComputedStyle(el);
      if (cs.position === "fixed" || cs.position === "sticky") {
        var r = el.getBoundingClientRect();
        if (r.top <= 2 && r.height > 20 && r.height < 120) max = Math.max(max, Math.round(r.bottom));
      }
    });
    return max;
  }

  /* --------------------- 当前设计文件（cid）监听（SPA 鲁棒性） --------------------- */
  function refreshCid() {
    var m = (location.pathname || "").match(/\/proto\/design\/([A-Za-z0-9]+)/);
    cid = m ? m[1] : null;
    if (cid !== lastCid) {
      // 切换到不同设计文件：清空已累积画布，避免跨文件串号
      lastCid = cid;
      seen = {};
      lastActiveId = null;
    }
    if (!cid) {
      // 非设计文件页：隐藏标签栏（不干扰 /workspace 等页面）
      root.style.display = "none";
      return false;
    }
    root.style.display = "";
    var changed = false;
    if (syncFromHistory()) changed = true;
    if (syncActiveScreen()) changed = true;
    return changed;
  }

  /* ------------------------------ 初始化 ------------------------------ */
  refreshCid();
  renderList();

  // 核心：点击左侧「画布」栏任意画布项 → 标记为最近并置顶进标签栏
  // 捕获阶段监听，不 preventDefault/stopPropagation，不影响墨刀自身交互。
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (!cid) return;
    var item = t.closest("div.rn-list-item[data-cid]");
    if (!item) return;
    if (item.classList && item.classList.contains("folder")) return; // 文件夹忽略
    var id = item.getAttribute("data-cid");
    if (!id) return;
    var name = readName(item);
    if (touch(id, name)) {
      lastActiveId = id;
      scheduleRender();
      bar.setActive(id);
    }
  }, true);

  // 兜底：左侧面板可能异步渲染、screen-history 可能延迟更新、SPA 路由可能变化
  setInterval(function () {
    var changed = refreshCid();
    if (changed) scheduleRender();
  }, 2000);

  // 轻量 MutationObserver：左侧画布栏出现新节点时即时同步（比 2s 轮询更跟手）
  try {
    var mo = new MutationObserver(function () {
      var changed = syncFromHistory() || syncActiveScreen();
      if (changed) scheduleRender();
    });
    mo.observe(document.body, { childList: true, subtree: true });
  } catch (e) {}

  /* --------------------- 来自设置页的消息（清除已关闭标签） --------------------- */
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (msg && msg.type === "MD_CLEAR_CLOSED") {
        closed = [];
        persistClosed();
        syncFromHistory();
        syncActiveScreen();
        renderList();
        if (typeof sendResponse === "function") sendResponse({ ok: true });
      }
      return false;
    });
  }
})();
