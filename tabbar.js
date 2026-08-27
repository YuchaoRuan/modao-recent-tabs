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
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 3h6l-1 6 3 3H7l3-3z"/></svg>'
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
    this.max = options.max || 20;
    this._build();
  }

  RecentTabsBar.prototype._build = function () {
    var bar = document.createElement("div");
    bar.className = "md-recent-tabs";

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

    var closeOthersBtn = document.createElement("button");
    closeOthersBtn.className = "md-icon-btn";
    closeOthersBtn.title = "关闭其他画布";
    closeOthersBtn.innerHTML = ICONS.closeOthers;
    closeOthersBtn.addEventListener("click", function () { self.onCloseOthers(); });

    actions.appendChild(badge);
    actions.appendChild(pinBtn);
    actions.appendChild(closeOthersBtn);

    bar.appendChild(brand);
    bar.appendChild(list);
    bar.appendChild(actions);
    this.root.appendChild(bar);
    this.barEl = bar;

    // 点击徽标以外区域关闭下拉菜单
    document.addEventListener("click", function (e) {
      if (self.menuEl.classList.contains("is-open") && !badge.contains(e.target)) {
        self._toggleMenu(false);
      }
    }, true);
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

  RecentTabsBar.prototype.setItems = function (items) {
    this.items = (items || [])
      .slice(0, this.max)
      .sort(function (a, b) {
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });
    this.render();
  };

  RecentTabsBar.prototype.setActive = function (id) {
    this.activeId = id;
    var tabs = this.listEl.querySelectorAll(".md-tab");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle("is-active", tabs[i].getAttribute("data-id") === id);
    }
  };

  RecentTabsBar.prototype.render = function () {
    var self = this;
    this.listEl.innerHTML = "";

    if (!this.items.length) {
      var empty = document.createElement("div");
      empty.className = "md-recent-tabs__empty";
      empty.textContent = "暂无最近画布";
      this.listEl.appendChild(empty);
    } else {
      this.items.forEach(function (item) {
        var tab = document.createElement("div");
        tab.className = "md-tab" + (item.id === self.activeId ? " is-active" : "");
        tab.setAttribute("data-id", item.id);
        tab.title = item.name + (item.updatedAt ? "　" + formatRelative(item.updatedAt) : "");

        var label = document.createElement("span");
        label.className = "md-tab__label";
        label.textContent = item.name;

        var close = document.createElement("span");
        close.className = "md-tab__close";
        close.setAttribute("role", "button");
        close.setAttribute("aria-label", "关闭");
        close.title = "关闭此标签";
        close.innerHTML = ICONS.close;

        close.addEventListener("click", function (e) {
          e.stopPropagation();
          self.onClose(item);
        });

        tab.appendChild(label);
        tab.appendChild(close);

        tab.addEventListener("click", function () {
          self.onSwitch(item);
        });

        self.listEl.appendChild(tab);
      });
    }

    // 若下拉菜单展开中，同步刷新其内容
    if (this.menuEl.classList.contains("is-open")) this._renderMenu();
  };

  /* ------------------------------ 导出 ------------------------------ */
  global.RecentTabsBar = RecentTabsBar;
  global.MD_ICONS = ICONS;
  global.MD_FORMAT_RELATIVE = formatRelative;
})(typeof window !== "undefined" ? window : this);
