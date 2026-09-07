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

  // 标签栏位置（above/below）：以 chrome.storage.local 为跨域可靠来源（选项页与内容脚本同源共享）。
  // 选项页写入 storage（本地写入必然成功 → 稳定反馈），内容脚本经 storage.onChanged 实时套用；
  // 再广播一次 MD_SET_TABBAR_POSITION 做即时视觉更新（尽力而为，不影响反馈与持久化）。
  var posEl = document.getElementById("tabbarPosition");
  var applyPosBtn = document.getElementById("applyPosition");

  // 初始化下拉为已保存值
  try {
    chrome.storage.local.get(["tabbarPosition"], function (s) {
      if (posEl && s && s.tabbarPosition) posEl.value = s.tabbarPosition;
    });
  } catch (e) {}

  function broadcastPosition(position) {
    // 选项页本身是独立标签页，active:true 只会命中选项页自己；
    // 改为向所有标签页广播，墨刀页(content script 已注入)收到即生效，其余页忽略。
    chrome.tabs.query({}, function (tabs) {
      var list = tabs || [];
      list.forEach(function (t) {
        if (typeof t.id !== "number") return;
        try {
          chrome.tabs.sendMessage(t.id, { type: "MD_SET_TABBAR_POSITION", position: position });
        } catch (e) {}
      });
    });
  }

  if (applyPosBtn) {
    applyPosBtn.addEventListener("click", function () {
      var position = posEl ? posEl.value : "below";
      // 可靠来源：写入 storage，反馈以 storage 写入结果为准（不依赖某标签页是否响应）
      try {
        chrome.storage.local.set({ tabbarPosition: position }, function () {
          if (chrome.runtime.lastError) {
            setStatus("保存失败：" + chrome.runtime.lastError.message, "err");
          } else {
            setStatus("已应用标签栏位置：" + (position === "above" ? "上方" : "下方") + "（当前墨刀页即时生效，刷新后保持）", "ok");
          }
        });
      } catch (e) {
        setStatus("保存失败：" + e.message, "err");
      }
      // 尽力即时视觉更新（非阻塞、不决定反馈）
      broadcastPosition(position);
    });
  }
})();
