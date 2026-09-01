/* =========================================================================
 * verify-patch.js — 墨刀桌面补丁 app.asar.patched 一致性校验
 *
 * 用途：在「升级客户端 / 重新打补丁」后，校验发布包是否真正包含最新源码、
 *       是否存在硬编码隐私路径、资源是否齐全。属于 QA 上线前检查工具。
 *
 * 用法（请在已安装 Node.js 的环境运行）：
 *   node verify-patch.js <app.asar.patched 路径> [源码目录]
 *
 * 示例：
 *   node verify-patch.js "C:/Users/15020/AppData/Local/modao-studio-enterprise/app-1.6.4/resources/app.asar.patched" ./desktop
 *
 * 退出码：0 = 通过；1 = 发现问题；2 = 参数/工具错误（如未提供 asar 路径）。
 * ========================================================================= */
"use strict";

var fs = require("fs");
var path = require("path");
var os = require("os");
var cp = require("child_process");

var asarPath = process.argv[2];
var srcDir = process.argv[3] || "desktop";

if (!asarPath) {
  console.error("用法: node verify-patch.js <app.asar.patched 路径> [源码目录]");
  process.exit(2);
}
if (!fs.existsSync(asarPath)) {
  console.error("[ERROR] 找不到 app.asar.patched: " + asarPath);
  process.exit(2);
}

var tmpDir = path.join(os.tmpdir(), "md-verify-" + Date.now());
var issues = [];
var ok = [];

function logOk(msg) { ok.push(msg); console.log("  [OK]   " + msg); }
function logBad(msg) { issues.push(msg); console.log("  [FAIL] " + msg); }

// 1. 解包（需要 @electron/asar；优先本地，否则走 npx 临时拉取）
console.log("1) 解包 " + asarPath);
try {
  try {
    require("@electron/asar").extractSync(asarPath, tmpDir);
  } catch (e) {
    cp.execFileSync("npx", ["@electron/asar@latest", "extract", asarPath, tmpDir], { stdio: "ignore" });
  }
} catch (e) {
  console.error("[ERROR] 解包失败，请确认已安装 @electron/asar 或能访问 npm: " + e.message);
  process.exit(2);
}

// 2. 校验注入标记（preload 必须含注入逻辑）
console.log("2) 校验 preload 注入标记");
var preloadPath = path.join(tmpDir, "resource", "preload.js");
if (fs.existsSync(preloadPath)) {
  var preload = fs.readFileSync(preloadPath, "utf8");
  if (/md-recent-tabs-root|RecentTabsBar|md-css/.test(preload)) {
    logOk("preload.js 含最近画布注入逻辑");
  } else {
    logBad("preload.js 未包含最近画布注入逻辑（注入可能缺失）");
  }
  // 隐私合规：不得残留硬编码用户路径日志
  if (/C:\\\\Users\\|c:\/users\/|Users\/15020/i.test(preload)) {
    logBad("preload 中存在硬编码用户路径，存在隐私泄漏风险（应改为 DEBUG_FILE 空）");
  } else {
    logOk("preload 无硬编码用户路径");
  }
} else {
  logBad("未找到 resource/preload.js");
}

// 3. 校验必备资源文件
console.log("3) 校验资源文件");
["tabbar.css", "tabbar.js", "recent-tabs-core.js", "recent-tabs-bootstrap.js"].forEach(function (f) {
  var p = path.join(tmpDir, "resource", f);
  if (fs.existsSync(p)) logOk("resource/" + f + " 存在");
  else logBad("resource/" + f + " 缺失");
});

// 4. 与源码目录比对（若提供）
console.log("4) 与源码目录比对");
if (fs.existsSync(srcDir)) {
  ["tabbar.css", "tabbar.js", "recent-tabs-core.js", "recent-tabs-bootstrap.js", "preload-inject.js"].forEach(function (f) {
    var sp = path.join(srcDir, f);
    var tp = path.join(tmpDir, "resource", f);
    if (!fs.existsSync(sp) || !fs.existsSync(tp)) { logBad("比对跳过（缺失）: " + f); return; }
    var s = fs.readFileSync(sp, "utf8");
    var t = fs.readFileSync(tp, "utf8");
    // 去除空白做近似比对（容忍换行/注释差异），仅看核心是否一致
    var sNorm = s.replace(/\s+/g, "");
    var tNorm = t.replace(/\s+/g, "");
    if (sNorm === tNorm) logOk(srcDir + "/" + f + " 与补丁内资源一致");
    else logBad(srcDir + "/" + f + " 与补丁内资源不一致（请重打补丁）");
  });
} else {
  console.log("  (未提供源码目录，跳过比对)");
}

// 清理临时目录
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}

console.log("");
if (issues.length) {
  console.log("结果：发现 " + issues.length + " 个问题，请排查后再发布。");
  process.exit(1);
} else {
  console.log("结果：校验通过，补丁资源完整且合规。");
  process.exit(0);
}
