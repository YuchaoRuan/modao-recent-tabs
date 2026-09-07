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
    var POS_KEY = "md_tabbar_position";
    var TOPBAR_H = 44;

    // 左侧画布项的 DOM 形态不止一种：运行端探针（sniffer-canvas-item.js）确认
    // 同时存在 div.rn-list-item[data-cid] 与 li.rn-content-item[data-cid] 两种形态，
    // 只认其中一种会在另一种渲染状态下「查不到」，被误判为画布已删除。
    var CANVAS_BASE_SELECTORS = ["div.rn-list-item", "li.rn-content-item"];
    var CANVAS_ITEM_SELECTOR = CANVAS_BASE_SELECTORS
      .map(function (s) { return s + "[data-cid]"; })
      .join(", ");

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
      var els = document.querySelectorAll(CANVAS_ITEM_SELECTOR);
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
        var el = findCanvasEl(id);
        if (el) name = readName(el);
      }
      if (!name) return false;
      seen[id] = { id: id, name: name, ts: Date.now() };
      setStale(id, false);
      return true;
    }

    // 定位左侧画布项 DOM：遍历所有已知形态，找不到返回 null。
    // 注意：找不到 **不等于** 画布被删除 —— 左侧栏可能是虚拟滚动（未进入视口不渲染）、
    // 文件夹折叠，或正处于 SPA 重绘瞬间。调用方必须按「暂时不可见」处理（见 onSwitch）。
    function findCanvasEl(id) {
      if (!id) return null;
      var esc = (typeof CSS !== "undefined" && CSS.escape) ? CSS.escape(id) : id;
      for (var i = 0; i < CANVAS_BASE_SELECTORS.length; i++) {
        var el = document.querySelector(CANVAS_BASE_SELECTORS[i] + '[data-cid="' + esc + '"]');
        if (el) return el;
      }
      return null;
    }

    // 找到左侧画布栏的可滚动容器（虚拟化长列表的滚动宿主），用于把目标画布滚入渲染窗口。
    function getCanvasScrollContainer() {
      var el = document.querySelector(CANVAS_ITEM_SELECTOR);
      while (el && el !== document.body && el !== document.documentElement) {
        var oy = getComputedStyle(el).overflowY;
        if ((oy === "auto" || oy === "scroll") && el.scrollHeight - el.clientHeight > 8) return el;
        el = el.parentElement;
      }
      return null;
    }

    // 待定（stale）标记：画布暂时定位不到时置位，仅视觉提示，不删标签。
    function setStale(id, stale) {
      if (bar && typeof bar.setStale === "function") bar.setStale(id, !!stale);
    }

    // 轮询/观察时复核待定标签：画布项一旦重新出现在 DOM 中立即取消待定。
    function revalidateStale() {
      if (!bar || !bar.staleIds) return false;
      var changed = false;
      Object.keys(bar.staleIds).forEach(function (id) {
        if (bar.staleIds[id] && findCanvasEl(id)) {
          bar.setStale(id, false);
          changed = true;
        }
      });
      return changed;
    }

    // 滚动扫描左侧画布栏，把目标画布滚进虚拟列表的渲染窗口后重新定位。
    // 仅作尽力而为的补救：找不到时回调 (null)，并会把滚动位置还原，不打扰用户。
    var revealToken = 0;
    var revealTimer = null;
    var REVEAL_MAX_STEPS = 24;
    var REVEAL_STEP_MS = 24;

    function revealCanvasEl(id, callback) {
      var token = ++revealToken;
      var sc = getCanvasScrollContainer();
      if (!sc) { callback(null, false); return; }
      var start = sc.scrollTop;
      var maxTop = Math.max(0, sc.scrollHeight - sc.clientHeight);
      var step = Math.max(120, Math.floor(sc.clientHeight * 0.75));
      // 候选位置过密时按上限重新等分，保证总步数可控（含末尾的 maxTop 一档）。
      if (maxTop > step * (REVEAL_MAX_STEPS - 1)) {
        step = Math.ceil(maxTop / (REVEAL_MAX_STEPS - 1));
      }
      // 位置序列必须**预计算并显式补上 maxTop**：
      // 旧实现在滚动前判定 `pos > maxTop`，而 pos 按 step 前进，
      // 最后一个可达位置 maxTop 从未被真正访问 → 列表末尾（最后一屏）
      // 的行在整个扫描过程中从未被渲染，findCanvasEl 恒为 null。
      var positions = [];
      for (var p = 0; p < maxTop; p += step) positions.push(p);
      if (positions.length === 0 || positions[positions.length - 1] !== maxTop) positions.push(maxTop);
      var idx = 0;
      function attempt() {
        if (token !== revealToken) { callback(null, true); return; }   // 已被新的切换请求取消
        var el = findCanvasEl(id);
        if (el) { callback(el, false); return; }
        if (idx >= positions.length) {
          try { sc.scrollTop = start; } catch (e) {}   // 未找到：还原用户原本的滚动位置
          callback(null, false);
          return;
        }
        try { sc.scrollTop = positions[idx]; } catch (e) {}
        idx++;
        revealTimer = setTimeout(attempt, REVEAL_STEP_MS);   // 虚拟列表重渲染需要一两帧
      }
      try { sc.scrollTop = positions[0]; } catch (e) {}
      idx = 1;
      revealTimer = setTimeout(attempt, REVEAL_STEP_MS);
    }

    // 真正执行切换：标记最近、滚动到可见、模拟点击左侧画布项、同步激活态
    function activateCanvas(id, name, el) {
      setStale(id, false);
      touch(id, name);
      scheduleRender();
      try { el.scrollIntoView({ block: "nearest" }); } catch (e) {}
      try { el.click(); } catch (e) {}   // 模拟点击左侧画布项 → 墨刀内部切换
      bar.setActive(id);
    }

    // 定位失败：给出可见反馈，绝不静默删除标签
    function notifyUnreachable(name) {
      var msg = "未找到画布「" + name + "」，请先在左侧画布栏展开或滚动到它，再点击标签切换";
      if (typeof console !== "undefined" && console.warn) {
        console.warn("[modao-recent-tabs] " + msg);
      }
      if (bar && typeof bar.toast === "function") bar.toast(msg, "warn");
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
    // 激活态选择器按「状态后缀 × 画布项形态」展开（保持原状态优先级在前）：
    // 画布项存在 div.rn-list-item 与 li.rn-content-item 两种形态，只认一种会漏检。
    var ACTIVE_STATE_SUFFIXES = [
      ".is-active",
      ".is-selected",
      ".selected",
      ".current",
      "[aria-selected='true']"
    ];
    var ACTIVE_SELECTORS = (function () {
      var out = [];
      for (var s = 0; s < ACTIVE_STATE_SUFFIXES.length; s++) {
        for (var b = 0; b < CANVAS_BASE_SELECTORS.length; b++) {
          out.push(CANVAS_BASE_SELECTORS[b] + "[data-cid]" + ACTIVE_STATE_SUFFIXES[s]);
        }
      }
      return out;
    })();

    function getActiveScreen() {
      for (var i = 0; i < ACTIVE_SELECTORS.length; i++) {
        var el = document.querySelector(ACTIVE_SELECTORS[i]);
        if (el) {
          var id = el.getAttribute("data-cid");
          if (id) return { id: id, name: readName(el), reliable: true };
        }
      }
      var titleEl = document.querySelector(".canvas-title");
      if (titleEl) {
        var name = readName(titleEl);
        if (name) {
          var els = document.querySelectorAll(CANVAS_ITEM_SELECTOR);
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
      showPositionToggle: true,   // 桌面端即时切换标签栏位置（写 localStorage + 重排）
      onSwitch: function (item) {
        if (!item || !item.id) return;
        var id = item.id;
        // 任何一次新的切换请求都必须先让「在飞的滚动扫描」失效。
        // 必须无条件放在这里（而不是只在 revealCanvasEl 内部递增）：若本次立即命中
        // 并走 `activateCanvas` 提前 return，就不会进入 revealCanvasEl，
        // 上一次的扫描会继续跑完并回调 activateCanvas(旧 id)，把画布切回先点的那个
        // （连点竞态：点 A 需扫描 → 立刻点 B → 结果被 A 覆盖）。
        revealToken++;
        var el = findCanvasEl(id);
        if (el) { activateCanvas(id, item.name, el); return; }
        // 画布项当前不在左侧栏 DOM：可能是虚拟滚动未渲染 / 文件夹折叠 / SPA 重建，
        // 这**不是**「画布已删除」的充分证据。旧逻辑在此直接 delete seen + return，
        // 会同时造成「标签消失」与「不切换」两个症状；改为：
        //   1) 先滚动扫描整列尽力定位（虚拟滚动场景可救回）；
        //   2) 期间把标签标记为「待定」，不删除；
        //   3) 仍定位不到则给出可见提示，标签保留、等用户手动 × 关闭。
        setStale(id, true);
        scheduleRender();
        revealCanvasEl(id, function (found, canceled) {
          if (canceled) return;                                  // 已被新的切换请求取代
          if (found) { activateCanvas(id, item.name, found); return; }
          notifyUnreachable(item.name || id);
        });
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
      },
      onTogglePosition: function () {
        // 即时切换标签栏位置：写 localStorage + chrome.storage（跨域可靠来源）+ 立即重排
        positionMode = positionMode === "above" ? "below" : "above";
        try { localStorage.setItem(POS_KEY, positionMode); } catch (e) {}
        try {
          if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ tabbarPosition: positionMode });
          }
        } catch (e) {}
        applyDisplayMode();   // 立即重排：bar.top / 工具栏下沉 / 内容下推 全部刷新
        bar.setPosition(positionMode);
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

    var positionMode = "below";
    try { positionMode = localStorage.getItem(POS_KEY) || "below"; } catch (e) {}
    if (positionMode !== "above") positionMode = "below";

    var offsetStyle = null;
    var hotspot = null;
    var lastHb = -1;
    var contentEls = [];             // 已应用下推的区域容器集合（画布视口 + 左右面板）
    var contentBaseMap = null;      // WeakMap<el, number> 下推前基准高度(px)，用于收缩高度防底部溢出
    var toolbarEl = null;           // 被下沉的墨刀默认工具栏元素（above+fixed 模式），destroy 时复位 marginTop

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
    function updateOffset(ti) {
      var isFloat = displayMode === "float";
      var isAbove = positionMode === "above";
      // above 时标签栏贴顶(top:0)、隐藏偏移为 0；below 置于工具栏「自然底边」之下。
      // 必须用 naturalBottom 而非 live hb：above→below 切换瞬间工具栏仍带 44px 下沉(marginTop)，
      // 此时 live hb=92，若据此定位会把 bar 放到 92px（压住未及还原的工具栏）；
      // naturalBottom 恒为下沉前的 48，使 bar 正确回到工具栏自然底边、切换不跳变。
      bar.barEl.style.top = isAbove ? "0px" : ti.naturalBottom + "px";
      bar.barEl.style.setProperty("--md-hide-offset", isAbove ? "0px" : ti.naturalBottom + "px");
      // 工具栏下沉用 marginTop（非 body padding），不触发反馈环；仅 above+fixed 下沉，below 与 above+float 清除
      if (ti.el) {
        toolbarEl = ti.el;
        ti.el.style.marginTop = (isAbove && !isFloat) ? (TOPBAR_H + "px") : "";
      }
      if (!offsetStyle) {
        offsetStyle = document.createElement("style");
        offsetStyle.id = "md-recent-tabs-offset";
        document.head.appendChild(offsetStyle);
      }
      // 顶部总占用：浮动模式仅工具栏(hb)；固定模式 bar(44)+工具栏自然高(48)=92（above/below 相同）
      var reserved = isFloat ? ti.hb : (TOPBAR_H + ti.naturalBottom);
      offsetStyle.textContent = "body{padding-top:" + reserved + "px !important;}";
      if (hotspot) hotspot.style.height = (ti.hb > 0 ? ti.hb : 8) + "px";
      applyContentOffset(ti); // A2：同步画布/侧栏区域容器下推避让
    }

    // 工具栏高度动态重测：hb 变化才刷新避让（幂等，供 2s 轮询与 MutationObserver 调用）。
    function refreshLayout() {
      var ti = getToolbarInfo();
      if (ti.hb === lastHb) return;   // above 下沉后 hb 恒 92 → 幂等；内容命中走 naturalBottom，不塌陷
      lastHb = ti.hb;
      updateOffset(ti);
    }

    function applyDisplayMode() {
      var ti = getToolbarInfo();
      lastHb = ti.hb;
      var isFloat = displayMode === "float";
      bar.barEl.classList.toggle("is-float", isFloat);
      bar.barEl.classList.remove("is-visible");
      bar.setPinned(!isFloat);
      updateOffset(ti);
      if (isFloat) {
        ensureHotspot();
      } else {
        removeHotspot();
      }
    }

    applyDisplayMode();
    bar.setPosition(positionMode);   // 同步位置切换按钮初始状态
    // 检测墨刀顶部工具栏高度（标签栏避让基准，修复「遮挡工具栏」BUG）。
    // 真实墨刀工具栏由 styled-components 生成（如 div.styles__StyledTopBar-xxx），
    // CSS 属性选择器必须用 [class*='...' i]（大小写不敏感）才能命中 StyledTopBar；
    // 定位放宽到 fixed/sticky/absolute、仅取视口顶部 60px 内的横带、高度 16~160，
    // 取「顶部最高横带」的 bottom 作为工具栏高度 hb。
    // 返回工具栏元素 + 实时底边(hb) + 自然底边(naturalBottom=实时底边-自身marginTop)。
    // naturalBottom 是内容命中的稳定基准：above 固定模式把工具栏下沉 44 后 hb 变 92，
    // 但 naturalBottom 恒为下沉前的 48，避免 findContentContainers 误用实时 hb 导致塌陷（R1/R5）。
    function getToolbarInfo() {
      var best = null, bestBottom = 0;
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
        var b = Math.round(r.bottom);
        if (b > bestBottom) { bestBottom = b; best = el; }
      });
      if (!best) return { el: null, hb: 0, naturalBottom: 0 };
      var cs = getComputedStyle(best);
      var mt = parseFloat(cs.marginTop);
      var naturalBottom = bestBottom - (isNaN(mt) ? 0 : mt);
      return { el: best, hb: bestBottom, naturalBottom: naturalBottom };
    }
    function detectHeaderBottom() { return getToolbarInfo().hb; }

    // A2（增强避让收尾，v1.0.6 扩展至左右面板）：把画布视口与各侧栏面板整体下推 TAB_H，
    // 使其始于标签栏之下。真实墨刀整体布局为「绝对定位 app 外壳 example-app(top:0) 内嵌：
    // relative 工具栏(0–48) + absolute 画布视口(.screen-container, top:48) + absolute 左右面板(top:48)」。
    // 标签栏 fixed 模式占据 48–92，会压住画布与侧栏内容顶部；因这些区域均由 absolute 定位、
    // body padding 推不动，故需对其本身做 margin-top 下推，而工具栏(0–48)在壳内、不受影响。
    // float 模式标签栏默认隐藏，无需下推。
    // 选型稳健性：墨刀使用 styled-components 哈希类名（版本间易变），故不依赖具体面板选择器，
    // 而是「在 app 外壳内、顶边贴近工具栏底部(hb±4)、且为 absolute/relative 定位、高度≥30」
    // 的区域容器全部下推（并去重只取最外层，避免画布内嵌 absolute 子元素被重复下推）。
    function findContentContainers(threshold) {
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
        if (Math.abs(baseTop - threshold) > 4) continue;     // 顶边贴近工具栏自然底边(48)，above/below 通用
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

    function applyContentOffset(ti) {
      var isFloat = displayMode === "float";
      if (contentBaseMap == null) contentBaseMap = new WeakMap();
      // 仅固定模式才下推内容（above+float 退化为 below+float：工具栏不下沉、内容不下推）
      var pushContent = !isFloat;
      var targets = pushContent ? findContentContainers(ti.naturalBottom) : [];
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
      var item = t.closest(CANVAS_ITEM_SELECTOR);
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
      if (revalidateStale()) changed = true;   // 画布项重新出现 → 取消待定标记
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
          if (revalidateStale()) changed = true;   // 左侧栏重绘后画布项可能已重新出现
          if (changed) scheduleRender();
        });
      });
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}

    // 来自设置页的消息（清除已关闭标签）：仅浏览器扩展侧启用
    if (enableMessageListener && typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
        if (msg && msg.type === "MD_SET_TABBAR_POSITION") {
          var p = (msg.position === "above") ? "above" : "below";
          try { localStorage.setItem(POS_KEY, p); } catch (e) {}
          positionMode = p;
          applyDisplayMode();   // 立即重排：bar.top / 工具栏下沉 / 内容下推 全部刷新
          bar.setPosition(p);   // 同步位置切换按钮状态
          if (typeof sendResponse === "function") sendResponse({ ok: true, position: p });
          return false;
        }
        if (msg && msg.type === "MD_GET_TABBAR_POSITION") {
          if (typeof sendResponse === "function") sendResponse({ ok: true, position: positionMode });
          return false;
        }
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

    // 位置偏好：以 chrome.storage.local 为跨域可靠来源（选项页与内容脚本同源共享）。
    // 选项页写入 storage，内容脚本经 storage.onChanged 实时套用，不再依赖一次性消息投递是否成功。
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
      function applyPositionFromStorage(newValue) {
        if (newValue == null) return;
        var p = (newValue === "above") ? "above" : "below";
        try { localStorage.setItem(POS_KEY, p); } catch (e) {}
        positionMode = p;
        applyDisplayMode();   // 立即重排：bar.top / 工具栏下沉 / 内容下推 全部刷新
        bar.setPosition(p);   // 同步位置切换按钮状态
      }
      try {
        chrome.storage.local.get(["tabbarPosition"], function (s) {
          if (s && s.tabbarPosition) applyPositionFromStorage(s.tabbarPosition);
        });
      } catch (e) {}
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== "local") return;
        if (changes.tabbarPosition) applyPositionFromStorage(changes.tabbarPosition.newValue);
      });
    }

    var ctrl = {
      refresh: refreshCid,
      destroy: function () {
        try { if (mo) mo.disconnect(); } catch (e) {}
        if (pollTimer) clearInterval(pollTimer);
        if (revealTimer) { clearTimeout(revealTimer); revealTimer = null; }
        revealToken++;   // 使进行中的扫描回调失效
        // 待执行的重渲染也要清掉：否则销毁后仍会对已脱离文档树的旧 bar 跑一次 renderList()
        if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
        if (clickHandler) document.removeEventListener("click", clickHandler, true);
        if (bar && typeof bar.destroy === "function") bar.destroy();
        removeHotspot();
        try { if (root.parentNode) root.parentNode.removeChild(root); } catch (e) {}
        if (offsetStyle && offsetStyle.parentNode) offsetStyle.parentNode.removeChild(offsetStyle);
        offsetStyle = null;
        if (toolbarEl) { toolbarEl.style.marginTop = ""; toolbarEl = null; }
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
