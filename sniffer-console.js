// =========================================================================
// 墨刀内网企业版「最近画布」— 独立接口嗅探脚本（DevTools Console 版）
// 用法：
//   1. 浏览器打开内网墨刀 http://10.83.117.101:9080/workspace/recent 并登录
//   2. F12 打开 DevTools → Console，粘贴本文件全部内容，回车
//   3. 刷新页面（或触发"最近"列表加载）
//   4. 控制台会打印捕获到的接口（URL / method / 响应样本）
//      把打印出的 JSON 发回，即可精确锁定真实端点
// 说明：纯前端注入，不依赖浏览器扩展；刷新页面后需重新粘贴一次。
// =========================================================================
(function () {
  "use strict";
  window.__mdSniff = window.__mdSniff || [];

  function isCandidate(u) {
    if (!u) return false;
    if (/recent|history|latest/i.test(u)) return true;
    return /\/api\//.test(u) && /file|proj|doc|canvas|recent/i.test(u);
  }
  function looksList(t) {
    if (!t) return false;
    return /proto\/design|pb2ms|"cid"|"projectId"|"project_id"/.test(t);
  }
  function report(e) {
    window.__mdSniff.push(e);
    console.log("%c[捕获] " + e.method + " " + e.url, "color:#2d7ff9;font-weight:bold");
    console.log(JSON.stringify({ url: e.url, method: e.method, sample: e.body.slice(0, 2000) }, null, 2));
  }

  var origFetch = window.fetch;
  window.fetch = function () {
    var u = (arguments[0] && (arguments[0].url || String(arguments[0]))) || "";
    var m = (arguments[1] && arguments[1].method) || "GET";
    return origFetch.apply(this, arguments).then(function (r) {
      if (isCandidate(u) && m.toUpperCase() === "GET") {
        try { r.clone().text().then(function (t) { if (looksList(t)) report({ url: u, method: m, body: t }); }); } catch (e) {}
      }
      return r;
    });
  };

  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__mdUrl = u; this.__mdMethod = m; return origOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener("load", function () {
      if (isCandidate(this.__mdUrl) && (this.__mdMethod || "GET").toUpperCase() === "GET" && looksList(this.responseText)) {
        report({ url: this.__mdUrl, method: this.__mdMethod || "GET", body: this.responseText });
      }
    });
    return origSend.apply(this, arguments);
  };

  console.log("%c嗅探已开启：请刷新页面或触发“最近”列表加载，捕获结果会打印在下方", "color:#1aab5b;font-weight:bold");
})();
