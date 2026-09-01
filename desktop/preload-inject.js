/* 墨刀桌面注入 v5 — 修复 ASI 分号问题（追加到 resource/preload.js 末尾）
   注意：本文件最前面必须以 ; 开头，避免与上一行的 process.once(...) 被 ASI 拼成函数调用 */
;(function () {
  "use strict";
  // 排障日志：默认仅输出到 DevTools 控制台。如需落盘，临时把 DEBUG_FILE 设为绝对路径后再重打补丁。
  // 发布版本保持为空，避免将日志写入任何硬编码路径（隐私/兼容）。
  var DEBUG_FILE = "";
  function dbg(m) {
    if (DEBUG_FILE) {
      try { require("fs").appendFileSync(DEBUG_FILE, new Date().toISOString() + " | " + m + "\n"); } catch (e) {}
    }
    try { console.log("[md-recent-tabs] " + m); } catch (e) {}
  }
  try {
    dbg("ENTER");
    var fs = require("fs"); dbg("fs ok");
    var path = require("path"); dbg("path ok __dirname=" + __dirname);
    function read(n) { return fs.readFileSync(path.join(__dirname, n), "utf8"); }
    var css = read("tabbar.css"); dbg("css len=" + css.length);
    var js = ["tabbar.js", "recent-tabs-core.js", "recent-tabs-bootstrap.js"].map(read).join("\n;\n");
    dbg("js len=" + js.length);

    function domInject() {
      if (typeof document === "undefined" || !document || !document.head) return false;
      if (document.getElementById("md-css")) return true;
      var s = document.createElement("style"); s.id = "md-css"; s.textContent = css; document.head.appendChild(s);
      var sc = document.createElement("script"); sc.id = "md-js"; sc.textContent = js; document.head.appendChild(sc);
      dbg("DOM append done head=" + !!document.head);
      return true;
    }

    // 方法1：直接 DOM（最稳，共享 DOM 树）
    try { dbg("dom immediate: " + domInject()); } catch (e) { dbg("DOM ERR: " + (e && e.message)); }
    // 方法2：webFrame.executeJavaScript（绕过 CSP）
    try {
      var wf = require("electron").webFrame;
      dbg("webFrame=" + (wf ? "yes" : "no"));
      if (wf && wf.executeJavaScript) { wf.executeJavaScript(js); dbg("executeJavaScript done"); }
    } catch (e) { dbg("webFrame ERR: " + (e && e.message)); }

    var tries = 0;
    var t = setInterval(function () {
      tries++;
      try { if (domInject()) { clearInterval(t); dbg("dom ok at try " + tries); } } catch (e) {}
      if (tries >= 30) { clearInterval(t); dbg("give up after 30 tries"); }
    }, 1000);
  } catch (e) { dbg("TOP ERR: " + (e && e.message)); }
})();
