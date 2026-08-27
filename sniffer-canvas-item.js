// 墨刀画布项诊断脚本（浏览器 Console 运行，无需扩展）
// 用途：扫描左侧「画布」栏中含指定关键词的画布项，输出其真实 DOM 结构，
//       用于定位「点击某画布不显示/置顶」的问题根因。
(function () {
  var KW = ["新增", "修改", "消息模板", "说明"];
  var out = [];
  var seen = {};
  document.querySelectorAll("div.rn-list-item[data-cid], li.rn-content-item[data-cid]").forEach(function (el) {
    var txt = (el.textContent || "").replace(/\s+/g, " ").trim();
    var hit = KW.some(function (k) { return txt.indexOf(k) >= 0; });
    if (!hit) return;
    var id = el.getAttribute("data-cid");
    if (seen[id]) return;
    seen[id] = 1;
    out.push({
      tag: el.tagName,
      cls: (el.className || "").toString().slice(0, 90),
      cid: id,
      txt: txt.slice(0, 50),
      html: el.outerHTML.slice(0, 500)
    });
  });
  console.log("=== 命中画布项 ===");
  console.log(JSON.stringify(out, null, 2));
  console.log("div.rn-list-item.page 数:", document.querySelectorAll("div.rn-list-item.page[data-cid]").length);
  console.log("div.rn-list-item[data-cid] 数:", document.querySelectorAll("div.rn-list-item[data-cid]").length);
  console.log("div.rn-list-item.folder 数:", document.querySelectorAll("div.rn-list-item.folder[data-cid]").length);
})();
