/* =========================================================================
 * 墨刀企业版（内网）「最近画布」— 共享核心逻辑
 * 浏览器扩展内容脚本与桌面注入共用，由 content.js / recent-tabs-bootstrap.js 调用。
 * 依赖全局 RecentTabsBar（tabbar.js）。
 * P0 合规：图标全 SVG，无 emoji、无紫粉渐变。
 * ========================================================================= */
(function (global) {
  "use strict";

  // 模块级单例缓存：防止重复挂载（桌面热重载 / HMR 场景）。destroy 时清空。
  var __instance = null;

  // 创建一个「最近画布」控制器并挂载到 root。
  // options.enableMessageListener=true 时启用 MD_CLEAR_CLOSED 扩展消息（仅浏览器扩展侧）。
  function createRecentTabs(options) {
    options = options || {};
    var enableMessageListener = !!options.enableMessageListener;

    // 自幂等：若已存在有效实例，直接复用，避免重复创建 root / 叠加监听。
    if (__instance) return __instance;

    var CLO  = "md_closed_screens";
    var DMODE = "md_display_mode";
    var TOPBAR_H = 44;

    var cid = null;
    var lastCid = null;
    var closed = readClosed();
    var seen = {};

    function readClosed() {
      try { return JSON.parse(localStorage.getItem(CLO) || "[]"); } catch (e) { return []; }
    }
    function persistClosed() {
      try { localStorage.setItem(CLO, JSON.stringify(closed)); } catch (e) {}
    }

    // 墨刀原生格式（运行端探针已确认，2026-08-28）：
    //   localStorage['screen-history-onLeave-project-<cid>'] = "rbpVRNr<base62>"
    // 即最近离开画布的完整 screen id（rbpVRNr 为墨刀 screen id 前缀）。
    // onLeave 时整体覆盖为最新画布，故 localStorage 只保留"最近一个"，并非历史列表。
    // 兼容旧版可能的 JSON 数组（最新在前）。
    function getRecentIds() {
      if (!cid) return [];
      var raw = localStorage.getItem("screen-history-onLeave-project-" + cid);
      if (!raw) return [];
      try {
        var a = JSON.parse(raw);
        if (Array.isArray(a)) return a.map(String).filter(Boolean);
      } catch (e) {}
      var m = raw.match(/rbpVRNr[A-Za-z0-9]+/g);
      return m || [];
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
          if (id) return { id: id, name: readName(el), reliable: true };
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
              return { id: els[j].getAttribute("data-cid"), name: name, reliable: false };
            }
          }
        }
      }
      return null;
    }

    // 名称反查命中的画布，其名称是否已在 seen 中由「不同 cid」占用 → 同名歧义。
    // 真实墨刀当前版本无激活 class/aria 标记，激活检测只能走名称反查；
    // 当项目存在同名画布时，反查结果可能是 DOM 中排序更靠前的同名项（cid 不同），
    // 若据此误判为“激活变化”去 touch，会凭空制造第二个同名标签（「设备导入」BUG）。
    function seenHasNameCollision(name, exceptId) {
      for (var id in seen) {
        if (id === exceptId) continue;
        if (seen[id] && seen[id].name === name) return true;
      }
      return false;
    }

    var lastActiveId = null;

    // 激活画布变化时置顶进标签栏（覆盖“进入文件默认打开的画布”）
    function syncActiveScreen() {
      var active = getActiveScreen();
      if (!active || !active.id) return false;
      if (active.id === lastActiveId) return false;
      // 歧义保护：名称反查(reliable=false)结果不可信，仅在“已有用户明确点击目标
      // (lastActiveId 已设)”且“未命中同名碰撞”时才允许据此更新；
      // 初始化阶段(lastActiveId=null)或命中同名不同 cid 时，绝不凭名称反查去 touch，
      // 避免制造重标签幻影（修复“设备导入”BUG）。
      if (!active.reliable && (!lastActiveId || seenHasNameCollision(active.name, active.id))) return false;
      lastActiveId = active.id;
      return touch(active.id, active.name);
    }

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
        if (!el) {
          // 画布已从左侧栏移除（可能已被删除）：清理失效标签，避免死标签占位误导用户（P3-2）
          if (seen[item.id]) { delete seen[item.id]; scheduleRender(); }
          if (typeof console !== "undefined" && console.warn) {
            console.warn("[modao-recent-tabs] 画布不存在，已清理失效标签: " + item.id);
          }
          return;
        }
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
        .map(function (id) { return { id: id, name: seen[id].name, ts: seen[id].ts }; });
      // 排序由 tabbar.setItems 统一负责（通用组件契约，演示页亦依赖）；
      // bar.items[0] 即排序后的“最近”项，作为默认激活（消除 core 层冗余排序，P2-2）。
      bar.setItems(list.map(function (it) {
        return { id: it.id, name: it.name, updatedAt: it.ts };
      }));
      bar.setBadge(bar.items.length ? "画布 " + bar.items.length : "画布");
      var stillActive = bar.activeId && bar.items.some(function (it) { return it.id === bar.activeId; });
      if (!stillActive) bar.setActive(bar.items.length ? bar.items[0].id : null);
    }

    var displayMode = "fixed";
    try { displayMode = localStorage.getItem(DMODE) || "fixed"; } catch (e) {}
    if (displayMode !== "float") displayMode = "fixed";

    var offsetStyle = null;
    var hotspot = null;
    var lastHb = -1;
    var contentEls = [];             // 已应用下推的区域容器集合（画布视口 + 左右面板）
    var contentBaseMap = null;      // WeakMap<el, number> 下推前基准高度(px)，用于收缩高度防底部溢出

    function persistDisplayMode() {
      try { localStorage.setItem(DMODE, displayMode); } catch (e) {}
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

    // 按当前工具栏高度刷新避让样式（标签栏 top / body padding / 浮动隐藏偏移 / 热点高度）。
    // 与 displayMode 解耦：工具栏高度变化（SPA 重渲染）时只调本函数，不打断浮动显隐状态。
    function updateOffset(hb) {
      var isFloat = displayMode === "float";
      bar.barEl.style.top = hb + "px";
      bar.barEl.style.setProperty("--md-hide-offset", hb + "px");
      if (!offsetStyle) {
        offsetStyle = document.createElement("style");
        offsetStyle.id = "md-recent-tabs-offset";
        document.head.appendChild(offsetStyle);
      }
      offsetStyle.textContent = isFloat
        ? (hb > 0 ? "body{padding-top:" + hb + "px !important;}" : "body{padding-top:0 !important;}")
        : (hb > 0 ? "body{padding-top:" + (TOPBAR_H + hb) + "px !important;}" : "body{padding-top:" + TOPBAR_H + "px !important;}");
      if (hotspot) hotspot.style.height = (hb > 0 ? hb : 8) + "px";
      applyContentOffset(hb); // A2：同步画布/侧栏区域容器下推避让
    }

    // 工具栏高度动态重测：hb 变化才刷新避让（幂等，供 2s 轮询与 MutationObserver 调用）。
    function refreshLayout() {
      var hb = detectHeaderBottom();
      if (hb === lastHb) return;
      lastHb = hb;
      updateOffset(hb);
    }

    function applyDisplayMode() {
      var hb = detectHeaderBottom();
      lastHb = hb;
      var isFloat = displayMode === "float";
      bar.barEl.classList.toggle("is-float", isFloat);
      bar.barEl.classList.remove("is-visible");
      bar.setPinned(!isFloat);
      updateOffset(hb);
      if (isFloat) {
        ensureHotspot();
      } else {
        removeHotspot();
      }
    }

    applyDisplayMode();

    // 检测墨刀顶部工具栏高度（标签栏避让基准，修复「遮挡工具栏」BUG）。
    // 真实墨刀工具栏由 styled-components 生成（如 div.styles__StyledTopBar-xxx），
    // CSS 属性选择器必须用 [class*='...' i]（大小写不敏感）才能命中 StyledTopBar；
    // 定位放宽到 fixed/sticky/absolute、仅取视口顶部 60px 内的横带、高度 16~160，
    // 取「顶部最高横带」的 bottom 作为工具栏高度 hb。
    function detectHeaderBottom() {
      var max = 0;
      var sels = [
        "header",
        "[class*='topbar' i]",
        "[class*='header' i]",
        "[class*='toolbar' i]",
        "[class*='navbar' i]"
      ];
      document.querySelectorAll(sels.join(",")).forEach(function (el) {
        var cs = getComputedStyle(el);
        var pos = cs.position;
        // 真实墨刀顶部工具栏为 styled-components 生成的 position:relative
        // （如 div.styles__StyledToolbar-sc-… GUIDE_TOOLBAR_COMMON，top:0 height:48），
        // 故必须接受 relative；但仍排除 static（左侧/右侧栏小标题为 static，会误抓）。
        if (pos !== "fixed" && pos !== "sticky" && pos !== "absolute" && pos !== "relative") return;
        // 不把自身标签栏 / 触发热点计入避让基准
        if (el.id === "md-recent-tabs-root" || (typeof el.className === "string" && /md-recent-tabs/.test(el.className))) return;
        var r = el.getBoundingClientRect();
        if (r.top > 60) return;        // 仅视口顶部区域，防误抓页面中部元素
        if (r.height < 16 || r.height > 160) return;
        if (r.width < 200) return;    // 仅视口顶部宽横带，排除工具栏内小图标
        max = Math.max(max, Math.round(r.bottom));
      });
      return max;
    }

    // A2（增强避让收尾，v1.0.6 扩展至左右面板）：把画布视口与各侧栏面板整体下推 TAB_H，
    // 使其始于标签栏之下。真实墨刀整体布局为「绝对定位 app 外壳 example-app(top:0) 内嵌：
    // relative 工具栏(0–48) + absolute 画布视口(.screen-container, top:48) + absolute 左右面板(top:48)」。
    // 标签栏 fixed 模式占据 48–92，会压住画布与侧栏内容顶部；因这些区域均由 absolute 定位、
    // body padding 推不动，故需对其本身做 margin-top 下推，而工具栏(0–48)在壳内、不受影响。
    // float 模式标签栏默认隐藏，无需下推。
    // 选型稳健性：墨刀使用 styled-components 哈希类名（版本间易变），故不依赖具体面板选择器，
    // 而是「在 app 外壳内、顶边贴近工具栏底部(hb±4)、且为 absolute/relative 定位、高度≥30」
    // 的区域容器全部下推（并去重只取最外层，避免画布内嵌 absolute 子元素被重复下推）。
    function findContentContainers(hb) {
      var shell = document.querySelector("[class*='example-app' i]") || document.querySelector(".app-shell");
      if (!shell) return [];
      var cands = [];
      var nodes = shell.querySelectorAll("*");
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (el.id === "md-recent-tabs-root") continue;
        if (typeof el.className === "string" && /md-recent-tabs/.test(el.className)) continue;
        var cs = getComputedStyle(el);
        if (cs.position !== "absolute" && cs.position !== "relative") continue;
        var r = el.getBoundingClientRect();
        // 按「基准顶边」判定：若本元素已被下推（带 marginTop），先扣回再比 hb，
        // 否则重刷时 live top=92≠hb 会漏选并清空下推（resize/换页后 hb 变化即塌陷）。
        var curMt = parseFloat(cs.marginTop);
        var baseTop = r.top - (isNaN(curMt) ? 0 : curMt);
        if (Math.abs(baseTop - hb) > 4) continue;     // 顶边贴近工具栏底部（基准位）
        if (r.height < 30) continue;                  // 排除小元素（图标/分隔条）
        cands.push(el);
      }
      // 去重：去掉「有祖先也在候选集」的元素，只推最外层区域容器
      var out = [];
      for (var j = 0; j < cands.length; j++) {
        var elj = cands[j], hasAnc = false, p = elj.parentElement;
        while (p) {
          if (cands.indexOf(p) !== -1) { hasAnc = true; break; }
          p = p.parentElement;
        }
        if (!hasAnc) out.push(elj);
      }
      return out;
    }

    function applyContentOffset(hb) {
      var isFloat = displayMode === "float";
      if (contentBaseMap == null) contentBaseMap = new WeakMap();
      var targets = isFloat ? [] : findContentContainers(hb);
      // 还原不再属于目标的元素（float 切换 / DOM 变化导致区域容器增减）
      for (var k = 0; k < contentEls.length; k++) {
        var old = contentEls[k];
        if (targets.indexOf(old) === -1) {
          old.style.marginTop = "";
          old.style.height = "";
        }
      }
      contentEls = targets.slice();
      for (var i = 0; i < targets.length; i++) {
        var el = targets[i];
        if (!contentBaseMap.has(el)) {
          var cs = getComputedStyle(el);
          var h = parseFloat(cs.height);
          contentBaseMap.set(el, (!isNaN(h) && h > 0) ? h : null);
        }
        var base = contentBaseMap.get(el);
        // 区域容器下推 TAB_H，使其始于标签栏之下（top:48 + 44 = 92）；
        // 收缩高度避免底部溢出视口。toolbar 在壳内 0–48 不受影响。
        el.style.marginTop = TOPBAR_H + "px";
        if (base != null) el.style.height = (base - TOPBAR_H) + "px";
      }
    }

    // 当前设计文件（cid）监听（SPA 鲁棒性）
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

    refreshCid();
    renderList();

    // 核心：点击左侧「画布」栏任意画布项 → 标记为最近并置顶进标签栏
    // 捕获阶段监听，不 preventDefault/stopPropagation，不影响墨刀自身交互。
    var clickHandler = function (e) {
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
    };
    document.addEventListener("click", clickHandler, true);

    // 兜底：左侧面板可能异步渲染、screen-history 可能延迟更新、SPA 路由可能变化
    var pollTimer = setInterval(function () {
      var changed = refreshCid();
      refreshLayout(); // 工具栏高度变化（SPA 重渲染/尺寸调整）时动态重测避让
      if (changed) scheduleRender();
    }, 2000);

    // 轻量 MutationObserver：左侧画布栏出现新节点时即时同步（比 2s 轮询更跟手）。
    // rAF 节流：编辑器 DOM 变动频繁，把同一帧内的多次变动合并为一次全文档扫描，避免卡顿。
    var mo = null;
    try {
      var moScheduled = false;
      mo = new MutationObserver(function () {
        if (moScheduled) return;
        moScheduled = true;
        requestAnimationFrame(function () {
          moScheduled = false;
          var changed = syncFromHistory() || syncActiveScreen();
          refreshLayout(); // 顶部工具栏 DOM 增删/结构变化 → 同步重测避让
          if (changed) scheduleRender();
        });
      });
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}

    // 来自设置页的消息（清除已关闭标签）：仅浏览器扩展侧启用
    if (enableMessageListener && typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
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

    var ctrl = {
      refresh: refreshCid,
      destroy: function () {
        try { if (mo) mo.disconnect(); } catch (e) {}
        if (pollTimer) clearInterval(pollTimer);
        if (clickHandler) document.removeEventListener("click", clickHandler, true);
        if (bar && typeof bar.destroy === "function") bar.destroy();
        removeHotspot();
        try { if (root.parentNode) root.parentNode.removeChild(root); } catch (e) {}
        if (offsetStyle && offsetStyle.parentNode) offsetStyle.parentNode.removeChild(offsetStyle);
        offsetStyle = null;
        for (var ci = 0; ci < contentEls.length; ci++) {
          contentEls[ci].style.marginTop = "";
          contentEls[ci].style.height = "";
        }
        contentEls = [];
        contentBaseMap = null;
        __instance = null; // 允许后续重新 create（P2-3）
      }
    };
    __instance = ctrl;
    return ctrl;
  }

  global.MDRecentTabs = { create: createRecentTabs };
})(typeof window !== "undefined" ? window : this);
