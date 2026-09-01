# modao-recent-tabs 自动化测试

基于 Playwright（Python，受管 venv）的 `recent-tabs-core.js` 核心逻辑 + `tabbar.js` 组件自动化测试。

## 运行环境

- Python venv：`C:\Users\15020\.workbuddy\binaries\python\envs\default`
- Chromium：随 Playwright 安装；本机需 `--no-sandbox`（沙箱会杀 chromium 子进程）
- 真实内网墨刀（`10.83.117.101:9080`）不可达且需登录，故用**本地模拟墨刀设计文件页**跑通同一套逻辑

## 运行

```bash
# 核心逻辑（recent-tabs-core.js）
python tests/test_core_logic.py

# UI 组件（desktop/index.html 演示页）
python tests/test_tabbar_ui.py
```

退出码：`0` 全过，`1` 有失败。失败用例自动在 `tests/artifacts/` 留截图。

> 本机执行须带 `--no-sandbox`：脚本内已 `chromium.launch(headless=True, args=["--no-sandbox"])`。
> 若改用全局 python，请先 `pip install playwright` 并 `playwright install chromium`。

## 结构

| 文件 | 作用 |
|------|------|
| `tests/harness.py` | 本地静态服务器（`/proto/design/<cid>` 与未知路径均返回模拟页）；`inject_and_create()` 注入真实源码并调 `MDRecentTabs.create()`（等价 content.js 入口）；`Tester` 轻量 PASS/FAIL 收集；`new_page()` 转发页面 JS 错误 |
| `tests/fixtures/mock-modao-design.html` | 模拟墨刀设计文件页：固定顶栏、`div.rn-list-item[data-cid]` 画布栏（含 `.folder` 排除项、`.is-active` 默认画布）、`.canvas-title`。历史由脚本写 `localStorage` |
| `tests/test_core_logic.py` | 核心逻辑 10 用例 |
| `tests/test_tabbar_ui.py` | 组件 1 用例（演示页） |

## 覆盖映射（README.browser.md 自测清单 8 项 + 扩展）

| # | 自测项 | 测试用例 |
|---|--------|----------|
| 1 | 顶部出现「最近画布」标签栏 | `test_appears`（设计页可见 / 非设计页 `/workspace` `display:none` 隐藏） |
| 2 | 按最近打开顺序排序 | `test_ordering`（历史倒序；文件夹 SF 排除） |
| 3 | 点标签切换画布 | `test_switch`（标签→模拟点击左侧画布项，激活态跟随） |
| 4 | 点 × 关闭标签 | `test_close_single`（关闭 + `md_closed_screens` 持久化 + 刷新后不再出现） |
| 5 | 关闭其他画布 | `test_close_others`（仅留当前激活项） |
| 6 | 画布列表下拉 | `test_dropdown`（徽标展开、列出画布、点项切换、选择收起） |
| 7 | 图钉：固定/浮动显隐 | `test_pin_float`（浮动模式 + 滑出热点 + `body` padding + 持久化 `float`） |
| 8 | 进入文件默认画布出现 | `test_default_canvas`（`is-active` 默认画布 + 历史画布均出现） |
| 9 | SPA 跨设计文件切换 | `test_spa_switch`（`cid` 重置，不串号；真实扩展靠 2s 轮询 `refreshCid` 检测并重渲染） |
| 10 | 清除已关闭标签 | `test_clear_closed`（扩展消息 `MD_CLEAR_CLOSED` → 恢复 + 清空记录） |
| 11 | 演示页组件交互 | `test_demo`（渲染/切换/关闭/下拉，复用同一套 `tabbar.js`） |

## 测试中发现的行为说明（非缺陷，已据实断言）

- **`refresh()` 不触发重渲染**：`refreshCid()` 只更新内部 `seen`/激活态，真实扩展依赖每 2s 的 `setInterval(refreshCid)` 在 `cid` 变化时调用 `scheduleRender()`。SPA 用例据此等待轮询生效，而非直接调 `refresh()` 后立即断言。
- **重建时激活最新历史项**：切到新文件后 `renderList()` 取 `list[0]`（按 `ts` 最新的历史项）为激活，`canvas-title` 匹配仅更新 `lastActiveId` 但不覆盖。故 OTHERCID 历史 `[O2,O1]` 下激活 `O2`。
- **`body` padding 由注入 `<style id=md-recent-tabs-offset>` 设置**（非内联样式），断言用 `getComputedStyle`。
- **空状态节点**：`renderList()` 在 `items` 为空时渲染 `.md-recent-tabs__empty`（"暂无最近画布"）。
