# A2 真实环境核验报告 — modao-recent-tabs

> 核验日期：2026-09-01
> 探针：verify-a2-real.js（标注 v1.0.6；核心逻辑对应 recent-tabs-core.js v1.0.6/v1.0.7）
> 环境：真实墨刀 http://10.83.117.101:9080/proto/design/pb2msfg4ie1f8gv9w

## 1. 核验结论

**PASS（静态下推）** — `pass: true`，`missedCount: 0`。

## 2. 现场证据

| 字段 | 值 | 含义 |
|------|-----|------|
| `isDesignPage` | true | 处于 /proto/design/ 设计文件页 ✓ |
| `patchLoaded` | true | 补丁已注入（找到 .md-recent-tabs） ✓ |
| `tabBarMode` | fixed(pinned 常驻) | 标签栏常驻，A2 应下推 ✓ |
| `tabBar_top` | 48 | 标签栏顶边 |
| `tabBar_height` | 44 | 标签栏高度 |
| `tabBar_bottom` | 92 | 内容区必须 ≥ 92 才避让 ✓ |
| `detectHeaderBottom_hb` | 48 | 工具栏底边真实值 |
| `pushedCount` | 1 | 命中下推区域数 |
| `pushedRegions[0]` | `main-content` / band=left / liveTop=92 / marginTop=44px / avoidsTabBar=true | 单层内容容器整体下推 ✓ |
| `missedCount` | 0 | 无漏推区域 ✓ |

## 3. 关键判读

- 真实墨刀结构为**单层内容包装容器** `.main-content`（内含画布 + 左/右侧栏），整体坐在 `top:48`。A2 将其 `marginTop` 设为 44px 后，其所有子区域随父容器一并下移，整体避让标签栏。比 mock 中三个独立区域分别下推更干净。
- `rightBandPushed: false` 是探针 **band 分类假象**：`main-content` 从左缘起，被归为 left 带；右栏嵌套其中随之下移，并非漏推（`missedCount=0` 已证明）。
- `missedCount=0` 证明不存在「顶边仍贴 hb、却无 44px 下推」的漏推区域。

## 4. 噪声说明（与本项目无关）

粘贴内容中的以下报错**非本扩展产物**，为宿主/其他扩展噪声：
- `Uncaught SyntaxError: Identifier 'n' has already been declared` — 墨刀/QQ浏览器/搜狗 content script 冲突
- `Content Script 未知消息类型: DISABLE_FEATURES/ENABLE_FEATURES/COMPUTE_PAGE_FINGERPRINT` — 其他扩展
- `A listener indicated an asynchronous response...` — 墨刀内部

## 5. 待补验证 & 建议

- [ ] **v1.0.7 relayout 幂等未触发验证**：本次探针仅验证静态下推。v1.0.7 的 baseTop 幂等修复（refreshLayout 重刷不塌陷）需在真实环境触发一次 `MutationObserver` 重排（缩放窗口/切换画布）后再跑探针，确认 `main-content` 不塌回 top:48。
- [ ] **收尾**：确认无误后 `git commit` + tag `v1.0.7`，将 verify-a2-real.js 定为正式验收探针。
