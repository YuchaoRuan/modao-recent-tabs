# 交付概览 — 墨刀企业版（内网私有化）「最近画布」顶部 Tab 栏插件

## 环境事实（本次关键修正）
- 内网私有化部署：服务端 `http://10.83.117.101:9080`；桌面客户端 Electron 薄壳（`hostUrl` 指向该内网服务）；登录/数据在公司服务器，与 modao.cc 令牌无关。
- 用户约束：**不能改服务器** → 纯客户端侧注入。

## 逆向结论
- 会话：localStorage 键 `ACCESS`（按内网源隔离）+ 同源 Cookie。
- 画布模型：文件类型 `proto2`，画布 cid 形如 `pb2msfg4ie1f8gv9w`，路由 `/proto/design/<cid>`，最近页 `/workspace/recent`。
- API 体系：`/api/dashboard/v6/*`、`/api/flat/web_v1/*`、`/api/library/v4/*` 等。

## 数据来源（已锁定，无需抓接口）
- 最近画布来自 `localStorage['screen-history-onLeave-project-<cid>']`（最近浏览顺序）+ 左侧画布栏 `div.rn-list-item[data-cid]` DOM（画布名称）。
- 切换画布 = 模拟点击左侧画布项（内部状态，URL 不变）。
- **「画布」指设计文件内的一个页面/屏幕**，不是 `/workspace/recent` 的设计文件列表。

## 交付物（D:\WorkBuddy\墨刀\modao-recent-tabs\）
- 浏览器扩展（target 内网，MV3）：`manifest.json` `content.js` `background.js` `options.html/options.js` `README.browser.md`
- 桌面注入（Electron preload 直接 DOM 注入）：`desktop/preload-inject.js` `desktop/recent-tabs-bootstrap.js` `desktop/README.md` `desktop/apply-patch.cmd` `desktop/app.asar.patched`
- UI 组件（扩展与桌面共用）：`tabbar.js` `tabbar.css`
- 文档：`README.md` `README.browser.md` `OVERVIEW.md`

## 需求覆盖
1. 顶部 tab 按时间倒序展示最近画布 ✅
2. 点击 tab 快速切换 ✅
3. 单 tab 关闭（仅本地）✅
4. 风格一致 + 稳定运行 ✅

## P0 合规
全 SVG 图标、无紫粉渐变、颜色走 token、无 emoji、无弹跳缓动。

## 待用户后续
- 按 `desktop/README.md` 用 `desktop/apply-patch.cmd` 改包注入桌面客户端。
- 浏览器扩展见 `README.browser.md`：`chrome://extensions`（或 Edge `edge://extensions`）开发者模式加载已解压目录即可，无需配置接口。
