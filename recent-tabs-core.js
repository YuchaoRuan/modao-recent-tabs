/* =========================================================================
 * v1.0.17 画布识别收窄：墨刀 v22.18 起左栏为「页面 / 画布 / 图层」三面板，
 *         三者**共用**通用树组件类名 div.rn-list-item / li.rn-content-item
 *         （且 layer-item 在画布与图层面板都会出现，带 data-cid 的页面项
 *         div.rn-list-item.page 同样存在），旧版仅按 `[data-cid]` 匹配会把
 *         点「页面」「图层」也当成画布 → 顶部「最近画布」凭空长出无效标签。
 *         改为**按容器锚点判定**（isCanvasPanelItem）。判据最终定为「**只做排除**」：
 *         建标签条件 = 命中通用树项 **且不在**「页面 / 图层 / 状态页 / 交互树」容器内。
 *         不再要求「必须命中画布面板白名单」——白名单把"画布项长什么样"硬编码成容器
 *         id，一旦墨刀改版/挂载时机不同，真正的画布点击会被一起拒掉（真机实测：
 *         「点画布不长标签」），比原 BUG 更严重；黑名单失效最坏只退回 1.0.16 的宽松
 *         行为（点页面/图层也建标签），且能被真机自检脚本立刻发现。
 *         影响面：getScreenMap / findCanvasEl / getActiveScreen / 点击建标签入口。
 *         性能：左侧「页面」面板常驻 4400+ 节点，逐项 closest 代价高，改为
 *         「先取黑名单容器再 contains 判归属」，并去掉了会产生重复回调的嵌套扫描。
 *         另修：进入文件带出当前画板（种子窗口 15s + 只用唯一名称反查）、
 *         时间戳严格递增（同毫秒 touch 不再让"最近"排序退化）。
 * v1.0.16 浮动模式不再注入覆盖工具栏的热区 div：该热区铺满墨刀顶部工具栏
 *         （高=工具栏高48、z-index 仅次标签栏），既导致鼠标移到工具栏就误弹
 *         标签栏，也直接截获工具栏点击（「工具栏点不动」根因）。改为窗口最
 *         顶部 4px 边缘触发（document mousemove 判定），不插入任何 DOM；
 * v1.0.15 取消「工具栏上方/下方」位置切换：标签栏固定显示在墨刀工具栏上方
 *         （always above），固定/浮动图钉切换保持不变；
 * v1.0.14 切换成功后不再自动恢复原检索词（搜索框保持空态 = 全量列表）；
 * v1.0.13 自动重定位：优先用左侧搜索框清空/按名检索把目标带回 DOM，
 *         彻底失败才走 v1.0.12 的滚动扫描 + 不可达提示兜底链（见 locateCanvas）。
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
    // 版本号会写到 #md-recent-tabs-root[data-md-version]，便于真机在 Console 直接
    // 核对当前加载的是哪一版（排查「改了没生效」类问题时先看这个）。
    var MD_VERSION = "1.0.17";

    // 左侧画布项的 DOM 形态不止一种：运行端探针（sniffer-canvas-item.js）确认
    // 同时存在 div.rn-list-item[data-cid] 与 li.rn-content-item[data-cid] 两种形态，
    // 只认其中一种会在另一种渲染状态下「查不到」，被误判为画布已删除。
    var CANVAS_BASE_SELECTORS = ["div.rn-list-item", "li.rn-content-item"];
    var CANVAS_ITEM_SELECTOR = CANVAS_BASE_SELECTORS
      .map(function (s) { return s + "[data-cid]"; })
      .join(", ");

    // ---- 面板锚点（v1.0.17）：「画布 / 页面 / 图层」三个左栏列表 ------------------
    // 真机取证 + 用户界面核对（2026-09-14，墨刀 v22.18.18-op22603.1）：
    //   左栏**上部**那列，界面标题写着「画布」，容器 = #screen-scroll-list
    //     （内部把这种实体叫 screen / 类名带 page，但**界面文案就是「画布」**）；
    //     条目名不带序号，如「登机牌解析流程」；.canvas-title 与它同名；
    //     localStorage 的 screen-history-onLeave-project-<cid> 记的也是它的 id。
    //      → 这一列**才是**「最近画布」要跟踪的对象。
    //   左栏**下部**面板的「页面」标签，容器 = #mb-enabled-canvas-list
    //     （内部实体类型是 Canvas，条目名带序号，如「1 登机牌解析流程」）；
    //   左栏下部面板的「图层」标签，容器 = #layer-scroll-list / #mb-enabled-layer-list。
    //      → 这两列都**不得**建标签。
    // 三个列表共用同一套通用树组件类名（li.rn-content-item / div.rn-list-item，
    // layer-item 在两列里都会出现），无法用 class 区分，只能按容器祖先判定。
    // 白名单（诊断用）：命中任一祖先 → 该项属于「画布」列。
    var CANVAS_PANEL_SELECTORS = [
      "#screen-scroll-list",
      "#screen_list",
      ".screen-list-container",
      "#mobile-screen-tree"
    ];
    // 黑名单：命中任一祖先 → **一定不是**画布项。
    // 覆盖下部「页面」列（#mb-enabled-canvas-list 等）、「图层」列、状态页与交互树。
    // 注意：**不能**把页面树自身的容器（#mobile-page-item / ul.child-screens 等）放进
    // 黑名单 —— 上部「画布」列的条目正是它们的子节点。
    var NON_CANVAS_PANEL_SELECTORS = [
      // —— 下部「页面」列（画板列表，条目名带序号）——
      "#mb-enabled-canvas-list",
      "#canvas-scroll-list",
      ".canvas-scroll-list",
      ".canvas-sortable-list",
      // —— 下部「图层」列（widget 树）——
      "#mb-enabled-layer-list",
      "#layer-scroll-list",
      ".layer-scroll-list",
      ".layer-sortable-list",
      ".mb-layer-panel",
      // —— 状态页 / 交互树 ——
      "#mb-state-list",
      "#interaction-tree-container",
      "#interaction-tree-list"
    ];
    // 严格模式判定锚点：任一左栏列表存在 → 判定为墨刀设计页（旧版/简化 DOM 时走兼容降级）
    var STRICT_PANEL_SELECTORS = [
      "#screen-scroll-list",
      "#mb-enabled-canvas-list",
      "#canvas-scroll-list",
      ".canvas-scroll-list",
      "#mb-enabled-layer-list",
      "#layer-scroll-list",
      ".layer-scroll-list"
    ];

    // 元素（或其任一祖先）是否命中给定锚点选择器集合。
    function matchAncestor(el, selectors) {
      if (!el || typeof el.closest !== "function") return false;
      for (var i = 0; i < selectors.length; i++) {
        try { if (el.closest(selectors[i])) return true; } catch (e) {}
      }
      return false;
    }

    // 是否检测到新版「三面板」左栏。nav 在画布/图层间互斥切换会让面板容器
    // 随时增删，故**每次实时计算**，不缓存为一次性常量。
    function hasPanelLayout() {
      for (var i = 0; i < STRICT_PANEL_SELECTORS.length; i++) {
        try { if (document.querySelector(STRICT_PANEL_SELECTORS[i])) return true; } catch (e) {}
      }
      return false;
    }

    // 画布项判定：**只做排除**（黑名单），不再要求「必须命中画布面板白名单」。
    // 教训（2026-09-11 真机回归）：白名单把「画布项长什么样」硬编码成了容器 id，
    // 只要墨刀的画布面板容器与取证版本不完全一致（改版 / 另一套布局 / 挂载时机），
    // 真正的画布点击会被一起拒绝 —— 用户实测「点画布不长标签」，退化比原 BUG 更严重。
    // 而 1.0.16 之所以可用，正是因为它只做「点谁都能建标签」。故本版取两者之长：
    //   建标签条件 = 命中通用树项 **且不在** 页面 / 图层 / 状态页 / 交互树内。
    // 不对称风险取舍：白名单失效=画布点击被拒（用户不可用）；黑名单失效=退回 1.0.16
    // 的宽松行为（点页面/图层也建标签，可由真机自检脚本立刻发现）——后者可接受。
    // strict 参数保留仅为兼容既有调用点，判定不再依赖它。
    function isCanvasPanelItem(el, strict) {
      if (!el) return false;
      return !matchAncestor(el, NON_CANVAS_PANEL_SELECTORS);
    }

    // 收集当前文档里真实存在的面板容器（nav 在画布/图层间互斥切换会让容器增删，
    // 故每次实时计算，不缓存为一次性常量）。
    function collectPanels(selectors) {
      var out = [];
      for (var i = 0; i < selectors.length; i++) {
        try {
          var els = document.querySelectorAll(selectors[i]);
          for (var j = 0; j < els.length; j++) {
            if (out.indexOf(els[j]) < 0) out.push(els[j]);
          }
        } catch (e) {}
      }
      return out;
    }

    // 当前面板快照：canvas=画布面板容器，non=非画布面板容器（页面/图层/状态/交互树）
    function currentPanels() {
      return {
        canvas: collectPanels(CANVAS_PANEL_SELECTORS),
        non: collectPanels(NON_CANVAS_PANEL_SELECTORS)
      };
    }

    // el（或其祖先）是否落在给定容器集合内
    function insideAny(el, containers) {
      if (!el) return false;
      for (var i = 0; i < containers.length; i++) {
        if (containers[i] === el || containers[i].contains(el)) return true;
      }
      return false;
    }

    // 遍历「非页面 / 非图层」面板里的画布项（已跳过 folder）。
    // 与 isCanvasPanelItem 同一判据（只排除黑名单容器），保证批量扫描与点击判定一致。
    // 性能：真机「页面」面板常驻 4400+ 节点，逐项做 closest 祖先匹配代价高，这里改成
    // 「先取出黑名单容器，再用 contains 判归属」（含 4400 项的页面面板只需第 1 次
    // contains 即命中排除），且只做一次 querySelectorAll 取项，不产生重复回调。
    function eachCanvasItem(fn, panels) {
      var p = panels || currentPanels();
      var els = document.querySelectorAll(CANVAS_ITEM_SELECTOR);
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el.classList && el.classList.contains("folder")) continue;
        if (insideAny(el, p.non)) continue;   // 页面 / 图层 / 状态页 / 交互树 → 排除
        fn(el);
      }
    }

    // 第一个可作滚动作业的树项（跳过文件夹与非画布面板）。用于定位滚动宿主；
    // 取不到画布项时退回任意树项，保证「滚动扫描兜底」仍尽力而为
    // （滚动本身不会建标签，findCanvasEl 仍按面板判定，不会误点到图层/页面项）。
    function firstCanvasItem(panels) {
      var found = null;
      eachCanvasItem(function (el) { if (!found) found = el; }, panels);
      return found || document.querySelector(CANVAS_ITEM_SELECTOR);
    }

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
    // v1.0.17：只收「画布」面板的项（页面 / 图层 / 状态 / 交互树一律排除），
    // 否则点页面、点图层都会在顶部标签栏凭空生成无效标签。
    function getScreenMap() {
      var map = {};
      eachCanvasItem(function (el) {
        var id = el.getAttribute("data-cid");
        var name = readName(el);
        if (id && name && !(id in map)) map[id] = name;
      });
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
      // 时间戳必须**严格大于**当前所有标签：Date.now() 只有毫秒精度，
      // 同一毫秒内连续两次 touch（或 touch 与 syncFromHistory 的 base 撞车）会让
      // ts 相同 → tabbar 排序退化为插入顺序，「刚点/刚带出的那个」不一定排到最前
      // （真机/探针 2026-09-11 实测：O1 带出后仍排在 O2 之后）。
      var ts = Date.now(), k;
      for (k in seen) { if (seen[k] && seen[k].ts >= ts) ts = seen[k].ts + 1; }
      seen[id] = { id: id, name: name, ts: ts };
      setStale(id, false);
      return true;
    }

    // 定位左侧画布项 DOM：遍历所有已知形态，找不到返回 null。
    // 注意：找不到 **不等于** 画布被删除 —— 左侧栏可能是虚拟滚动（未进入视口不渲染）、
    // 文件夹折叠，或正处于 SPA 重绘瞬间。调用方必须按「暂时不可见」处理（见 onSwitch）。
    // v1.0.17：同名形态在「页面 / 画布 / 图层」面板里可能同时存在，必须按面板锚点
    // 过滤，否则点标签会点到页面或图层里的同名节点（切错 / 建无效标签）。
    function findCanvasEl(id) {
      if (!id) return null;
      var esc = (typeof CSS !== "undefined" && CSS.escape) ? CSS.escape(id) : id;
      var p = currentPanels();
      for (var i = 0; i < CANVAS_BASE_SELECTORS.length; i++) {
        var els = document.querySelectorAll(CANVAS_BASE_SELECTORS[i] + '[data-cid="' + esc + '"]');
        for (var j = 0; j < els.length; j++) {
          // 与 isCanvasPanelItem 同判据：只排除页面 / 图层 / 状态页 / 交互树内的同名项
          if (!insideAny(els[j], p.non)) return els[j];
        }
      }
      return null;
    }

    // 找到左侧画布栏的可滚动容器（虚拟化长列表的滚动宿主），用于把目标画布滚入渲染窗口。
    function getCanvasScrollContainer() {
      var el = firstCanvasItem(currentPanels());
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

    // 搜索定位（v1.0.13）：轮询预算 / 间隔，以及在飞句柄（destroy 时取消）。
    var LOCATE_TIMEOUT_MS = 2000;
    var LOCATE_STEP_MS = 90;
    var locateHandle = null;

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

    // 以 React 兼容方式写入左侧搜索框并触发墨刀内部重渲染：
    // 墨刀搜索框是受控 input，直接 box.value= 不会更新其内部状态；必须用
    // HTMLInputElement.prototype 上的原生 value setter 写值，再派发 input/change
    // （bubbles）事件让 React onChange 触发列表过滤。整段 try/catch 容错，
    // 在普通 DOM（非 React）环境同样可用。
    function setSearchValue(box, v) {
      var val = v == null ? "" : String(v);
      try {
        var desc = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement ? HTMLInputElement.prototype : null, "value"
        );
        if (desc && desc.set) desc.set.call(box, val);
        else box.value = val;
      } catch (e) {
        try { box.value = val; } catch (e2) {}
      }
      try {
        box.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
        box.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
      } catch (e) {}
    }

    // 探测墨刀左侧「画布搜索框」（真机取证 2026-09-07）：
    //   <input placeholder="关键字搜索…" class=""> 位于左侧栏顶部、视口 300px 内。
    // 条件放宽到「placeholder 含 搜索/查找/检索」+ 视口顶部 300px 内 + 宽度 > 40px，
    // 避免命中页面其它角落的小输入框；找不到返回 null（走原路径，不改旧行为）。
    function findScreenSearchBox() {
      var inputs = document.querySelectorAll("input");
      for (var i = 0; i < inputs.length; i++) {
        var box = inputs[i];
        var ph = box.getAttribute ? (box.getAttribute("placeholder") || "") : "";
        if (!/搜索|查找|检索/.test(ph)) continue;
        try {
          var r = box.getBoundingClientRect();
          if (r.width <= 40) continue;     // 太窄不可能是左侧栏搜索框
          if (r.top >= 300) continue;      // 仅认视口顶部 300px 内的搜索框
        } catch (e) {
          continue;
        }
        return box;
      }
      return null;
    }

    // 轮询 findCanvasEl(id)：命中即 cb(el)，预算耗尽 cb(null)。内部捕获启动时的
    // revealToken —— 期间一旦被新的切换请求递增（连点竞态）即静默放弃，不再回调、
    // 也不再调度下一次；返回 { cancel } 供 destroy / 新一轮定位清理在飞轮询。
    function pollFind(id, timeoutMs, stepMs, cb) {
      var token = revealToken;
      var deadline = Date.now() + timeoutMs;
      var timer = null;
      var stopped = false;
      function cancel() {
        stopped = true;
        if (timer) { clearTimeout(timer); timer = null; }
      }
      function attempt() {
        timer = null;
        if (stopped || token !== revealToken) return;   // 被取消 / 被新切换取代
        var el = findCanvasEl(id);
        if (el) { cb(el); return; }
        if (Date.now() >= deadline) { cb(null); return; }
        timer = setTimeout(attempt, stepMs);
      }
      timer = setTimeout(attempt, stepMs);
      return { cancel: cancel };
    }

    // v1.0.13 自动重定位：在 onSwitch 未命中分支、revealCanvasEl 滚动扫描**之前**
    // 调用。真机取证结论：真实墨刀设计页左侧列表**全量渲染**，真正「找不到」的根因
    // 是左侧搜索框处于过滤态（非命中画布被移出 DOM）；故优先把搜索框当作定位工具：
    //   情形一  搜索框有词 → 先清空恢复全量列表，轮询目标是否回到 DOM；
    //   情形二  仍找不到（或搜索框本就为空）→ 把目标名写入搜索框触发墨刀检索
    //           （跨文件夹命中），命中即切换；
    //   切换成功 → 搜索框保持空态（全量列表），**不再自动恢复**原检索词
    //           （需求调整 2026-09-07：恢复原词会让列表立刻回到过滤态，
    //            刚打开的画布若不含该词随即移出视口，用户会误以为没切过去）；
    //   全部失败 → 还原搜索现场后调 fail()（= 滚动扫描 + 不可达提示，v1.0.12 语义）。
    // 仅当「探测到搜索框」才进入；探测不到的环境（历史夹具 / 墨刀改版）直接 fail()。
    function locateCanvas(id, name, fail) {
      var box = findScreenSearchBox();
      if (!box) { fail(); return; }
      // 竞态防护：本次定位开始即令在飞扫描/轮询失效；后续每次 attempt 都校验
      // 局部 token 仍是最新，防止「清空轮询未结束时用户又点了别的标签」旧结果覆盖。
      var token = ++revealToken;
      if (locateHandle) { locateHandle.cancel(); locateHandle = null; }
      var originalValue = box.value || "";
      var hadFocus = (document.activeElement === box);

      // 切换后归还焦点（若用户原本聚焦在搜索框）
      function finish() {
        if (hadFocus && document.activeElement !== box) {
          try { box.focus(); } catch (e) {}
        }
      }
      // 还原搜索现场：仅用于**彻底失败**兜底（空原值 = 保持清空/全量列表；
      // 非空 = 恢复原搜索词，别把用户没定位成功前的检索上下文弄丢）。
      // 切换**成功**路径不调用（见 succeed：成功后不恢复原检索词）。
      function restoreSearch() {
        try { setSearchValue(box, originalValue); } catch (e) {}
      }
      function succeed(el) {
        if (token !== revealToken) return;
        activateCanvas(id, name, el);
        finish();
        // 需求调整（2026-09-07）：切换成功后**不自动恢复**原检索词——若把原词
        // 写回，列表立即回到过滤态，刚打开的画布（往往不含该词）又被移出 DOM，
        // 用户会误以为没切过去。故成功后搜索框统一保持/回到空态 = 全量列表；
        // 情形二注入的临时「目标名前缀」检索词也在此一并清掉，不留残留。
        if (box.value) {
          try { setSearchValue(box, ""); } catch (e) {}
        }
      }
      function allFailed() {
        if (token !== revealToken) return;
        finish();
        restoreSearch();     // 先把搜索现场还原（空原值即恢复全量列表）
        fail();              // 滚动扫描 + 不可达提示（保持 v1.0.12 语义，不重复标 stale）
      }
      // 情形二：按目标名检索；名称较长时取前若干字符（子串命中即可）。
      function searchByName() {
        if (!name) { allFailed(); return; }
        var q = name.length > 8 ? name.slice(0, 8) : name;
        try { setSearchValue(box, q); } catch (e) { allFailed(); return; }
        locateHandle = pollFind(id, LOCATE_TIMEOUT_MS, LOCATE_STEP_MS, function (el) {
          locateHandle = null;
          if (token !== revealToken) return;
          if (el) { succeed(el); return; }
          allFailed();
        });
      }
      if (originalValue) {
        // 情形一：清空过滤词 → 目标（若只是被搜索过滤）随全量列表回到 DOM
        try { setSearchValue(box, ""); } catch (e) { allFailed(); return; }
        locateHandle = pollFind(id, LOCATE_TIMEOUT_MS, LOCATE_STEP_MS, function (el) {
          locateHandle = null;
          if (token !== revealToken) return;
          if (el) { succeed(el); return; }
          searchByName();      // 清空后仍找不到 → 情形二
        });
      } else {
        searchByName();        // 搜索框本就为空 → 直接走情形二
      }
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
      if (!ids.length) return false;   // 无历史 → 直接返回，省掉一次全表扫描
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

    // 画板项名字在真机带序号前缀（如「1 行李RFID标签编码规则」），而 .canvas-title
    // 是无序号的名字（如「行李RFID标签编码规则」）——直接字符串相等必然失配，这正是
    // 「打开设计文件不带出当前画板」的原因之一（真机 2026-09-14 实证）。
    // 比对前统一去掉开头的「序号 + 分隔符」与首尾空白。
    function normalizeName(s) {
      return String(s == null ? "" : s)
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^\d+\s*[.、:：\-\)]*\s*/, "")
        .trim();
    }

    // 检测当前激活画布（编辑器里正打开的那个）。优先激活态 class，其次 canvas-title 文本反查。
    // 激活态选择器按「状态后缀 × 画布项形态」展开（保持原状态优先级在前）：
    // 画布项存在 div.rn-list-item 与 li.rn-content-item 两种形态，只认一种会漏检。
    var ACTIVE_STATE_SUFFIXES = [
      ".is-active",
      ".is-selected",
      ".selected",
      ".current",
      "[aria-selected='true']",
      // v1.0.17：真机实测（2026-09-11，v22.18.18-op22603.1）墨刀用的是
      // `class="active"` / `class="select"`，**没有** is- 前缀，而旧表只有
      // .is-active/.is-selected/.selected/.current → 激活检测在真机恒不命中，
      // 「进入设计文件时带出当前画板」一直是失效的。补上真机实际类名。
      ".active",
      ".select"
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

    // v1.0.17：激活态与名称反查都必须限定在「画布」面板内——页面/图层面板里的
    // 同名项同样带 .rn-list-item/.rn-content-item 与激活 class，不限定会把点页面
    // 或点图层误判为「激活画布变化」，从而在标签栏凭空建标签。
    // 注意：.canvas-title 名称反查（reliable:false）的同名歧义保护逻辑
    // （seenHasNameCollision / lastActiveId 门槛）保持原样，只追加面板限定。
    function getActiveScreen() {
      var strict = hasPanelLayout();
      var i, j;
      for (i = 0; i < ACTIVE_SELECTORS.length; i++) {
        var found = document.querySelectorAll(ACTIVE_SELECTORS[i]);
        for (j = 0; j < found.length; j++) {
          if (!isCanvasPanelItem(found[j], strict)) continue;
          var aid = found[j].getAttribute("data-cid");
          // 名称可能为空（画布项文本未渲染完），交给调用方按 name 校验处理
          if (aid) return { id: aid, name: readName(found[j]), reliable: true };
        }
      }
      // 名称反查兜底：真机在「刚切页、激活 class 还没落到画布面板」的瞬间走这里。
      // 仅用于「进入文件时带出一次」（见 syncActiveScreen 的 autoSeedUsed 闸门），
      // 绝不用于后续切页，否则点页面 → 标题变化 → 反查命中新页画板 → 凭空建标签。
      var titleEl = document.querySelector(".canvas-title");
      if (titleEl) {
        var name = readName(titleEl);
        var nTitle = normalizeName(name);
        if (name && nTitle) {
          var els = document.querySelectorAll(CANVAS_ITEM_SELECTOR);
          for (var k = 0; k < els.length; k++) {
            if (els[k].classList && els[k].classList.contains("folder")) continue;
            if (!isCanvasPanelItem(els[k], strict)) continue;
            // 按归一化名字比对（画板项带序号前缀，标题不带）
            if (normalizeName(readName(els[k])) === nTitle) {
              return { id: els[k].getAttribute("data-cid"), name: readName(els[k]), reliable: false };
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
    // v1.0.17：自动带出「当前画板」只允许发生**一次**，且必须在「种子窗口」内
    // （进入设计文件后 SEED_WINDOW_MS 内）或用户尚未操作列表时。
    // 用户选定语义：进入设计文件时带出当前画板，之后切页不再自动建标签。
    // 真机 2026-09-11 反例：点页面会切换页面 → 新页画板变激活、canvas-title 随之
    // 变化 → 若持续自动跟踪，标签栏会长出一个（画板名的）新标签，用户侧表现就是
    // 「点页面也产生了标签 / 把页面当成了画布」。
    var autoSeedUsed = false;
    var SEED_WINDOW_MS = 15000;
    var autoSeedDeadline = Date.now() + SEED_WINDOW_MS;

    // 名称在「画布面板」内是否唯一（排除自身）。名称反查不可信，同名歧义时
    // 反查命中的可能是 DOM 里排序更靠前的同名项（cid 不同）→ 会制造重标签幻影
    // （「设备导入」BUG）。仅当名称唯一才允许用它做初始种子。
    function isUniqueCanvasName(name, exceptId) {
      if (!name) return false;
      var target = normalizeName(name);
      var dup = false, hit = 0;
      eachCanvasItem(function (el) {
        if (normalizeName(readName(el)) !== target) return;
        hit++;
        if (el.getAttribute("data-cid") !== exceptId) dup = true;
      });
      return !dup && hit >= 1;
    }

    // 激活画布变化时置顶进标签栏（仅用于“进入文件默认打开的画布”这一次）
    function syncActiveScreen() {
      if (autoSeedUsed) return false;
      if (Date.now() > autoSeedDeadline) return false;   // 种子窗口已过 → 绝不再自动建标签
      var active = getActiveScreen();
      if (!active || !active.id) return false;      // 画布面板还没渲染 → 下轮再试
      if (active.id === lastActiveId) return false;
      // 名称反查(reliable=false)结果不可信：命中同名不同 cid、或名称在画布面板内
      // 不唯一时绝不据此 touch，避免制造重标签幻影（修复“设备导入”BUG）。
      // 带出一次的种子优先来自激活 class（reliable=true），仅在画布面板内**名称唯一**
      // 时才接受名称反查（真机打开文件时画板项可能还没拿到 active class）。
      if (!active.reliable) {
        if (seenHasNameCollision(active.name, active.id)) return false;
        if (!isUniqueCanvasName(active.name, active.id)) return false;
      }
      autoSeedUsed = true;                           // 只带出一次，用完即关
      var ok = touch(active.id, active.name);
      if (ok) lastActiveId = active.id;
      return ok;
    }

    var root = document.createElement("div");
    root.id = "md-recent-tabs-root";
    root.setAttribute("data-md-version", MD_VERSION);   // 真机可用 Console 核对加载版本
    document.documentElement.appendChild(root);

    function closeId(id) {
      if (closed.indexOf(id) < 0) closed.push(id);
      delete seen[id];
    }

    var bar = new RecentTabsBar(root, {
      max: 20,
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
        // 画布项当前不在左侧栏 DOM：可能是搜索过滤态 / 虚拟滚动未渲染 / 文件夹折叠 /
        // SPA 重建，这**不是**「画布已删除」的充分证据。旧逻辑在此直接 delete seen + return，
        // 会同时造成「标签消失」与「不切换」两个症状；改为：
        //   1) 先把标签标记为「待定」，不删除；
        //   2) 自动重定位（locateCanvas，v1.0.13）：优先用左侧搜索框把目标带回 DOM——
        //      有词先清空恢复全量、仍找不到再按目标名检索，命中即切换；
        //   3) 仍定位不到则滚动扫描兜底（revealCanvasEl，虚拟滚动场景可救回）；
        //   4) 最后给出可见提示，标签保留、等用户手动 × 关闭。
        setStale(id, true);
        scheduleRender();
        locateCanvas(id, item.name || id, function () {
          // fail：保留原 revealCanvasEl 滚动扫描兜底 + notifyUnreachable（v1.0.12 语义）
          revealCanvasEl(id, function (found, canceled) {
            if (canceled) return;                                  // 已被新的切换请求取代
            if (found) { activateCanvas(id, item.name, found); return; }
            notifyUnreachable(item.name || id);
          });
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
    // v1.0.15：标签栏位置固定「工具栏上方」(above) 无切换概念；
    // 布局（bar 贴顶 / 工具栏下沉 / 内容下推）见 updateOffset。历史遗留的
    // md_tabbar_position 值（含旧版存的 below）一律忽略，不再读取。

    var offsetStyle = null;
    var lastHb = -1;
    var contentEls = [];             // 已应用下推的区域容器集合（画布视口 + 左右面板）
    var contentBaseMap = null;      // WeakMap<el, number> 下推前基准高度(px)，用于收缩高度防底部溢出
    var toolbarEl = null;           // 被下沉的墨刀默认工具栏元素（above+fixed 模式），destroy 时复位 marginTop

    function persistDisplayMode() {
      try { localStorage.setItem(DMODE, displayMode); } catch (e) {}
    }

    // 浮动模式显隐（v1.0.16）：不再注入任何 DOM，改用 document 级 mousemove 判定。
    // 触发带 = 窗口最顶部 FLOAT_TRIGGER_Y px：鼠标停在该带内 → 滑出；
    // 其余区域（含墨刀工具栏按钮区 clientY≈10~38）→ 收起，工具栏不被误弹、不被拦截。
    var FLOAT_TRIGGER_Y = 4;
    var floatBound = false;
    var overBar = false;
    var hideTimer = null;
    var floatMoveHandler = null;

    function showBar() {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      bar.barEl.classList.add("is-visible");
    }

    function hideBar() {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(function () {
        bar.barEl.classList.remove("is-visible");
        hideTimer = null;
      }, 250);
    }

    function onFloatMove(e) {
      if (displayMode !== "float") return;
      if (!e || typeof e.clientY !== "number") return;
      if (e.clientY <= FLOAT_TRIGGER_Y) { showBar(); return; }
      if (!overBar) hideBar();          // 停在已展开的标签栏上时不收起（保证可点标签）
    }

    function onBarEnter() { overBar = true; showBar(); }
    function onBarLeave() { overBar = false; hideBar(); }

    function bindFloatTrigger() {
      if (floatBound) return;
      floatMoveHandler = onFloatMove;
      document.addEventListener("mousemove", floatMoveHandler, true);
      bar.barEl.addEventListener("mouseenter", onBarEnter);
      bar.barEl.addEventListener("mouseleave", onBarLeave);
      floatBound = true;
    }

    function unbindFloatTrigger() {
      if (floatMoveHandler) {
        document.removeEventListener("mousemove", floatMoveHandler, true);
        floatMoveHandler = null;
      }
      bar.barEl.removeEventListener("mouseenter", onBarEnter);
      bar.barEl.removeEventListener("mouseleave", onBarLeave);
      floatBound = false;
      overBar = false;
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      bar.barEl.classList.remove("is-visible");
    }

    // 按当前工具栏高度刷新避让样式（标签栏 top / body padding / 浮动隐藏偏移）。
    // 与 displayMode 解耦：工具栏高度变化（SPA 重渲染）时只调本函数，不打断浮动显隐状态。
    function updateOffset(ti) {
      var isFloat = displayMode === "float";
      // v1.0.15：位置固定「工具栏上方」——标签栏恒贴顶(top:0)、浮动隐藏偏移为 0。
      // 固定模式把墨刀工具栏整条下沉 TOPBAR_H(44px) 为其让位（marginTop，不触发
      // 反馈环）；浮动模式不下沉。工具栏自然底边 naturalBottom 仍作内容命中基准。
      bar.barEl.style.top = "0px";
      bar.barEl.style.setProperty("--md-hide-offset", "0px");
      if (ti.el) {
        toolbarEl = ti.el;
        ti.el.style.marginTop = isFloat ? "" : (TOPBAR_H + "px");
      }
      if (!offsetStyle) {
        offsetStyle = document.createElement("style");
        offsetStyle.id = "md-recent-tabs-offset";
        document.head.appendChild(offsetStyle);
      }
      // 顶部总占用：浮动模式仅工具栏(hb)；固定模式 bar(44)+工具栏自然高(48)=92
      var reserved = isFloat ? ti.hb : (TOPBAR_H + ti.naturalBottom);
      offsetStyle.textContent = "body{padding-top:" + reserved + "px !important;}";
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
        bindFloatTrigger();
      } else {
        unbindFloatTrigger();
      }
    }

    applyDisplayMode();
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
        // 置顶(above)+固定模式会把墨刀工具栏整条下沉 44px（marginTop，见 updateOffset），
        // 此时工具栏**内部**的相对/绝对子行（图标条/按钮容器，view 顶边随之下移到 ≈44~52）
        // 会被下面的「顶边贴近 naturalBottom(48)±4」误判为内容区而遭 A2 整体下推 + 高度收缩，
        // 表现为墨刀原生操作按钮/图标被压扁、推离工具栏框架（“操作栏下移、图标较大偏移”）。
        // 修复：工具栏自身及其内部一切节点绝不参与 A2 内容下推（A2 只应作用于工具栏**之下**的区域）。
        if (toolbarEl && (el === toolbarEl || toolbarEl.contains(el))) continue;
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
        // 换设计文件 → 重新开一次「种子窗口」，允许带出一次当前画板
        autoSeedUsed = false;
        autoSeedDeadline = Date.now() + SEED_WINDOW_MS;
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
    // v1.0.17：只有「画布」面板的点击才建标签。页面面板（#screen-scroll-list 等）
    // 与图层面板（#layer-scroll-list 等）里的项 DOM 形态与画布项几乎一致
    // （都是 .rn-list-item / .rn-content-item + data-cid），必须按容器锚点拒绝，
    // 否则点页面、点图层都会在顶部「最近画布」生成无效标签。
    function trackCanvasFromEvent(e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (!cid) return;
      var item = t.closest(CANVAS_ITEM_SELECTOR);
      if (!item) return;
      // 用户已开始在左栏列表里操作（点页面 / 图层 / 画布 / 文件夹都算）→ 立即关闭
      // 「进入文件自动带出」的种子窗口。否则「点页面切页 → canvas-title 变化」会被
      // 种子路径当成激活画布变化，凭空长出一个画板标签（真机 2026-09-11 复现）。
      autoSeedUsed = true;
      if (item.classList && item.classList.contains("folder")) return; // 文件夹忽略
      if (!isCanvasPanelItem(item)) return;   // 非画布面板（页面 / 图层 / 状态 / 交互树）→ 不建标签
      var id = item.getAttribute("data-cid");
      if (!id) return;
      var name = readName(item);
      if (touch(id, name)) {
        lastActiveId = id;
        scheduleRender();
        bar.setActive(id);
        // 浮动模式下标签栏默认隐藏：用户刚点了画布却看不到反馈，会误以为「没建标签」。
        // 这里主动滑出一次，让点击结果立即可见（不动固定模式行为）。
        if (displayMode === "float" && typeof showBar === "function") showBar();
      }
    }

    // v1.0.17：同时监听 mousedown 与 click。
    // 原因（真机 2026-09-11 反馈「点画布没反应」）：墨刀切换画板发生在按下阶段，并且会
    // 重渲染左栏；若节点在 mousedown 与 mouseup 之间被替换，浏览器不会派发 click
    // （本项目早前也踩过同类"重排吞掉 click"的坑，见 tests/test_regression_tab_autoclose.py）。
    // touch() 对同一 id 是幂等的（再次调用只刷新名称与时间戳），因此两个事件都处理
    // 不会产生重复标签，只会让「按下即记录」比「点击才记录」更不容易丢。
    var clickHandler = trackCanvasFromEvent;
    var downHandler = trackCanvasFromEvent;
    document.addEventListener("click", clickHandler, true);
    document.addEventListener("mousedown", downHandler, true);

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
        if (revealTimer) { clearTimeout(revealTimer); revealTimer = null; }
        revealToken++;   // 使进行中的扫描/搜索定位回调失效
        if (locateHandle) { locateHandle.cancel(); locateHandle = null; }
        // 待执行的重渲染也要清掉：否则销毁后仍会对已脱离文档树的旧 bar 跑一次 renderList()
        if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
        if (clickHandler) document.removeEventListener("click", clickHandler, true);
        if (downHandler) document.removeEventListener("mousedown", downHandler, true);
        if (bar && typeof bar.destroy === "function") bar.destroy();
        unbindFloatTrigger();
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
