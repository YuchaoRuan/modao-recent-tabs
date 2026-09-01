/* =========================================================================
 * 墨刀企业版（内网）「最近画布」— 后台 Service Worker（MV3）
 * 职责：
 *   - 首次安装引导：打开设置页（配置服务器地址）。
 *   - 工具栏按钮（action）：对当前标签页注入标签栏脚本。
 *     用于 manifest 静态匹配之外的自定义服务器地址（如 IP/端口变更）。
 * 数据获取与画布切换均在内容脚本内完成（同源 localStorage + 左侧画布栏 DOM）。
 * P0 合规：无 emoji、无紫粉渐变。
 * ========================================================================= */

chrome.runtime.onInstalled.addListener(function (details) {
  if (details && details.reason === "install") {
    chrome.runtime.openOptionsPage();
  }
});

// 点击工具栏图标：把标签栏注入到当前墨刀标签页。
// 内容脚本已做幂等保护（重复注入不会重复挂载）。
chrome.action.onClicked.addListener(function (tab) {
  if (!tab || typeof tab.id !== "number") return;
  var tid = tab.id;
  chrome.scripting.insertCSS(
    { target: { tabId: tid }, files: ["tabbar.css"] },
    function () {
      if (chrome.runtime.lastError) { reportInjectFail(tid); return; }
      chrome.scripting.executeScript(
        { target: { tabId: tid }, files: ["tabbar.js", "content.js"] },
        function () {
          if (chrome.runtime.lastError) { reportInjectFail(tid); return; }
          markInjected(tid);
        }
      );
    }
  );
});

// 注入失败：给出可操作的提示（地址/权限），并通过角标让用户感知。
function reportInjectFail(tid) {
  var msg = (chrome.runtime.lastError && chrome.runtime.lastError.message) || "未知错误";
  console.warn(
    "[墨刀最近画布] 注入失败：" + msg +
    "。常见原因：当前页不是墨刀页面，或该地址未在 manifest 的 host_permissions 中授权" +
    "（自定义服务器地址需要在 manifest 添加对应主机或 <all_urls>）。"
  );
  try {
    chrome.action.setBadgeText({ tabId: tid, text: "!" });
    chrome.action.setBadgeBackgroundColor({ tabId: tid, color: "#f53f3f" });
    chrome.action.setTitle({ tabId: tid, title: "注入失败：" + msg });
  } catch (e) {}
}

function markInjected(tid) {
  try {
    chrome.action.setBadgeText({ tabId: tid, text: "" });
    chrome.action.setTitle({ tabId: tid, title: "墨刀最近画布：已注入" });
  } catch (e) {}
}
