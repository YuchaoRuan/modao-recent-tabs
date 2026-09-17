# modao-recent-tabs 变更日志与回归台账

> **本文件是「杜绝同一个 BUG 反复出现」的唯一登记处。改代码前先读「已修复缺陷索引」，
> 改完必须新增/更新用例并在本文件登记。** 详细纪律见文末「改动纪律」。

---

## 〇、版本号约定（务必先读）

- **`1.0.17` 为已发布版本**（带 BUG-0012）。
- **`1.0.18` 为待发布号**（含 BUG-0012 / BUG-0013 / BUG-0014 的全部修复）。
- 期间（2026-09-16）曾以 **`1.0.19`** 临时包给用户**真机试装**做复验；现统一**收敛回 `1.0.18`**
  —— 三处版本号（`VERSION` / `manifest.json` / 核心 `MD_VERSION`）均为 `1.0.18`，此号**冻结**：
  未获用户明确确认「修复完成、正式发布」之前，**禁止再改动三处版本号**（见「改动纪律」第 10 条）。

---

## 一、已修复缺陷索引（改动时逐条对照，禁止回退）

| BUG-ID | 首现版本 | 修复版本 | 现象（用户原话摘要） | 根因 | 锁定用例 |
|--------|---------|---------|--------------------|------|---------|
| BUG-0001 | — | v1.0.0 | 需求基线：顶部展示最近画布，点标签快速切换 | — | `test_core_logic.py` |
| BUG-0002 | v1.0.6 | v1.0.7 | 固定标签栏遮挡墨刀工具栏 / 内容区不下推 | 下推基准每次重排都重算，导致塌陷 | `test_core_logic.py::test_default_canvas` 等 |
| BUG-0003 | v1.0.9 | v1.0.9 | 选项页改设置不生效 | 只给当前 tab 发消息，未广播 | — |
| BUG-0004 | v1.0.11 | v1.0.11 | 标签栏位置设置不生效 | `chrome.storage` 未用 | — |
| BUG-0005 | v1.0.12 | v1.0.12 | 点标签画布**被误删且不切换** | 定位不到就 `delete seen`，把「暂时不可见」当「已删除」 | `test_regression_tab_autoclose.py` |
| BUG-0006 | v1.0.12 | v1.0.17（部分） | 「设备导入」画布点出**重复同名 tab** | `getActiveScreen` 在两个画布同名时按名称回退匹配 | `test_canvas_panel_only.py::test_t10/t16`（真机复验待补） |
| BUG-0007 | v1.0.13 | v1.0.13 | 左侧搜索框处于过滤态时，点标签找不到画布 | 非命中画布被移出 DOM；需先清空/按名检索 | `test_relocate_search.py` |
| BUG-0008 | v1.0.13 | v1.0.14 | 切换成功后列表又回到过滤态，用户以为没切过去 | 成功后自动恢复原检索词 | `test_relocate_search.py` |
| BUG-0009 | v1.0.15 | v1.0.16 | 浮动模式标签栏**遮挡并拦截**墨刀顶部工具栏 | 注入的热区 div 铺满工具栏、z-index 仅次标签栏 | `test_core_logic.py::test_float_toolbar_not_blocked` |
| BUG-0010 | v1.0.16 | v1.0.17 | 点左栏「页面」/「图层」也凭空长出无效标签 | 三列共用 `rn-list-item`/`rn-content-item` + `data-cid`，只按 `[data-cid]` 无法区分 | `test_canvas_panel_only.py`（T1/T2/T7/T8/T13/T17） |
| BUG-0011 | v1.0.17（同一版内） | v1.0.17 | 「点画布不长标签」（比原 BUG 更严重） | 判据要求「必须命中画布列白名单容器」，容器锚点一改版就连真画布一起拒 | `test_canvas_panel_only.py::test_t17` |
| **BUG-0012** | **v1.0.17** | **v1.0.18** | **点标签提示「未找到画布，请先在左侧画布栏展开或滚动到它」——曾经打开的画布仍在左栏「画布」列表中，只是被收缩折叠不可见 / 因滚动不在可见区域** | **v1.0.17 把「下部页面列」的容器类名（`#canvas-scroll-list` / `.canvas-scroll-list` / `.canvas-sortable-list` / `#mb-enabled-canvas-list`）列入 `findCanvasEl` 黑名单一律拒绝；真机上「画布」列在**存在分组或需要滚动**时行的外层被同一个 sortable 列表组件包住 → 类名命中黑名单 → 行即使在 DOM 里也永远查不到** | `test_relocate_collapsed.py`（C1/C2/C3/C4/C5） |
| **BUG-0013** | **v1.0.18（旧称，即临时试装的 1.0.19）** | **v1.0.18** | **点标签仍提示「未找到画布，请先在左侧画布栏展开或滚动到它…」，真机复验仍失败（F12 日志行号与源码 `recent-tabs-core.js:742` / `:744` 逐行吻合 → 版本确已生效）** | **`findCanvasEl` 用 `canvasPanelPresent()` 门控候选，而 `canvasPanelPresent` 的「用是否存在画布级行兜底」分支是**死代码**——它靠 `classifyItem(els[i]) === "canvas"` 判存在，但 `classifyItem` 只在 `insideAny(el, p.canvas)` 为真时才可能返回 `"canvas"`，`p.canvas` 为空时恒不返回 → 恒 false。于是「画布」列容器锚点一旦被墨刀改版换名，`canvasPanelPresent` 恒 false → `preferCanvas` 恒 false → 所有被判为 `canvasWrapped` / `page` 的候选行被**无条件跳过** → 真画布行（恰被 sortable 容器包住）永远查不到** | `test_relocate_collapsed.py`（D1/D2 锁定；D3/D4 保护） |
| **BUG-0014** | **≤ v1.0.17（长期存在，本轮才修）** | **v1.0.18** | **「点标签能切换但不定位到画布在画布列表的位置」；追问后确认「（左栏列表）刷新了一下回到了列表顶部」。期望「滚动 + 设为左栏选中态」** | **定位**只在**点击前**滚一次（`scrollIntoView`）；墨刀切换画布时会**重渲染左栏并把滚动容器 `scrollTop` 复位**（含重建行节点）→ 刚滚到位立刻被冲掉 → 列表回到顶部。且 `isRowVisible` 只判「是否在渲染树」，**不判是否在滚动容器可视区内** → 滚出视野的行照样算「可见」，定位链误以为已到位。**选中态**：定位成功后未在左栏标示「当前是哪一行」** | `test_relocate_collapsed.py`（**E2 锁定**；E1 基线回归；E3 需求；E4/E5 保护） |
| **BUG-0015** | **≤ v1.0.13（放大分支自 v1.0.13 即在，原始设计缺陷非回归）** | **v1.0.18** | **列表中的画布因「滚动不在可见区域」（虚拟列表未渲染该行）→ 点画布标签报「未找到画布「X」，请先在左侧画布栏展开或滚动到它，再点击标签切换」，画布切不过去** | **`revealCanvasEl` 的「放大分支」在长列表上把 `step` 放大到远超虚拟列表单次渲染窗口（约 `clientHeight`+overscan），档间留下 338~734px 从未渲染的缝隙，目标行落在缝隙里永远查不到（`findCanvasEl` 恒 null）→ `notifyUnreachable`** | `tests/test_reveal_gap.py`（【回归】P71 漏扫必现「未找到画布」；【保护】末行 P980 仍须命中；A/B 矩阵 v1.0.16→regression_fail） |

---

## 二、版本明细

### v1.0.18（开发中，待发布）

> 本版把「临时 1.0.19 包」的定位加固**并入**，并新增 BUG-0014 的「滚动 + 左栏选中态」修复。
> 版本号统一收敛回 `1.0.18` 并冻结。

**需求（用户 2026-09-16 提出）**
1. 左栏「画布」列表中的画布，**无论被收缩折叠不可见、还是因滚动不在可见区域**，
   点它的标签都必须**定位到画布所在位置并显示画布内容**。（BUG-0012）
2. 点标签提示「未找到画布」在真机复验**仍失败**，必须彻底修复；定位能力必须**不弱于 v1.0.16**。（BUG-0013）
3. **本轮新增（BUG-0014，用户追问后明确）**：
   - 点标签后必须**定位到该画布在左栏列表中的位置并保持**（不得「刷新了一下回到列表顶部」）；
   - 目标行须呈**左栏选中态**；
   - 用户一旦**手动滚动**，我方纠偏**不得抢回**。

**真机取证事实**
- 用户 F12 控制台实打实打印：
  `recent-tabs-core.js:742 [modao-recent-tabs] 未找到画布「航班座位号查询（说明）」，请先在左侧画布栏展开或滚动到它，再点击标签切换`
  与 `recent-tabs-core.js:744 [modao-recent-tabs] 定位失败诊断: Object`；
  这两行与旧 1.0.18 源码 `notifyUnreachable` 的 `console.warn` 行号**逐行吻合** → **排除「改动没生效」**。
- 用户追问 BUG-0014 现象，明确是「（左栏列表）刷新了一下回到了列表顶部」。
- 关键判据（定位路径**不依赖容器锚点**的立足点）：三列**行自身**签名不同 ——
  「画布」列行项 `div.rn-list-item.page[data-cid][data-interactive-target-type="page"]`（**不带** `layer-item`）；
  「页面」列行项 `div.rn-list-item.layer-item.interactive-target-hotspot[…=canvasList]`（**带** `layer-item`）；
  「图层」列行项 `div.rn-list-item.layer-item[data-cid]`（**带** `layer-item`）。
  故 `layer-item` + 「是否在图层树容器内」两个信号足以把真画布行与页面/图层列行分开。

**修复 A —— 定位不再依赖容器锚点（BUG-0013）**
- `findCanvasEl` 改为**只允许两个拒绝理由**：① 落在图层树 / 状态页 / 交互树容器内；
  ② 行项带 `layer-item` 类名。**不再**由任何容器识别结果（`canvasPanelPresent` / 黑名单）
  压制候选 → 定位对**真画布行不缩水**（凡 v1.0.16 能命中并点击的真画布行，本版也命中；
  唯一收窄是永不点 v1.0.16 会误命中的页面/图层列行）。
- 优先级排序 `canvas > canvasWrapped > page > other`：只要容器可识别，必优先选中「画布」列
  那一行；把「无归属」的 `other` 排到**最低**。⚠ 这是对初版 `canvas > other > canvasWrapped > page`
  的**修正**——QA 复核发现旧序会把「未知面板里、无 `layer-item`、不在任何已知容器内、且与目标
  同 cid」的杂散行（`other`）排在真画布行（`canvasWrapped` / `page`）之前而误点；已用 **D4** 锁定。
- `canvasPanelPresent` 降级为**仅供诊断**，并把其死亡兜底分支改成诚实实现。
- `isCanvasPanelItem`（**建标签**判据）**保持不变**（BUG-0011 教训）。
- `diagnoseLocateFailure` 大幅加固（对每个同 cid 元素输出签名 / 归属 / 被拒原因 / 祖先链）。

**修复 B —— 点标签后「滚到目标行并保持 + 左栏选中态」（BUG-0014）**
- 新增 `isRowInScroller(el, sc)`：用 `getBoundingClientRect` 与滚动容器客户区比较，判行是否落在
  **可视矩形**内（上下各 4px 容差）。与只判渲染树的 `isRowVisible` **语义区分**（注释写清）。
- 新增 `getRowScroller(el)`：向上找最近的 `overflowY∈{auto,scroll}` 且可滚动的祖先，取不到退回
  `getCanvasScrollContainer()`。
- **改进 `getCanvasScrollContainer()`（用户点名要做的一项）**：候选**起点不止「第一个画布行」**——
  取不到行时把**「画布列容器本身」**也纳入起点向上找滚动宿主，避免「一屏都没渲染出行」时直接返回
  `null`、整条滚动兜底被跳过；**绝不用页面列的行当起点**而滚错容器。
- 新增 `scrollRowIntoView(id, el, center)`：先**按 id 重新定位**行（`findCanvasEl(id,true) || el`，
  不用可能已被 React 重建的旧节点）→ 用 rect 差算出相对滚动宿主的 `rowTop` → 设 `sc.scrollTop`
  （`clamp` 到 `[0, scrollHeight-clientHeight]`；`center` 为真居中、否则只保证完整可见）→ 另调
  `row.scrollIntoView({block:"nearest"})` 兜底。
- 新增 `keepRowVisible(id, ms)`：在 rAF、+60ms、+180ms、+400ms、+800ms（不超过 `ms`）各复查一次；
  行已在 `sc` 可视区内就**提前结束**；被复位就重新 `scrollRowIntoView`；行被重建就重新
  `findCanvasEl(id,true)` 再滚；**用户一旦手动滚动立即放弃**（`document` 上临时监听 `wheel`/`keydown`，
  `sc` 上监听 `pointerdown`/`touchstart`，capture + `{passive:true}`，触发即解绑全部监听）；
  token 与 `revealToken` 联动（新切换 / `destroy` 令在飞纠偏失效）。
- **左栏选中态**：目标行若已带墨刀自身激活类（`.active`/`.is-active`/…）就**什么都不做**；否则给定位到
  的那一行加 `md-rt-located`，并从上一行移除（模块级记住上次标记节点）。样式由注入的 `<style>` 提供
  （左侧 3px 主色竖条 + 淡背景；**无 `!important`**、**不覆盖** `display`/`position`/`height`）。标记可逆：
  切标签时移动、`onClose` 与 `destroy` 时清除、`keepRowVisible` 复查时对新节点补标记。
- `activateCanvas` 改为：`setStale(id,false)` → `touch(id,name)` → `scheduleRender()` →
  `ensureRowVisible(id, el)`（保留展开折叠分组能力）→ `scrollRowIntoView(id, target, false)` →
  `target.click()` → `scrollRowIntoView(id, target, true)` + `keepRowVisible(id, 800)` + 落选中态 →
  `bar.setActive(id)`。
- **不动**：`rejectReason` / `LOCATE_PRIORITY` / `findCanvasEl` 的接受规则 / `isCanvasPanelItem` /
  `eachCanvasItem`（防 BUG-0011、D4 回退）。

**验证（三方 A/B + 对抗性自证，缺一不可）**

> ⚠ **v1.0.17**：本地提交号 `5f08557`（本地 tag `v1.0.17` 亦指向它）；矩阵统一用**提交号**，
> 避免 tag 缺失时 `git show` 静默失败。
> ⚠ **旧 1.0.18（即临时 1.0.19 包）从未提交**（无 tag / 无提交号），故不作为 A/B 矩阵对照；
> 其对 BUG-0013 的失败由 D1/D2 用例锁定，并可用 `scripts/mk-core-rejected.py` 生成的
> **「被否决实现等价核心」** 手工反向对照。

```bash
# ① 修复版：必须全绿（含 C/D/E 各组）
python tests/test_relocate_collapsed.py
python tests/test_canvas_panel_only.py            # T11 等保护项不得回退
# ② v1.0.17（提交 5f08557）原样核心：必须复现用户原话（未找到画布）
git show 5f08557:recent-tabs-core.js > _core17.js
python tests/test_relocate_collapsed.py --core _core17.js
# ③ v1.0.16 核心：必须全绿（【回归】组）
git show v1.0.16:recent-tabs-core.js > _core16.js
python tests/test_relocate_collapsed.py --core _core16.js
# ④ 被否决实现（旧定位门控）反向对照：C/D 必须失败
python scripts/mk-core-rejected.py                                 # → _core-rejected.js
python tests/test_relocate_collapsed.py --core _core-rejected.js
# ⑤ 全量回归门禁（含 ①②③ 的自动化 A/B，等价且更可靠）
python scripts/regress.py
```

**对抗性自证（BUG-0014，实测记录）**
- 动手前把当轮修复前的核心备份为 `_core-prev.js`（sha256 `5bef4172…`）。
- `python tests/test_relocate_collapsed.py --core _core-prev.js` 跑 E 组：
  - **E2 失败**（`isRowInScroller('G20')=False`，`scrollerTop=0`）→ **复现用户真机现象**「回到列表顶部」；
  - **E3 失败**（`activeRowCid()=null`）→ 旧核心无左栏选中态标记；
  - E1 通过 → 说明**无复位**时旧核心「点击前滚一次」已足够：**真正锁定 BUG-0014 的是 E2/E3**，
    E1 作为基线回归（防新逻辑破坏「全量渲染 + 滚出可视区」这一既有能力）。

**独立复核（2026-09-17，由独立复核方执行，实现者未参与）**

复核方式：**自写独立探针与脚本**（`tests/_qa_*.py`），不以实现者的用例作为唯一依据。
结论：**修复成立**。

- **E 组 A/B 实测**（修复版 vs `_core-prev.js`）：修复版 E1-E5 **全 PASS**；
  `_core-prev.js` 上 **E1 PASS、E2 FAIL**（`scrollerTop=0`）、**E3 FAIL**（`activeRowCid=null`）、
  E4 PASS、**E5 FAIL**（断言「目标行在可视区」）。E2/E3 与上节「对抗性自证」**完全吻合**。
- **E1 是否构成门禁假绿：不构成**。E1 是无复位场景，旧核心「点击前滚一次」已足够。
  BUG-0014 由 **E2/E3（【需求】组）** 锁定，不由 E1 证明；`ab_expectations.json` 未对 E1
  设预期，内部自洽，无需改动。
- **滚动抢回实测**（t=0 注入手势）：`wheel` / `pointerdown`（拖拽滚动条）/ `keydown`（PageDown）
  三种真实手势下 `scrollerTop=200` **均保留，不抢回**；trackpad 惯性同样派发 `wheel`，亦不抢回。
- **选中态实测**：点 G20 后 `md-rt-located` 只落在 G20、`style` 标签 1 个、无 `!important`、
  `data-*` 未变；切 G25 标记正确迁移；`destroy` 后标记数与 `style` 标签均归 0；
  与墨刀自身激活类 **无冲突**。
- **未回退**：`test_canvas_panel_only.py` T0-T19 全 PASS（含 T11）。
- **门禁**：`scripts/regress.py` **exit=0**（A/B 两条 OK、双副本一致、`VERSION`=1.0.18）。

**已知残留（低危，理论性，本轮不修）**

`keepRowVisible` **未监听原生 `scroll` 事件**：纯程序化修改 `scrollTop`（不派发任何手势事件）
时，在约 800ms 活跃窗内会被回滚到目标行中心（复核实测 `stolen=true`）。因真实用户手势
（`wheel`/`keydown`/`pointerdown`/`touchstart`）均能触发解绑，**用户不可感知**。

> ⚠ **不可简单地补一个 `scroll` 监听**：我方自身的程序化滚动同样派发 `scroll`，
> 监听后会立即自我解绑，导致 BUG-0014 复发。若要修，必须区分「自产 scroll」与「外部 scroll」
> （例如记录期望 `scrollTop` 值、或加写入时间窗），并补对应保护用例。

**未能覆盖**：真机墨刀的**异步多帧重渲染/复位**时序。夹具为**同步一次性复位**，无法完全复现；
真机上「恰好居中」的效果未经真机验证。

**真机复验（2026-09-17，v1.0.18 安装包，用户实测）**

- `data-md-version` = `1.0.18`（版本核对通过，故本轮结论有效）。
- 「点标签后定位」实测：`scroller.top` = `1400`（旧版为 0，即用户报的「回到列表顶部」）；
  目标行 `rectTop=564` 落在滚动容器 `132..736` 内（`inScroller=true`）；
  `offsetFromScrollerTop=432`（容器高 604，落在中下部而非贴顶）。
  `selectedStateSource="molde"`：墨刀自身 `.active.select` 已生效，我方按设计**不加**标记。
  → **BUG-0014 修复在真机生效。**
- **真机 DOM 实录（与夹具的差异，后续写夹具应对齐）**：
  滚动宿主是 `div.rn-content-body.scrollbar2-container#screen-scroll-list`
  （夹具用的是 `div.canvas-col-scroll#screen-scroll-list`）；
  画布行是 `li.rn-content-item` 套 `div.rn-list-item.page`，**两层都带 `data-cid`**
  （故每个 cid 命中 2 个节点，`canvasRowCount=1960` / `distinctCidCount=980` 即由此而来）；
  列表是 `ul.child-screens` 递归**嵌套树**；行激活类为 `active select`（已在
  `ACTIVE_STATE_SUFFIXES` 内，无遗漏）；`id="mobile-page-item"` 在多处重复。
- 写入 `scrollHeight=31376` ≈ 980 画布 × 32px，确认真机画布列表是**全量渲染**（非虚拟化）。

**复验同时确认的一条「非缺陷」行为（不要误判为 BUG）**

失效标签（cid 已不在当前文档中，`hitTotal=0`）会被正确处置：标记 `data-stale="1"`、
保留在标签栏不静默删除、给出可见提示、且**不误点**其它面板的同 cid 节点。
实测「行李RFID标签编码规则」（cid `rbpVRNrB2oi39Izfe`）`hitTotal=0`、`stale=true`，
连点 6 次均走该分支，属**预期行为**。

> ⚠ 但提示文案「请先在左侧画布栏展开或滚动到它，再点击标签切换」对「画布已不存在」的场景
> 属**误导**（展开或滚动都找不到）。建议区分两种失败原因后再给文案：
> cid 在文档中有节点但被折叠/被拒 → 维持现文案；
> cid 在文档中零节点 → 改为「该画布已不在当前文件中，标签已标记为失效」。
> 列为待改进的可用性问题，本版不动（用户范围收缩为「只做第 ③ 项」）。

**BUG-0015 修复（滚动不在可见区 → 点标签定位到画布）**
- **现象（用户本轮原话）**：列表中的画布**无论是否被收缩折叠、还是由于滚动列表不在可见区域**，点击
  画布标签**都要能定位到画布所在位置，并显示画布内容**。其中「折叠」由 BUG-0012/0013/0014 已锁定
  （`ensureRowVisible` + `collectCollapsedToggles` 保持不动）；本项只修「**滚动不在可见区域**」这一条
  （能力 A：修好的 `revealCanvasEl` 滚动扫描）。
- **根因（已取证，非回归）**：`revealCanvasEl`（约 :572-625）做滚动扫描：`:568` 的 `step` 在长列表上被
  **放大分支**（旧 :569-572，`if (maxTop > step*(REVEAL_MAX_STEPS-1)) step = ceil(maxTop/(REVEAL_MAX_STEPS-1))`）
  放大到远超虚拟列表单次渲染窗口（约 `clientHeight`+overscan，实测 604~1000px）。真机 `clientHeight≈604`、
  `maxTop≈30772` → `step=ceil(30772/23)=1338px`，放大到远超渲染窗口；停靠点 0,1338,…,30772（24 档），
  档间留 338~734px **从未渲染过的缝隙**。目标行落在缝隙里 → 24 档扫完从未被渲染 → `findCanvasEl` 恒
  `null` → `notifyUnreachable`（:1135）报「未找到画布」。漏扫比例 25%~55%，与真机「多数失败偶尔成功」吻合。
  该放大分支**自 v1.0.13 即存在**（已逐版本比对 v1.0.13/v1.0.16/v1.0.17/当前，`revealCanvasEl` 除一行注释
  外完全一致），属**原始设计缺陷，不是回归**。
- **修复（R1~R8，均不动 BUG-0012/0013/0014 已锁定的折叠/选中态能力）**：
  - **R1 无缝（根因修复）**：**删除放大分支**。`step` 上限恒为 `Math.max(120, Math.floor(sc.clientHeight*0.75))`，
    **任何情况下不得放大到超过 clientHeight**。
  - **R2 时长有界**：`REVEAL_MAX_STEPS`（:564）24→**90**；整轮扫描总预算 ≤ 2500ms。若按 R1 步长所需档数
    超 90，改**多趟交错扫描**（`passes=ceil(need/90)`，第 k 趟起点偏移 `k*step/passes`，趟内仍按 R1 步长
    前进）。**绝不允许通过放大步长来减少档数**。
  - **R3 抗渲染延迟**：`REVEAL_STEP_MS`（:565）24→**27**（90×27=2430ms ≤ 2500ms，预算余量 70ms）；并在
    扫完所有停靠点仍未命中时做**一次终极复核**（再等一档 + 重查 `findCanvasEl`），不随档数线性放大。
    ⚠ **两个常量联动约束**（代码注释已写明）：「档数 × STEP_MS ≤ 2500ms」。若日后调大 `STEP_MS`，
    必须同步把 `REVEAL_MAX_STEPS` 压到 `⌊2500/STEP_MS⌋` 以内（如 `STEP_MS=32` → `MAX_STEPS≤78`，
    78×32=2496≤2500）；否则整轮超预算，`regress.py` 全量门禁会假失败。
  - **R4** 扫描彻底失败仍还原 `sc.scrollTop = start`（保持现状）；**R5** 保留 `revealToken` 取消语义与
    `callback(el,false)` / `callback(null,true)` / `callback(null,false)` 三态契约不变；
    **R6** 扫描过程中不弹 toast，只保留最终失败提示。
  - **R7（纪律，别越界）**：**不**为「真机折叠检测」新增任何猜测式点击启发式。真机探针显示
    `collapsedToggleCount = 0`（文档里没有任何 `aria-expanded="false"`），说明真机折叠机制未知；
    本项目历史上 BUG-0011/0012/0013 都源于启发式误判，别再犯。`collectCollapsedToggles` 只认
    `aria-expanded="false"`，**保持原样**。改为在 `diagnoseLocateFailure`（:1102 附近）返回对象补一个
    布尔字段 **`rowFoundButHidden`**（`findCanvasEl(id,true)` 能返回行、但该行 `isRowVisible` 为假时置
    `true`），让真机 Console 自己告诉我们折叠是怎么表达的。
  - **R8 文档同步**：模块头注释 `:72-74` 仍写着「③④ 由 `canvasPanelPresent()` 门控」，但实现（:466-486）
    已取消门控、`allowFallback` 是 :485-486 显式声明的死参数。已改正 `:72-74` 为「按 `LOCATE_PRIORITY`
    取最优、无 `canvasPanelPresent` 门控」，与实现对齐。
- **锁定用例**：`tests/test_reveal_gap.py`（夹具 `?rows=980`、`.rn-virtual` 写死 600px、目标行 `P71`）。
  断言分组：【回归】旧核心（v1.0.16，含放大分支）必现「未找到画布」、新核心必过；
  【保护】列表末行 `P980` 两边都必须命中（旧核心靠 `positions` 末尾显式补 `maxTop` 才能中，这条防把
  末尾补档逻辑改坏）。A/B 矩阵见 `tests/ab_expectations.json`（v1.0.16 → `regression_fail`）。

**影响文件**：`recent-tabs-core.js`、`desktop/recent-tabs-core.js`（副本同步，SHA256 一致）、
`VERSION`、`manifest.json`、`tests/fixtures/mock-modao-design-collapsed.html`
（新增 `setFullRender` / `setResetOnSwitch` / `setMoldeActive` / `isRowInScroller` / `activeRowCid`）、
`tests/test_relocate_collapsed.py`（新增 E1-E5）、`tests/test_reveal_gap.py`（新增 BUG-0015 长列表定位回归）、`tests/fixtures/mock-modao-design-virtual.html`（改：支持 `?rows=N`、写死 `.rn-virtual` 600px）、`tests/ab_expectations.json`（补 `test_reveal_gap.py` A/B）、`tests/README.md`、
`README.md`、`README.browser.md`、`scripts/mk-core-rejected.py`（由 `mk-core18.py` 改名）、
`scripts/probe-locate-scroll.js` / `scripts/probe-locate-scroll.min.js`（真机复验探针，新增）、
`.gitignore`、`CHANGELOG.md`（本文件）。

---

### v1.0.17

- 需求：点左栏「页面」「图层」不得在顶部「最近画布」生成无效标签（BUG-0010）。
- 修复：按容器锚点判定归属；判据最终定为「**只做排除**」（BUG-0011 教训：白名单过严会
  把真画布点击一起拒掉）。
- 另修：进入设计文件带出当前画板（种子窗口 15s + 名称唯一才反查）、时间戳严格递增、
  同时监听 `mousedown` 与 `click`（画布切换发生在按下阶段，重排会吞掉 click）。
- ⚠ **本版引入 BUG-0012**（见上）。

### v1.0.16
- 修复浮动模式热区 div 遮挡/拦截工具栏（BUG-0009）：改为窗口顶部 4px 边缘触发，不注入 DOM。

### v1.0.15
- 取消「工具栏上方/下方」位置切换，固定显示在工具栏上方。

### v1.0.14
- 切换成功后不再自动恢复原检索词（BUG-0008）。

### v1.0.13
- 点标签定位不到时先清空搜索框 / 按名检索重定位（BUG-0007）；标签不再静默删除（BUG-0005）。

### v1.0.12
- 修复点标签被误删导致无法切换（BUG-0005）。

### v1.0.11 / v1.0.9
- 选项页设置改用 `chrome.storage` + 广播生效（BUG-0004 / BUG-0003）。

### v1.0.7 / v1.0.8
- A2 内容区下推避让固定标签栏（BUG-0002）；标签栏位置可配置。

### v1.0.0
- 首个可用版本：本地注入标签栏 + 最近画布切换 + 单标签关闭 + 下拉列表。

---

## 三、改动纪律（每次都照做）

1. **先取证，后动手**：用 `git show <tag|commit>:recent-tabs-core.js` 取基线做语义 diff，
   禁止凭记忆断言「上个版本是好的」。
2. **先红后绿**：每个缺陷先有能复现的夹具/用例（必须出现用户原话里的现象），再改代码。
   夹具必须照真机 DOM 契约构造，并带「反向对照」证明夹具具对抗性。
3. **只放宽该放宽的**：定位放宽时，**建标签收窄不得放宽**（BUG-0010 不得回退），
   反之亦然。任一方向改动都要在台账里写明「另一方向为何不受影响」。
4. **两副本一致**：根目录 `recent-tabs-core.js` 与 `desktop/recent-tabs-core.js` 必须同步
   （`scripts/regress.py` 会校验哈希）。
5. **三处版本同升**：`VERSION` / `manifest.json` 的 `version` / 核心 `MD_VERSION`
   （并写到 `#md-recent-tabs-root[data-md-version]`，真机可在 Console 核对）。
6. **全量回归门禁**：`python scripts/regress.py` 必须 `rc=0`（含 A/B 对照），否则不许发版。
7. **登记三件套**：新修复必须 (a) 在本文件「已修复缺陷索引」加一行、写明现象/根因/锁定用例，
   (b) 新增能复现用户原话的用例（按【回归】/【需求】/【保护】分组标注），
   (c) 在 `tests/ab_expectations.json` 补一条 A/B 对照（上一个好版本记 `regression_pass`、
   引入该缺陷的版本记 `regression_fail`）。
   **没有用例的修复视为没修；没进 A/B 矩阵的修复下次可能被静默回退。**
8. **引用历史版本统一用「提交号」而非「tag」**：本仓库 tag 不连续（缺 v1.0.1–v1.0.6、
   v1.0.10 等）。**注意：`v1.0.17` tag 实际存在，指向提交 `5f08557`**（早期文档误记为
   「从未打 tag」，已更正）；但 A/B 矩阵仍**统一用提交号**书写，避免 tag 被移动或缺失时
   `git show` 静默失败导致假跳过。写脚本/文档要引某版本核心时，先
   `git rev-parse --verify --quiet <ref>` 确认可解析，取不到就改用提交号。
   取不到的版本不得进 `tests/ab_expectations.json`。
9. **真机复验**：内网 `10.83.117.101:9080` 需登录，无法远程调试；夹具通过后在真机
   Console 跑自检脚本核对（`data-md-version` + 本文件登记的诊断输出）。
10. **版本号冻结纪律（本轮新增）**：在未获用户**明确确认「修复完成、正式发布」**之前，
    **禁止改动三处版本号**（`VERSION` / `manifest.json` / 核心 `MD_VERSION`）。
    期间如需给用户真机试装，用**当前待发布号**打包并在本文件登记试装事实，**不得**临时另起
    一个新的版本号（否则会出现「改了没生效 / 到底跑的是哪一版」的排查灾难——1.0.19 的教训）。
