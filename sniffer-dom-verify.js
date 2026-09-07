/* =========================================================================
 * 墨刀企业版（内网）「最近画布」DOM 特征验证（1.0.13 自动重定位方案用）
 * 目标方案：点击标签找不到画布时 → 自动清空搜索框恢复全量 → 重新定位。
 * 本脚本一次自动完成 5 个阶段，无需复现提示态、不依赖 stale、不点画布。
 * 用法：打开任意墨刀设计文件页 → F12 → Console → 粘贴全部 → 回车。
 *       约 8 秒自动跑完并逐行打印【阶段】结果，请把全部输出发回。
 * 注意：如 Console 只显示 undefined 而无任何【阶段】行，请把 Console 顶部
 *       过滤切到 "All levels" 再跑一遍，或直接告诉我换其他方式。
 * ========================================================================= */
(function () {
  "use strict";
  var LOG = [];
  function p(s) { LOG.push(s); console.log(s); }
  function done(tag) {
    try { if (window.copy) copy(LOG.join("\n")); } catch (e) {}
    console.log("[verify-done] 已尝试复制到剪贴板，也可手动全选上方输出");
  }

  // 工具：找左侧搜索框（placeholder 含"搜索"，位于视口顶部 300px 内）
  function findSearchBox() {
    var box = null;
    Array.prototype.slice.call(document.querySelectorAll("input")).forEach(function (el) {
      var ph = (el.getAttribute && el.getAttribute("placeholder")) || "";
      var r = el.getBoundingClientRect();
      if (!box && r.top >= 0 && r.top < 300 && r.width > 40 && /搜索|查找|检索/.test(ph)) box = el;
    });
    return box;
  }
  // 工具：React 受控输入原生赋值 + 事件
  function setVal(el, v) {
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function itemCount() {
    return document.querySelectorAll("div.rn-list-item[data-cid], li.rn-content-item[data-cid]").length;
  }

  var box = findSearchBox();
  p("【0】页面: " + location.href.slice(0, 80));
  p("【0】搜索框: " + (box ? ("找到 placeholder=" + JSON.stringify((box.getAttribute && box.getAttribute("placeholder")) || "") + " class=" + JSON.stringify((typeof box.className === "string" ? box.className : ""))) : "未找到"));
  if (!box) { p("【0】未找到搜索框，终止（请确认在墨刀设计文件页）"); done(); return; }
  p("【0】搜索框初始 value=" + JSON.stringify(box.value) + "，当前画布项总数=" + itemCount());

  // 阶段 A：输入测试词，验证 setter 输入能否触发墨刀搜索
  p("【1】输入测试词「系统」……");
  setVal(box, "系统");
  setTimeout(function () {
    p("【1】1.2s 后 搜索框value=" + JSON.stringify(box.value) + " 画布项总数=" + itemCount());
    p("【1】若总数从上千骤降 → 输入已被墨刀接受并触发搜索（TRIGGER=OK）");

    // 阶段 B：清空搜索，验证列表恢复
    p("【2】清空搜索框……");
    setVal(box, "");
    setTimeout(function () {
      p("【2】1.2s 后 搜索框value=" + JSON.stringify(box.value) + " 画布项总数=" + itemCount());
      p("【2】若总数回升到接近清空前 → 清空恢复有效（CLEAR=OK）");

      // 阶段 C：折叠文件夹子项是否在 DOM（决定是否需要"展开文件夹"逻辑）
      p("【3】统计折叠文件夹结构……");
      var uls = Array.prototype.slice.call(document.querySelectorAll("ul.child-screens"));
      var inDom = 0, hiddenCnt = 0, hiddenUls = 0;
      uls.forEach(function (u) {
        var cs = getComputedStyle(u);
        var items = u.querySelectorAll("li.rn-content-item[data-cid], div.rn-list-item[data-cid]").length;
        inDom += items;
        var r = u.getBoundingClientRect();
        if (cs.display === "none" || r.height < 8) { hiddenUls++; hiddenCnt += items; }
      });
      p("【3】ul.child-screens 数量=" + uls.length + " 其中子画布项合计=" + inDom + "（全量画布约 2241）");
      p("【3】隐藏(折叠)的 ul 数量=" + hiddenUls + " 其内含子画布项=" + hiddenCnt);
      p("【3】若 hiddenCnt>0 → 折叠文件夹子项被卸载，需搜索定位或展开；若 hiddenCnt=0 且 inDom≈2241 → 折叠不卸载");

      done();
    }, 1200);
  }, 1200);
})();
