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

**当前发布状态（2026-09-17 22:20，用户决定）**：**暂不发布，先观察几天**。
代码已在 `main`（`535bcd4`），门禁 `rc=0`，试装包就绪，**但版本号仍冻结在 `1.0.18`、未打 tag、未发 Release**。
用户确认无误后再解冻发布。

> ⚠ **发布时不能用 `1.0.19`**：上面已记过，`1.0.19` 曾被用作**临时试装包**的号，
> 再拿它发正式版会让「真机跑的是哪一版」又一次说不清（这正是 1.0.19 事件的教训）。
> **正式发布请用 `1.0.20`**，并在本文件登记包 sha256。

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
| **BUG-0016** | **≤ v1.0.13（原始设计缺陷，非回归）** | **v1.0.18（定位加固第 2 轮）** | **画布在「收缩折叠」的分组里 → 点标签报「未找到画布，请先在左侧画布栏展开或滚动到它，再点击标签切换」（用户 2026-09-17 再次上报，与 BUG-0012 同话术）。三种容器/黑名单解释都已在前几轮排除，问题仍存在** | **循环依赖：唯一的展开入口 `ensureRowVisible` 只在 `activateCanvas` 内被调用，即「**已经找到行之后**」才尝试展开；而折叠闭合的分组其子行不在 DOM（或 `display:none`）⇒ 找不到行 ⇒ 永远走不到展开。**要展开得先找到行，要找到行得先展开** —— 任何 DOM 契约下都无法收敛** | `tests/test_locate_hidden.py`（**H1 锁定**；A/B 矩阵 6288b2d→regression_fail） |
| **BUG-0017** | **≤ v1.0.13（原始设计缺陷，非回归）** | **v1.0.18（定位加固第 2 轮）** | **同 BUG-0016 的现象；尤其是真机搜索框文案/位置与代码假定不一致时（真机折叠分组里的画布永远点不到）** | **能力互相短路：`locateCanvas` 开头 `if(!box){fail();return;}`。`findScreenSearchBox` 只认「placeholder 含 搜索/查找/检索 + 宽>40 + 视口顶部 300px 内」三条硬条件，任一与真机 UI 漂移即返回 null ⇒「清空过滤 / 按名检索 / 展开折叠」三条能力被整体跳过，只剩滚动扫描（对折叠行无效）→ 报「未找到画布」** | `tests/test_locate_hidden.py`（**H3 锁定**） |
| **BUG-0018** | **≤ v1.0.13（与 BUG-0012 同源，只是换了个类名）** | **v1.0.18（定位加固第 2 轮）** | **画布行被 `.layer-sortable-list` 包住时（「画布」列在存在分组 / 需要滚动时复用该组件）点标签报「未找到画布，请先在左侧画布栏展开或滚动到它」** | **`.layer-sortable-list` 与页面列的 `.canvas-sortable-list` 属**同一套 sortable 组件**、同样会被「画布」列复用，却在图层树黑名单里被**无条件拒绝** → 行即使在 DOM 里也永远查不到。BUG-0012 只给 page-list 类名开了「画布列优先」的口子（改判 `canvasWrapped`），layer-tree 的组件类名没开** | `tests/test_locate_hidden.py`（**H4 锁定**） |
| **BUG-0020** | **≤ v1.0.18 定位加固第 2 轮（R5 检索词阶梯引入）** | **v1.0.18（第 3 轮，`MD_BUILD=locate-robust.7`）** | **「按名检索失败后的兜底」不完成：既不弹 toast，搜索框也卡在注入的检索词上（期望还原为原值）。门禁 `test_qa_v1013_edge` Q4 组 4/8、`test_relocate_search` R3 组 8/11** | **R5 的「检索词阶梯」（全名 → 前 8 → 前 4）每一档都用完整的 `LOCATE_TIMEOUT_MS`(2s)，最坏把检索阶段从 2s 放大到 3×2s=6s，撑爆既有用例的等待窗口（Q4 按「清空 ≤2s + 检索 ≤2s + 兜底」设计只等 4700ms；R3 只等 2800ms）⇒ 兜底来不及执行。属**耗时放大**，不是逻辑错** | `tests/test_qa_v1013_edge.py::test_q4_...`（Q4 组 8/8）、`tests/test_relocate_search.py::test_r3_...`（R3 组 11/11） | | **v1.0.18（定位加固第 3 轮，`MD_BUILD=locate-robust.5`）** | **点左栏画布建标签 → 收缩折叠其父文件夹 → 点该画布的标签 → 「无法正常定位上一个画布的位置，也无法显示画布」；真机同时出现「左栏滚了但滚错位置」与 toast「未找到画布…」。用户第 8 次上报同一现象** | **三个根因叠加，前两个使「事后检测折叠」在物理上不可能**：① 真机折叠 = 子 `ul` **移出 DOM**、DOM 里零痕迹（`ariaExpanded.count=0`、`structCandidates=[]`）⇒ aria / 结构判据都无对象；② `CANVAS_PANEL_SELECTORS` 四个锚点在真机**全部失配**（scroller 只剩 `.rn-content-body.scrollbar2-container`），而两个展开函数有「无锚点直接返回 0」的护栏 ⇒ **静默空操作**；③ 左栏搜索框**未点「搜索画布」前不渲染**，`findScreenSearchBox()` 恒 null ⇒ 检索链整体跳过 | `tests/test_locate_hidden.py::test_h8_real_machine_expander`（**15 条断言**；A/B：`b1adeef` → **9/15 失败**，toast 逐字命中用户原话） |

| **BUG-0022** | **v1.0.18（种子画布缺父文件夹链）** | **v1.0.18（MD_BUILD=locate-robust.9）** | **进入设计文件默认带出的画布（种子画布）被折叠进画布树 + 父级文件滚出可见区后，点其标签提示「找不到画布」；之后点过的画布切换正常** | **种子路径 `syncActiveScreen` 只调 `touch()` 建标签，从未调 `collectGroupPath()`，致 `groupPath[id]` 为空。真机折叠=子 `ul` 出 DOM 且无搜索框，唯一能重新展开的 `expandRecordedPath()` 依赖 `groupPath` → 缺链即失败；点击路径 `trackCanvasFromEvent` 有记录故正常** | `tests/test_seed_folded.py`（**已实跑验证 2026-09-18**：修复版 `locate-robust.9` → S1 6/6 + S3 2/2 + S4 2/2、`EXIT=0`；【回归】种子画布折叠+滚走后点标签必须展开定位并切换；【保护】不凭空长标签 / autoSeed 闸门不变。**A/B**：`9d7827f`（`locate-robust.8`，修复前）→ **【回归】组失败**、title 未切换、toast 逐字命中用户原话「未找到画布…」；已登记 `tests/ab_expectations.json`） |

---

## 一之二、~~已知红灯（**未修复**，单独开一轮专修）~~ → **已于本轮修复（BUG-0020）**

> 登记理由：不写下来就等于丢。这两个失败**不是 BUG-0019 引入的** —— 已用 `b1adeef` 的核心
> 换盘实测，两条在基线上以**完全相同的断言、完全相同的数值**失败（见下「验证」列）。
> 它们让全量门禁 `rc≠0`，故 BUG-0019 本轮**不满足**「门禁 rc=0 才可发版」这一条，
> 经用户同意：**本轮先提交，红灯下一轮专修**。

| BUG-ID | 状态 | 现象 | 初步定位 | 影响面 | 验证 |
|---|---|---|---|---|---|
| **BUG-0020** | **已于 2026-09-17 修复**（根因：R5 阶梯把检索阶段耗时从 2s 放大到最多 6s，撑爆用例等待窗口；修法：整段有界 `SEARCH_TOTAL_MS=2000` + 档间按剩余档数均分）。修复后 `test_qa_v1013_edge` 与 `test_relocate_search` 均 `EXIT=0`。保留本段作为**过程记录**：它证明了「全量门禁从第 2 轮起就没被真正跑绿过」。 |

> ⚠ 顺带发现一件更要紧的事：上一轮（定位加固第 2 轮）CHANGELOG 的「本轮门禁结果」写着
> **「待填」** ⇒ **全量门禁从第 2 轮起就没被真正跑绿过**。2026-09-17 是第一次完整跑它，
> 一跑就暴露了这两个红灯。以后每轮收尾都必须真的跑 `scripts/regress.py`，不能只跑新增用例。

---

## 二、版本明细

#### 定位加固第 3 轮（2026-09-17，BUG-0019）

> **真机已由用户按 3 步复现验证通过（2026-09-17 20:50，构建 `locate-robust.4`）。**
> 本轮把「真机实测到的 DOM 契约」落成夹具与用例，并完成 A/B 反向对照。

**为什么前 7 轮修不掉（本轮取证才拿到答案）**

前三轮（BUG-0012/0013/0015）修的是**判据**，第 2 轮（BUG-0016/0017/0018）修的是**调用顺序与编排**。
本轮取证证明：**在真机 DOM 下，「事后检测折叠」这条路根本不存在**，所以任何判据都修不好：

| 真机实测 | 后果 |
|---|---|
| 折叠 = 子 `ul` **移出 DOM**；`ariaExpanded.count = 0`；`structCandidates = []` | aria 展开、结构展开**都没有对象**可作用 |
| scroller 只有 `.rn-content-body.scrollbar2-container`，`#screen-scroll-list` 等锚点**全部失配** | 两个展开函数「无锚点 ⇒ 返回 0」的护栏触发 ⇒ **不报错、直接空操作**（极易被误判为「判据没匹配上」） |
| 左栏 `input/textarea` 数为 0（**搜索框需先点「搜索画布」按钮才渲染**） | `findScreenSearchBox()` 恒 null ⇒ 检索重定位整条链被跳过 |

**修复（路径驱动，取代猜测驱动）**

- **S1 记录父分组链**：`trackCanvasFromEvent` 建标签时（此刻画布可见）调 `collectGroupPath()`，
  收集祖先文件夹 cid（外层→内层）存进 `groupPath[id]`。文件夹行识别用**行自身**的
  `div.rn-list-item.folder`（不依赖容器锚点），并用 `layer-item` + 面板级硬黑名单排除图层列。
- **S2 按记录展开**：`expandRecordedPath()` 逐级 `clickSuppressed(item.querySelector("a.expander"))`，
  每级等 `LOCATE_STEP_MS`（墨刀 React 重渲染是异步的）。`a.expander` 是**真实语义类名**
  （非 styled-components 哈希），真机实测确认。
- **S3 已展开判定**：`folderRowExpanded()` 用「行内是否存在**带布局盒**的 `ul`」。
  ⚠ 不能只查 `li.children` 的直接 UL —— 真机是 `li > [div, ul]`，夹具是 `li > div > ul`，
  两种都要覆盖。
- **S4 编排前置**：`locateCanvas` 把「路径展开」放在搜索两阶段与 aria 展开**之前**
  （后者在真机恒为空操作）。路径走不通再退回老路，不丢兜底。
- **S5 探针可达性修复**：content script 是 **isolated world**（`manifest.json` 未声明
  `"world":"MAIN"`），挂在 `window` 上的 `__mdRtProbe` 对 DevTools Console **不可见** ——
  这个探针此前在真机上**从来没被取到过**（夹具用 `add_script_tag` 注入属页面主世界，所以测试一直绿）。
  现同时挂到 `root.__mdRtProbe`（DOM 节点属性跨世界可读写）。

**验证（A/B 反向对照，缺一不可）**

| 核心 | H8 | 现象 |
|---|---|---|
| 当前（`locate-robust.5`） | **15/15 PASS** | 定位成功、分组展开、标题切换、无 toast |
| `b1adeef`（修复前 = `locate-robust.3`） | **9/15 FAIL** | toast **逐字命中用户原话**「未找到画布「历史画布 05」，请先在左侧画布栏展开或滚动到它，再点击标签切换」；`clickLog=[]`、标题未切换、分组未展开 |
| H1–H7 在 `b1adeef` 上 | 11/10/8/12/9/12 **全过** | 无误伤，失败**只**落在 H8 |

**夹具教训（本轮踩到的两个坑，务必记）**

1. **假绿：夹具折叠时仍留着「空的隐藏 `ul`」** → 旧核心的 R9（结构判据：可见行内含不可见 `ul`）
   照样能展开，H8 在旧核心上也 14/14 全绿。修正：新增 `setCollapsedDetached(true)`，
   折叠时把子列表容器**整个 `removeChild`**（真机实测折叠态 `<li>` 只有 1 个子元素）。
   **默认关**，保持 H1/H5 原样不变。
2. **A/B 假失败：用 PowerShell 裸 `>` 导出 `git show <ref>:recent-tabs-core.js` 会写成 UTF-16LE**
   （`\xff\xfe` BOM）→ Playwright 读它抛 `UnicodeDecodeError` → **每一组都只记 1 条断言且失败（0/1）**，
   看起来像「旧版本必现缺陷」，其实是**旧核心压根没跑起来**。
   判据：**看到「所有组都 0/1」= 编码问题，不是证据**。改用 Python `subprocess` 落盘 UTF-8。

**未能覆盖 / 仍待办**

- **路径只记在内存**：刷新页面后旧标签没有路径记录，仍会退回老路（大概率仍失败）。
  是否持久化到 localStorage 待用户决定（现有 `seen` 本身就没有落盘，加它属于新增持久化面）。
- **「滚错位置」的回滚未修**：`:701` 的 `sc.scrollTop = start` 在真机没生效，原因未查。
  主路径通了之后再单独动它，避免一次改两处说不清因果。
- **搜索框兜底未做**：已知搜索框需先点「搜索画布」按钮，按钮 DOM 签名已给出取证脚本但尚未取样。

**BUG-0020（顺带修掉的两个预存红灯，2026-09-17）**

> 这两个失败**不是 BUG-0019 引入的**：用 `b1adeef` 的核心换盘实测，两者在基线上以
> **完全相同的断言、完全相同的数值**失败。它们让门禁 `rc≠0`，故本轮一并修掉。

- **根因（耗时放大，不是逻辑错）**：定位加固第 2 轮的 R5 引入「检索词阶梯」（全名 → 前 8 → 前 4），
  但**每一档都用完整的 `LOCATE_TIMEOUT_MS`(2s)** ⇒ 检索阶段从 2s 放大到最多 **3×2s=6s**，
  撑爆既有用例的等待窗口：
  - `test_qa_v1013_edge` Q4 的 4700ms 是按「清空 ≤2s + 检索 ≤2s + 兜底」设计的；
  - `test_relocate_search` R3 只等 2800ms。
  结果：兜底链（`restoreSearch()` + `fail()`）**来不及执行** ⇒ 不弹 toast、搜索框卡在注入词上。
- **修法（整段有界 + 档间均分）**：新增 `SEARCH_TOTAL_MS = 2000` 作为阶梯**总预算**，
  每档预算 = `剩余时间 / (剩余档数 + 1)`，下限 `2×LOCATE_STEP_MS`。
  能力保留（三档都会被尝试），耗时压回 ≤2s。
  ⚠ 常量联动：`SEARCH_TOTAL_MS` 调大 ⇒ 相关用例的等待窗口必须同步放宽。
- **验证**：`test_qa_v1013_edge` Q4 组 8/8、`test_relocate_search` R3 组 11/11，两者 `EXIT=0`。

**BUG-0021（「滚错位置」的回滚：已实现 + 回归通过，但**锁定用例未完成**）**

> 用户要求的第 5 项。⚠ 按「没有用例的修复视为没修」，这一项**还不能算修好**。

- **现象**：定位**失败**时左栏「滚了，但滚错位置」，没有回到点击前的位置。
- **根因**：`revealCanvasEl` 只做**单次** `sc.scrollTop = start`，在真机上无效，两条原因：
  ① 墨刀重渲染会**重建**左栏节点 ⇒ 扫描开始时捕获的 `sc` 已脱离文档，写它不产生可见效果；
  ② React 重渲染会在我们写入**之后**再次复位 `scrollTop`。
- **修法**：新增 `restoreScrollTop(start, token)` —— 多帧反复写回（600ms / 每 80ms 一档）、
  **每帧重取**滚动宿主（应对节点被重建）、用户一旦 `wheel`/`keydown`/`pointerdown`/`touchstart`
  立即停止、`revealToken` 变化立即停止。与成功路径 `keepRowVisible` 同一套纪律。
  ⚠ **不能补 `scroll` 监听**：程序化改 `scrollTop` 也派发 `scroll`，会自我解绑（BUG-0014 实测过的坑）。
- **回归**：`test_reveal_gap` / `test_relocate_collapsed` / `test_locate_hidden` /
  `test_relocate_search` / `test_qa_v1013_edge` 均 `EXIT=0`。
- **⏸ 未完成：`tests/test_locate_hidden.py::test_h9_failure_restores_scroll` 写好但尚未通过，
  已摘出 `main()`（硬注册会把门禁染红 = 用失败用例假装锁住缺陷）。已定位的坑：**
  1. 用「折叠 + detach」造失败 ⇒ 列表变短、`scrollerMax=0` ⇒ `start` 恒为 0，
     断言退化成 `0 == 0` 的空转（**已假绿过一次**）。改用夹具新增的 `removeRow(cid)` 才拿到 `start=806`。
  2. 关掉干扰（窗口 0）后 `got=51 ≠ 0`，说明多帧复写**确实有作用**，但固定 `sleep` 测不到终态
     （等待 2000ms + 收 toast 1500ms 仍太早，toast 也没收到）⇒ 失败链耗时比预估长。
     下一步：**把等待改成轮询** `wait_for_function`（等 `scrollerTop` 稳定 + toast 出现）再断言。
  3. 已排除：`setResetOnSwitch` 默认 `false`，不是干扰源。
- **夹具新增**：`armScrollResetOnce(ms)`（窗口期内每次滚动都把 `scrollTop` 归零，模拟 React 连续复位；
  ⚠ 必须是**窗口期**而非「只复位一次」——只复位一次会被扫描阶段的滚动消耗掉，导致假绿）、
  `removeRow(cid)`（真正删除一行，用于造「必然失败但列表仍长」）。

**本轮门禁结果（2026-09-17，`MD_BUILD=locate-robust.7`）**：`python scripts/regress.py` **rc=0**

| 段 | 结果 |
|---|---|
| [1/4] 一致性 | 双副本 SHA256 一致；`VERSION` / `manifest` / `MD_VERSION` 三处均为 `1.0.18` |
| [2/4] 全量回归 | 10 个用例**全部 rc=0、0 失败**（含此前两个红灯） |
| [3/4] A/B 对照 | 5 条全部符合预期：`test_relocate_collapsed` v1.0.16→pass、`5f08557`→fail；`test_reveal_gap` v1.0.16→fail；`test_locate_hidden` `6288b2d`→fail(15)、`b1adeef`→fail(3) |
| [4/4] 结论 | ✅ 门禁通过 |

> ⚠ **过程教训（务必记住）**：上一轮 CHANGELOG 的「本轮门禁结果」写的是**「待填」**
> ⇒ **全量门禁从第 2 轮起就没被真正跑绿过**。2026-09-17 是第一次完整跑 `scripts/regress.py`，
> 一跑就暴露了 BUG-0020。**以后每轮收尾必须真跑门禁，不能只跑新增用例。**

**影响文件**：`recent-tabs-core.js`、`desktop/recent-tabs-core.js`、
`tests/fixtures/mock-modao-design-collapsed.html`（新增 `expander` 模式 + `setCollapsedDetached`）、
`tests/test_locate_hidden.py`（新增 H8；`current_build()` 改为从被测核心读出，不再硬编码指纹）、
`tests/ab_expectations.json`、`CHANGELOG.md`（本文件）。⚠ 三处版本号仍冻结 `1.0.18`。

---

### v1.0.18（开发中，待发布）

> 本版把「临时 1.0.19 包」的定位加固**并入**，并新增 BUG-0014 的「滚动 + 左栏选中态」修复。
> 版本号统一收敛回 `1.0.18` 并冻结。

#### 定位加固第 2 轮（2026-09-17，BUG-0016 / BUG-0017 / BUG-0018）

**用户再次上报（2026-09-17）**

> 「曾经打开的画布仍在左侧顶部画布列表中，只是被收缩折叠不可见，点击画布标签提示：未找到画布，
> 请先在左侧画布栏展开或滚动到它，再点击标签切换。」「修改了那么多轮这个问题仍然存在！
> 我的要求是列表中的画布**无论是否被收缩折叠还是由于滚动列表不在可见区域**，点击画布标签
> 都要能定位到画布所在位置，并显示画布内容。」

**为什么前几轮修不掉（性质不同，务必先读这段）**

前三轮修的都是**判据类**缺陷 —— 容器锚点识别错误（BUG-0013）、黑名单误判（BUG-0012）、
扫描步长放大漏档（BUG-0015），改动全落在 `findCanvasEl` 的**候选接受规则**与
`revealCanvasEl` 的**扫描步长**上。本轮三个缺陷是**结构性**缺陷（调用顺序 / 能力编排 /
同一个类名的另一处），不在同一条路径上，所以按前几轮的思路继续改是**收敛不了**的：

| | 缺陷 | 为什么前几轮修不到 |
|---|---|---|
| BUG-0016 | **循环依赖**：`ensureRowVisible` 只在 `activateCanvas` 内被调用，即「**已经找到行之后**」才尝试展开；折叠让行找不到 ⇒ 展开步骤永远执行不到 | 它是**调用顺序**问题，不是判据问题。只要「先找到行、再展开」这个顺序不变，**任何** DOM 契约下「折叠不可见」都修不好 |
| BUG-0017 | **能力互相短路**：`locateCanvas` 开头 `if(!box){fail();return;}` ⇒ 搜索框探测失败时，「清空过滤 / 按名检索 / 展开折叠」三条能力被整体跳过 | 它是**能力编排**问题。前三轮都在改 `findCanvasEl` 的接受规则，没人动过这条短路的入口 |
| BUG-0018 | **同类名黑名单**：`.layer-sortable-list` 与页面列 `.canvas-sortable-list` 属同一套 sortable 组件、同样被「画布」列复用，却在图层树黑名单里被无条件拒绝 | BUG-0012 只给 page-list 类名开了「画布列优先」的口子，**layer-tree 的组件类名没开** —— 同一个 BUG 换了个类名 |

**修复（R1~R8'，只放宽「定位」侧）**

- **R1 新增 `expandCollapsedInCanvasPanel()`（打破循环依赖，BUG-0016 根因修复）**：
  **不依赖目标行是否在 DOM**，只在「画布」列容器范围内展开所有 `aria-expanded="false"` 的开关
  （最多 `EXPAND_MAX=10` 个，每轮**重新扫描**，节点上用 JS 私有 expando 记录「本轮已点」，
  **不写 `data-*`**、不污染宿主 React 会读回的字段）。画布列锚点一个都没有时**直接返回 0**
  （无锚点 ⇒ 无法界定安全范围，宁可不点）。
- **R2 `locateCanvas` 取消短路，改为能力串联（BUG-0017 根因修复）**：无搜索框时不再 `fail()`，
  而是跳过搜索两阶段、继续执行「展开折叠分组」。`allFailed()` 里先展开；**展开过**就
  `pollFind` 等墨刀重渲染再判成败（React 异步），**无可展开项**则立即 `fail()`，
  不给「画布确实不存在」的场景平白加时延。
- **R3 `findScreenSearchBox` 改四级探测（结构优先、文案/几何兜底）**：
  L1 缓存上次用过的框（仍在文档且可用）→ L2 **画布列容器内**的文本类输入框（不依赖
  placeholder、不依赖绝对坐标）→ L3 放宽词表（含 `关键字/名称/search/filter`）且去掉
  `top<300` 限制 → L4 原严格规则（保持老夹具 / 老真机行为不变）。命中级别记入
  `lastSearchBoxSource` 并写进诊断对象。**写值/取值语义（`setSearchValue`）一字未改。**
- **R4 黑名单拆分（BUG-0018 根因修复）**：`LAYER_TREE_HARD_SELECTORS`
  （`#mb-enabled-layer-list` / `#layer-scroll-list` / `.layer-scroll-list` / `.mb-layer-panel` /
  `#mb-state-list` / `#interaction-tree-*` —— **面板级容器**）**无条件拒绝**；
  `LAYER_TREE_SHARED_SELECTORS`（`.layer-sortable-list` —— **共享 sortable 组件类名**）
  **仅在「不在画布列内」时拒绝**。与 v1.0.18 对 `.canvas-sortable-list` 的处理**完全对称**。
  防误点仍由「行项带 `layer-item`」这条**容器无关**判据兜底（真机取证：真画布行不带，
  图层/页面列行必带）。
- **R5 检索词阶梯**：情形二从「只试前 8 个字符」改为**有界阶梯**（全名 → 前 8 → 前 4，去重），
  逐个尝试、命中即停。真机画布名常带后缀（如「航班座位号查询（说明）」），把整名塞进搜索框
  可能因墨刀的分词 / 模糊匹配策略而不命中。
- **R6 需求冲突消解（BUG-0008 ↔ BUG-0014）**：切换成功后按 BUG-0008 清空检索词，但**清空后
  复核**目标行是否仍找得到 —— 找不到就把检索词**写回**。理由：目标行若本来就靠检索才现身
  （它在折叠分组里），一清空就立刻消失，用户看到的是「刚定位到又没了」。
  **宁可让左栏停在检索态（那一行看得见），也不让定位结果消失。**
- **R7 构建指纹 `MD_BUILD`**：写到 `#md-recent-tabs-root[data-md-build]`（本版 =
  `locate-robust.3`；`.2` → `.3` 的差异见 R9）。版本号按改动纪律第 10 条**冻结在 1.0.18**（未获用户确认不得改），
  可真机复验又必须先证明「跑的是哪一份代码」→ 把构建标识与版本号**解耦**。真机核对：
  `document.querySelector('#md-recent-tabs-root').getAttribute('data-md-build')`。
  诊断对象同时新增 `build` / `searchBoxSource` / `panelCollapsedToggles` / `panelStructuralToggles`
  （后两个**只统计不点击**）。
- **R8' 文档同步 + 防御**：模块头注释补本轮条目；`insideAny` 加 `undefined` 防御 ——
  新增面板字段时，若有调用点传**自行拼装的部分**快照（只含 `canvas`/`layerTree`/`pageList`），
  会在 `containers.length` 处抛错并**打断整条初始化**（本轮开发中真实踩到，见下「自曝偏差」）。
- **R9 末位兜底「按结构展开折叠分组」（`expandCollapsedByStructure`）——R7 的唯一受限例外**：
  触发条件 = 「搜索两阶段 + aria 展开」**全都为空**。此时现状是**必然失败、无任何退路**，
  而真机折叠**已确证不是 aria**（`collapsedToggleCount = 0`），所以这个组合必须补一条路。
  判据是**结构**而非猜测信号：在「画布」列锚点容器内，一个**自身有布局盒**的行
  （`li.rn-content-item`）却包着**没有布局盒**的 `ul` 列表容器 —— 叶子画布行不会含列表容器，
  故这是「折叠分组行」唯一自洽的解释（不用 `folder`/`collapse`/caret 图标之类类名或文案猜测）。
  边界（与 R7 硬约束逐条对齐）：**只在「本来就要报失败」的分支里执行**（正常流程永不触发，
  不可能让已经能用的流程变糟）；只在画布列锚点内寻找，**绝不越界**（越界会误点页面列 /
  图层列 / 左栏 nav）；只点「行 + 其内层行项」，不点任意后代；**不点目标行本身**
  （不替用户做切换）；同一节点同一页面只点一次（JS 私有 expando，不写 `data-*`）；锚点全无
  则直接放弃。展开与诊断**共用同一判据**（`structuralToggleCandidates`），避免两处漂移。
- **R10 只读探针 `__mdRtProbe()`（真机取证入口）**：给 Console 一个**不触发失败**就能拿诊断样本的入口 ——
  `Object.keys(seen)`（标签栏里的最近画布）或指定 id 各输出一条与「定位失败诊断」同构的对象。
  全函数体包在 `try/catch` 里，任何异常都不会影响初始化。**它回答的是本项目反复卡住的那个问题：
  「真机画布列里的折叠到底怎么表达」**（此前只能等失败后反推，拿不到折叠态样本）。
- **R11 自产点击不计入建标签（`suppressTrack` / `clickSuppressed`）—— 防「凭空长标签」**：
  R1/R9 展开折叠分组时会**合成 click**，而 `trackCanvasFromEvent` 是 document **捕获阶段**的
  全局监听 → 它会把这次合成点击也当成「用户点了左栏一行」。若该分组行**不带 `folder` 类名**
  （真机类名漂移），`touch()` 就会凭空长出一个分组标签 —— 这是**本轮改动自己引入的新风险**，
  复验前必须先堵掉。做法：合成点击（仅限「展开折叠分组」这类**非用户意图**的点击）期间置位
  计数器，监听器直接忽略；**不**包住「点目标行切换画布」（那是用户意图）。
  用计数器而非布尔：多轮展开可能嵌套，需成对（`try/finally`）。
  ⚠ 注意 `folder` 类名此前只是「跳过文件夹」的**单点依赖**，R11 把它降级为「兜底判据」——
  即使类名漂移，展开动作也不会污染标签栏。
  **自证**：把 `if (suppressTrack > 0) return;` 这一行删掉后跑 H7 → 两条展开路径**都**凭空
  多出 `GFOLD` 标签（4 条断言失败）⇒ 该用例确实在测这条护栏，不是顺带绿。

**纪律（务必守住）**

1. 只放宽**定位**侧。`isCanvasPanelItem`（建标签判据）**未放宽语义**：`classifyItem` 的改动与
   `rejectReason` **严格对称**；图层列行仍因「命中面板级容器」+「带 `layer-item`」被**双重拒绝**。
2. **不新增任何猜测式点击启发式**（R7 立规 —— BUG-0011/0012/0013 全部源于启发式误判）。
   展开阶段只认标准 `aria-expanded="false"`，且**绝不越出「画布」列容器**。
   **唯一例外是 R9**，且它不是「猜测」而是**结构判据**（行可见 + 行内包着不可见的 `ul`），
   并额外加了「只在本来就要报失败的分支执行」这一条硬护栏 —— 例外若被后人扩大化，
   本 BUG 立刻复发，务必连护栏一起读。
3. ⚠ **真机实测 `collapsedToggleCount = 0`**（文档里没有任何 `aria-expanded="false"`）⇒
   **aria 展开阶段在真机上很可能是空操作**，因此「搜索框四级探测」**不是可选优化，而是并列的第二条主路**。
   夹具专门用 `setToggleMode("data")` 建模这一真机形态（无 `aria-expanded` 的折叠），H3 / H5 即锁定它。
   三条主路的覆盖面（按夹具矩阵，缺一条都有盲区）：

   | 场景 | 折叠形态 | 搜索框 | 命中的主路 | 锁定用例 |
   |---|---|---|---|---|
   | 折叠 + 有搜索框 | aria | 有 | R1 aria 展开 | H1 |
   | 折叠 + 有搜索框 | 无 aria（真机） | 有（文案/位置漂移） | R3/R5 墨刀检索 | H3 |
   | 折叠 + **无搜索框** | 无 aria（真机） | **探测不到** | **R9 结构展开** | **H5** |
   | 折叠 + 无搜索框 | aria | 探测不到 | R1 aria 展开（R9 不触发） | H1 |

4. **我们自己合成的展开点击，必须不计入建标签**（R11）。判据是 `suppressTrack > 0` 时
   `trackCanvasFromEvent` 直接返回 —— 这条与「点页面/图层不建标签」是同一条纪律的两半：
   前者管「不是画布的地方」，后者管「不是用户的动作」。H7 用「去掉 `folder` 类名」锁定它。

**验证**

- 新增用例 `tests/test_locate_hidden.py`（夹具 `mock-modao-design-collapsed.html` 新增
  `setCollapsedUnrendered` / `setToggleMode` / `setSearchTopPx` / `setSearchPlaceholder` /
  `setSearchBoxMissing` / `groupRowsCount` / `toggleSignals` / `wrapClass`，
  `setWrapped` 支持 `"layer"`）：
  - **修复版全绿**：H1 11/11、H3 10/10、H4 8/8、**H5 12/12**、**H6 9/9**、**H7 12/12**、H2 5/5
    （共 **67 条断言**），`rc=0`。
  - **反向对照**：`git show 6288b2d:recent-tabs-core.js`（修复前最后一版）→ **27 条失败**；
    H1(6)/H3(5)/H4(4)/**H5(6)** 的【回归】组**全部失败**，且 toast **逐字命中用户原话**
    「未找到画布「历史画布 05」，请先在左侧画布栏展开或滚动到它，再点击标签切换」；
    H2【保护】组在新旧核心上**都通过**（5/5）→ 保护基线有效，不是「顺带测了别的东西」；
    H6 在旧核心上失败于「没有探针这个能力」（`window.__mdRtProbe is not a function`）、
    H7 的 2 条【回归】**也失败**（旧核心根本没走到展开动作）—— 两者符合预期。
    ⚠ H5 在旧核心上是「`if(!box){fail();return;}` 直接短路」→ 不属于「差一点」，而是**完全无路可走**。
  - **护栏自证（R11，对抗性）**：把 `if (suppressTrack > 0) return;` 删掉后跑 H7 →
    aria 与结构两条展开路径**都**凭空多出 `GFOLD` 标签（4 条【保护】失败）⇒ H7 真的在锁这条护栏。
  - A/B 矩阵：`tests/ab_expectations.json` 登记 `test_locate_hidden.py` → `6288b2d` →
    `regression_fail`。**本缺陷无 `regression_pass` 对照**（三个都是结构性缺陷，所有历史版本
    都没有对应能力；`v1.0.16` 在 H1/H3 上同样失败，**不得**当作 regression_pass）。
- 门禁：见本节末「本轮门禁结果」。

**自曝偏差（写作纪律要求主动披露）**

1. **开发中真实踩到并修掉的一个自伤缺陷**：`currentPanels()` 新增 `layerTreeHard` /
   `layerTreeShared` 字段的那次编辑**未落盘**（工具并发写同一文件时被覆盖），
   而 `rejectReason` / `classifyItem` 已经在读这两个字段 ⇒ 启动即抛
   `Cannot read properties of undefined (reading 'length')`，H 组用例**全部一条断言都没跑到**。
   这是用例抓出来的（不是靠人眼复核），也说明「0 断言」与「全通过」必须分开看。
   已补 `insideAny` 的 `undefined` 防御，防止同类问题再次打断初始化。
2. **H2 曾出现一次「假失败」**：原写法是「先 `sleep` 到切换流程结束，再查 toast」，
   而 toast 数秒后自动淡出 → 查询时已消失。已改为**边等边收**（`collect_toast` 在窗口内持续
   轮询并累积文案）。**这条不影响产品代码，只影响取证方式**，记录在此以免后人重犯。
3. **本轮改动自己引入过一个新风险，已堵并锁死（R11）**：R9 上线后我去核对「这次合成点击会不会
   在别处产生后果」，发现文档级**捕获阶段**的点击监听器会把它当成用户点击 —— 若分组行不带
   `folder` 类名，就会**凭空长出一个分组标签**。这不是原缺陷的一部分，是本轮**新造**的风险。
   已加 `suppressTrack` 护栏并新增 H7 锁定；护栏本身也做了对抗性自证（删掉就复现）。
   教训：**新增「代替用户点击」的能力时，必须同时审「这个 click 还会被谁听到」**。

**未能覆盖 / 仍需真机确认**

- 真机折叠**到底用什么机制表达**仍未确证（`collapsedToggleCount = 0` 只说明「不是 aria」）。
  三条路都在夹具上验过（R1 aria 展开 / R3+R5 墨刀检索 / R9 结构展开），但
  **真机上哪一条生效、是否都生效，必须由用户真机复验确认**。
- 真机墨刀的异步多帧重渲染时序仍无法在夹具里完全复现（夹具的展开/检索都是同步一次性重渲染）。
- **若真机复验仍失败，不要再猜，直接读诊断对象**。本轮新增**只读探针**（不点击、不改状态、不弹 toast）：
  在设计页 Console 跑单行 `__mdRtProbe()`（对标签栏每条最近画布各输出一条），或
  `__mdRtProbe('<cid>')` 只查指定画布 —— **加壳前也能拿到折叠态样本**，这是本项目一直缺的那块证据。
  `build` 必须是 `locate-robust.3`，否则本轮结论一律作废。判读表：

  | 观测 | 说明 | 下一步 |
  |---|---|---|
  | `cidHitTotal = 0` | 该 id 在整份文档里**一个节点都没有** → 行已被移出 DOM | 说明它不在左栏（或未加载）→ 看 `trackedIds`/`historyIds` 是否含它 |
  | `cidHitTotal > 0` 但 `rowHitTotal = 0` | 节点在，但全被**判据拒绝** | 把 `reason` 打出来（`inLayerTree` / `layerItem`）→ 又有新的类名/容器形态没覆盖 |
  | `panelCollapsedToggles = 0` 且 `panelStructuralToggles = 0` | 画布列里既无 aria 折叠、也无结构可辨的折叠容器 | **折叠解释不成立** → 转向看上面两行 |
  | `panelStructuralToggles > 0` | R9 认得出折叠分组 | 若仍失败 → 是「点了但没展开」（展开交互不是 click）→ 需要真机录一次点击事件的探针 |
  | `searchBoxSource = "none"` | 四级探测都没找到搜索框 | 搜索两条主路整体不可用 → 优先看 R9 是否生效 |

**本轮门禁结果**：_（待填）_

**影响文件**：`recent-tabs-core.js`、`desktop/recent-tabs-core.js`（副本同步）、
`tests/fixtures/mock-modao-design-collapsed.html`、`tests/test_locate_hidden.py`（新增）、
`tests/ab_expectations.json`、`tests/README.md`、`README.browser.md`、`CHANGELOG.md`（本文件）。
⚠ **本轮不改版本号**（`VERSION` / `manifest.json` / `MD_VERSION` 仍为 `1.0.18`，
按改动纪律第 10 条：未获用户明确确认「修复完成、正式发布」前禁止改动）。

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
