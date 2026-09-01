# 墨刀企业版「最近画布」顶部标签栏插件

在墨刀企业版**桌面客户端**窗口顶部，以标签页形式展示你最近打开的画布（当前设计文件内），支持快速切换、单标签关闭、关闭其他、画布列表下拉。风格与墨刀一致，运行稳定。

## 解决什么问题
墨刀打开一个设计文件后，左侧「画布」栏里有多个画布，来回切换要反复在列表里找。本插件在窗口顶部加一条标签栏，自动记录你最近打开的画布，点标签即可来回切换，无需重新查找。

## 功能清单
- 顶部标签栏展示**当前设计文件**内最近打开的画布，按最近时间排序
- 进入文件时默认打开的画布、以及你点过的画布，都会自动加入并置顶
- 点标签 → 切换到对应画布；点 × → 关闭该标签（仅本地）
- 右侧「画布 N」→ 点击展开画布列表下拉，点任意项切换
- 右侧「关闭其他」→ 只保留当前画布标签，关闭其余
- 右侧「图钉」→ 切换固定显示 / 浮动显示（浮动时标签栏自动隐藏，鼠标移到窗口顶部滑出，离开自动收起）

> 所有关闭操作只移除本地标签，**不修改墨刀里的画布数据**。

## 一键安装（开箱即用）

> 前提：客户端版本为 **1.6.4**（安装路径含 `app-1.6.4`）。若版本不同，见下方「从源码重打」。

1. **完全退出**墨刀企业版（含右下角托盘图标）。
2. 把 `app.asar.patched` 和 `apply-patch.cmd` 放到**同一个目录**（任意位置即可）。
3. 双击 `apply-patch.cmd`，脚本会自动完成：检测客户端是否在运行 → 备份原 `app.asar` → 替换为补丁版。
4. 重新打开墨刀企业版，进入任一设计文件，窗口顶部即出现「最近画布」标签栏。

## 还原 / 卸载
替换前脚本会把原文件备份为 `app.asar.bak`（与原文件同目录）。要还原：退出客户端后，用 `app.asar.bak` 覆盖回 `app.asar` 即可。

## 从源码重打（客户端升级 / 版本不同）
客户端升级会覆盖 `app.asar`，此时用 `src/` 里的源码重新打补丁。需要 Node.js 环境（自带 `npx`）：

```bash
# 1. 解包当前客户端的 app.asar
npx @electron/asar extract app.asar app_unpacked

# 2. 复制插件文件到 resource/（含共享核心模块 recent-tabs-core.js）
cp desktop/tabbar.css desktop/tabbar.js desktop/recent-tabs-core.js desktop/recent-tabs-bootstrap.js app_unpacked/resource/

# 3. 追加注入片段到 preload.js（务必先加一个换行）
printf '\n' >> app_unpacked/resource/preload.js
cat desktop/preload-inject.js >> app_unpacked/resource/preload.js

# 4. 重新打包
npx @electron/asar pack app_unpacked app.asar.patched
```

然后把新生成的 `app.asar.patched` 替换到 `resources/app.asar`。

## 目录结构
```
modao-recent-tabs-plugin/
├── README.md                 # 本说明
├── app.asar.patched          # 已打好的补丁包（直接替换用）
├── apply-patch.cmd           # 一键替换脚本
├── src/                      # 源码（升级后重打用）
│   ├── tabbar.css            #   标签栏样式
│   ├── tabbar.js             #   标签栏组件（RecentTabsBar）
│   ├── preload-inject.js     #   preload 注入片段
│   └── recent-tabs-bootstrap.js  # 画布数据 + 交互逻辑
└── sniffer-canvas-*.js       # 排障工具（可选，位于仓库根目录）
    ├── sniffer-canvas-item.js    #   输出指定画布项 DOM 结构，排查「某画布不显示」
    ├── sniffer-canvas-dom.js     #   探查左侧画布栏 DOM 结构
    └── sniffer-console.js        #   控制台排障输出
```

## 排障工具
- **某画布点了不显示**：浏览器打开该设计文件 → F12 → Console → 粘贴 `sniffer-canvas-item.js`（仓库根目录）全部内容回车，把输出发给维护者定位。
- **想了解左侧画布栏结构**：同理运行 `sniffer-canvas-dom.js`。

## 注意事项
- 本插件只改桌面客户端本地 `app.asar`，**不改内网服务器**。
- 关闭标签仅移除本地标签，不删墨刀画布。
- 若团队客户端版本不是 1.6.4，用「从源码重打」生成对应版本的补丁包。
