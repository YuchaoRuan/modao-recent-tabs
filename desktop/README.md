# 桌面客户端注入（v3：preload 直接 DOM 注入）

墨刀企业版桌面客户端是 Electron 薄壳（`app-1.6.4/resources/app.asar`），加载 `http://10.83.117.101:9080` 的墨刀 Web 应用。

> 现状：v3 已**直接替换到现场 `resources/app.asar`**，原始干净包保留为 `resources/app.asar.orig`（1.37MB）。v2（主进程注入改 main.js）会触发主进程未捕获异常，已弃用。

## 为什么改回 preload（v3）
- **v1** 用 preload 的 `webFrame.executeJavaScript`：在 `contextIsolation:true` 下未生效，标签栏不出现。
- **v2** 改 `main.js` 加 `web-contents-created` 钩子：会触发主进程 `TypeError`，客户端直接报错打不开，已弃用。
- **v3**（当前）：**仅改 preload**，用**直接 DOM 注入**（`document.head.appendChild`），不依赖 `webFrame`，脚本元素在主世界执行 → 既安全又一定能注入。

```js
// preload 隔离世界：直接操作共享 DOM 树
document.head.appendChild(<style>);    // 样式可见
document.head.appendChild(<script>);   // 脚本在主世界执行
```

## 当前已落盘
- `resources/app.asar` —— v3 补丁版（已替换；**含 v1.0.16 浮动模式修复**，2026-09-08 重打）
- `resources/app.asar.bak` —— 原始干净备份（1.37MB），重打时**必须**以它为基底
  （`app.asar` 已注入过 preload，再拿它当基底会二次注入 → 双标签栏）
- 交付目录 `desktop/app.asar.patched` —— 已同步为 v3 + v1.0.16

## 验证
完全退出客户端（含托盘）→ 重新打开 → 窗口顶部出现「最近画布」标签栏。

## 从源码重打（客户端升级后）

> **基底必须是 `app.asar.bak`（原始干净包）**，不能用已打过补丁的 `app.asar`
> —— 后者的 `resource/preload.js` 末尾已有注入代码，再追加一次会双份注入（双标签栏）。

```bash
# 离线 asar CLI（无需 npx 联网），版本 @electron/asar 4.3.0 + Node 22.22.2
NODE="C:/Users/15020/.workbuddy/binaries/node/versions/22.22.2-2/node.exe"
ASAR="C:/Users/15020/.workbuddy/binaries/node/workspace/node_modules/@electron/asar/bin/asar.mjs"
RES="$LOCALAPPDATA/modao-studio-enterprise/app-1.6.4/resources"

"$NODE" "$ASAR" extract "$RES/app.asar.bak" app_unpacked
cp desktop/tabbar.css desktop/tabbar.js desktop/recent-tabs-core.js desktop/recent-tabs-bootstrap.js app_unpacked/resource/
printf '\n' >> app_unpacked/resource/preload.js
cat desktop/preload-inject.js >> app_unpacked/resource/preload.js
"$NODE" "$ASAR" pack app_unpacked desktop/app.asar.patched
```

打包后自检（缺一即说明打错基底或文件没覆盖到）：

```bash
grep -c "FLOAT_TRIGGER_Y"      desktop/app.asar.patched   # >0：含 v1.0.16 浮动修复
grep -c "md-recent-tabs-hotspot" desktop/app.asar.patched # 必须为 0：热区已删除
```

覆盖安装目录：`desktop/apply-patch.cmd`（会先备份 `.bak`、并检测客户端进程）。

## 可选：配置内网最近接口路径
```js
// 墨刀页面 DevTools Console
localStorage.setItem('md_recentPath', '/api/...');   // 嗅探脚本抓到的真实路径
```
留空则走最近页 DOM 抓取 → 演示数据。

## 注入文件清单
| 文件 | 位置 | 作用 |
|------|------|------|
| `preload-inject.js` | 追加到 `resource/preload.js` 末尾 | 直接 DOM 注入（安全、必注入主世界） |
| `tabbar.css` / `tabbar.js` | `resource/` | 标签栏样式与组件 |
| `recent-tabs-bootstrap.js` | `resource/` | 主世界引导脚本（创建 tab 栏 + 拉取最近） |

## 注意事项
- 不要再去改 `main.js`（v2 的坑）。
- 客户端升级（Squirrel）会覆盖 `app.asar`，需重打。
- 注入只发生在 `document.head` 可用后（含 DOMContentLoaded 与 1s 间隔兜底），最多重试 30 次。