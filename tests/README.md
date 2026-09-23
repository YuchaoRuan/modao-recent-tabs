# modao-recent-tabs 自动化测试

基于 Playwright（Python，受管 venv）的 `recent-tabs-core.js` 核心逻辑 + `tabbar.js` 组件自动化测试。

> 缺陷台账与改动纪律见仓库根目录 [`CHANGELOG.md`](../CHANGELOG.md)。
> 发版前请跑 `python scripts/regress.py`（一致性 + 全量 + A/B 对照门禁）。

## 运行环境

- Python venv：`C:\Users\15020\.workbuddy\binaries\python\envs\default`
- Chromium：随 Playwright 安装；本机需 `--no-sandbox`（沙箱会杀 chromium 子进程）
- 真实内网墨刀（`10.83.117.101:9080`）不可达且需登录，故用**本地模拟墨刀设计文件页**跑通同一套逻辑

## 运行

```bash
# 全量回归门禁（一致性 + 全量 + A/B，推荐）
python scripts/regress.py

# 核心逻辑（recent-tabs-core.js）
python tests/test_core_logic.py

# UI 组件（desktop/index.html 演示页）
python tests/test_tabbar_ui.py

# 「点标签 → 标签被自动关闭且画布未切换」BUG 回归（虚拟滚动左侧栏夹具）
python tests/test_regression_tab_autoclose.py

# v1.0.17「只有画布面板能建标签」回归（页面/画布/图层三面板夹具）
python tests/test_canvas_panel_only.py

# v1.0.18「点标签提示未找到画布」+「点标签后定位到列表位置并保持」回归
#   （折叠 / 滚动 / 全量渲染 / 切换复位 / 锚点改名夹具，支持 --core 做 A/B；C/D/E 三组）
python tests/test_relocate_collapsed.py                             # C0-C5 + D1-D4 + E1-E5 必须全绿
# ⚠ v1.0.17 的提交号是 5f08557（本地 tag v1.0.17 亦指向它）；引历史版本一律用提交号更稳：
#   git show 5f08557:recent-tabs-core.js > _core17.js
python tests/test_relocate_collapsed.py --core _core17.js           # 必须复现用户原话（D1/D2 失败）
#   git show v1.0.16:recent-tabs-core.js > _core16.js
python tests/test_relocate_collapsed.py --core _core16.js           # 【回归】组必须全过
python tests/test_relocate_collapsed.py --carrier desktop           # 用 desktop/ 副本跑 parity
# ⚠ 旧 1.0.18（即曾临时试装的 1.0.19 包）从未提交（无 tag / 无提交号）。要反向对照 BUG-0013，
#   用脚本生成「被否决实现等价核心」：
python scripts/mk-core-rejected.py                                  # → _core-rejected.js（已 gitignore）
python tests/test_relocate_collapsed.py --core _core-rejected.js    # C/D 必须失败
# BUG-0014 对抗性自证：把当轮修复前的核心备份为 _core-prev.js，E2/E3 在其上必须失败：
python tests/test_relocate_collapsed.py --core _core-prev.js        # E2/E3 必须失败

# BUG-0015 长列表「滚动不在可见区」漏扫回归（夹具 ?rows=980；A/B 对照 v1.0.16）
python tests/test_reveal_gap.py
python tests/test_reveal_gap.py --core _core16.js                    # 必须失败（漏扫 P71）

# v1.0.18「定位加固第 2 轮」：折叠不可见 / 真机折叠形态 / 搜索框漂移 / 同类名容器
#   （BUG-0016 循环依赖、BUG-0017 能力互相短路、BUG-0018 同类名黑名单；
#    H1/H3/H4/H5/H6/H7 + 保护 H2）
python tests/test_locate_hidden.py                                   # 必须全绿（7 组 67 断言，0 失败）
#   git show 6288b2d:recent-tabs-core.js > _core_pre2.js
python tests/test_locate_hidden.py --core _core_pre2.js              # 【回归】组必须失败（复现用户原话）
python tests/test_locate_hidden.py --carrier desktop                 # 用 desktop/ 副本跑 parity

# BUG-0022 种子画布折叠回归：进入设计文件时默认带出的画布（种子路径建标签）被折叠进画布树 +
#   父级文件滚出可见区后，点其标签必须能展开定位并切换（真机契约：折叠=ul 出 DOM + 无搜索框）
python tests/test_seed_folded.py                                     # 必须全绿（S1 6/6 + S3 2/2 + S4 2/2，EXIT=0）
python tests/test_seed_folded.py --carrier desktop                   # 用 desktop/ 副本跑 parity
#   git show 9d7827f:recent-tabs-core.js > _core8.js
python tests/test_seed_folded.py --core _core8.js                    # 【回归】必须失败（复现用户原话「未找到画布」）
```

> A/B 对照矩阵已固化在 `tests/ab_expectations.json`，由 `scripts/regress.py` 的 [3/4] 段自动执行
> （`expect=regression_pass|regression_fail`）。日常不必手敲上面的 `--core`，新增缺陷时在该文件补一条即可。

退出码：`0` 全过，`1` 有失败。失败用例自动在 `tests/artifacts/` 留截图。

> 本机执行须带 `--no-sandbox`：脚本内已 `chromium.launch(headless=True, args=["--no-sandbox"])`。
> 若改用全局 python，请先 `pip install playwright` 并 `playwright install chromium`。

## 结构

| 文件 | 作用 |
|------|------|
| `tests/harness.py` | 本地静态服务器（`/proto/design/<cid>` 与未知路径均返回模拟页）；`inject_and_create()` 注入真实源码并调 `MDRecentTabs.create()`（等价 content.js 入口）；`Tester` 轻量 PASS/FAIL 收集；`new_page()` 转发页面 JS 错误 |
| `tests/fixtures/mock-modao-design.html` | 模拟墨刀设计文件页：固定顶栏、`div.rn-list-item[data-cid]` 画布栏（含 `.folder` 排除项、`.is-active` 默认画布）、`.canvas-title`。历史由脚本写 `localStorage` |
| `tests/fixtures/mock-modao-design-virtual.html` | 模拟**左侧画布栏虚拟滚动**的墨刀设计页：40 页长列表只渲染进入视口的行 + 折叠文件夹「归档」+ 点项后整栏重渲染（模拟 SPA 重绘）。用于复现「标签自动关闭」BUG |
| `tests/fixtures/mock-modao-design-panels.html` | 模拟墨刀 v22.18 的**「页面 / 画布 / 图层」三面板**左栏（真机 DOM 契约：三面板共用 `li.rn-content-item` / `div.rn-list-item` 且都带 `data-cid`，只能按容器锚点区分）。含与画布同 `data-cid` 的图层节点、空名称画布项、无归属孤立项，`__mock.setPanels()` 可模拟画布/图层 nav 互斥切换 |
| `tests/fixtures/mock-modao-design-collapsed.html` | 模拟墨刀 v22.18 三面板左栏 + **画布列可收缩折叠 / 滚动虚拟渲染 / 全量渲染 / 切换复位**：分组「历史画布」的 30 个画布行外层被 `div.canvas-sortable-list`（**v1.0.17 黑名单名容器**）包住；`__mock.setGroupOpen()` 折叠/展开、`__mock.setWrapped()` 切换是否被该容器包住、`__mock.setPanels()` 卸载整列、**`__mock.setAnchorRenamed(true)` 把「画布」列容器锚点改版换名**（`#screen-scroll-list`→`#screen-scroll-list-v2`、`.screen-list-container`→`.screen-panel`，使核心无任何已知画布锚点匹配）。v1.0.18（BUG-0014）新增 **`setFullRender(bool)`**（全量渲染：滚出可见区的行保留在 DOM，仅被 overflow 裁掉）、**`setResetOnSwitch(bool)`**（切换后重渲染左栏并把滚动容器 `scrollTop` 归零、含重建行节点）、**`setMoldeActive(bool)`**（是否由墨刀自身给激活行加 `.is-active`）、**`isRowInScroller(cid)`**（行是否落在滚动容器可视矩形内，与核心同口径）、**`activeRowCid()`**（左栏带选中类的行 cid）。用于复现并锁定 BUG-0012 / BUG-0013 的「未找到画布」与 BUG-0014 的「点标签后回到列表顶部」。**定位加固第 2 轮（BUG-0016/0017/0018）再新增**：**`setCollapsedUnrendered(bool)`**（折叠时子行**根本不渲染** —— 真机常见形态）、**`setToggleMode("aria"|"data")`**（`"data"` = **真机形态**：折叠**不用** `aria-expanded` 表达，只用 `data-collapsed` + class ⇒ 任何「只认 aria 的展开启发式」都失效）、**`setSearchTopPx(v)`** / **`setSearchPlaceholder(v)`**（把「画布」搜索框下推 >300px / 换成不含 搜索·查找·检索 的文案 ⇒ 旧探测规则必然失效）、**`setSearchBoxMissing(bool)`**（搜索框探测不到）、**`searchValue()`** / **`groupRowsCount()`** / **`toggleSignals()`** / **`wrapClass()`**；`setWrapped` 支持 `"layer"`（用 `.layer-sortable-list` 代替 `.canvas-sortable-list` 包住行） |
| `tests/test_canvas_panel_only.py` | v1.0.17「只有画布面板能建标签」回归 14 组 / 114 断言：点页面/图层不建标签、同 cid 图层节点不污染、点画布建标签、连点不重复、空名不建、`.is-active` 收窄、点标签不误点图层、严格模式双向、兼容降级、反向对照（屏蔽面板判定后原 BUG 必复现） |
| `tests/test_relocate_collapsed.py` | 「点标签提示未找到画布」（BUG-0012/BUG-0013）+「点标签后定位到列表位置并保持 + 左栏选中态」（BUG-0014）回归 **15 组**：C0-C5（折叠不可见 / 滚动未渲染 → 定位并切换；分组行可建标签；不误点图层；画布列卸载不误点其它列）+ **D1-D4（画布列容器锚点被改版换名：行被 sortable 容器包住 / 折叠隐藏 → 仍须定位并切换；带 `layer-item` 的页面/图层列同 cid 节点绝不误点；未知面板里同 cid 的杂散行不得因优先级反转抢占真画布行）** + **E1-E5（全量渲染下目标行滚出可视区 → 点标签必须滚回；切换后重渲染+滚动归零 → 目标行仍须在可视区（锁 BUG-0014 真机现象）；左栏目标行呈选中态且可逆无残留；用户手动滚动不被抢回；全量渲染下不得点到页面/图层列同 cid 行）**。断言按【回归】/【需求】/【保护】分组，支持 `--core` 做三方 A/B |
| `tests/test_locate_hidden.py` | **定位加固第 2 轮**（BUG-0016 / BUG-0017 / BUG-0018）回归 **7 组 / 67 断言**：**H1**（折叠 ⇒ 子行**不渲染** + 探测不到搜索框 → 必须靠「展开画布列内折叠分组」找回并切换）、**H3**（**真机折叠形态**：无 `aria-expanded` + 搜索框 placeholder 漂移 + 下推 >300px → 必须靠「结构优先」探到搜索框、用检索找回；【需求】清空检索词后目标行仍须可见）、**H4**（行被 `.layer-sortable-list` —— 图层树同名 sortable 组件 —— 包住时定位不得被容器名拒绝）、**H5**（**真机折叠形态 + 搜索框探测不到**：两条主路全空 → 必须靠**结构判据**展开折叠分组；这是旧版**必然失败**的盲区）、**H6**（只读探针 `__mdRtProbe()` 可用且**无副作用**）、**H7**（**合成的展开点击不得凭空长标签**：去掉分组行 `folder` 类名后走两条展开路径，标签栏不得多出分组标签；R11 护栏，删掉 `suppressTrack` 守卫本用例必失败）、**H2【保护】**（画布列整体卸载 → 必须给提示且绝不误点图层/页面列同 cid 节点）。A/B 对照 `6288b2d` → `regression_fail`（旧核心 27 条失败，toast 逐字复现用户原话） |
| `scripts/dump-canvas-dom.js` | **真机取证脚本**（IIFE、只读、不污染全局）：无新版构建时可直接粘到墨刀设计页 Console，dump 当前 DOM 真相 —— 核心版本 / 各已知锚点选择器命中数 / 所有 `[data-cid]` 行的签名（tag·class·type·layerItem·visible·panel·被拒原因）与完整祖先链（≤8 层）/ 按名字模糊匹配的候选；`console.log(JSON.stringify(...))` + `copy(...)` 便于回贴。用法见 `CHANGELOG.md` v1.0.18 / `dump-canvas-dom.js` 顶部注释 |
| `tests/test_seed_folded.py` | **BUG-0022**（种子画布折叠+父级滚出可见区后点其标签报「找不到画布」）回归 **3 组 / 10 断言**：**S1**【回归】种子画布折叠+detach+无搜索框 → 点标签必须展开 `GFOLD` 并切过去（title 命中）；并入【保护】不得删标签 / 分组须重新展开 / 行须重新可见。**S3**【保护】记录父文件夹链不得凭空长出 `GFOLD` 标签（种子标签集合 == [G05]）。**S4**【保护】autoSeed「只带出一次」闸门不被本修复改动。⚠ 夹具的「图层」列与「画布」列**共用同 data-cid**（G05），前置断言用 `canvas_row_in_dom()`（限画布列容器）而非 `__mock.inDom()`（全局面查询会被图层列节点污染）。A/B：`9d7827f`（`locate-robust.8`，修复前）→ `regression_fail`，toast 逐字复现用户原话 |
| `tests/test_core_logic.py` | 核心逻辑 10 用例 |
| `tests/test_tabbar_ui.py` | 组件 1 用例（演示页） |
| `tests/test_regression_tab_autoclose.py` | 标签自动关闭 BUG 回归 5 用例（虚拟滚动夹具） |

## 覆盖映射（README.browser.md 自测清单 8 项 + 扩展）

| # | 自测项 | 测试用例 |
|---|--------|----------|
| 1 | 顶部出现「最近画布」标签栏 | `test_appears`（设计页可见 / 非设计页 `/workspace` `display:none` 隐藏） |
| 2 | 按最近打开顺序排序 | `test_ordering`（历史倒序；文件夹 SF 排除） |
| 3 | 点标签切换画布 | `test_switch`（标签→模拟点击左侧画布项，激活态跟随） |
| 4 | 点 × 关闭标签 | `test_close_single`（关闭 + `md_closed_screens` 持久化 + 刷新后不再出现） |
| 5 | 关闭其他画布 | `test_close_others`（仅留当前激活项） |
| 6 | 画布列表下拉 | `test_dropdown`（徽标展开、列出画布、点项切换、选择收起） |
| 7 | 图钉：固定/浮动显隐 | `test_pin_float`（浮动模式 + 顶部边缘触发 + `body` padding + 持久化 `float`） |
| 8 | 进入文件默认画布出现 | `test_default_canvas`（`is-active` 默认画布 + 历史画布均出现） |
| 9 | SPA 跨设计文件切换 | `test_spa_switch`（`cid` 重置，不串号；真实扩展靠 2s 轮询 `refreshCid` 检测并重渲染） |
| 10 | 清除已关闭标签 | `test_clear_closed`（扩展消息 `MD_CLEAR_CLOSED` → 恢复 + 清空记录） |
| 11 | 演示页组件交互 | `test_demo`（渲染/切换/关闭/下拉，复用同一套 `tabbar.js`） |
| 12 | 浮动模式不遮挡工具栏 | `test_float_toolbar_not_blocked`（v1.0.16 回归：无热区 div、`elementFromPoint` 命中工具栏、工具栏点击可达、悬停工具栏不误弹） |
| 13 | 折叠/滚动/改版换名下点标签能定位 | `test_relocate_collapsed.py` C1/C2、**D1/D2（BUG-0013）** |
| 14 | 不误点页面/图层列（含同 cid） | `test_canvas_panel_only.py` T6/T11/T12、`test_relocate_collapsed.py` C4/C5/**D3**/**E5** |
| 16 | 同 cid 冲突行不得因优先级反转抢占真画布行 | `test_relocate_collapsed.py` **D4**（未知面板杂散行） |
| 15 | 定位失败不静默删标签 + 可见提示 | `test_relocate_collapsed.py` C5、`test_canvas_panel_only.py` T11 |
| 17 | 点标签后定位到画布在左栏的位置并保持 + 左栏选中态 | `test_relocate_collapsed.py` **E1/E2（定位并保持）、E3（选中态）、E4（手动滚动不被抢回）** |
| 18 | 折叠分组里的画布（子行不渲染）点标签也能定位 | `test_locate_hidden.py` **H1（BUG-0016：先展开再定位）** |
| 19 | 真机折叠形态（无 `aria-expanded`）+ 搜索框文案/位置漂移时仍能定位 | `test_locate_hidden.py` **H3（BUG-0017：搜索框四级探测 + 检索词阶梯）** |
| 20 | 画布行被 `.layer-sortable-list`（图层树同名组件）包住时不被拒绝 | `test_locate_hidden.py` **H4（BUG-0018）** |
| 21 | 画布列整体卸载时不得误点其它列 + 必须给提示 | `test_locate_hidden.py` **H2**、`test_relocate_collapsed.py` C5 |
| 22 | 真机折叠形态 + 搜索框探测不到（两条主路全空）时仍能定位 | `test_locate_hidden.py` **H5（结构判据展开，R9 末位兜底）** |
| 23 | 真机可在 Console 一行取证（不触发失败也能拿折叠态样本） | `test_locate_hidden.py` **H6（`__mdRtProbe()` 只读）** |
| 24 | 核心为展开折叠分组而合成的点击不得凭空长标签 | `test_locate_hidden.py` **H7（去掉 `folder` 类名 + 两条展开路径）** |

## 测试中发现的行为说明（非缺陷，已据实断言）

- **`refresh()` 不触发重渲染**：`refreshCid()` 只更新内部 `seen`/激活态，真实扩展依赖每 2s 的 `setInterval(refreshCid)` 在 `cid` 变化时调用 `scheduleRender()`。SPA 用例据此等待轮询生效，而非直接调 `refresh()` 后立即断言。
- **重建时激活最新历史项**：切到新文件后 `renderList()` 取 `list[0]`（按 `ts` 最新的历史项）为激活，`canvas-title` 匹配仅更新 `lastActiveId` 但不覆盖。故 OTHERCID 历史 `[O2,O1]` 下激活 `O2`。
- **`body` padding 由注入 `<style id=md-recent-tabs-offset>` 设置**（非内联样式），断言用 `getComputedStyle`。
- **空状态节点**：`renderList()` 在 `items` 为空时渲染 `.md-recent-tabs__empty`（"暂无最近画布"）。
