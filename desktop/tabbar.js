/* =========================================================================
   墨刀企业版「最近画布」顶部 Tab 栏 — 共享组件
   内容脚本（扩展）与桌面演示共用，零依赖、原生 JS。
   P0 合规：图标全部为内联 SVG，禁用 emoji。
   ========================================================================= */
(function (global) {
  "use strict";

  /* ----------------------------- 图标（SVG） ----------------------------- */
  var ICONS = {
    // 品牌/“最近”：顺时针箭头环绕的时钟
    recent:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/><path d="M3 12a9 9 0 0 1 3-6.7"/><path d="M21 12a9 9 0 0 0-3-6.7"/></svg>',
    // 关闭单标签：×
    close:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    // 关闭其他：左侧保留一个标签框，右侧 × 关闭其余
    closeOthers:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="13" height="14" rx="2"/><path d="M17 15l4 4M21 15l-4 4"/></svg>',
    // 下拉箭头
    chevron:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
    // 图钉（固定/浮动切换）
    pin:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 3h6l-1 6 3 3H7l3-3z"/></svg>',
    // 位置（顶部 / 工具栏下方）切换：上下双向箭头
    position:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v16"/><path d="M8 8l4-4 4 4"/><path d="M8 16l4 4 4-4"/></svg>',
    // 提示（警告）：三角感叹号
    warn:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.6 1.8 20.4h20.4z"/><path d="M12 9.4v4.3"/><path d="M12 17.2h.01"/></svg>'
  };

  function formatRelative(ts) {
    if (!ts) return "";
    var diff = Date.now() - ts;
    var m = Math.floor(diff / 60000);
    if (m < 1) return "刚刚";
    if (m < 60) return m + " 分钟前";
    var h = Math.floor(m / 60);
    if (h < 24) return h + " 小时前";
    var d = Math.floor(h / 24);
    if (d < 30) return d + " 天前";
    return new Date(ts).toLocaleDateString("zh-CN");
  }

  /* --------------------------- 最近画布 Tab 栏 --------------------------- */
  function RecentTabsBar(root, options) {
    options = options || {};
    this.root = root;
    this.items = [];
    this.activeId = null;
    this.onSwitch = options.onSwitch || function () {};
    this.onClose = options.onClose || function () {};
    this.onCloseOthers = options.onCloseOthers || function () {};
    this.onTogglePin = options.onTogglePin || function () {};
    this.onTogglePosition = options.onTogglePosition || function () {};
    this.showPositionToggle = !!options.showPositionToggle;
    this.max = options.max || 20;
    // 标签节点复用表：id -> {el, labelEl, closeEl, item}。
    // 增量渲染（复用节点）而非每次 innerHTML 全量重建，避免点击过程中节点被替换导致 click 丢失。
    this._tabs = {};
    // 待定（stale）标签集合：id -> true。画布项暂时不在左侧栏 DOM 时标记，不删除。
    this.staleIds = {};
    // 关闭按钮「起笔」标记：null=无指针信息（合成 click，放行）；true=pointerdown 落在 × 上；
    // false=pointerdown 落在别处（列表重排/位移导致的误命中必须忽略，防止误关标签）。
    this._closeArmed = null;
    this._build();
  }

  RecentTabsBar.prototype._build = function () {
    var bar = document.createElement("div");
    bar.className = "md-recent-tabs";
    bar.setAttribute("role", "tablist");
    bar.setAttribute("aria-label", "最近画布");

    var brand = document.createElement("div");
    brand.className = "md-recent-tabs__brand";
    brand.innerHTML = ICONS.recent + "<span>最近画布</span>";

    var list = document.createElement("div");
    list.className = "md-recent-tabs__list";
    this.listEl = list;

    var actions = document.createElement("div");
    actions.className = "md-recent-tabs__actions";

    var self = this;

    // 徽标：可点击，展开画布列表下拉菜单
    var badge = document.createElement("button");
    badge.type = "button";
    badge.className = "md-recent-tabs__badge";
    badge.title = "画布列表";
    this.badgeEl = badge;
    this.badgeTextEl = document.createElement("span");
    this.badgeTextEl.className = "md-recent-tabs__badge-text";
    this.badgeTextEl.textContent = "—";
    badge.appendChild(this.badgeTextEl);
    badge.insertAdjacentHTML("beforeend", ICONS.chevron);

    this.menuEl = document.createElement("div");
    this.menuEl.className = "md-recent-tabs__menu";
    badge.appendChild(this.menuEl);

    badge.addEventListener("click", function (e) {
      e.stopPropagation();
      self._toggleMenu();
    });

    var pinBtn = document.createElement("button");
    pinBtn.className = "md-icon-btn md-pin-btn";
    pinBtn.title = "切换固定/浮动显示";
    pinBtn.innerHTML = ICONS.pin;
    pinBtn.addEventListener("click", function () { self.onTogglePin(); });
    this.pinBtn = pinBtn;

    // 位置切换按钮（桌面端即时切换标签栏位置；默认显示，可由 showPositionToggle 关闭）
    var posBtn = null;
    if (this.showPositionToggle) {
      posBtn = document.createElement("button");
      posBtn.type = "button";
      posBtn.className = "md-icon-btn md-position-btn";
      posBtn.setAttribute("aria-pressed", "false");
      posBtn.title = "切换标签栏位置（顶部 / 工具栏下方）";
      posBtn.innerHTML = ICONS.position;
      posBtn.addEventListener("click", function () { self.onTogglePosition(); });
      this.posBtn = posBtn;
    }

    var closeOthersBtn = document.createElement("button");
    closeOthersBtn.className = "md-icon-btn";
    closeOthersBtn.title = "关闭其他画布";
    closeOthersBtn.innerHTML = ICONS.closeOthers;
    closeOthersBtn.addEventListener("click", function () { self.onCloseOthers(); });

    actions.appendChild(badge);
    actions.appendChild(pinBtn);
    if (self.posBtn) actions.appendChild(self.posBtn);
    actions.appendChild(closeOthersBtn);

    bar.appendChild(brand);
    bar.appendChild(list);
    bar.appendChild(actions);
    this.root.appendChild(bar);
    this.barEl = bar;

    // 点击徽标以外区域关闭下拉菜单
    this._docClick = function (e) {
      if (self.menuEl.classList.contains("is-open") && !badge.contains(e.target)) {
        self._toggleMenu(false);
      }
    };
    document.addEventListener("click", this._docClick, true);

    // 记录一次点击的「起笔」是否落在某个标签的 × 上。
    // 目的：列表重排/重建可能让指针在 mousedown 与 mouseup 之间落到别的 × 上，
    // 只有起笔也在 × 上才允许关闭，避免「点标签主体却关掉了标签」。
    this._barPointerDown = function (e) {
      var t = e.target;
      self._closeArmed = !!(t && t.closest && t.closest(".md-tab__close"));
    };
    bar.addEventListener("pointerdown", this._barPointerDown, true);

    // 一次点击结束后复位起笔标记：保证后续合成 click（无 pointerdown）仍按放行处理。
    this._resetArm = function () { self._closeArmed = null; };
    document.addEventListener("click", this._resetArm, false);
  };

  RecentTabsBar.prototype.destroy = function () {
    // 仅清理本组件注册在 document 上的监听；DOM 由 createRecentTabs 统一移除。
    if (this._docClick) {
      document.removeEventListener("click", this._docClick, true);
      this._docClick = null;
    }
    if (this._resetArm) {
      document.removeEventListener("click", this._resetArm, false);
      this._resetArm = null;
    }
    if (this._toastTimer) {
      clearTimeout(this._toastTimer);
      this._toastTimer = null;
    }
    this._tabs = {};
    this.staleIds = {};
  };

  RecentTabsBar.prototype._toggleMenu = function (open) {
    var willOpen = typeof open === "boolean" ? open : !this.menuEl.classList.contains("is-open");
    this.menuEl.classList.toggle("is-open", willOpen);
    this.badgeEl.classList.toggle("is-open", willOpen);
    if (willOpen) this._renderMenu();
  };

  RecentTabsBar.prototype._renderMenu = function () {
    var self = this;
    this.menuEl.innerHTML = "";
    if (!this.items.length) {
      var empty = document.createElement("div");
      empty.className = "md-menu-empty";
      empty.textContent = "暂无最近画布";
      this.menuEl.appendChild(empty);
      return;
    }
    this.items.forEach(function (item) {
      var it = document.createElement("div");
      it.className = "md-menu-item" + (item.id === self.activeId ? " is-active" : "");
      it.setAttribute("data-id", item.id);
      it.textContent = item.name;
      it.title = item.name;
      it.addEventListener("click", function (e) {
        e.stopPropagation();
        self._toggleMenu(false);
        self.onSwitch(item);
      });
      self.menuEl.appendChild(it);
    });
  };

  RecentTabsBar.prototype.setBadge = function (text, kind) {
    this.badgeTextEl.textContent = text;
    this.badgeEl.className =
      "md-recent-tabs__badge" + (kind ? " is-" + kind : "");
  };

  RecentTabsBar.prototype.setPinned = function (pinned) {
    if (!this.pinBtn) return;
    this.pinBtn.classList.toggle("is-pinned", !!pinned);
    this.pinBtn.title = pinned
      ? "固定显示（点击切换为浮动）"
      : "浮动显示（点击切换为固定）";
  };

  // 设置位置切换按钮的视觉/无障碍状态（above=贴顶；below=工具栏下方）
  RecentTabsBar.prototype.setPosition = function (mode) {
    if (!this.posBtn) return;
    var isAbove = mode === "above";
    this.posBtn.classList.toggle("is-above", isAbove);
    this.posBtn.setAttribute("aria-pressed", isAbove ? "true" : "false");
    this.posBtn.title = isAbove
      ? "标签栏在顶部（点击移至工具栏下方）"
      : "标签栏在工具栏下方（点击移至顶部）";
  };

  RecentTabsBar.prototype.setItems = function (items) {
    // 必须先「按最近排序」再截断：先 slice 会按调用方传入顺序（seen 的插入顺序）
    // 保留最早的一批，把最近使用的画布截掉，表现为标签莫名消失。
    this.items = (items || [])
      .slice()
      .sort(function (a, b) {
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      })
      .slice(0, this.max);
    this.render();
  };

  // 标记/取消「待定」标签：画布项暂时不在左侧栏 DOM（虚拟滚动未渲染 / 文件夹折叠 / SPA 重绘）
  // 时置为待定，仅做视觉提示，绝不删除标签（旧逻辑会静默删掉活画布的标签）。
  RecentTabsBar.prototype.setStale = function (id, stale) {
    if (!this.staleIds) this.staleIds = {};
    if (stale) this.staleIds[id] = true;
    else delete this.staleIds[id];
    var entry = this._tabs && this._tabs[id];
    if (entry) {
      entry.el.classList.toggle("is-stale", !!stale);
      if (stale) entry.el.setAttribute("data-stale", "1");
      else entry.el.removeAttribute("data-stale");
    }
  };

  // 轻提示（无 emoji，图标为内联 SVG）。定位在标签栏下沿，数秒后自动淡出。
  RecentTabsBar.prototype.toast = function (message, kind) {
    if (!this.root || !message) return;
    var el = this.toastEl;
    if (!el) {
      el = document.createElement("div");
      el.className = "md-recent-tabs__toast";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      this.toastEl = el;
      this.root.appendChild(el);
    }
    var icon = document.createElement("span");
    icon.className = "md-recent-tabs__toast-icon";
    icon.innerHTML = ICONS.warn;
    var text = document.createElement("span");
    text.className = "md-recent-tabs__toast-text";
    text.textContent = message;
    el.innerHTML = "";
    el.appendChild(icon);
    el.appendChild(text);
    el.classList.toggle("is-warn", kind !== "info");

    var barRect = this.barEl ? this.barEl.getBoundingClientRect() : { bottom: 0 };
    el.style.top = Math.max(0, Math.round(barRect.bottom) + 8) + "px";
    el.classList.add("is-visible");

    var self = this;
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(function () {
      self._toastTimer = null;
      if (self.toastEl) self.toastEl.classList.remove("is-visible");
    }, 3600);
  };

  RecentTabsBar.prototype.setActive = function (id) {
    this.activeId = id;
    var tabs = this.listEl.querySelectorAll(".md-tab");
    for (var i = 0; i < tabs.length; i++) {
      var isActive = tabs[i].getAttribute("data-id") === id;
      tabs[i].classList.toggle("is-active", isActive);
      // 同步可访问性状态（P3-1）：激活项可聚焦且 aria-selected=true
      tabs[i].setAttribute("tabindex", isActive ? "0" : "-1");
      tabs[i].setAttribute("aria-selected", isActive ? "true" : "false");
    }
  };

  // 创建单个标签节点（仅在首次出现该 id 时调用；后续一律复用）。
  RecentTabsBar.prototype._createTab = function (item) {
    var self = this;
    var tab = document.createElement("div");
    tab.className = "md-tab";
    tab.setAttribute("data-id", item.id);
    // 可访问性（P3-1）：标签栏为 tablist，每个标签为 tab
    tab.setAttribute("role", "tab");

    var label = document.createElement("span");
    label.className = "md-tab__label";

    var close = document.createElement("span");
    close.className = "md-tab__close";
    close.setAttribute("role", "button");
    close.setAttribute("aria-label", "关闭");
    close.title = "关闭此标签";
    close.innerHTML = ICONS.close;

    close.addEventListener("click", function (e) {
      e.stopPropagation();
      // 只有当这次点击的起笔（pointerdown）同样落在 × 上时才关闭。
      // 列表重排/位移可能让 mouseup 落到 × 上而起笔在标签主体，
      // 旧逻辑会把它当成「点 × 」而误关标签；此处直接忽略。
      if (self._closeArmed === false) return;
      self._closeArmed = null;
      var entry = self._tabs && self._tabs[item.id];
      self.onClose(entry ? entry.item : item);
    });

    tab.appendChild(label);
    tab.appendChild(close);

    tab.addEventListener("click", function () {
      var entry = self._tabs && self._tabs[item.id];
      self.onSwitch(entry ? entry.item : item);
    });

    var entry = { el: tab, labelEl: label, closeEl: close, item: item };
    this._updateTab(entry, item);
    return entry;
  };

  // 把已有标签节点同步到最新数据（文本 / 激活态 / 可访问性 / 待定态）。
  RecentTabsBar.prototype._updateTab = function (entry, item) {
    var isActive = item.id === this.activeId;
    var name = item.name || "";
    var stale = !!(this.staleIds && this.staleIds[item.id]);
    if (entry.labelEl.textContent !== name) entry.labelEl.textContent = name;
    var title = (stale ? "暂未定位到该画布（请先在左侧画布栏展开或滚动到它）　" : "") +
                name + (item.updatedAt ? "　" + formatRelative(item.updatedAt) : "");
    if (entry.el.getAttribute("title") !== title) entry.el.setAttribute("title", title);
    entry.el.classList.toggle("is-active", isActive);
    entry.el.setAttribute("tabindex", isActive ? "0" : "-1");
    entry.el.setAttribute("aria-selected", isActive ? "true" : "false");

    entry.el.classList.toggle("is-stale", stale);
    if (stale) entry.el.setAttribute("data-stale", "1");
    else entry.el.removeAttribute("data-stale");

    entry.item = item;
  };

  // 增量渲染：复用已有标签节点，只在集合/顺序真正变化时增删移动。
  // 旧实现每次 innerHTML = "" 全量重建，会把用户正在点击的节点销毁：
  // mousedown 与 mouseup 之间若发生重建，浏览器因「无共同祖先」而不派发 click，
  // 表现为「点了标签但什么也没发生」。
  RecentTabsBar.prototype.render = function () {
    var list = this.listEl;
    if (!list) return;
    var scrollLeft = list.scrollLeft;

    if (!this.items.length) {
      this._tabs = {};
      list.innerHTML = "";
      var empty = document.createElement("div");
      empty.className = "md-recent-tabs__empty";
      empty.textContent = "暂无最近画布";
      list.appendChild(empty);
      if (this.menuEl && this.menuEl.classList.contains("is-open")) this._renderMenu();
      return;
    }

    // 清掉空态占位（有标签时不应保留）
    var emptyEl = list.querySelector(".md-recent-tabs__empty");
    if (emptyEl && emptyEl.parentNode) emptyEl.parentNode.removeChild(emptyEl);

    var prev = this._tabs || {};
    var next = {};
    var i, item, entry;

    for (i = 0; i < this.items.length; i++) {
      item = this.items[i];
      entry = prev[item.id];
      if (entry) {
        this._updateTab(entry, item);
      } else {
        entry = this._createTab(item);
      }
      next[item.id] = entry;
    }

    // 移除已不在列表中的标签节点
    for (var oldId in prev) {
      if (Object.prototype.hasOwnProperty.call(prev, oldId) && !next[oldId]) {
        if (prev[oldId].el.parentNode) prev[oldId].el.parentNode.removeChild(prev[oldId].el);
      }
    }

    // 按目标顺序摆放：仅当位置不一致时才移动，尽量减少 DOM 操作
    for (i = 0; i < this.items.length; i++) {
      var want = next[this.items[i].id].el;
      var at = list.children[i];
      if (at !== want) list.insertBefore(want, at || null);
    }

    this._tabs = next;
    // 保险：重建可能让横向滚动位置变化，显式还原
    if (list.scrollLeft !== scrollLeft) list.scrollLeft = scrollLeft;

    // 若下拉菜单展开中，同步刷新其内容
    if (this.menuEl && this.menuEl.classList.contains("is-open")) this._renderMenu();
  };

  /* ------------------------------ 导出 ------------------------------ */
  global.RecentTabsBar = RecentTabsBar;
  global.MD_ICONS = ICONS;
  global.MD_FORMAT_RELATIVE = formatRelative;
})(typeof window !== "undefined" ? window : this);
