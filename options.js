/* =========================================================================
 * 墨刀企业版（内网）「最近画布」— 设置页逻辑
 * 配置项：墨刀服务器地址（modaoBaseUrl）。
 * 操作：清除已关闭标签（向当前墨刀标签页的内容脚本发消息 MD_CLEAR_CLOSED）。
 * ========================================================================= */
(function () {
  "use strict";

  var addrEl = document.getElementById("serverAddr");
  var saveBtn = document.getElementById("save");
  var clearBtn = document.getElementById("clearClosed");
  var statusEl = document.getElementById("status");

  function setStatus(text, kind) {
    statusEl.textContent = text || "";
    statusEl.className = "status" + (kind ? " " + kind : "");
  }

  chrome.storage.local.get(["modaoBaseUrl"], function (s) {
    addrEl.value = s.modaoBaseUrl || "http://10.83.117.101:9080";
  });

  saveBtn.addEventListener("click", function () {
    var v = (addrEl.value || "").trim();
    if (!/^https?:\/\/.+/i.test(v)) {
      setStatus("请填写以 http(s):// 开头的地址", "err");
      return;
    }
    v = v.replace(/\/+$/, "");
    chrome.storage.local.set({ modaoBaseUrl: v }, function () {
      setStatus("已保存", "ok");
    });
  });

  clearBtn.addEventListener("click", function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var t = tabs && tabs[0];
      if (!t || typeof t.id !== "number") {
        setStatus("未找到当前标签页", "err");
        return;
      }
      try {
        chrome.tabs.sendMessage(t.id, { type: "MD_CLEAR_CLOSED" }, function () {
          var err = chrome.runtime.lastError;
          if (err) {
            setStatus("请先在该墨刀标签页加载插件", "err");
          } else {
            setStatus("已清除关闭记录", "ok");
          }
        });
      } catch (e) {
        // 边缘情况：sendMessage 直接抛异常（非走 lastError）
        setStatus("清除失败：" + (e && e.message ? e.message : e), "err");
      }
    });
  });
})();
