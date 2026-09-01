/* =========================================================================
 * 墨刀企业版（内网）「最近画布」— 浏览器扩展内容脚本入口
 * 画布检测/切换/渲染/显示模式逻辑均在共享模块 recent-tabs-core.js（与桌面端一致）。
 * 启用 MD_CLEAR_CLOSED 扩展消息（来自设置页「清除已关闭标签」）。
 * P0 合规：图标全 SVG，无 emoji、无紫粉渐变。
 * ========================================================================= */
;(function () {
  "use strict";

  // 幂等保护：避免通过工具栏按钮重复注入时重复挂载
  if (document.getElementById("md-recent-tabs-root")) return;
  if (!document.documentElement) return;

  // 核心逻辑见 recent-tabs-core.js；此处仅负责入口与启用扩展消息监听。
  window.__mdRecentTabs = window.MDRecentTabs.create({ enableMessageListener: true });
})();
