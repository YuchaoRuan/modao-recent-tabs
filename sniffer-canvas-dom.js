// 墨刀画布切换 DOM 结构探查（在浏览器 /proto/design/<cid> 页的 Console 运行）
// 用法：粘贴全部内容 → 回车 → 点击左侧“画布”栏的任意画布 → 复制控制台打印的 JSON 发回
(function () {
  "use strict";
  function dump(el) {
    if (!el) return null;
    var attrs = [];
    for (var i = 0; i < (el.attributes ? el.attributes.length : 0); i++) {
      var a = el.attributes[i];
      if (/^(data-|aria-|role|title|class|id)$/.test(a.name)) {
        attrs.push(a.name + '="' + (a.value || "").slice(0, 80) + '"');
      }
    }
    return {
      tag: el.tagName,
      id: el.id || "",
      cls: typeof el.className === "string" ? el.className.slice(0, 120) : "",
      attrs: attrs.join(" ").slice(0, 200),
      text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60),
      html: (el.outerHTML || "").slice(0, 400)
    };
  }

  function dumpPanel() {
    var out = [];
    var all = document.querySelectorAll(
      '[class*="screen"], [class*="page"], [class*="canvas"], [class*="layer-list"], [class*="tree"], [class*="list"]'
    );
    var seen = 0;
    for (var i = 0; i < all.length && seen < 60; i++) {
      var el = all[i];
      var t = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (t && t.length > 0 && t.length < 30 && el.children.length <= 3) {
        out.push(dump(el));
        seen++;
      }
    }
    console.log("=== 左侧面板候选画布项 ===");
    console.log(JSON.stringify(out, null, 2));
  }

  document.addEventListener(
    "click",
    function (e) {
      var n = e.target, chain = [];
      for (var i = 0; i < 6 && n; i++) { chain.push(dump(n)); n = n.parentElement; }
      console.log("=== 点击目标链（点击画布后看这里）===");
      console.log(JSON.stringify(chain, null, 2));
    },
    true
  );

  dumpPanel();
  console.log("已就绪：现在点击左侧'画布'栏的任意画布，再复制上方两个 JSON 发回");
})();
