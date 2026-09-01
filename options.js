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
    // 选项页本身是独立标签页，active:true 只会命中选项页自己；
    // 改为向所有标签页广播，墨刀页(content script 已注入)会收到并生效，其余页忽略。
    chrome.tabs.query({}, function (tabs) {
      var list = tabs || [];
      var pending = 0, ok = 0;
      function finalize() {
        if (ok > 0) {
          setStatus("已清除关闭记录", "ok");
        } else {
          setStatus("未找到已加载插件的墨刀标签页，请先打开墨刀设计页", "err");
        }
      }
      list.forEach(function (t) {
        if (typeof t.id !== "number") return;
        pending++;
        try {
          chrome.tabs.sendMessage(t.id, { type: "MD_CLEAR_CLOSED" }, function () {
            if (!chrome.runtime.lastError) ok++;
            pending--;
            if (pending === 0) finalize();
          });
        } catch (e) {
          pending--;
          if (pending === 0) finalize();
        }
      });
      if (pending === 0) finalize();
    });
  });

  // 标签栏位置（above/below）：向当前墨刀标签页内容脚本发 MD_SET_TABBAR_POSITION
  var posEl = document.getElementById("tabbarPosition");
  var applyPosBtn = document.getElementById("applyPosition");
  if (posEl) posEl.value = "below";

  function sendPositionMessage(position) {
    // 选项页本身是独立标签页，active:true 只会命中选项页自己；
    // 改为向所有标签页广播，墨刀页(content script 已注入)会收到并生效，其余页忽略。
    chrome.tabs.query({}, function (tabs) {
      var list = tabs || [];
      var pending = 0, ok = 0;
      function finalize() {
        if (ok > 0) {
          setStatus("已应用标签栏位置：" + (position === "above" ? "上方" : "下方"), "ok");
        } else {
          setStatus("未找到已加载插件的墨刀标签页，请先打开墨刀设计页", "err");
        }
      }
      list.forEach(function (t) {
        if (typeof t.id !== "number") return;
        pending++;
        try {
          chrome.tabs.sendMessage(t.id, { type: "MD_SET_TABBAR_POSITION", position: position }, function () {
            if (!chrome.runtime.lastError) ok++;
            pending--;
            if (pending === 0) finalize();
          });
        } catch (e) {
          pending--;
          if (pending === 0) finalize();
        }
      });
      if (pending === 0) finalize();
    });
  }

  if (applyPosBtn) {
    applyPosBtn.addEventListener("click", function () {
      sendPositionMessage(posEl ? posEl.value : "below");
    });
  }
})();
