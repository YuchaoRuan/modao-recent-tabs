/* 墨刀桌面注入 v5 — 修复 ASI 分号问题（追加到 resource/preload.js 末尾）
   注意：本文件最前面必须以 ; 开头，避免与上一行的 process.once(...) 被 ASI 拼成函数调用 */
;(function () {
  "use strict";
  function dbg(m) {
    try { require("fs").appendFileSync("C:/Users/15020/modao-debug.log", new Date().toISOString() + " | " + m + "\n"); } catch (e) {}
  }
  try {
    dbg("ENTER");
    var fs = require("fs"); dbg("fs ok");
    var path = require("path"); dbg("path ok __dirname=" + __dirname);
    function read(n) { return fs.readFileSync(path.join(__dirname, n), "utf8"); }
    var css = read("tabbar.css"); dbg("css len=" + css.length);
    var js = ["tabbar.js", "recent-tabs-bootstrap.js"].map(read).join("\n;\n");
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
