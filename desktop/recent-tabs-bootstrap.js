;(function () {
  "use strict";
  if (document.getElementById("md-recent-tabs-root")) return;
  if (!document.documentElement) return;

  // 桌面端：与浏览器扩展共用 recent-tabs-core.js，但不启用扩展消息监听（桌面无设置页）。
  window.__mdRecentTabs = window.MDRecentTabs.create({ enableMessageListener: false });
})();
