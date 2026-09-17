/* =========================================================================
 * v1.0.18（定位加固第 2 轮 · BUG-0016/0017/0018）修复「折叠不可见 / 滚动不可见 → 点标签
 *         报未找到画布」在真机仍未修复（用户 2026-09-17 再次上报）：
 *         现象：「曾经打开的画布仍在左侧顶部画布列表中，只是被收缩折叠不可见（或因滚动
 *         不在可见区域），点击画布标签提示：未找到画布，请先在左侧画布栏展开或滚动到它，
 *         再点击标签切换。」要求：**无论被收缩折叠、还是因滚动不在可见区域，点标签都要
 *         定位到画布所在位置并显示画布内容**。
 *         本轮不动「建标签」判据，只补三个**结构性**缺陷。注意前三轮修的是「容器锚点 /
 *         黑名单误判」，本轮修的是「能力互相短路」与「循环依赖」—— 性质不同，故此前
 *         反复修而不掉：
 *           BUG-0016 循环依赖（折叠不可见**永远**修不好的原因）：
 *             唯一的展开入口 ensureRowVisible 只在 activateCanvas 内被调用，即
 *             「**已经找到行之后**」才尝试展开；而折叠闭合的分组其子行不在 DOM（或
 *             display:none）⇒ 找不到行 ⇒ 永远走不到展开 ⇒ 报「未找到画布」。
 *             即：要展开得先找到行，要找到行得先展开。任何 DOM 契约下都无法收敛。
 *             修复：新增 expandCollapsedInCanvasPanel()，**不依赖目标行是否在 DOM**，
 *             只在「画布」列容器范围内展开所有 aria-expanded="false" 的开关；并串入
 *             locateCanvas 的失败收尾（展开后轮询等待重渲染，再判成败）。
 *           BUG-0017 能力互相短路：locateCanvas 开头 `if(!box){fail();return;}` ——
 *             搜索框一旦探测不到（真机 UI 漂移即会），「清空过滤 / 按名检索 / 展开折叠」
 *             三条能力被整体跳过，只剩滚动扫描（对折叠行无效）→ 报「未找到画布」。
 *             修复：取消短路，改为**能力串联**（无搜索框就跳过搜索两阶段，仍执行展开 +
 *             扫描兜底）；findScreenSearchBox 改为「结构优先、文案/几何兜底」四级探测
 *             （L1 缓存 / L2 画布列容器内的输入框 / L3 放宽词表 / L4 原严格规则）。
 *           BUG-0018 同类名黑名单复发：`.layer-sortable-list` 与页面列的
 *             `.canvas-sortable-list` 属**同一套 sortable 组件**，同样会被「画布」列在
 *             分组 / 需要滚动时复用；它却在图层树黑名单里被**无条件拒绝** —— 与 BUG-0012
 *             同源，只是换了个类名。修复：黑名单拆成 LAYER_TREE_HARD_SELECTORS（面板级
 *             容器，无条件拒绝）与 LAYER_TREE_SHARED_SELECTORS（组件类名，仅「不在画布列
 *             内」时拒绝）；防误点仍由「行项带 layer-item」这条**容器无关**判据兜底。
 *         纪律：只放宽「定位」侧；**不新增任何猜测式点击启发式**（R7 立规 —— BUG-0011/
 *         0012/0013 全部源于启发式误判）；展开只认标准 aria-expanded 且绝不越出画布列
 *         容器；画布列锚点全无时直接放弃（无法界定安全范围，宁可不点）。
 *         ⚠ R9（对 R7 的唯一、受限例外，务必连约束一起读）：真机实测画布列里**没有**
 *         aria-expanded="false"（collapsedToggleCount = 0），若「搜索框四级探测」也够不着，
 *         则前两条主路全空 ⇒ 现状**必然失败、且无任何退路**。故补末位兜底
 *         expandCollapsedByStructure()：判据是**结构**（自身可见的行，却包着一个不可见的
 *         `ul` 列表容器）——不是类名 / 文案 / 图标之类的猜测信号；且只在「本来就要报失败」
 *         的分支里执行，正常流程永不触发；只在画布列锚点内寻找、只点行的内层行项、
 *         **不点目标行本身**、同一节点只点一次。
 *         构建指纹：新增 MD_BUILD → 写到 #md-recent-tabs-root[data-md-build]。版本号
 *         **冻结在 1.0.18**（改动纪律第 10 条：未获用户确认不得改版本号），故用构建指纹
 *         证明真机跑的到底是哪一份代码。
 *         回归用例：tests/test_locate_hidden.py（H1/H3 锁定 + H2/H4 保护）。
 * v1.0.18（本轮 · BUG-0014）修复「点标签能切换画布，但左栏列表刷新了一下回到顶部」：
 *         现象（用户原话）：「点标签能切换但不定位到画布在画布列表的位置」，追问确认
 *         「刷新了一下回到了列表顶部」；期望「滚动 + 设为左栏选中态」。
 *         根因：原实现只在**点击前**滚一次（scrollIntoView），而墨刀切换画布时会重渲染
 *         左栏并把滚动容器 scrollTop **复位**（含重建行节点）→ 刚滚到位立刻被冲掉 →
 *         列表回到顶部；且 isRowVisible 只判「是否在渲染树」，不判「是否在滚动容器可视
 *         区内」——滚出视野的行照样算「可见」→ 定位链误以为已到位。
 *         修复（只动「定位/滚动显示」，不碰建标签与定位接受规则）：
 *           · 新增 isRowInScroller(el, sc)：用 getBoundingClientRect 与滚动容器客户区比较，
 *             判行是否落在**可视矩形**内（上下各 4px 容差）；与只判渲染树的 isRowVisible
 *             语义区分（二者互补，注释写清差异）。
 *           · 新增 getRowScroller(el)：向上找最近的 overflowY∈{auto,scroll} 且可滚动的祖先，
 *             取不到退回 getCanvasScrollContainer()。
 *           · getCanvasScrollContainer 的候选**起点不止第一个画布行**：取不到行时把「画布列
 *             容器本身」也纳入起点向上找滚动宿主，避免一屏都没渲染出行时直接返回 null、
 *             整条滚动兜底被跳过；绝不用页面列的行当起点而滚错容器。
 *           · 新增 scrollRowIntoView(id, el, center)：按 id 重新定位行 → rect 差算 rowTop
 *             → 设 scrollTop（clamp 到 [0, scrollHeight-clientHeight]）→ scrollIntoView
 *             (nearest) 兜底。
 *           · 新增 keepRowVisible(id, ms)：点击后在 rAF/+60/+180/+400/+800ms 复查，被复位就
 *             重新滚、行被重建就重新定位；**用户一旦手动滚动（wheel/keydown/pointerdown/
 *             touchstart）立即放弃**并解绑全部监听；token 与 revealToken 联动，destroy 清干。
 *           · activateCanvas 改为：点击前滚一次（完整可见）→ 点击 → 点击后再滚并居中 →
 *             keepRowVisible 复查 → 落左栏选中态（md-rt-located；墨刀自身已有激活类则不叠加）。
 *         回归用例：tests/test_relocate_collapsed.py（E1/E2 锁定 + E3/E4 需求/保护）。
 * v1.0.18（定位加固）修复「点标签提示未找到画布」在真机仍未修复（用户 2026-09-16 复验）：
 *         现象：与上一版完全相同的「未找到画布，请先在左侧画布栏展开或滚动到它」
 *         提示；真机 F12 日志行号与上一版源码逐行吻合
 *         （recent-tabs-core.js:742 / :744）→ 已排除「改动没生效」。
 *         根因（确凿死亡分支）：findCanvasEl 用 canvasPanelPresent() 门控候选；而
 *         canvasPanelPresent 的「用是否存在画布级行兜底」分支是**死代码** —— 它靠
 *         classifyItem(els[i]) === "canvas" 判存在，但 classifyItem 只在
 *         insideAny(el, p.canvas) 为真时才可能返回 "canvas"；当 p.canvas 为空时它
 *         恒不返回 "canvas"。于是「画布」列容器锚点一旦被墨刀改版换名，
 *         canvasPanelPresent 恒为 false → preferCanvas 恒为 false → 所有被判为
 *         canvasWrapped / page 的候选行被无条件跳过 → 真画布行（恰被 sortable
 *         容器包住）永远查不到 → 弹「未找到画布」。
 *         修复（只放宽「定位」，绝不动「建标签」判据）：
 *           · findCanvasEl 只允许因**两个**理由拒绝候选：① 落在图层树 / 状态页 /
 *             交互树容器内；② 行项带 layer-item 类名（真机取证：左栏下部「页面」列
 *             与「图层」列的行项都带 layer-item，唯左栏上部「画布」列的行项是
 *             div.rn-list-item.page，不带 layer-item）。不再由任何容器识别结果
 *             （canvasPanelPresent / 黑名单）压制候选 → 定位对**真画布行不缩水**
 *             （凡 v1.0.16 能命中并点击的真画布行，本版也命中；唯一收窄是永不点
 *             v1.0.16 会误命中的页面/图层列行）。
 *           · 优先级排序 canvas > canvasWrapped > page > other：只要容器可识别，
 *             必优先选中「画布」列那一行；「无归属」的 other 排最低，避免未知面板里
 *             同 cid 的杂散行抢占真画布行（QA 复核 BUG-0013 时发现的优先级反转）。
 *           · canvasPanelPresent 降级为**仅供诊断**，并修正其死亡兜底分支为诚实实现
 *             （不再把死代码留在原地误导后人）。
 *           · isCanvasPanelItem（建标签判据）**保持不变**（BUG-0011 教训：把判据收窄
 *             成白名单会把真画布点击一起拒掉，比原 BUG 更严重）。
 *           · 定位失败诊断大幅加固：对每个同 cid 元素输出
 *             tag / class / data-interactive-target-type / layerItem / visible /
 *             完整祖先链（最多 8 层）/ 被拒原因；另输出各锚点命中数与 data-cid 命中总数。
 *         回归用例：tests/test_relocate_collapsed.py（D1/D2 锁定 + D3/D4 保护；A/B 见 CHANGELOG.md）。
 * v1.0.18（回归修复）修复「点标签提示未找到画布」回归（用户 2026-09-16 上报）：
 *         现象：曾经打开过的画布仍在左侧上部「画布」列里，只是被**收缩折叠**
 *         不可见、或因**滚动不在可见区域**；此时点它的标签 → 提示「未找到画布，
 *         请先在左侧画布栏展开或滚动到它，再点击标签切换」，画布切不过去。
 *         v1.0.16 及更早正常，v1.0.17 引入。
 *         根因（由 v1.0.16→v1.0.17 源码差异推导，不靠记忆）：v1.0.17 把「下部
 *         页面列」的容器类名（#canvas-scroll-list / .canvas-scroll-list /
 *         .canvas-sortable-list / #mb-enabled-canvas-list）放进了 findCanvasEl
 *         的**黑名单**，一律拒绝其中的同 cid 行；而真机上「画布」列在**存在分组
 *         或需要滚动**时，行的外层会被同一个 sortable 列表组件包住 → 类名正好
 *         命中黑名单 → 行即使在 DOM 里（折叠隐藏）也永远查不到。
 *         修复（只放宽「定位」，不放宽「建标签」收窄）：
 *           · 行归属改五分类：canvas（画布列）/ canvasWrapped（画布列内、被黑名单
 *             名容器包住）/ page（下部页面列）/ layer（图层·状态·交互树）/ other。
 *           · findCanvasEl(id) 按 LOCATE_PRIORITY（canvas > canvasWrapped > page > other）
 *             取最优候选，**不做 canvasPanelPresent() 门控**（BUG-0013 已取消：该门控的
 *             「画布级行兜底」分支是死代码，会把真画布行一并拒掉）；「画布」列整体卸载时，
 *             靠拒绝理由① inLayerTree ② layerItem 兜底，**绝不点**其它列的节点
 *             （v1.0.17 成果，T11 锁定，机制见 findCanvasEl 注释）。
 *             净效果：定位能力回到 v1.0.16，唯一收窄是永不点图层树节点。
 *           · 命中后若该行被折叠隐藏，自动展开包住它的 aria-expanded="false"
 *             祖先（最多 2 层、只在画布列容器内）并滚动到可见，再点它切换 ——
 *             落实「定位到画布所在位置，并显示画布内容」。
 *           · 仍失败时保留标签 + data-stale + toast，并输出结构化诊断（面板快照 /
 *             候选行 / 折叠开关 / 搜索框 / 历史 id），供真机 Console 一键定位。
 *         建标签判据不变（仍拒绝页面列、图层树、状态页、交互树），另补：画布列内
 *         被黑名单名容器包住的分组行同样可建标签（否则折叠分组里的画布点了不长标签）。
 *         回归用例：tests/test_relocate_collapsed.py（A/B 对照命令见 CHANGELOG.md）。
 * v1.0.17 画布识别收窄：墨刀 v22.18 起左栏为「页面 / 画布 / 图层」三面板，
 *         三者**共用**通用树组件类名 div.rn-list-item / li.rn-content-item
 *         （且 layer-item 在画布与图层面板都会出现，带 data-cid 的页面项
 *         div.rn-list-item.page 同样存在），旧版仅按 `[data-cid]` 匹配会把
 *         点「页面」「图层」也当成画布 → 顶部「最近画布」凭空长出无效标签。
 *         改为**按容器锚点判定**（isCanvasPanelItem）。判据最终定为「**只做排除**」：
 *         建标签条件 = 命中通用树项 **且不在**「页面 / 图层 / 状态页 / 交互树」容器内。
 *         不再要求「必须命中画布面板白名单」——白名单把"画布项长什么样"硬编码成容器
 *         id，一旦墨刀改版/挂载时机不同，真正的画布点击会被一起拒掉（真机实测：
 *         「点画布不长标签」），比原 BUG 更严重；黑名单失效最坏只退回 1.0.16 的宽松
 *         行为（点页面/图层也建标签），且能被真机自检脚本立刻发现。
 *         影响面：getScreenMap / findCanvasEl / getActiveScreen / 点击建标签入口。
 *         性能：左侧「页面」面板常驻 4400+ 节点，逐项 closest 代价高，改为
 *         「先取黑名单容器再 contains 判归属」，并去掉了会产生重复回调的嵌套扫描。
 *         另修：进入文件带出当前画板（种子窗口 15s + 只用唯一名称反查）、
 *         时间戳严格递增（同毫秒 touch 不再让"最近"排序退化）。
 * v1.0.16 浮动模式不再注入覆盖工具栏的热区 div：该热区铺满墨刀顶部工具栏
 *         （高=工具栏高48、z-index 仅次标签栏），既导致鼠标移到工具栏就误弹
 *         标签栏，也直接截获工具栏点击（「工具栏点不动」根因）。改为窗口最
 *         顶部 4px 边缘触发（document mousemove 判定），不插入任何 DOM；
 * v1.0.15 取消「工具栏上方/下方」位置切换：标签栏固定显示在墨刀工具栏上方
 *         （always above），固定/浮动图钉切换保持不变；
 * v1.0.14 切换成功后不再自动恢复原检索词（搜索框保持空态 = 全量列表）；
 * v1.0.13 自动重定位：优先用左侧搜索框清空/按名检索把目标带回 DOM，
 *         彻底失败才走 v1.0.12 的滚动扫描 + 不可达提示兜底链（见 locateCanvas）。
 * 墨刀企业版（内网）「最近画布」— 共享核心逻辑
 * 浏览器扩展内容脚本与桌面注入共用，由 content.js / recent-tabs-bootstrap.js 调用。
 * 依赖全局 RecentTabsBar（tabbar.js）。
 * P0 合规：图标全 SVG，无 emoji、无紫粉渐变。
 * ========================================================================= */
(function (global) {
  "use strict";

  // 模块级单例缓存：防止重复挂载（桌面热重载 / HMR 场景）。destroy 时清空。
  var __instance = null;

  // 创建一个「最近画布」控制器并挂载到 root。
  // options.enableMessageListener=true 时启用 MD_CLEAR_CLOSED 扩展消息（仅浏览器扩展侧）。
  function createRecentTabs(options) {
    options = options || {};
    var enableMessageListener = !!options.enableMessageListener;

    // 自幂等：若已存在有效实例，直接复用，避免重复创建 root / 叠加监听。
    if (__instance) return __instance;

    var CLO  = "md_closed_screens";
    var DMODE = "md_display_mode";
    var TOPBAR_H = 44;
    // 版本号会写到 #md-recent-tabs-root[data-md-version]，便于真机在 Console 直接
    // 核对当前加载的是哪一版（排查「改了没生效」类问题时先看这个）。
    var MD_VERSION = "1.0.18";
    // 构建指纹（定位加固第 2 轮，2026-09-17）：**版本号冻结期间**用它区分「真机跑的是哪一份代码」。
    // 背景：改动纪律第 10 条禁止在用户确认前改动三处版本号（VERSION / manifest / MD_VERSION），
    // 但真机复验又必须先证明版本（否则复验结论作废）—— 于是把「本轮构建标识」与版本号解耦。
    // 真机核对：document.querySelector('#md-recent-tabs-root').getAttribute('data-md-build')
    //   locate-robust.2 → 能力串联 + 搜索四级探测 + 黑名单拆分 + aria 展开
    //   locate-robust.3 → 追加末位兜底「按结构展开折叠分组」（expandCollapsedByStructure）
    //                     + 诊断新增 panelStructuralToggles（只统计不点击）
    var MD_BUILD = "locate-robust.6";

    // 左侧画布项的 DOM 形态不止一种：运行端探针（sniffer-canvas-item.js）确认
    // 同时存在 div.rn-list-item[data-cid] 与 li.rn-content-item[data-cid] 两种形态，
    // 只认其中一种会在另一种渲染状态下「查不到」，被误判为画布已删除。
    var CANVAS_BASE_SELECTORS = ["div.rn-list-item", "li.rn-content-item"];
    var CANVAS_ITEM_SELECTOR = CANVAS_BASE_SELECTORS
      .map(function (s) { return s + "[data-cid]"; })
      .join(", ");

    // ---- 面板锚点（v1.0.17）：「画布 / 页面 / 图层」三个左栏列表 ------------------
    // 真机取证 + 用户界面核对（2026-09-14，墨刀 v22.18.18-op22603.1）：
    //   左栏**上部**那列，界面标题写着「画布」，容器 = #screen-scroll-list
    //     （内部把这种实体叫 screen / 类名带 page，但**界面文案就是「画布」**）；
    //     条目名不带序号，如「登机牌解析流程」；.canvas-title 与它同名；
    //     localStorage 的 screen-history-onLeave-project-<cid> 记的也是它的 id。
    //      → 这一列**才是**「最近画布」要跟踪的对象。
    //   左栏**下部**面板的「页面」标签，容器 = #mb-enabled-canvas-list
    //     （内部实体类型是 Canvas，条目名带序号，如「1 登机牌解析流程」）；
    //   左栏下部面板的「图层」标签，容器 = #layer-scroll-list / #mb-enabled-layer-list。
    //      → 这两列都**不得**建标签。
    // 三个列表共用同一套通用树组件类名（li.rn-content-item / div.rn-list-item，
    // layer-item 在两列里都会出现），无法用 class 区分，只能按容器祖先判定。
    // 白名单（诊断用）：命中任一祖先 → 该项属于「画布」列。
    var CANVAS_PANEL_SELECTORS = [
      "#screen-scroll-list",
      "#screen_list",
      ".screen-list-container",
      "#mobile-screen-tree"
    ];
    // 黑名单 A（**最强**）：图层树 / 状态页 / 交互树 —— 命中即「一定不是画布」，
    // 建标签与定位**任何情况下都拒绝**（点它会点到图层节点上，属切错）。
    // ⚠ 定位加固第 2 轮（2026-09-17）：本数组拆成「面板级硬拒绝」与「共享 sortable 组件」两部分。
    //   理由与 BUG-0012 根因同源：`.canvas-sortable-list` 这类**组件类名**会被「画布」列在
    //   分组 / 需要滚动时复用；`.layer-sortable-list` 是同一套 sortable 组件的另一半，
    //   同样可能被复用。把它当无条件黑名单 ⇒ 行即使在 DOM 里也永远查不到 ⇒ 报「未找到画布」。
    //   故：**面板级容器**（一定是非画布面板）无条件拒绝；**组件类名**仅在「不在画布列内」
    //   时才作为拒绝依据（见 rejectReason / classifyItem）。
    var LAYER_TREE_HARD_SELECTORS = [
      // —— 下部「图层」列（widget 树）的面板级容器 ——
      "#mb-enabled-layer-list",
      "#layer-scroll-list",
      ".layer-scroll-list",
      ".mb-layer-panel",
      // —— 状态页 / 交互树（绝不是画布）——
      "#mb-state-list",
      "#interaction-tree-container",
      "#interaction-tree-list"
    ];
    // 共享 sortable 组件类名（画布列也会复用；真机取证见 CHANGELOG BUG-0012 根因段）
    var LAYER_TREE_SHARED_SELECTORS = [".layer-sortable-list"];
    // 原「图层树 / 状态页 / 交互树」合集（= hard + shared）：保留给诊断字段与既有调用点
    var LAYER_TREE_PANEL_SELECTORS =
      LAYER_TREE_HARD_SELECTORS.concat(LAYER_TREE_SHARED_SELECTORS);
    // 黑名单 B：下部「页面」列（画板列表，条目名带序号）的容器类名。
    // ⚠ v1.0.18 教训：这些类名**同时**会被「画布」列在分组 / 滚动场景复用
    // （同一套 sortable 列表组件），故它们只能作「默认拒绝」依据，不能无条件拒绝 ——
    // 若目标行同时也落在**画布列容器内**，应改判为画布行（见 classifyItem）。
    var PAGE_LIST_PANEL_SELECTORS = [
      "#mb-enabled-canvas-list",
      "#canvas-scroll-list",
      ".canvas-scroll-list",
      ".canvas-sortable-list"
    ];
    // 合计黑名单：仅用于「是否落在非画布容器内」的粗判（诊断 / 兼容既有调用点）
    var NON_CANVAS_PANEL_SELECTORS =
      LAYER_TREE_PANEL_SELECTORS.concat(PAGE_LIST_PANEL_SELECTORS);
    // 严格模式判定锚点：任一左栏列表存在 → 判定为墨刀设计页（旧版/简化 DOM 时走兼容降级）
    var STRICT_PANEL_SELECTORS = [
      "#screen-scroll-list",
      "#mb-enabled-canvas-list",
      "#canvas-scroll-list",
      ".canvas-scroll-list",
      "#mb-enabled-layer-list",
      "#layer-scroll-list",
      ".layer-scroll-list"
    ];

    // 元素（或其任一祖先）是否命中给定锚点选择器集合。
    function matchAncestor(el, selectors) {
      if (!el || typeof el.closest !== "function") return false;
      for (var i = 0; i < selectors.length; i++) {
        try { if (el.closest(selectors[i])) return true; } catch (e) {}
      }
      return false;
    }

    // 是否检测到新版「三面板」左栏。nav 在画布/图层间互斥切换会让面板容器
    // 随时增删，故**每次实时计算**，不缓存为一次性常量。
    function hasPanelLayout() {
      for (var i = 0; i < STRICT_PANEL_SELECTORS.length; i++) {
        try { if (document.querySelector(STRICT_PANEL_SELECTORS[i])) return true; } catch (e) {}
      }
      return false;
    }

    // 收集当前文档里真实存在的面板容器（nav 在画布/图层间互斥切换会让容器增删，
    // 故每次实时计算，不缓存为一次性常量）。
    function collectPanels(selectors) {
      var out = [];
      for (var i = 0; i < selectors.length; i++) {
        try {
          var els = document.querySelectorAll(selectors[i]);
          for (var j = 0; j < els.length; j++) {
            if (out.indexOf(els[j]) < 0) out.push(els[j]);
          }
        } catch (e) {}
      }
      return out;
    }

    // 当前面板快照：
    //   canvas    画布列容器（#screen-scroll-list 等）
    //   layerTree 图层树 / 状态页 / 交互树容器（永不是画布）
    //   pageList  下部「页面」列容器（默认拒绝，但画布列分组/滚动时可能复用同类名）
    function currentPanels() {
      return {
        canvas: collectPanels(CANVAS_PANEL_SELECTORS),
        // layerTree = hard + shared（诊断字段沿用原口径，输出体积不变）
        layerTree: collectPanels(LAYER_TREE_PANEL_SELECTORS),
        // 定位加固第 2 轮：拆成两类，供 rejectReason / classifyItem 区分对待
        layerTreeHard: collectPanels(LAYER_TREE_HARD_SELECTORS),
        layerTreeShared: collectPanels(LAYER_TREE_SHARED_SELECTORS),
        pageList: collectPanels(PAGE_LIST_PANEL_SELECTORS)
      };
    }

    // el（或其祖先）是否落在给定容器集合内
    // 防御：容器集合缺失（undefined/null）时按「不在任何容器内」处理 —— 历史教训：
    // 新增面板字段（layerTreeHard / layerTreeShared）时，若有调用点自行拼装**部分**面板
    // 快照（只含 canvas / layerTree / pageList），漏加字段会在此抛
    // "Cannot read properties of undefined (reading 'length')"，把整条初始化打断。
    function insideAny(el, containers) {
      if (!el || !containers) return false;
      for (var i = 0; i < containers.length; i++) {
        if (containers[i] === el || containers[i].contains(el)) return true;
      }
      return false;
    }

    // 行项是否带 `layer-item` 类名 —— v1.0.18 定位路径的**独立于容器锚点**的判据。
    // 真机取证（v22.18.18-op22603.1，见 tests/fixtures/mock-modao-design-panels.html）：
    //   左栏上部「画布」列行项  = div.rn-list-item.page[data-cid]
    //                             + data-interactive-target-type="page"  → **不带** layer-item
    //   左栏下部「页面」列行项  = div.rn-list-item.layer-item.interactive-target-hotspot
    //                             + data-interactive-target-type="canvasList" → **带** layer-item
    //   左栏「图层」列行项      = div.rn-list-item.layer-item[data-cid] → **带** layer-item
    // 所以凭 `layer-item` 这一个类名即可把「真画布行」与「页面列 / 图层列行」分开，
    // 完全不依赖容器锚点 —— 这正是锚点被改版换名时仍能定位的依据。
    // 被测元素既可能是内层 div.rn-list-item，也可能是外层 li.rn-content-item（两种都带
    // data-cid，均会被 CANVAS_ITEM_SELECTOR 命中）；对 li 形态需下钻到它的**本行**行项。
    function rowHasLayerItem(el) {
      if (!el) return false;
      if (el.classList && el.classList.contains("layer-item")) return true;
      if (!el.querySelector) return false;
      var inner = null;
      try { inner = el.querySelector(":scope > .rn-list-item"); } catch (e) { inner = null; }
      if (!inner) inner = el.querySelector(".rn-list-item");   // 兼容：li 内仅一个行项
      return !!(inner && inner.classList && inner.classList.contains("layer-item"));
    }

    // 定位路径的唯一拒绝判据（v1.0.18）：候选行是否**必须**被拒。
    // 只允许两个理由（见 findCanvasEl 注释）：
    //   "inLayerTree" 落在图层树 / 状态页 / 交互树容器内（v1.0.17 成果，T11/C4/C5 锁定）
    //   "layerItem"   行项带 layer-item 类名（下部「页面」列 / 「图层」列的行，不是画布）
    // 返回 "" 表示该候选可接受。诊断输出复用本函数。
    // 定位加固第 2 轮补充「画布列优先」规则（与 classifyItem 对 `.canvas-sortable-list` 的同款处理对称）：
    //   · 面板级容器（hard）内 → 仍无条件拒绝（那些容器绝不在画布列内）；
    //   · 共享 sortable 组件类名（shared）→ **只在不在画布列内时**才拒绝。若行同时落在
    //     画布列容器内，说明命中的是「被同名组件包住的真画布行」，交给 ② layer-item 兜底判断
    //     （真机取证：真画布行不带 layer-item，图层/页面列行必带 → ② 已足够防误点）。
    function rejectReason(el, panels) {
      var p = panels || currentPanels();
      // ①A 面板级容器：无条件拒绝
      if (insideAny(el, p.layerTreeHard)) return "inLayerTree";
      // ①B 共享 sortable 组件类名：画布列内不据此拒绝（真画布行可能被它包住）
      if (!insideAny(el, p.canvas) && insideAny(el, p.layerTreeShared)) return "inLayerTree";
      // ② 行项带 layer-item：容器无关的独立判据（真机取证）
      if (rowHasLayerItem(el)) return "layerItem";
      return "";
    }

    // 行归属分类（v1.0.18，建标签与定位共用同一判据）：
    //   "layer"         图层树 / 状态页 / 交互树 —— 任何情况下都不是画布，永不点
    //   "canvas"        画布列内、且没被「页面列类名」的容器包住 → 最可信
    //   "canvasWrapped" 画布列内、但外层被黑名单名容器（sortable 列表）包住
    //                   → 折叠分组 / 滚动虚拟化的真实形态（v1.0.17 回归的根因）
    //   "page"          下部「页面」列 → 不是画布，默认拒绝
    //   "other"         无归属的通用树项 → 沿用 v1.0.17「只排除」语义，接受
    // 判据顺序把 layer 放最前：即使画布列容器与图层树嵌套，也绝不把图层节点当画布。
    function classifyItem(el, panels) {
      if (!el) return "other";
      var p = panels || currentPanels();
      var inCanvas = insideAny(el, p.canvas);
      // "layer" 判定与 rejectReason 保持一致：面板级容器无条件算图层；
      // 共享 sortable 组件类名只在**不在画布列内**时才算图层（否则它是被包住的真画布行）。
      if (insideAny(el, p.layerTreeHard)) return "layer";
      if (!inCanvas && insideAny(el, p.layerTreeShared)) return "layer";
      if (inCanvas) return insideAny(el, p.pageList) ? "canvasWrapped" : "canvas";
      if (insideAny(el, p.pageList)) return "page";
      return "other";
    }

    // 「画布」列当前是否存在于文档中。
    // ⚠ v1.0.18：本函数**仅供诊断**（写入 diagnoseLocateFailure 的快照），定位路径
    // （findCanvasEl）**已不再**依赖它。历史教训（BUG-0012 / BUG-0013）：曾用它门控候选，
    // 而它自身在「锚点被改版换名」的 DOM 下恒为 false → 把真画布行一并拒掉。
    // 诚实实现（替换掉原来的死亡兜底分支）：命中任一「画布」列容器锚点，或存在
    // 一个「不在图层树 / 状态 / 交互树容器内、不在下部『页面』列内、且行项不带
    // layer-item」的行 —— 即符合真画布行签名的行 —— 就认为画布列还在。
    function canvasPanelPresent(panels) {
      var p = panels || currentPanels();
      if (p.canvas.length > 0) return true;
      var els = document.querySelectorAll(CANVAS_ITEM_SELECTOR);
      for (var i = 0; i < els.length; i++) {
        if (insideAny(els[i], p.pageList)) continue;   // 下部「页面」列的行不算「画布列存在」
        if (rejectReason(els[i], p) !== "") continue;  // 图层树 / 带 layer-item 的行不算
        return true;
      }
      return false;
    }

    // 画布项判定（建标签入口）：**只做排除**，不再要求「必须命中画布面板白名单」。
    // 教训（2026-09-11 真机回归）：白名单把「画布项长什么样」硬编码成容器 id，
    // 一旦墨刀改版 / 挂载时机不同，真正的画布点击会被一起拒掉（真机实测：
    // 「点画布不长标签」），比原 BUG 更严重；黑名单失效最坏只退回 1.0.16 的宽松
    // 行为（点页面/图层也建标签），且能被真机自检脚本立刻发现。
    // v1.0.18 追加：画布列内**被黑名单名容器包住**的分组行（canvasWrapped）同样接受
    // —— 否则折叠分组里的画布点了不长标签，与本次回归同源。
    // 仍然**不**接受 "page"（下部页面列）/"layer"（图层树/状态页/交互树）。
    // strict 参数保留仅为兼容既有调用点，判定不再依赖它。
    function isCanvasPanelItem(el, strict) {
      var k = classifyItem(el);
      return k === "canvas" || k === "canvasWrapped" || k === "other";
    }

    // 遍历「可建标签」的画布项（已跳过 folder）。
    // 与 isCanvasPanelItem 同一判据，保证批量扫描与点击判定一致。
    // 性能：真机「页面」面板常驻 4400+ 节点，逐项做 closest 祖先匹配代价高，这里改成
    // 「先取出容器集合，再用 contains 判归属」，且只做一次 querySelectorAll 取项。
    function eachCanvasItem(fn, panels) {
      var p = panels || currentPanels();
      var els = document.querySelectorAll(CANVAS_ITEM_SELECTOR);
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el.classList && el.classList.contains("folder")) continue;
        var k = classifyItem(el, p);
        if (k === "page" || k === "layer") continue;   // 页面列 / 图层·状态·交互树 → 排除
        fn(el);
      }
    }

    // 第一个可作滚动作业的树项（跳过文件夹与页面/图层列项）。用于定位滚动宿主。
    // 优先级：画布列行 → 画布列内被包住的行 → 无归属行 → 任意树项。
    // v1.0.18：与 findCanvasEl 用同一套拒绝规则（rejectReason），锚点被改版换名时
    // 也能选中真画布行作为滚动宿主。注意「滚动」本身不会建标签，且 findCanvasEl 仍按
    // 归属判定，故退回任意树项不会误点。
    function firstCanvasItem(panels) {
      var p = panels || currentPanels();
      var els = document.querySelectorAll(CANVAS_ITEM_SELECTOR);
      var wrapped = null, other = null;
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el.classList && el.classList.contains("folder")) continue;
        if (rejectReason(el, p) !== "") continue;   // 图层树 / 带 layer-item 的行：不是画布
        var k = classifyItem(el, p);
        if (k === "canvas") return el;
        if (k === "canvasWrapped" && !wrapped) wrapped = el;
        else if (k === "other" && !other) other = el;
      }
      if (wrapped) return wrapped;
      if (other) return other;
      return document.querySelector(CANVAS_ITEM_SELECTOR);
    }

    var cid = null;
    var lastCid = null;
    var closed = readClosed();
    var seen = {};

    function readClosed() {
      try { return JSON.parse(localStorage.getItem(CLO) || "[]"); } catch (e) { return []; }
    }
    function persistClosed() {
      try { localStorage.setItem(CLO, JSON.stringify(closed)); } catch (e) {}
    }

    // 墨刀原生格式（运行端探针已确认，2026-08-28）：
    //   localStorage['screen-history-onLeave-project-<cid>'] = "rbpVRNr<base62>"
    // 即最近离开画布的完整 screen id（rbpVRNr 为墨刀 screen id 前缀）。
    // onLeave 时整体覆盖为最新画布，故 localStorage 只保留"最近一个"，并非历史列表。
    // 兼容旧版可能的 JSON 数组（最新在前）。
    function getRecentIds() {
      if (!cid) return [];
      var raw = localStorage.getItem("screen-history-onLeave-project-" + cid);
      if (!raw) return [];
      try {
        var a = JSON.parse(raw);
        if (Array.isArray(a)) return a.map(String).filter(Boolean);
      } catch (e) {}
      var m = raw.match(/rbpVRNr[A-Za-z0-9]+/g);
      return m || [];
    }

    // 从画布项 DOM 提取名称（textContent 优先，input/title 兜底）
    function readName(el) {
      if (!el) return "";
      var n = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (n) return n;
      if (el.querySelector) {
        var inp = el.querySelector("input[value], textarea");
        if (inp && (inp.value || inp.textContent)) {
          return (inp.value || inp.textContent).replace(/\s+/g, " ").trim();
        }
      }
      var ti = el.getAttribute ? el.getAttribute("title") : null;
      return ti ? ti.trim() : "";
    }

    // 左侧画布栏：id -> name（排除文件夹 folder）
    // v1.0.17：只收「画布」面板的项（页面 / 图层 / 状态 / 交互树一律排除），
    // 否则点页面、点图层都会在顶部标签栏凭空生成无效标签。
    function getScreenMap() {
      var map = {};
      eachCanvasItem(function (el) {
        var id = el.getAttribute("data-cid");
        var name = readName(el);
        if (id && name && !(id in map)) map[id] = name;
      });
      return map;
    }

    // 把一个画布标记为最近（置顶）。若之前在关闭列表，则重新打开（移除关闭记录）。
    function touch(id, name) {
      if (!id) return false;
      var ci = closed.indexOf(id);
      if (ci >= 0) {
        closed.splice(ci, 1);
        persistClosed();
      }
      if (!name) {
        // v1.0.18：连带兜底候选一起找（折叠分组 / 滚动未渲染时严格候选可能为空），
        // 否则标签会因取不到名字而不落库。
        var el = findCanvasEl(id, true);
        if (el) name = readName(el);
      }
      if (!name) return false;
      // 时间戳必须**严格大于**当前所有标签：Date.now() 只有毫秒精度，
      // 同一毫秒内连续两次 touch（或 touch 与 syncFromHistory 的 base 撞车）会让
      // ts 相同 → tabbar 排序退化为插入顺序，「刚点/刚带出的那个」不一定排到最前
      // （真机/探针 2026-09-11 实测：O1 带出后仍排在 O2 之后）。
      var ts = Date.now(), k;
      for (k in seen) { if (seen[k] && seen[k].ts >= ts) ts = seen[k].ts + 1; }
      seen[id] = { id: id, name: name, ts: ts };
      setStale(id, false);
      return true;
    }

    // 定位左侧画布项 DOM：遍历所有已知形态，找不到返回 null。
    // 注意：找不到 **不等于** 画布被删除 —— 左侧栏可能是虚拟滚动（未进入视口不渲染）、
    // 收缩折叠隐藏，或正处于 SPA 重绘瞬间。调用方必须按「暂时不可见」处理（见 onSwitch）。
    // v1.0.17：同名形态在「页面 / 画布 / 图层」面板里可能同时存在，必须按面板归属过滤，
    //          否则点标签会点到页面或图层里的同名节点（切错 / 建无效标签）。
    // v1.0.18：**只允许两个拒绝理由**，不再由任何容器识别结果（canvasPanelPresent /
    // 黑名单）压制候选 —— 那正是 BUG-0012/BUG-0013 的根因：锚点被改版换名时
    // canvasPanelPresent 恒 false → 真画布行被一并拒掉。
    //   拒绝① 落在图层树 / 状态页 / 交互树容器内（rejectReason = "inLayerTree"）：
    //          永不点（v1.0.17 成果，T11/C4/C5 锁定）。
    //   拒绝② 行项带 layer-item 类名（rejectReason = "layerItem"）：下部「页面」列 /
    //          「图层」列的行都带它，真画布行不带（真机取证，见 rowHasLayerItem）。
    // 其余候选全部接受，并按归属**优先级**取最优。关键：只要容器可识别，就必须优先选中
    // 「画布」列那一行 —— 因此把「无归属」的 other 排到**最低**，防止「未知面板里一条同
    // cid 的杂散行（无 layer-item、不在任何已知容器内）」抢占真画布行
    //（QA 复核 BUG-0013 时实测到该优先级反转：旧序 other(2) 会压过 canvasWrapped(3)/page(4)）。
    //   ① "canvas"        画布列内、未被 sortable 容器包住 → 最可信
    //   ② "canvasWrapped" 画布列内、被 sortable 容器包住（黑名单名容器）→ 仍是画布列的行
    //   ③ "page"          下部「页面」列容器内 —— 画布列锚点被改版换名时，被包住的真画布行
    //                      会落到这里；带 layer-item 的页面列行已在上一步被拒，故此为逐级兜底
    //   ④ "other"         无归属通用树项 —— 兼容降级（旧 DOM / 无任何锚点）用，可信度最低
    // 净效果：定位对**真画布行不缩水**（凡 v1.0.16 能命中并点击的真画布行，本版也命中；
    // 唯一收窄是永不点图层树 / 页面·图层列——那是 v1.0.16 会误命中的行）。
    // allowFallback 参数保留仅为兼容既有调用点（当前所有调用点都传 true）；本版定位
    // 不再需要它做门控。
    var LOCATE_PRIORITY = { canvas: 1, canvasWrapped: 2, page: 3, other: 4 };

    function findCanvasEl(id, allowFallback) {
      if (!id) return null;
      var esc = (typeof CSS !== "undefined" && CSS.escape) ? CSS.escape(id) : id;
      var p = currentPanels();
      var best = null, bestRank = 99;
      for (var i = 0; i < CANVAS_BASE_SELECTORS.length; i++) {
        var els = document.querySelectorAll(CANVAS_BASE_SELECTORS[i] + '[data-cid="' + esc + '"]');
        for (var j = 0; j < els.length; j++) {
          var el = els[j];
          // 唯二的拒绝理由（见上）：命中即跳过。
          if (rejectReason(el, p) !== "") continue;
          var rank = LOCATE_PRIORITY[classifyItem(el, p)] || 99;
          if (rank < bestRank) { best = el; bestRank = rank; }
        }
      }
      return best;
    }

    // 找到左侧画布栏的可滚动容器（虚拟化长列表的滚动宿主），用于把目标画布滚入渲染窗口。
    // v1.0.18（BUG-0014）：候选**起点不止「第一个画布行」**——当「画布」列一屏都没渲染出行
    //   （搜索过滤态 / 首屏尚未渲染 / 分组折叠）时 firstCanvasItem 可能取不到行，旧实现直接
    //   返回 null，使整条滚动兜底（revealCanvasEl / scrollRowIntoView）被跳过。现改为：
    //   先试第一个画布行，再以**「画布」列容器本身**为起点向上找滚动宿主。
    // 注意：绝不用**页面列的行**作起点（否则会滚错容器 / 影响「页面」列滚动位置）。
    function getCanvasScrollContainer() {
      var p = currentPanels();
      var starts = [];
      var row = firstCanvasItem(p);
      if (row) starts.push(row);
      for (var i = 0; i < p.canvas.length; i++) starts.push(p.canvas[i]);
      for (var s = 0; s < starts.length; s++) {
        var el = starts[s];
        while (el && el !== document.body && el !== document.documentElement) {
          var oy = "";
          try { oy = getComputedStyle(el).overflowY; } catch (e) {}
          if ((oy === "auto" || oy === "scroll") && el.scrollHeight - el.clientHeight > 8) return el;
          el = el.parentElement;
        }
      }
      return null;
    }

    // 待定（stale）标记：画布暂时定位不到时置位，仅视觉提示，不删标签。
    function setStale(id, stale) {
      if (bar && typeof bar.setStale === "function") bar.setStale(id, !!stale);
    }

    // 轮询/观察时复核待定标签：画布项一旦重新出现在 DOM 中立即取消待定。
    function revalidateStale() {
      if (!bar || !bar.staleIds) return false;
      var changed = false;
      Object.keys(bar.staleIds).forEach(function (id) {
        // v1.0.18：用兜底候选复核 —— 折叠隐藏 / 被 sortable 容器包住的行同样算「回来了」
        if (bar.staleIds[id] && findCanvasEl(id, true)) {
          bar.setStale(id, false);
          changed = true;
        }
      });
      return changed;
    }

    // 滚动扫描左侧画布栏，把目标画布滚进虚拟列表的渲染窗口后重新定位。
    // 仅作尽力而为的补救：找不到时回调 (null)，并会把滚动位置还原，不打扰用户。
    var revealToken = 0;
    var revealTimer = null;
    // R2 时长有界：整轮扫描总预算 ≤ 2500ms。
    //   档数上限 REVEAL_MAX_STEPS = 90，单停靠点停留 REVEAL_STEP_MS = 27ms
    //   → 90 × 27 = 2430ms ≤ 2500ms（预算余量 70ms）。
    //   ⚠ 约束（R2/R3 联动）：「档数 × REVEAL_STEP_MS ≤ 2500」。若日后想调大 REVEAL_STEP_MS
    //   以抗渲染延迟，必须把 REVEAL_MAX_STEPS 同步压到 ⌊2500 / REVEAL_STEP_MS⌋ 以内，
    //   否则整轮会超预算（regress.py 全量门禁会假失败）。例：若 STEP_MS=32，则
    //   MAX_STEPS 须 ≤ 78（78×32=2496≤2500）。
    // R1 根因修复见下方 revealCanvasEl：步长上限恒为 clientHeight 比例值，绝不放大。
    var REVEAL_MAX_STEPS = 90;
    var REVEAL_STEP_MS = 27;

    // 搜索定位（v1.0.13）：轮询预算 / 间隔，以及在飞句柄（destroy 时取消）。
    var LOCATE_TIMEOUT_MS = 2000;
    var LOCATE_STEP_MS = 90;
    var locateHandle = null;

    function revealCanvasEl(id, callback) {
      var token = ++revealToken;
      var sc = getCanvasScrollContainer();
      if (!sc) { callback(null, false); return; }
      var start = sc.scrollTop;
      var maxTop = Math.max(0, sc.scrollHeight - sc.clientHeight);
      // R1（根因修复）：步长上限恒为 clientHeight 比例值，**绝不放大到超过 clientHeight**。
      // 旧代码的「放大分支」会在长列表上把 step 放大到远超虚拟列表单次渲染窗口（约
      // clientHeight + overscan），导致档间留下从未渲染的缝隙，目标行（落在缝隙里）永远查不到
      // → 报「未找到画布」。真机佐证：手动滚到可见后 [data-cid] 立刻命中，说明行只是被虚拟化卸载。
      var step = Math.max(120, Math.floor(sc.clientHeight * 0.75));
      // 位置序列预计算 + 显式补上末尾 maxTop 一档（保证列表末行也能被访问，见历史注释）：
      //   旧实现在滚动前判定 `pos > maxTop`，而 pos 按 step 前进，最后一个可达位置 maxTop
      //   从未被真正访问 → 列表末尾（最后一屏）的行在整个扫描过程中从未被渲染，findCanvasEl 恒为 null。
      // 若按 R1 步长所需档数超过 REVEAL_MAX_STEPS，则拆成**多趟交错扫描**（绝不放步长）：
      //   passes = ceil(need / REVEAL_MAX_STEPS)，第 k 趟起点偏移 k*step/passes，
      //   趟内仍按 R1 步长前进；每趟档数 ≤ REVEAL_MAX_STEPS → 单趟预算可控。
      //   ⚠ 预算保证针对单趟（≤ REVEAL_MAX_STEPS 档）场景；多趟仅在需 >~1125 行时才触发，
      //      属超出本缺陷实测范围的超大列表，按需以时间换覆盖，不在此约束内。
      var need = Math.ceil(maxTop / step) + 1;            // 单趟停靠点总数（含末尾 maxTop）
      var passes = Math.max(1, Math.ceil(need / REVEAL_MAX_STEPS));
      var positions = [];
      for (var k = 0; k < passes; k++) {
        var off = passes > 1 ? Math.round(k * step / passes) : 0;
        for (var p = off; p < maxTop; p += step) positions.push(p);
      }
      if (positions.length === 0 || positions[positions.length - 1] !== maxTop) positions.push(maxTop);
      // 多趟会有少量重叠停靠点，去重避免重复扫描。
      var _seenPos = {};
      positions = positions.filter(function (v) {
        if (_seenPos[v]) return false;
        _seenPos[v] = true;
        return true;
      });
      var idx = 0;
      function attempt() {
        if (token !== revealToken) { callback(null, true); return; }   // 已被新的切换请求取消
        var el = findCanvasEl(id, true);   // v1.0.18：连带兜底候选（折叠分组 / 被 sortable 容器包住）
        if (el) { callback(el, false); return; }
        if (idx >= positions.length) {
          // R3 终极复核：已扫完所有停靠点仍未命中时，给虚拟列表最后一次渲染机会再查一次，
          // 避免「刚滚到位就被判失败」。仅在最后一档之后多做一次等待+查询，不随档数线性放大，
          // 预算内可控（最坏 91 × REVEAL_STEP_MS = 2457ms ≤ 2500ms）。
          try { sc.scrollTop = positions[positions.length - 1]; } catch (e) {}
          revealTimer = setTimeout(function () {
            if (token !== revealToken) { callback(null, true); return; }
            var el2 = findCanvasEl(id, true);
            if (el2) { callback(el2, false); return; }
            try { sc.scrollTop = start; } catch (e) {}   // 未找到：还原用户原本的滚动位置
            callback(null, false);
          }, REVEAL_STEP_MS);
          return;
        }
        try { sc.scrollTop = positions[idx]; } catch (e) {}
        idx++;
        revealTimer = setTimeout(attempt, REVEAL_STEP_MS);   // 虚拟列表重渲染需要一两帧
      }
      try { sc.scrollTop = positions[0]; } catch (e) {}
      idx = 1;
      revealTimer = setTimeout(attempt, REVEAL_STEP_MS);
    }

    // 以 React 兼容方式写入左侧搜索框并触发墨刀内部重渲染：
    // 墨刀搜索框是受控 input，直接 box.value= 不会更新其内部状态；必须用
    // HTMLInputElement.prototype 上的原生 value setter 写值，再派发 input/change
    // （bubbles）事件让 React onChange 触发列表过滤。整段 try/catch 容错，
    // 在普通 DOM（非 React）环境同样可用。
    function setSearchValue(box, v) {
      var val = v == null ? "" : String(v);
      try {
        var desc = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement ? HTMLInputElement.prototype : null, "value"
        );
        if (desc && desc.set) desc.set.call(box, val);
        else box.value = val;
      } catch (e) {
        try { box.value = val; } catch (e2) {}
      }
      try {
        box.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
        box.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
      } catch (e) {}
    }

    // 探测墨刀左侧「画布搜索框」（真机取证 2026-09-07；定位加固第 2 轮 2026-09-17 加固）。
    // 历史实现只认三条硬条件：placeholder 含 搜索|查找|检索 + 宽度>40 + 视口顶部 300px 内。
    // 任一条件与真机 UI 漂移（改文案 / 搜索框下移 / 换组件）就返回 null —— 而 locateCanvas
    // 曾以 `if(!box){fail();return;}` **短路**，于是「清空过滤」与「按名检索」两条能力被整体
    // 跳过，只剩滚动扫描兜底（折叠分组的行无论滚多少次都不会出现）→ 报「未找到画布」。
    // 现按「**结构优先、文案/几何兜底**」分四级，并把命中级别记入 lastSearchBoxSource 供诊断：
    //   L1 缓存：上次成功用过的那个框（仍在文档中且可见）—— 同一页面内最可靠
    //   L2 结构：**画布列容器内**的文本类输入框（不依赖 placeholder，也不依赖绝对坐标）
    //   L3 文案：placeholder 命中更宽词表（含 关键字/名称/search/filter），放宽 300px 限制
    //   L4 兼容：原严格规则，保持最后（老夹具 / 老真机行为不变）
    // 只放宽「找得到框」这一侧；写值/取值语义（setSearchValue）一字未改。
    var lastSearchBox = null;
    var lastSearchBoxSource = "none";
    var SEARCH_PLACEHOLDER_RE = /搜索|查找|检索|关键字|名称|search|filter/i;
    var BAD_INPUT_TYPES = [
      "hidden", "checkbox", "radio", "file", "color", "range",
      "button", "submit", "reset", "image", "password"
    ];

    function inputRejected(box) {
      var t = (box.getAttribute ? (box.getAttribute("type") || "") : "").toLowerCase();
      return !!t && BAD_INPUT_TYPES.indexOf(t) >= 0;
    }
    // 可用性判据：在文档中、非禁用类型、有可见尺寸。宽度阈值沿用 40px（避免命中装饰性小框）。
    function inputUsable(box) {
      if (!box || inputRejected(box)) return false;
      try {
        if (box.isConnected === false) return false;
        var r = box.getBoundingClientRect();
        return r.width > 40 && r.height > 0;
      } catch (e) { return false; }
    }
    function rememberSearchBox(box, source) {
      lastSearchBox = box || null;
      lastSearchBoxSource = box ? (source || "none") : "none";
      return box;
    }

    function findScreenSearchBox() {
      // L1 缓存：上次用过的框仍可用就直接复用（避免同一页面内反复探测得到不同结果）
      if (lastSearchBox && inputUsable(lastSearchBox)) return lastSearchBox;
      lastSearchBox = null;
      // L2 结构：画布列容器内的文本类输入框（不靠 placeholder / 不靠视口坐标）
      var p = currentPanels();
      for (var c = 0; c < p.canvas.length; c++) {
        var nodes = [];
        try { nodes = p.canvas[c].querySelectorAll("input"); } catch (e) { nodes = []; }
        for (var n = 0; n < nodes.length; n++) {
          // 行内的输入框（重命名 / 改名）不是搜索框 → 跳过
          if (nodes[n].closest && nodes[n].closest("li.rn-content-item")) continue;
          if (inputUsable(nodes[n])) return rememberSearchBox(nodes[n], "anchor");
        }
      }
      // L3 文案：更宽的词表 + 不再限制视口 300px
      var inputs = document.querySelectorAll("input");
      for (var i = 0; i < inputs.length; i++) {
        var box = inputs[i];
        var ph = box.getAttribute ? (box.getAttribute("placeholder") || "") : "";
        if (!SEARCH_PLACEHOLDER_RE.test(ph)) continue;
        if (!inputUsable(box)) continue;
        return rememberSearchBox(box, "placeholder");
      }
      // L4 兼容：原严格规则（placeholder 含 搜索|查找|检索 + 宽>40 + top<300）
      for (var j = 0; j < inputs.length; j++) {
        var b4 = inputs[j];
        var ph4 = b4.getAttribute ? (b4.getAttribute("placeholder") || "") : "";
        if (!/搜索|查找|检索/.test(ph4)) continue;
        try {
          var r4 = b4.getBoundingClientRect();
          if (r4.width <= 40) continue;     // 太窄不可能是左侧栏搜索框
          if (r4.top >= 300) continue;      // 仅认视口顶部 300px 内的搜索框
        } catch (e4) {
          continue;
        }
        return rememberSearchBox(b4, "legacy");
      }
      return null;
    }

    // 轮询 findCanvasEl(id)：命中即 cb(el)，预算耗尽 cb(null)。内部捕获启动时的
    // revealToken —— 期间一旦被新的切换请求递增（连点竞态）即静默放弃，不再回调、
    // 也不再调度下一次；返回 { cancel } 供 destroy / 新一轮定位清理在飞轮询。
    function pollFind(id, timeoutMs, stepMs, cb) {
      var token = revealToken;
      var deadline = Date.now() + timeoutMs;
      var timer = null;
      var stopped = false;
      function cancel() {
        stopped = true;
        if (timer) { clearTimeout(timer); timer = null; }
      }
      function attempt() {
        timer = null;
        if (stopped || token !== revealToken) return;   // 被取消 / 被新切换取代
        var el = findCanvasEl(id, true);   // v1.0.18：连带兜底候选（折叠分组 / 被 sortable 容器包住）
        if (el) { cb(el); return; }
        if (Date.now() >= deadline) { cb(null); return; }
        timer = setTimeout(attempt, stepMs);
      }
      timer = setTimeout(attempt, stepMs);
      return { cancel: cancel };
    }

    // ---- 折叠分组展开阶段（定位加固第 2 轮，2026-09-17，BUG-0016）------------------------
    // 旧实现「找不到目标行」时只会滚动扫描 —— 而**折叠闭合的分组，其子行无论怎样滚动都不会
    // 被渲染**（真机折叠 = 子行不在 DOM；夹具可建模为 display:none）。更致命的是：
    // 旧代码里唯一的展开入口 ensureRowVisible 只在 activateCanvas 内被调用，即「**已经找到
    // 行之后**」才尝试展开 —— 而折叠恰好让行找不到 ⇒ 循环依赖：
    //     要展开得先找到行，要找到行得先展开。
    // 所以「被收缩折叠不可见」这一半需求，在任何 DOM 契约下都不可能被旧实现修好。
    // 本阶段专门打破该循环：**不依赖目标行是否已在 DOM**，直接在「画布」列范围内把处于
    // 折叠态的开关全部展开。
    // 纪律（务必守住，违者复发 BUG-0011/0012/0013）：
    //   · 只认标准 `aria-expanded="false"`，**不新增任何猜测式点击启发式**（R7 立规）；
    //   · **绝不越出「画布」列容器**（越界会误点左侧 nav / 页面列 / 图层列，触发切换面板）；
    //   · 画布列锚点一个都没有时**直接放弃**（无锚点 ⇒ 无法界定安全范围，宁可不点）；
    //   · 同一节点本轮只点一次（DOM 上的 JS 私有 expando，不写 data-*，不污染宿主 React 读回的字段）；
    //   · 每轮**重新扫描**开关集合 —— 展开会让墨刀重渲染，旧节点可能已脱离文档。
    // 返回实际被点击的开关数（0 = 无可展开项，调用方不必等重渲染）。
    var EXPAND_MAX = 10;
    // 自产点击抑制（防「凭空长标签」，R11）：展开折叠分组时我们会**合成 click**，
    // 而 `trackCanvasFromEvent` 是 document 捕获阶段的监听 → 它会把这次合成点击也当成
    // 「用户点了左栏一行」；若该分组行**不带 `folder` 类名**（真机类名漂移），
    // 就会凭空长出一个标签（历史上出现过同类问题）。
    // 故合成点击（仅限「展开折叠分组」这类**非用户意图**的点击）期间置位本计数器，
    // 点击监听器直接忽略。**注意不要用它包住「点目标行切换画布」** —— 那是用户意图。
    // 用计数器而非布尔：click 派发虽同步，但多轮展开可能嵌套，需成对。
    var suppressTrack = 0;
    function clickSuppressed(el) {
      if (!el || typeof el.click !== "function") return;
      suppressTrack++;
      try { el.click(); } catch (e) {} finally { suppressTrack--; }
    }
    function expandCollapsedInCanvasPanel() {
      var p = currentPanels();
      if (!p.canvas.length) return 0;
      var clicked = 0;
      for (var round = 0; round < EXPAND_MAX; round++) {
        var next = null;
        for (var c = 0; c < p.canvas.length && !next; c++) {
          var nodes = [];
          try { nodes = p.canvas[c].querySelectorAll('[aria-expanded="false"]'); } catch (e) { nodes = []; }
          for (var i = 0; i < nodes.length; i++) {
            if (!nodes[i].__mdRtExpanded) { next = nodes[i]; break; }
          }
        }
        if (!next) break;
        next.__mdRtExpanded = 1;
        clickSuppressed(next);                 // 墨刀原生展开行为（点击分组行）；自产点击不计入建标签
        clicked++;
      }
      return clicked;
    }

    // ---- 末位兜底展开（结构识别，**仅在前两条主路都无能为力时**才执行）------------------
    // 为什么需要它：真机实测「画布」列里**没有** aria-expanded="false"（collapsedToggleCount = 0），
    // 若「搜索框四级探测」也够不着（改版把搜索框挪出画布列容器、或换成非 input 组件），
    // 则上面两条主路全部为空 → 现状是**必然失败**。该组合没有任何退路，故补这一层。
    // 判据是**结构**而非类名/文案（不用 "folder"/"collapse"/caret 之类猜测信号）：
    //   在「画布」列内，一个**自身有布局盒**的行（`li.rn-content-item`），却包着一个
    //   **没有布局盒**的 `ul` 列表容器 —— 这是「折叠的分组行」唯一自洽的解释
    //   （叶子画布行不会含列表容器）。
    // 纪律（与 R7 的边界，务必守住）：
    //   · 只在**前两条主路都失败**的分支里被调用（正常流程永不执行 → 不可能让已好的流程变糟）；
    //   · 只在「画布」列锚点容器内寻找，绝不越界（越界会误点页面列 / 图层列 / 左栏 nav）；
    //   · 只点「行 + 其内层行项」，不点任意后代；**不点目标行本身**（不替用户做切换）；
    //   · 同一节点同一页面只点一次（DOM 上的 JS 私有 expando，不写 data-*，不污染宿主 React 字段）；
    //   · 画布列锚点一个都没有 → 直接放弃（无锚点 ⇒ 无法界定安全范围，宁可不点）。
    function expandCollapsedByStructure(id) {
      var p = currentPanels();
      if (!p.canvas.length) return 0;
      var clicked = 0;
      for (var round = 0; round < EXPAND_MAX; round++) {
        var cands = structuralToggleCandidates(p, id);
        if (!cands.length) break;
        var next = cands[0];
        next.__mdRtStructExpanded = 1;
        var hit = null;
        try { hit = next.querySelector("div.rn-list-item") || next; } catch (e) { hit = next; }
        clickSuppressed(hit);                  // 墨刀原生展开行为（点击分组行）；自产点击不计入建标签
        clicked++;
      }
      return clicked;
    }

    // 结构候选集：展开与诊断**共用同一判据**（避免两处漂移）。返回「像折叠分组行」的节点数组。
    // 判据只有两条：行自身有布局盒；行内含至少一个无布局盒的 `ul` 列表容器。
    function structuralToggleCandidates(p, id) {
      var out = [];
      if (!p || !p.canvas || !p.canvas.length) return out;
      for (var c = 0; c < p.canvas.length; c++) {
        var rows = [];
        try { rows = p.canvas[c].querySelectorAll("li.rn-content-item"); } catch (e) { rows = []; }
        for (var i = 0; i < rows.length; i++) {
          var row = rows[i];
          if (row.__mdRtStructExpanded) continue;                       // 本轮已点过
          if (id && row.getAttribute && row.getAttribute("data-cid") === id) continue;  // 不点目标行本身
          if (!isRowVisible(row)) continue;                             // 行本身必须可见
          var lists = [];
          try { lists = row.querySelectorAll("ul"); } catch (e2) { lists = []; }
          for (var j = 0; j < lists.length; j++) {
            if (!isRowVisible(lists[j])) { out.push(row); break; }      // 有不可见列表容器 → 折叠分组行
          }
        }
      }
      return out;
    }

    // ---- 路径驱动的折叠展开（BUG-0019，2026-09-17 真机取证后新增）----------------------
    // 取证结论（三条均已实锤，见 CHANGELOG BUG-0019）：
    //   ① 真机折叠 = 子 `ul` **从 DOM 移除**，DOM 里不留任何折叠痕迹
    //      （`aria-expanded` 计数为 0；也找不到「可见行内含不可见 ul」）⇒ 事后**检测**折叠不可能；
    //   ② 左栏**根本没有搜索框**（`.mb-left-panel-container` 内 input/textarea = 0）
    //      ⇒ 「清空过滤 / 按名检索」两条路在真机恒为空操作；
    //   ③ 展开入口是文件夹行内的 **`a.expander`**（真实语义类名，非 styled-components 哈希）；
    //      折叠态 `<li>` 只有 1 个子元素，展开态 2 个（多出一个嵌套 `ul`）。
    // 故唯一可行解 = **画布可见时（建标签那一刻）记下它的父文件夹 cid 链**，点标签时按记录
    // 逐级点 `a.expander` 展开。全程不依赖任何事后检测，也不依赖容器锚点。
    var groupPath = {};                 // cid -> [外层文件夹 cid, …, 内层文件夹 cid]

    // 从被点击的画布行向上收集祖先文件夹 cid（返回顺序：外层 → 内层）。
    function collectGroupPath(el) {
      var out = [];
      var n = el;
      for (var d = 0; n && d < 12; d++) {
        n = n.parentElement;
        if (!n) break;
        if (String(n.tagName).toUpperCase() !== "LI") continue;
        for (var i = 0; i < n.children.length; i++) {
          var c = n.children[i];
          if (!c.classList || !c.classList.contains("rn-list-item")) continue;
          if (!c.classList.contains("folder")) continue;      // 叶子画布行不是分组
          if (rowHasLayerItem(c)) continue;                   // 图层列：绝不记录、绝不点
          if (matchAncestor(c, LAYER_TREE_HARD_SELECTORS)) continue;
          var fid = c.getAttribute("data-cid");
          if (fid) out.push(fid);
          break;
        }
      }
      return out.reverse();
    }
    // 取文件夹行项（真机形态：`div.rn-list-item.folder[data-cid]`）。
    function folderItemByCid(fid) {
      if (!fid) return null;
      var esc = (typeof CSS !== "undefined" && CSS.escape) ? CSS.escape(fid) : fid;
      var els = [];
      try { els = document.querySelectorAll('div.rn-list-item.folder[data-cid="' + esc + '"]'); } catch (e) { return null; }
      for (var i = 0; i < els.length; i++) {
        if (rowHasLayerItem(els[i])) continue;
        if (matchAncestor(els[i], LAYER_TREE_HARD_SELECTORS)) continue;
        return els[i];
      }
      return null;
    }
    // 该文件夹是否已展开：展开态的行内会有一个**带布局盒**的嵌套 `ul`。
    // ⚠ 不能只查 `li.children` 里的直接 UL —— 夹/真机都可能把子列表再包一层 div
    // （真机：li > [div.rn-list-item, ul]；夹具：li > div.canvas-sortable-list > ul）。
    // 折叠态要么 ul 不在 DOM，要么被 display:none（无布局盒）→ 两种情况都判 false。
    // 取不到行时返回 true（宁可不点，也不误点）。
    function folderRowExpanded(item) {
      var li = item && item.parentElement;
      while (li && String(li.tagName).toUpperCase() !== "LI") li = li.parentElement;
      if (!li) return true;
      var uls = [];
      try { uls = li.querySelectorAll("ul"); } catch (e) { return true; }
      for (var i = 0; i < uls.length; i++) {
        try { if (uls[i].getClientRects().length > 0) return true; } catch (e2) {}
      }
      return false;
    }
    // 按记录的 cid 链逐级展开；每点一级等一拍（墨刀 React 重渲染是异步的）。
    // done(true) = 该展开的都展开了；done(false) = 超时或被新一轮定位作废。
    function expandRecordedPath(path, token, done) {
      var i = 0;
      var deadline = Date.now() + LOCATE_TIMEOUT_MS;
      function step() {
        if (token !== revealToken) { done(false); return; }
        while (i < path.length) {
          var item = folderItemByCid(path[i++]);
          if (!item) continue;
          if (folderRowExpanded(item)) continue;
          var ex = null;
          try { ex = item.querySelector("a.expander"); } catch (e) { ex = null; }
          if (!ex) continue;
          clickSuppressed(ex);
          if (Date.now() > deadline) { done(false); return; }
          setTimeout(step, LOCATE_STEP_MS);
          return;
        }
        done(true);
      }
      step();
    }

    // v1.0.13 自动重定位：在 onSwitch 未命中分支、revealCanvasEl 滚动扫描**之前**
    // 调用。真机取证结论：真实墨刀设计页左侧列表**全量渲染**，真正「找不到」的根因
    // 是左侧搜索框处于过滤态（非命中画布被移出 DOM）；故优先把搜索框当作定位工具：
    //   情形一  搜索框有词 → 先清空恢复全量列表，轮询目标是否回到 DOM；
    //   情形二  仍找不到（或搜索框本就为空）→ 把目标名写入搜索框触发墨刀检索
    //           （跨文件夹命中），命中即切换；
    //   切换成功 → 搜索框保持空态（全量列表），**不再自动恢复**原检索词
    //           （需求调整 2026-09-07：恢复原词会让列表立刻回到过滤态，
    //            刚打开的画布若不含该词随即移出视口，用户会误以为没切过去）；
    //   全部失败 → 还原搜索现场 → **展开画布列内折叠分组** → 仍未命中才调 fail()
    //           （= 滚动扫描 + 不可达提示，v1.0.12 语义）。
    // 定位加固第 2 轮（2026-09-17）：**取消「探测不到搜索框就 fail()」的短路**。
    //   旧写法 `if(!box){fail();return;}` 会让能力互相短路 —— 搜索框一旦探测失败，
    //   「清空过滤 / 按名检索 / 展开折叠」三条能力全部被跳过，只剩滚动扫描（对折叠行无效）。
    //   现改为「能力串联」：搜索框不可用就跳过搜索两阶段，仍然执行展开 + 扫描兜底。
    function locateCanvas(id, name, fail) {
      // 竞态防护：本次定位开始即令在飞扫描/轮询失效（必须最先执行 —— 本函数即使走
      // 「无搜索框」分支也会实际切换画布，同样需要让上一次的在飞请求作废）。
      var token = ++revealToken;
      if (locateHandle) { locateHandle.cancel(); locateHandle = null; }
      var box = findScreenSearchBox();
      var originalValue = box ? (box.value || "") : "";
      var hadFocus = !!(box && document.activeElement === box);
      // 情形二注入的临时检索词（用于成功后复核：见 succeed）
      var typedTerm = "";

      // 切换后归还焦点（若用户原本聚焦在搜索框）
      function finish() {
        if (box && hadFocus && document.activeElement !== box) {
          try { box.focus(); } catch (e) {}
        }
      }
      // 还原搜索现场：仅用于**彻底失败**兜底（空原值 = 保持清空/全量列表；
      // 非空 = 恢复原搜索词，别把用户没定位成功前的检索上下文弄丢）。
      // 切换**成功**路径不调用（见 succeed：成功后不恢复原检索词）。
      function restoreSearch() {
        if (!box) return;
        try { setSearchValue(box, originalValue); } catch (e) {}
      }
      function succeed(el) {
        if (token !== revealToken) return;
        activateCanvas(id, name, el);
        finish();
        // 需求调整（2026-09-07）：切换成功后**不自动恢复**原检索词——若把原词
        // 写回，列表立即回到过滤态，刚打开的画布（往往不含该词）又被移出 DOM，
        // 用户会误以为没切过去。故成功后搜索框统一保持/回到空态 = 全量列表；
        // 情形二注入的临时「目标名前缀」检索词也在此一并清掉，不留残留。
        if (box && box.value) {
          try { setSearchValue(box, ""); } catch (e) {}
          // 需求冲突消解（定位加固第 2 轮）：
          //   BUG-0008 要求成功后清空检索词（左栏回到全量列表）；
          //   BUG-0014 要求「定位到该画布在左栏列表中的位置并**保持**」。
          //   若目标行本来就是**靠检索才现身**的（它在折叠分组里），一清空就立刻消失 →
          //   用户看到「刚定位到又没了」。故清空后**复核**目标行是否仍找得到，找不到就把
          //   检索词写回：宁可让左栏停在检索态（那一行看得见），也不让定位结果消失。
          if (typedTerm && !findCanvasEl(id, true)) {
            try { setSearchValue(box, typedTerm); } catch (e2) {}
          }
        }
      }
      // 搜索两阶段都失败后的收尾：先展开画布列内折叠分组，展开过就轮询等重渲染，
      // 仍未命中才 fail()（滚动扫描 + 提示）。
      function allFailed() {
        if (token !== revealToken) return;
        var n = 0;
        try { n = expandCollapsedInCanvasPanel(); } catch (e) { n = 1; }
        if (!n) {
          // 前两条主路（搜索清空 / 按名检索 / aria 展开）都为空 → 末位兜底：按**结构**展开
          // 折叠分组。真机折叠不用 aria-expanded 且搜索框够不着时，这是唯一剩下的动作；
          // 它只在「本来就要报失败」的分支里执行，不可能让已经能用的流程变糟。
          try { n = expandCollapsedByStructure(id); } catch (e) { n = 0; }
        }
        if (!n) {
          // 确实无可展开项：没必要多等一轮（保持「画布确实不存在」时的提示时延）
          finish();
          restoreSearch();
          fail();
          return;
        }
        // 展开动作已发出 → 墨刀重渲染左栏需要一两帧，用轮询等行出现再判成败
        locateHandle = pollFind(id, LOCATE_TIMEOUT_MS, LOCATE_STEP_MS, function (el) {
          locateHandle = null;
          if (token !== revealToken) return;
          if (el) { succeed(el); return; }
          finish();
          restoreSearch();
          fail();
        });
      }
      // 无搜索框可用：跳过搜索两阶段，但**仍然**执行「展开折叠分组」兜底（原来这里直接
      // fail()，正是「折叠不可见」永远修不好的原因）。
      // BUG-0019：真机常态 = 「搜索框未实例化 + 折叠零痕迹」，此时检索两阶段根本不可用，
      // 「按记录的父文件夹 cid 链逐级点 a.expander」是唯一主路，故在 !box 分支启用。
      // ⚠ 只在 !box 时启用（第 3 轮踩到的回归，务必记住）：早期我把它**前置到搜索两阶段之前**，
      //   等于给每次定位都多塞一轮 2s 轮询，直接把 test_qa_v1013_edge / test_relocate_search
      //   的等待窗口顶爆（门禁一次红 7 条）。路径展开是**兜底**，不是**前置** ——
      //   有搜索框时原有两阶段必须原样保留，不得改变时序。
      if (!box) {
        var recordedPath = groupPath[id] || null;
        if (recordedPath && recordedPath.length) {
          expandRecordedPath(recordedPath, token, function () {
            if (token !== revealToken) return;
            locateHandle = pollFind(id, LOCATE_TIMEOUT_MS, LOCATE_STEP_MS, function (el) {
              locateHandle = null;
              if (token !== revealToken) return;
              if (el) { succeed(el); return; }
              allFailed();                 // 记录的链也救不回来 → 退回展开 + 滚动扫描兜底
            });
          });
          return;
        }
        allFailed();
        return;
      }
      // 情形二：按目标名检索；名称较长时取前若干字符（子串命中即可）。
      // 定位加固第 2 轮：改为**检索词阶梯**（全名 → 前 8 → 前 4），逐个尝试、命中即停。
      //   理由：真机画布名常带后缀（如「航班座位号查询（说明）」），把整名塞进搜索框可能
      //   因墨刀的分词/模糊匹配策略而不命中；截断到合法前缀基本必中。阶梯有界（≤3 个词）。
      var terms = [];
      function termLadder() {
        var out = [];
        var n = String(name || "").replace(/\s+/g, " ").trim();
        if (!n) return out;
        [n, n.slice(0, 8), n.slice(0, 4)].forEach(function (t) {
          t = String(t || "").trim();
          if (t && out.indexOf(t) < 0) out.push(t);
        });
        return out;
      }
      function searchNext() {
        if (token !== revealToken) return;
        if (!terms.length) { allFailed(); return; }
        typedTerm = terms.shift();
        try { setSearchValue(box, typedTerm); } catch (e) { allFailed(); return; }
        locateHandle = pollFind(id, LOCATE_TIMEOUT_MS, LOCATE_STEP_MS, function (el) {
          locateHandle = null;
          if (token !== revealToken) return;
          if (el) { succeed(el); return; }
          searchNext();        // 本词未命中 → 换更短的前缀再试
        });
      }
      function searchByName() {
        if (!name) { allFailed(); return; }
        terms = termLadder();
        searchNext();
      }
        if (originalValue) {
          // 情形一：清空过滤词 → 目标（若只是被搜索过滤）随全量列表回到 DOM
          try { setSearchValue(box, ""); } catch (e) { allFailed(); return; }
          locateHandle = pollFind(id, LOCATE_TIMEOUT_MS, LOCATE_STEP_MS, function (el) {
            locateHandle = null;
            if (token !== revealToken) return;
            if (el) { succeed(el); return; }
            searchByName();      // 清空后仍找不到 → 情形二
          });
        } else {
          searchByName();        // 搜索框本就为空 → 直接走情形二
        }
    }

    // 行是否真正可见（在渲染树里、有布局盒）。display:none / 被折叠 / 已脱离文档 → false。
    function isRowVisible(el) {
      try { return !!(el && el.getClientRects && el.getClientRects().length > 0); } catch (e) { return false; }
    }

    // ⚠ 与 isRowVisible 的**语义差异**（务必分清，二者互补，不可互相替代）：
    //   isRowVisible(el)       只判「有没有布局盒」（在渲染树里且没被 display:none / 折叠 / 脱离
    //                          文档）；**滚出滚动容器可视区的行照样有布局盒** → 仍返回 true。
    //                          它回答的是「这个节点还算数吗」。
    //   isRowInScroller(el, sc) 判「是否落在滚动容器 sc 的**可视矩形**内」（上下各 4px 容差）。
    //                          它回答的是「用户此刻**看得见**它吗」。
    // 「定位成功」= 在渲染树 **且** 在可视区内；只满足前者会出现「点标签后列表刷新回到顶部、
    // 目标行滚出视野」这种「没定位到」的观感（BUG-0014 的真机现象）。
    function isRowInScroller(el, sc) {
      if (!el || !sc) return false;
      try {
        var r = el.getBoundingClientRect();
        var c = sc.getBoundingClientRect();
        var TOL = 4;
        return r.top >= c.top - TOL && r.bottom <= c.bottom + TOL;
      } catch (e) {
        return false;
      }
    }

    // 目标行所属的滚动宿主：向上找最近的、overflowY 为 auto|scroll 且**确实可滚动**
    // （scrollHeight - clientHeight > 8）的祖先；找不到则退回 getCanvasScrollContainer()。
    // 从 el 自身开始（行本身不会是滚动宿主，但含自身更稳妥）。
    function getRowScroller(el) {
      var node = el;
      while (node && node !== document.body && node !== document.documentElement) {
        var oy = "";
        try { oy = getComputedStyle(node).overflowY; } catch (e) {}
        if ((oy === "auto" || oy === "scroll") && node.scrollHeight - node.clientHeight > 8) return node;
        node = node.parentElement;
      }
      return getCanvasScrollContainer();
    }

    // 收集包住目标行的「已折叠开关」祖先（aria-expanded="false"）。
    // 只在**画布列容器内**逐级上溯，绝不越过画布列去碰页面/图层列与左侧 nav，
    // 避免为了展开一个分组而误触发切换面板等副作用。
    function collectCollapsedToggles(el, p) {
      var out = [];
      var node = el && el.parentElement, hop = 0;
      while (node && hop++ < 10) {
        if (p.canvas.length > 0 && !insideAny(node, p.canvas)) break;   // 越出画布列即停止
        var exp = node.getAttribute ? node.getAttribute("aria-expanded") : null;
        if (exp === "false") out.push(node);
        node = node.parentElement;
      }
      if (!out.length && p.canvas.length === 0) {
        // 没有画布列锚点的 DOM（改版 / 旧结构）：只认标准 aria-expanded，最多上溯 5 层
        node = el && el.parentElement;
        var hop2 = 0;
        while (node && hop2++ < 5) {
          if (node.getAttribute && node.getAttribute("aria-expanded") === "false") out.push(node);
          node = node.parentElement;
        }
      }
      return out;
    }

    // 「定位到画布所在位置」：确保目标行在左栏真正可见。
    //   1) 已可见 → 直接 scrollIntoView(nearest) 并返回它；
    //   2) 被收缩折叠隐藏 → 展开包住它的折叠开关（最多 2 层），展开后**重新定位**
    //      （墨刀展开会重渲染左栏，原节点可能已被替换），再滚动到可见；
    //   3) 返回最终可用的节点（调用方用它做点击切换）。
    function ensureRowVisible(id, el) {
      if (!el) return null;
      var p = currentPanels();
      if (isRowVisible(el)) {
        try { el.scrollIntoView({ block: "nearest" }); } catch (e) {}
        return el;
      }
      var toggles = collectCollapsedToggles(el, p);
      for (var i = 0; i < toggles.length && i < 2; i++) {
        clickSuppressed(toggles[i]);     // 展开折叠分组（墨刀原生行为）；自产点击不计入建标签
        var fresh = findCanvasEl(id, true);
        if (fresh) el = fresh;
        if (isRowVisible(el)) break;
      }
      var target = findCanvasEl(id, true) || el;
      if (isRowVisible(target)) {
        try { target.scrollIntoView({ block: "nearest" }); } catch (e) {}
      }
      return target;
    }

    // 把目标行滚入其滚动容器的可视区。
    //   center=false → 只保证**完整可见**（尽量少动，不打扰用户）
    //   center=true  → 尽量**居中**（点标签切换后把目标行放到视觉中心）
    // 关键点：
    //   · 先按 id **重新定位**行节点（传入的 el 可能是 React 重渲染前的旧节点，已脱离文档）；
    //   · 用 rect 差算出相对滚动宿主的 rowTop，据此设 sc.scrollTop，再 clamp 到
    //     [0, scrollHeight - clientHeight]；
    //   · 另调 row.scrollIntoView({block:"nearest"}) 兜底（兼容非标准滚动宿主）。
    function scrollRowIntoView(id, el, center) {
      var row = null;
      try { row = findCanvasEl(id, true) || el; } catch (e) { row = el; }
      if (!row) return null;
      var sc = getRowScroller(row);
      if (sc) {
        try {
          var rr = row.getBoundingClientRect();
          var cr = sc.getBoundingClientRect();
          var rowTop = rr.top - cr.top + sc.scrollTop;     // 行在滚动内容坐标系中的位置
          var rowH = rr.height;
          var view = sc.clientHeight;
          var maxTop = Math.max(0, sc.scrollHeight - view);
          var t;
          if (center) {
            t = rowTop - (view - rowH) / 2;                // 居中
          } else {
            var rel = rr.top - cr.top;                     // 相对可视区顶端
            if (rel < 0) t = rowTop - 8;                   // 在可视区上方 → 上移露出（留 8px 边距）
            else if (rel + rowH > view) t = rowTop + rowH - view + 8;  // 在下方 → 下移露出
            else t = sc.scrollTop;                         // 已完整可见 → 不动
          }
          t = Math.max(0, Math.min(maxTop, t));
          sc.scrollTop = t;
        } catch (e) {}
      }
      try { row.scrollIntoView({ block: "nearest" }); } catch (e) {}
      return row;
    }

    // ---- 左栏选中态（v1.0.18 · 需求②）：给「定位到的那一行」加 md-rt-located ----
    // 目的：用户点标签切换后，左栏能看出「当前画布是哪一行」。
    // 纪律：
    //   · 目标行若**已带墨刀自身激活类** → 什么都不做（不叠加、不与墨刀争样式）；
    //   · 否则加 md-rt-located，并从**上一行**移除（模块级记住上次标记节点，保证可逆）；
    //   · 样式由我方注入的 <style> 提供：左侧 3px 主色竖条 + 淡背景；
    //     不写 !important、不覆盖 display/position/height 等布局属性。
    var locatedRow = null;       // 上次被标记的节点（用于「从上一行移除」）
    var locatedStyleEl = null;   // 注入的样式节点（destroy 时移除）
    var keepHandle = null;       // 在飞的 keepRowVisible 句柄（新切换 / destroy 时取消）
    var MOLDE_ACTIVE_SELECTOR =
      ".active,.is-active,.is-selected,.selected,.current,[aria-selected='true']";

    // 行（或其内层行项 / 外层 li 容器）是否已带墨刀自身激活类。
    function rowHasMoldeActive(row) {
      if (!row || !row.classList) return false;
      try { if (row.matches && row.matches(MOLDE_ACTIVE_SELECTOR)) return true; } catch (e) {}
      if (row.querySelector) {
        try { if (row.querySelector(MOLDE_ACTIVE_SELECTOR)) return true; } catch (e) {}
      }
      try {
        var li = row.closest ? row.closest("li.rn-content-item") : null;
        if (li && li.matches && li.matches(MOLDE_ACTIVE_SELECTOR)) return true;
      } catch (e) {}
      return false;
    }

    function ensureLocatedStyle() {
      if (locatedStyleEl && locatedStyleEl.parentNode) return;
      locatedStyleEl = document.createElement("style");
      locatedStyleEl.id = "md-recent-tabs-located";
      locatedStyleEl.textContent =
        ".md-rt-located{" +
        "box-shadow:inset 3px 0 0 0 #2d7ff9;" +
        "background:rgba(45,127,249,0.10);" +
        "}";
      (document.head || document.documentElement).appendChild(locatedStyleEl);
    }

    function clearLocatedRow() {
      if (locatedRow && locatedRow.classList) {
        try { locatedRow.classList.remove("md-rt-located"); } catch (e) {}
      }
      locatedRow = null;
    }

    function markLocatedRow(row) {
      if (!row || !row.classList) return;
      if (rowHasMoldeActive(row)) {          // 墨刀自身已做掉选中态 → 什么都不做
        if (locatedRow && locatedRow !== row) clearLocatedRow();
        return;
      }
      if (locatedRow && locatedRow !== row) {
        try { locatedRow.classList.remove("md-rt-located"); } catch (e) {}
      }
      try { row.classList.add("md-rt-located"); } catch (e) {}
      locatedRow = row;
      ensureLocatedStyle();
    }

    // 点标签切换后把左栏目标行「保持在可视位置」——专治「点标签后又回到列表顶部」：
    // 墨刀在切换画布时会重渲染左栏（重建行节点 / 复位 scrollTop），一次滚动会被冲掉。
    // 策略：在 rAF、+60/180/400/800ms（不超过 ms）各复查一次：
    //   · 行已在 sc 可视区内 → 提前结束；
    //   · 被复位 → 重新 scrollRowIntoView；
    //   · 行被重建（旧节点脱离文档）→ 重新 findCanvasEl(id,true) 再滚；
    //   · 对新节点补选中态标记。
    // **用户一旦手动滚动立即放弃**：document 上临时监听 wheel/keydown，sc 上监听
    //   pointerdown/touchstart（capture、passive），触发即停止纠偏并解绑全部监听。
    // token 与 revealToken 联动：新切换 / destroy 令在飞纠偏失效。返回 { cancel }。
    function keepRowVisible(id, ms) {
      var budget = (ms == null) ? 800 : ms;
      var token = revealToken;
      var timers = [];
      var scBound = null;
      var done = false;

      function abort() { cleanup(); }

      function cleanup() {
        if (done) return;
        done = true;
        for (var i = 0; i < timers.length; i++) { try { clearTimeout(timers[i]); } catch (e) {} }
        timers = [];
        try { document.removeEventListener("wheel", abort, true); } catch (e) {}
        try { document.removeEventListener("keydown", abort, true); } catch (e) {}
        if (scBound) {
          try { scBound.removeEventListener("pointerdown", abort, true); } catch (e) {}
          try { scBound.removeEventListener("touchstart", abort, true); } catch (e) {}
          scBound = null;
        }
      }

      function tick() {
        if (done) return;
        if (token !== revealToken) { cleanup(); return; }   // 已被新的切换请求 / destroy 取代
        var row = null;
        try { row = findCanvasEl(id, true); } catch (e) { row = null; }
        if (!row) { try { scrollRowIntoView(id, null, true); } catch (e) {} return; }
        markLocatedRow(row);                                 // 行被重建 → 对新节点补选中态
        var sc = getRowScroller(row);
        if (sc && isRowInScroller(row, sc)) { cleanup(); return; }   // 已在可视区 → 提前结束
        try { scrollRowIntoView(id, row, true); } catch (e) {}
      }

      // 立即绑定「用户手动滚动即放弃」的监听
      try {
        document.addEventListener("wheel", abort, { capture: true, passive: true });
        document.addEventListener("keydown", abort, { capture: true, passive: true });
      } catch (e) {
        try {
          document.addEventListener("wheel", abort, true);
          document.addEventListener("keydown", abort, true);
        } catch (e2) {}
      }
      try {
        var probe = findCanvasEl(id, true);
        scBound = probe ? getRowScroller(probe) : null;
        if (scBound) {
          scBound.addEventListener("pointerdown", abort, { capture: true, passive: true });
          scBound.addEventListener("touchstart", abort, { capture: true, passive: true });
        }
      } catch (e) {}

      // rAF 首查（等一帧让 React 提交重渲染）
      try {
        requestAnimationFrame(function () { tick(); });
      } catch (e) { tick(); }

      var marks = [60, 180, 400, 800];
      for (var i = 0; i < marks.length; i++) {
        if (marks[i] > budget) break;
        (function (d) { timers.push(setTimeout(tick, d)); })(marks[i]);
      }
      return { cancel: cleanup };
    }

    // 真正执行切换：标记最近、定位到左栏可见位置、模拟点击左侧画布项、同步激活态。
    // v1.0.18（BUG-0014）：补齐「点标签后把左栏滚到目标行并保持」——
    //   ① 点击**前**先滚一次（保证行完整可见，便于墨刀接收点击）；
    //   ② 点击**后**再滚一次并居中（墨刀切换会重渲染左栏，节点可能被重建）；
    //   ③ keepRowVisible 复查若干次（墨刀重渲染会把 scrollTop 复位 → 重新滚回）；
    //   ④ 落左栏选中态（md-rt-located；识别到墨刀自身激活类则不叠加）。
    function activateCanvas(id, name, el) {
      setStale(id, false);
      touch(id, name);
      scheduleRender();
      // 保留展开折叠分组能力（折叠分组里的行需要先展开才能点到）
      var target = ensureRowVisible(id, el) || el;
      scrollRowIntoView(id, target, false);           // ① 点击前：保证完整可见
      try { target.click(); } catch (e) {}            // 模拟点击左侧画布项 → 墨刀内部切换
      var after = null;
      try { after = findCanvasEl(id, true) || target; } catch (e) { after = target; }
      scrollRowIntoView(id, after, true);             // ② 点击后：重新定位并居中
      if (keepHandle) { try { keepHandle.cancel(); } catch (e) {} keepHandle = null; }
      keepHandle = keepRowVisible(id, 800);           // ③ 复查，防被墨刀复位
      markLocatedRow(after);                          // ④ 落左栏选中态
      bar.setActive(id);
    }

    // 单个元素的简短签名：tagName + #id + 最多 3 个 class（诊断用，控制体积）。
    function briefEl(el) {
      if (!el || el.nodeType !== 1) return "";
      var tag = (el.tagName || "").toLowerCase();
      var idPart = el.id ? ("#" + el.id) : "";
      var cls = "";
      if (typeof el.className === "string" && el.className.trim()) {
        cls = "." + el.className.trim().split(/\s+/).slice(0, 3).join(".");
      }
      return tag + idPart + cls;
    }

    // 元素的祖先链（含自身），最多 maxDepth 层。每层形如 div#panel-canvas-col.screen-panel。
    function ancestorChain(el, maxDepth) {
      var out = [], node = el, depth = 0, max = maxDepth || 8;
      while (node && node.nodeType === 1 && depth < max) {
        out.push(briefEl(node));
        node = node.parentElement;
        depth++;
      }
      return out;
    }

    // 统计一组选择器在文档中的命中数（某个选择器非法时记 -1，便于发现语法问题）。
    function anchorHitCounts(selectors) {
      var out = {};
      for (var i = 0; i < selectors.length; i++) {
        try { out[selectors[i]] = document.querySelectorAll(selectors[i]).length; }
        catch (e) { out[selectors[i]] = -1; }
      }
      return out;
    }

    // 定位失败时的结构化诊断：把「为什么找不到」一次性打在 Console 里，便于真机
    // （内网 10.83.117.101 需登录、无法远程调试）不看源码也能一次定位。
    // v1.0.18 加固：对**每个**同 cid 的通用树项输出
    //   tag / class / data-interactive-target-type / layerItem / visible /
    //   kind / 归属面板 / 被拒原因 / 命中优先级 / 完整祖先链（最多 8 层，
    //   tag + 主要 class + id）；并输出各已知锚点命中数、data-cid 命中总数、
    //   搜索框是否存在、getRecentIds()。全部装在一个可折叠对象里，不打印巨量文本。
    function diagnoseLocateFailure(id, name) {
      try {
        var p = currentPanels();
        var esc = (typeof CSS !== "undefined" && CSS.escape) ? CSS.escape(id) : id;
        var rowEls = document.querySelectorAll(CANVAS_ITEM_SELECTOR);
        var cidEls = document.querySelectorAll('[data-cid="' + esc + '"]');

        var candidates = [];
        for (var i = 0; i < rowEls.length && candidates.length < 40; i++) {
          var el = rowEls[i];
          if (el.getAttribute("data-cid") !== id) continue;
          var reason = rejectReason(el, p);
          var kind = classifyItem(el, p);
          candidates.push({
            tag: el.tagName,
            cls: String(el.className || "").slice(0, 120),
            type: el.getAttribute("data-interactive-target-type"),
            layerItem: rowHasLayerItem(el),
            visible: isRowVisible(el),
            kind: kind,
            panel: matchAncestor(el, CANVAS_PANEL_SELECTORS) ? "canvas"
                   : matchAncestor(el, LAYER_TREE_PANEL_SELECTORS) ? "layerTree"
                   : matchAncestor(el, PAGE_LIST_PANEL_SELECTORS) ? "pageList" : "none",
            blacklistAny: matchAncestor(el, NON_CANVAS_PANEL_SELECTORS),
            rejected: reason || "none",          // "inLayerTree" / "layerItem" / "none"
            priority: LOCATE_PRIORITY[kind] || 99,
            acceptedAs: reason ? null : kind,    // 非 null = 会被 findCanvasEl 接受
            ancestors: ancestorChain(el, 8)
          });
        }

        var picked = findCanvasEl(id, true);
        // R7：若 findCanvasEl 能返回行、但该行不在可视区（被折叠 / 被溢出裁掉），
        // 置 rowFoundButHidden=true —— 让真机 Console 自己告诉我们折叠是怎么表达的，
        // 而不是在此加猜测式点击启发式（BUG-0011/0012/0013 都源于启发式误判，务必止步）。
        // collectCollapsedToggles 只认 aria-expanded="false"，保持原样不动。
        var rowFoundButHidden = !!(picked && !isRowVisible(picked));
        return {
          version: MD_VERSION,
          build: MD_BUILD,                   // 构建指纹（版本号冻结期间用它证明「跑的是哪一份」）
          id: id,
          name: name,
          searchBox: !!findScreenSearchBox(),   // 必须先调用：它会写入 lastSearchBoxSource
          searchBoxSource: lastSearchBoxSource, // none / anchor(L2 结构) / placeholder(L3 文案) / legacy(L4)
          historyIds: getRecentIds(),
          trackedIds: Object.keys(seen),
          cidHitTotal: cidEls.length,        // 全文档 [data-cid=<id>] 命中总数
          rowHitTotal: candidates.length,    // 通用树项中同 cid 的条数
          // 画布列内「处于折叠态的开关」总数（**只统计，不点击**）—— 与 collapsedToggles
          // （目标行祖先链上的折叠开关数）互补：后者依赖「行已在 DOM」，前者不依赖。
          panelCollapsedToggles: (function () {
            var n = 0;
            for (var c = 0; c < p.canvas.length; c++) {
              try { n += p.canvas[c].querySelectorAll('[aria-expanded="false"]').length; } catch (e) {}
            }
            return n;
          })(),
          // 画布列内「按**结构**判定的折叠分组行」总数（**只统计，不点击**）——
          // 回答「真机折叠若不是 aria，结构判据认不认得出它」。与面板折叠开关数是**并列**关系：
          // 两者都为 0 ⇒ 画布列内既无 aria 折叠、也无结构可辨的折叠容器 → 折叠解释不成立，
          // 应转向看 cidHitTotal（行是否已被移出 DOM）与 searchBoxSource（搜索框怎么找到的）。
          panelStructuralToggles: (function () {
            try { return structuralToggleCandidates(p, id).length; } catch (e) { return 0; }
          })(),
          anchors: {                         // 各已知锚点命中数（锚点被改版换名时此处会全 0）
            canvas: p.canvas.length,
            layerTree: p.layerTree.length,
            pageList: p.pageList.length,
            canvasPanelPresent: canvasPanelPresent(p),
            canvasSelectors: anchorHitCounts(CANVAS_PANEL_SELECTORS),
            layerTreeSelectors: anchorHitCounts(LAYER_TREE_PANEL_SELECTORS),
            pageListSelectors: anchorHitCounts(PAGE_LIST_PANEL_SELECTORS)
          },
          collapsedToggles: cidEls.length ? collectCollapsedToggles(cidEls[0], p).length : 0,
          rowFoundButHidden: rowFoundButHidden,
          picked: picked ? {
            tag: picked.tagName,
            cls: String(picked.className || "").slice(0, 120),
            kind: classifyItem(picked, p)
          } : null,
          candidates: candidates
        };
      } catch (e) {
        return { version: MD_VERSION, id: id, name: name, error: String(e) };
      }
    }

    // 定位失败：给出可见反馈，绝不静默删除标签
    function notifyUnreachable(name, id) {
      var msg = "未找到画布「" + name + "」，请先在左侧画布栏展开或滚动到它，再点击标签切换";
      if (typeof console !== "undefined" && console.warn) {
        console.warn("[modao-recent-tabs] " + msg);
        // 结构化诊断（供真机取证；数据量小，常开无副作用）
        console.warn("[modao-recent-tabs] 定位失败诊断:", diagnoseLocateFailure(id, name));
      }
      if (bar && typeof bar.toast === "function") bar.toast(msg, "warn");
    }

    // 从 screen-history 同步（初始 + 打开/离开文件时兜底）。返回是否有新画布出现。
    function syncFromHistory() {
      var ids = getRecentIds();
      if (!ids.length) return false;   // 无历史 → 直接返回，省掉一次全表扫描
      var map = getScreenMap();
      var changed = false;
      var base = Date.now();
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i];
        if (!map[id]) continue;
        if (!(id in seen)) {
          seen[id] = { id: id, name: map[id], ts: base - i * 1000 };
          changed = true;
        }
      }
      return changed;
    }

    // 画板项名字在真机带序号前缀（如「1 行李RFID标签编码规则」），而 .canvas-title
    // 是无序号的名字（如「行李RFID标签编码规则」）——直接字符串相等必然失配，这正是
    // 「打开设计文件不带出当前画板」的原因之一（真机 2026-09-14 实证）。
    // 比对前统一去掉开头的「序号 + 分隔符」与首尾空白。
    function normalizeName(s) {
      return String(s == null ? "" : s)
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^\d+\s*[.、:：\-\)]*\s*/, "")
        .trim();
    }

    // 检测当前激活画布（编辑器里正打开的那个）。优先激活态 class，其次 canvas-title 文本反查。
    // 激活态选择器按「状态后缀 × 画布项形态」展开（保持原状态优先级在前）：
    // 画布项存在 div.rn-list-item 与 li.rn-content-item 两种形态，只认一种会漏检。
    var ACTIVE_STATE_SUFFIXES = [
      ".is-active",
      ".is-selected",
      ".selected",
      ".current",
      "[aria-selected='true']",
      // v1.0.17：真机实测（2026-09-11，v22.18.18-op22603.1）墨刀用的是
      // `class="active"` / `class="select"`，**没有** is- 前缀，而旧表只有
      // .is-active/.is-selected/.selected/.current → 激活检测在真机恒不命中，
      // 「进入设计文件时带出当前画板」一直是失效的。补上真机实际类名。
      ".active",
      ".select"
    ];
    var ACTIVE_SELECTORS = (function () {
      var out = [];
      for (var s = 0; s < ACTIVE_STATE_SUFFIXES.length; s++) {
        for (var b = 0; b < CANVAS_BASE_SELECTORS.length; b++) {
          out.push(CANVAS_BASE_SELECTORS[b] + "[data-cid]" + ACTIVE_STATE_SUFFIXES[s]);
        }
      }
      return out;
    })();

    // v1.0.17：激活态与名称反查都必须限定在「画布」面板内——页面/图层面板里的
    // 同名项同样带 .rn-list-item/.rn-content-item 与激活 class，不限定会把点页面
    // 或点图层误判为「激活画布变化」，从而在标签栏凭空建标签。
    // 注意：.canvas-title 名称反查（reliable:false）的同名歧义保护逻辑
    // （seenHasNameCollision / lastActiveId 门槛）保持原样，只追加面板限定。
    function getActiveScreen() {
      var strict = hasPanelLayout();
      var i, j;
      for (i = 0; i < ACTIVE_SELECTORS.length; i++) {
        var found = document.querySelectorAll(ACTIVE_SELECTORS[i]);
        for (j = 0; j < found.length; j++) {
          if (!isCanvasPanelItem(found[j], strict)) continue;
          var aid = found[j].getAttribute("data-cid");
          // 名称可能为空（画布项文本未渲染完），交给调用方按 name 校验处理
          if (aid) return { id: aid, name: readName(found[j]), reliable: true };
        }
      }
      // 名称反查兜底：真机在「刚切页、激活 class 还没落到画布面板」的瞬间走这里。
      // 仅用于「进入文件时带出一次」（见 syncActiveScreen 的 autoSeedUsed 闸门），
      // 绝不用于后续切页，否则点页面 → 标题变化 → 反查命中新页画板 → 凭空建标签。
      var titleEl = document.querySelector(".canvas-title");
      if (titleEl) {
        var name = readName(titleEl);
        var nTitle = normalizeName(name);
        if (name && nTitle) {
          var els = document.querySelectorAll(CANVAS_ITEM_SELECTOR);
          for (var k = 0; k < els.length; k++) {
            if (els[k].classList && els[k].classList.contains("folder")) continue;
            if (!isCanvasPanelItem(els[k], strict)) continue;
            // 按归一化名字比对（画板项带序号前缀，标题不带）
            if (normalizeName(readName(els[k])) === nTitle) {
              return { id: els[k].getAttribute("data-cid"), name: readName(els[k]), reliable: false };
            }
          }
        }
      }
      return null;
    }

    // 名称反查命中的画布，其名称是否已在 seen 中由「不同 cid」占用 → 同名歧义。
    // 真实墨刀当前版本无激活 class/aria 标记，激活检测只能走名称反查；
    // 当项目存在同名画布时，反查结果可能是 DOM 中排序更靠前的同名项（cid 不同），
    // 若据此误判为“激活变化”去 touch，会凭空制造第二个同名标签（「设备导入」BUG）。
    function seenHasNameCollision(name, exceptId) {
      for (var id in seen) {
        if (id === exceptId) continue;
        if (seen[id] && seen[id].name === name) return true;
      }
      return false;
    }

    var lastActiveId = null;
    // v1.0.17：自动带出「当前画板」只允许发生**一次**，且必须在「种子窗口」内
    // （进入设计文件后 SEED_WINDOW_MS 内）或用户尚未操作列表时。
    // 用户选定语义：进入设计文件时带出当前画板，之后切页不再自动建标签。
    // 真机 2026-09-11 反例：点页面会切换页面 → 新页画板变激活、canvas-title 随之
    // 变化 → 若持续自动跟踪，标签栏会长出一个（画板名的）新标签，用户侧表现就是
    // 「点页面也产生了标签 / 把页面当成了画布」。
    var autoSeedUsed = false;
    var SEED_WINDOW_MS = 15000;
    var autoSeedDeadline = Date.now() + SEED_WINDOW_MS;

    // 名称在「画布面板」内是否唯一（排除自身）。名称反查不可信，同名歧义时
    // 反查命中的可能是 DOM 里排序更靠前的同名项（cid 不同）→ 会制造重标签幻影
    // （「设备导入」BUG）。仅当名称唯一才允许用它做初始种子。
    function isUniqueCanvasName(name, exceptId) {
      if (!name) return false;
      var target = normalizeName(name);
      var dup = false, hit = 0;
      eachCanvasItem(function (el) {
        if (normalizeName(readName(el)) !== target) return;
        hit++;
        if (el.getAttribute("data-cid") !== exceptId) dup = true;
      });
      return !dup && hit >= 1;
    }

    // 激活画布变化时置顶进标签栏（仅用于“进入文件默认打开的画布”这一次）
    function syncActiveScreen() {
      if (autoSeedUsed) return false;
      if (Date.now() > autoSeedDeadline) return false;   // 种子窗口已过 → 绝不再自动建标签
      var active = getActiveScreen();
      if (!active || !active.id) return false;      // 画布面板还没渲染 → 下轮再试
      if (active.id === lastActiveId) return false;
      // 名称反查(reliable=false)结果不可信：命中同名不同 cid、或名称在画布面板内
      // 不唯一时绝不据此 touch，避免制造重标签幻影（修复“设备导入”BUG）。
      // 带出一次的种子优先来自激活 class（reliable=true），仅在画布面板内**名称唯一**
      // 时才接受名称反查（真机打开文件时画板项可能还没拿到 active class）。
      if (!active.reliable) {
        if (seenHasNameCollision(active.name, active.id)) return false;
        if (!isUniqueCanvasName(active.name, active.id)) return false;
      }
      autoSeedUsed = true;                           // 只带出一次，用完即关
      var ok = touch(active.id, active.name);
      if (ok) lastActiveId = active.id;
      return ok;
    }

    var root = document.createElement("div");
    root.id = "md-recent-tabs-root";
    root.setAttribute("data-md-version", MD_VERSION);   // 真机可用 Console 核对加载版本
    // 构建指纹：版本号冻结期间用它区分「真机跑的是哪一份代码」（见 MD_BUILD 注释）
    root.setAttribute("data-md-build", MD_BUILD);
    document.documentElement.appendChild(root);

    function closeId(id) {
      if (closed.indexOf(id) < 0) closed.push(id);
      delete seen[id];
    }

    var bar = new RecentTabsBar(root, {
      max: 20,
      onSwitch: function (item) {
        if (!item || !item.id) return;
        var id = item.id;
        // 任何一次新的切换请求都必须先让「在飞的滚动扫描」失效。
        // 必须无条件放在这里（而不是只在 revealCanvasEl 内部递增）：若本次立即命中
        // 并走 `activateCanvas` 提前 return，就不会进入 revealCanvasEl，
        // 上一次的扫描会继续跑完并回调 activateCanvas(旧 id)，把画布切回先点的那个
        // （连点竞态：点 A 需扫描 → 立刻点 B → 结果被 A 覆盖）。
        revealToken++;
        // v1.0.18：连带兜底候选一起找 —— 目标行可能被收缩折叠隐藏、或因滚动不在
        // 渲染窗口里、或外层被 sortable 容器（黑名单名）包住。命中即切换，不必再
        // 走后面「搜索重定位 → 滚动扫描 → 提示」的长链路。
        var el = findCanvasEl(id, true);
        if (el) { activateCanvas(id, item.name, el); return; }
        // 画布项当前不在左侧栏 DOM：可能是搜索过滤态 / 虚拟滚动未渲染 / 文件夹折叠 /
        // SPA 重建，这**不是**「画布已删除」的充分证据。旧逻辑在此直接 delete seen + return，
        // 会同时造成「标签消失」与「不切换」两个症状；改为：
        //   1) 先把标签标记为「待定」，不删除；
        //   2) 自动重定位（locateCanvas，v1.0.13）：优先用左侧搜索框把目标带回 DOM——
        //      有词先清空恢复全量、仍找不到再按目标名检索，命中即切换；
        //   3) 仍定位不到则滚动扫描兜底（revealCanvasEl，虚拟滚动场景可救回）；
        //   4) 最后给出可见提示，标签保留、等用户手动 × 关闭。
        setStale(id, true);
        scheduleRender();
        locateCanvas(id, item.name || id, function () {
          // fail：保留原 revealCanvasEl 滚动扫描兜底 + notifyUnreachable（v1.0.12 语义）
          revealCanvasEl(id, function (found, canceled) {
            if (canceled) return;                                  // 已被新的切换请求取代
            if (found) { activateCanvas(id, item.name, found); return; }
            notifyUnreachable(item.name || id, id);
          });
        });
      },
      onClose: function (item) {
        closeId(item.id);
        clearLocatedRow();   // v1.0.18：关闭标签时清除左栏选中态标记（保持可逆）
        persistClosed();
        scheduleRender();
      },
      onCloseOthers: function () {
        var keep = bar.activeId;
        Object.keys(seen).forEach(function (id) {
          if (id !== keep) closeId(id);
        });
        persistClosed();
        scheduleRender();
      },
      onTogglePin: function () {
        displayMode = displayMode === "float" ? "fixed" : "float";
        persistDisplayMode();
        applyDisplayMode();
      }
    });

    var renderTimer = null;
    function scheduleRender() {
      if (renderTimer) return;
      renderTimer = setTimeout(function () { renderTimer = null; renderList(); }, 0);
    }

    function renderList() {
      var list = Object.keys(seen)
        .filter(function (id) { return closed.indexOf(id) < 0; })
        .map(function (id) { return { id: id, name: seen[id].name, ts: seen[id].ts }; });
      // 排序由 tabbar.setItems 统一负责（通用组件契约，演示页亦依赖）；
      // bar.items[0] 即排序后的“最近”项，作为默认激活（消除 core 层冗余排序，P2-2）。
      bar.setItems(list.map(function (it) {
        return { id: it.id, name: it.name, updatedAt: it.ts };
      }));
      bar.setBadge(bar.items.length ? "画布 " + bar.items.length : "画布");
      var stillActive = bar.activeId && bar.items.some(function (it) { return it.id === bar.activeId; });
      if (!stillActive) bar.setActive(bar.items.length ? bar.items[0].id : null);
    }

    var displayMode = "fixed";
    try { displayMode = localStorage.getItem(DMODE) || "fixed"; } catch (e) {}
    if (displayMode !== "float") displayMode = "fixed";
    // v1.0.15：标签栏位置固定「工具栏上方」(above) 无切换概念；
    // 布局（bar 贴顶 / 工具栏下沉 / 内容下推）见 updateOffset。历史遗留的
    // md_tabbar_position 值（含旧版存的 below）一律忽略，不再读取。

    var offsetStyle = null;
    var lastHb = -1;
    var contentEls = [];             // 已应用下推的区域容器集合（画布视口 + 左右面板）
    var contentBaseMap = null;      // WeakMap<el, number> 下推前基准高度(px)，用于收缩高度防底部溢出
    var toolbarEl = null;           // 被下沉的墨刀默认工具栏元素（above+fixed 模式），destroy 时复位 marginTop

    function persistDisplayMode() {
      try { localStorage.setItem(DMODE, displayMode); } catch (e) {}
    }

    // 浮动模式显隐（v1.0.16）：不再注入任何 DOM，改用 document 级 mousemove 判定。
    // 触发带 = 窗口最顶部 FLOAT_TRIGGER_Y px：鼠标停在该带内 → 滑出；
    // 其余区域（含墨刀工具栏按钮区 clientY≈10~38）→ 收起，工具栏不被误弹、不被拦截。
    var FLOAT_TRIGGER_Y = 4;
    var floatBound = false;
    var overBar = false;
    var hideTimer = null;
    var floatMoveHandler = null;

    function showBar() {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      bar.barEl.classList.add("is-visible");
    }

    function hideBar() {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(function () {
        bar.barEl.classList.remove("is-visible");
        hideTimer = null;
      }, 250);
    }

    function onFloatMove(e) {
      if (displayMode !== "float") return;
      if (!e || typeof e.clientY !== "number") return;
      if (e.clientY <= FLOAT_TRIGGER_Y) { showBar(); return; }
      if (!overBar) hideBar();          // 停在已展开的标签栏上时不收起（保证可点标签）
    }

    function onBarEnter() { overBar = true; showBar(); }
    function onBarLeave() { overBar = false; hideBar(); }

    function bindFloatTrigger() {
      if (floatBound) return;
      floatMoveHandler = onFloatMove;
      document.addEventListener("mousemove", floatMoveHandler, true);
      bar.barEl.addEventListener("mouseenter", onBarEnter);
      bar.barEl.addEventListener("mouseleave", onBarLeave);
      floatBound = true;
    }

    function unbindFloatTrigger() {
      if (floatMoveHandler) {
        document.removeEventListener("mousemove", floatMoveHandler, true);
        floatMoveHandler = null;
      }
      bar.barEl.removeEventListener("mouseenter", onBarEnter);
      bar.barEl.removeEventListener("mouseleave", onBarLeave);
      floatBound = false;
      overBar = false;
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      bar.barEl.classList.remove("is-visible");
    }

    // 按当前工具栏高度刷新避让样式（标签栏 top / body padding / 浮动隐藏偏移）。
    // 与 displayMode 解耦：工具栏高度变化（SPA 重渲染）时只调本函数，不打断浮动显隐状态。
    function updateOffset(ti) {
      var isFloat = displayMode === "float";
      // v1.0.15：位置固定「工具栏上方」——标签栏恒贴顶(top:0)、浮动隐藏偏移为 0。
      // 固定模式把墨刀工具栏整条下沉 TOPBAR_H(44px) 为其让位（marginTop，不触发
      // 反馈环）；浮动模式不下沉。工具栏自然底边 naturalBottom 仍作内容命中基准。
      bar.barEl.style.top = "0px";
      bar.barEl.style.setProperty("--md-hide-offset", "0px");
      if (ti.el) {
        toolbarEl = ti.el;
        ti.el.style.marginTop = isFloat ? "" : (TOPBAR_H + "px");
      }
      if (!offsetStyle) {
        offsetStyle = document.createElement("style");
        offsetStyle.id = "md-recent-tabs-offset";
        document.head.appendChild(offsetStyle);
      }
      // 顶部总占用：浮动模式仅工具栏(hb)；固定模式 bar(44)+工具栏自然高(48)=92
      var reserved = isFloat ? ti.hb : (TOPBAR_H + ti.naturalBottom);
      offsetStyle.textContent = "body{padding-top:" + reserved + "px !important;}";
      applyContentOffset(ti); // A2：同步画布/侧栏区域容器下推避让
    }

    // 工具栏高度动态重测：hb 变化才刷新避让（幂等，供 2s 轮询与 MutationObserver 调用）。
    function refreshLayout() {
      var ti = getToolbarInfo();
      if (ti.hb === lastHb) return;   // above 下沉后 hb 恒 92 → 幂等；内容命中走 naturalBottom，不塌陷
      lastHb = ti.hb;
      updateOffset(ti);
    }

    function applyDisplayMode() {
      var ti = getToolbarInfo();
      lastHb = ti.hb;
      var isFloat = displayMode === "float";
      bar.barEl.classList.toggle("is-float", isFloat);
      bar.barEl.classList.remove("is-visible");
      bar.setPinned(!isFloat);
      updateOffset(ti);
      if (isFloat) {
        bindFloatTrigger();
      } else {
        unbindFloatTrigger();
      }
    }

    applyDisplayMode();
    // 检测墨刀顶部工具栏高度（标签栏避让基准，修复「遮挡工具栏」BUG）。
    // 真实墨刀工具栏由 styled-components 生成（如 div.styles__StyledTopBar-xxx），
    // CSS 属性选择器必须用 [class*='...' i]（大小写不敏感）才能命中 StyledTopBar；
    // 定位放宽到 fixed/sticky/absolute、仅取视口顶部 60px 内的横带、高度 16~160，
    // 取「顶部最高横带」的 bottom 作为工具栏高度 hb。
    // 返回工具栏元素 + 实时底边(hb) + 自然底边(naturalBottom=实时底边-自身marginTop)。
    // naturalBottom 是内容命中的稳定基准：above 固定模式把工具栏下沉 44 后 hb 变 92，
    // 但 naturalBottom 恒为下沉前的 48，避免 findContentContainers 误用实时 hb 导致塌陷（R1/R5）。
    function getToolbarInfo() {
      var best = null, bestBottom = 0;
      var sels = [
        "header",
        "[class*='topbar' i]",
        "[class*='header' i]",
        "[class*='toolbar' i]",
        "[class*='navbar' i]"
      ];
      document.querySelectorAll(sels.join(",")).forEach(function (el) {
        var cs = getComputedStyle(el);
        var pos = cs.position;
        // 真实墨刀顶部工具栏为 styled-components 生成的 position:relative
        // （如 div.styles__StyledToolbar-sc-… GUIDE_TOOLBAR_COMMON，top:0 height:48），
        // 故必须接受 relative；但仍排除 static（左侧/右侧栏小标题为 static，会误抓）。
        if (pos !== "fixed" && pos !== "sticky" && pos !== "absolute" && pos !== "relative") return;
        // 不把自身标签栏 / 触发热点计入避让基准
        if (el.id === "md-recent-tabs-root" || (typeof el.className === "string" && /md-recent-tabs/.test(el.className))) return;
        var r = el.getBoundingClientRect();
        if (r.top > 60) return;        // 仅视口顶部区域，防误抓页面中部元素
        if (r.height < 16 || r.height > 160) return;
        if (r.width < 200) return;    // 仅视口顶部宽横带，排除工具栏内小图标
        var b = Math.round(r.bottom);
        if (b > bestBottom) { bestBottom = b; best = el; }
      });
      if (!best) return { el: null, hb: 0, naturalBottom: 0 };
      var cs = getComputedStyle(best);
      var mt = parseFloat(cs.marginTop);
      var naturalBottom = bestBottom - (isNaN(mt) ? 0 : mt);
      return { el: best, hb: bestBottom, naturalBottom: naturalBottom };
    }

    // A2（增强避让收尾，v1.0.6 扩展至左右面板）：把画布视口与各侧栏面板整体下推 TAB_H，
    // 使其始于标签栏之下。真实墨刀整体布局为「绝对定位 app 外壳 example-app(top:0) 内嵌：
    // relative 工具栏(0–48) + absolute 画布视口(.screen-container, top:48) + absolute 左右面板(top:48)」。
    // 标签栏 fixed 模式占据 48–92，会压住画布与侧栏内容顶部；因这些区域均由 absolute 定位、
    // body padding 推不动，故需对其本身做 margin-top 下推，而工具栏(0–48)在壳内、不受影响。
    // float 模式标签栏默认隐藏，无需下推。
    // 选型稳健性：墨刀使用 styled-components 哈希类名（版本间易变），故不依赖具体面板选择器，
    // 而是「在 app 外壳内、顶边贴近工具栏底部(hb±4)、且为 absolute/relative 定位、高度≥30」
    // 的区域容器全部下推（并去重只取最外层，避免画布内嵌 absolute 子元素被重复下推）。
    function findContentContainers(threshold) {
      var shell = document.querySelector("[class*='example-app' i]") || document.querySelector(".app-shell");
      if (!shell) return [];
      var cands = [];
      var nodes = shell.querySelectorAll("*");
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (el.id === "md-recent-tabs-root") continue;
        if (typeof el.className === "string" && /md-recent-tabs/.test(el.className)) continue;
        // 置顶(above)+固定模式会把墨刀工具栏整条下沉 44px（marginTop，见 updateOffset），
        // 此时工具栏**内部**的相对/绝对子行（图标条/按钮容器，view 顶边随之下移到 ≈44~52）
        // 会被下面的「顶边贴近 naturalBottom(48)±4」误判为内容区而遭 A2 整体下推 + 高度收缩，
        // 表现为墨刀原生操作按钮/图标被压扁、推离工具栏框架（“操作栏下移、图标较大偏移”）。
        // 修复：工具栏自身及其内部一切节点绝不参与 A2 内容下推（A2 只应作用于工具栏**之下**的区域）。
        if (toolbarEl && (el === toolbarEl || toolbarEl.contains(el))) continue;
        var cs = getComputedStyle(el);
        if (cs.position !== "absolute" && cs.position !== "relative") continue;
        var r = el.getBoundingClientRect();
        // 按「基准顶边」判定：若本元素已被下推（带 marginTop），先扣回再比 hb，
        // 否则重刷时 live top=92≠hb 会漏选并清空下推（resize/换页后 hb 变化即塌陷）。
        var curMt = parseFloat(cs.marginTop);
        var baseTop = r.top - (isNaN(curMt) ? 0 : curMt);
        if (Math.abs(baseTop - threshold) > 4) continue;     // 顶边贴近工具栏自然底边(48)，above/below 通用
        if (r.height < 30) continue;                  // 排除小元素（图标/分隔条）
        cands.push(el);
      }
      // 去重：去掉「有祖先也在候选集」的元素，只推最外层区域容器
      var out = [];
      for (var j = 0; j < cands.length; j++) {
        var elj = cands[j], hasAnc = false, p = elj.parentElement;
        while (p) {
          if (cands.indexOf(p) !== -1) { hasAnc = true; break; }
          p = p.parentElement;
        }
        if (!hasAnc) out.push(elj);
      }
      return out;
    }

    function applyContentOffset(ti) {
      var isFloat = displayMode === "float";
      if (contentBaseMap == null) contentBaseMap = new WeakMap();
      // 仅固定模式才下推内容（above+float 退化为 below+float：工具栏不下沉、内容不下推）
      var pushContent = !isFloat;
      var targets = pushContent ? findContentContainers(ti.naturalBottom) : [];
      // 还原不再属于目标的元素（float 切换 / DOM 变化导致区域容器增减）
      for (var k = 0; k < contentEls.length; k++) {
        var old = contentEls[k];
        if (targets.indexOf(old) === -1) {
          old.style.marginTop = "";
          old.style.height = "";
        }
      }
      contentEls = targets.slice();
      for (var i = 0; i < targets.length; i++) {
        var el = targets[i];
        if (!contentBaseMap.has(el)) {
          var cs = getComputedStyle(el);
          var h = parseFloat(cs.height);
          contentBaseMap.set(el, (!isNaN(h) && h > 0) ? h : null);
        }
        var base = contentBaseMap.get(el);
        // 区域容器下推 TAB_H，使其始于标签栏之下（top:48 + 44 = 92）；
        // 收缩高度避免底部溢出视口。toolbar 在壳内 0–48 不受影响。
        el.style.marginTop = TOPBAR_H + "px";
        if (base != null) el.style.height = (base - TOPBAR_H) + "px";
      }
    }

    // 当前设计文件（cid）监听（SPA 鲁棒性）
    function refreshCid() {
      var m = (location.pathname || "").match(/\/proto\/design\/([A-Za-z0-9]+)/);
      cid = m ? m[1] : null;
      if (cid !== lastCid) {
        // 切换到不同设计文件：清空已累积画布，避免跨文件串号
        lastCid = cid;
        seen = {};
        lastActiveId = null;
        // 换设计文件 → 重新开一次「种子窗口」，允许带出一次当前画板
        autoSeedUsed = false;
        autoSeedDeadline = Date.now() + SEED_WINDOW_MS;
      }
      if (!cid) {
        // 非设计文件页：隐藏标签栏（不干扰 /workspace 等页面）
        root.style.display = "none";
        return false;
      }
      root.style.display = "";
      var changed = false;
      if (syncFromHistory()) changed = true;
      if (syncActiveScreen()) changed = true;
      return changed;
    }

    refreshCid();
    renderList();

    // 核心：点击左侧「画布」栏任意画布项 → 标记为最近并置顶进标签栏
    // 捕获阶段监听，不 preventDefault/stopPropagation，不影响墨刀自身交互。
    // v1.0.17：只有「画布」面板的点击才建标签。页面面板（#screen-scroll-list 等）
    // 与图层面板（#layer-scroll-list 等）里的项 DOM 形态与画布项几乎一致
    // （都是 .rn-list-item / .rn-content-item + data-cid），必须按容器锚点拒绝，
    // 否则点页面、点图层都会在顶部「最近画布」生成无效标签。
    function trackCanvasFromEvent(e) {
      // R11：忽略我们**自己合成**的点击（展开折叠分组等）—— 否则若分组行不带 `folder`
      // 类名（真机类名漂移），展开动作会凭空长出一个标签。用户真实点击不受影响。
      if (suppressTrack > 0) return;
      var t = e.target;
      if (!t || !t.closest) return;
      if (!cid) return;
      var item = t.closest(CANVAS_ITEM_SELECTOR);
      if (!item) return;
      // 用户已开始在左栏列表里操作（点页面 / 图层 / 画布 / 文件夹都算）→ 立即关闭
      // 「进入文件自动带出」的种子窗口。否则「点页面切页 → canvas-title 变化」会被
      // 种子路径当成激活画布变化，凭空长出一个画板标签（真机 2026-09-11 复现）。
      autoSeedUsed = true;
      if (item.classList && item.classList.contains("folder")) return; // 文件夹忽略
      if (!isCanvasPanelItem(item)) return;   // 非画布面板（页面 / 图层 / 状态 / 交互树）→ 不建标签
      var id = item.getAttribute("data-cid");
      if (!id) return;
      var name = readName(item);
      if (touch(id, name)) {
        lastActiveId = id;
        // BUG-0019：此刻画布是可见的，顺手记下它的父文件夹 cid 链，供日后点标签时
        // 按记录展开（真机折叠无痕迹、无搜索框，事后检测不出来）。
        try { groupPath[id] = collectGroupPath(item); } catch (e) { groupPath[id] = []; }
        scheduleRender();
        bar.setActive(id);
        // 浮动模式下标签栏默认隐藏：用户刚点了画布却看不到反馈，会误以为「没建标签」。
        // 这里主动滑出一次，让点击结果立即可见（不动固定模式行为）。
        if (displayMode === "float" && typeof showBar === "function") showBar();
      }
    }

    // v1.0.17：同时监听 mousedown 与 click。
    // 原因（真机 2026-09-11 反馈「点画布没反应」）：墨刀切换画板发生在按下阶段，并且会
    // 重渲染左栏；若节点在 mousedown 与 mouseup 之间被替换，浏览器不会派发 click
    // （本项目早前也踩过同类"重排吞掉 click"的坑，见 tests/test_regression_tab_autoclose.py）。
    // touch() 对同一 id 是幂等的（再次调用只刷新名称与时间戳），因此两个事件都处理
    // 不会产生重复标签，只会让「按下即记录」比「点击才记录」更不容易丢。
    var clickHandler = trackCanvasFromEvent;
    var downHandler = trackCanvasFromEvent;
    document.addEventListener("click", clickHandler, true);
    document.addEventListener("mousedown", downHandler, true);

    // 兜底：左侧面板可能异步渲染、screen-history 可能延迟更新、SPA 路由可能变化
    var pollTimer = setInterval(function () {
      var changed = refreshCid();
      refreshLayout(); // 工具栏高度变化（SPA 重渲染/尺寸调整）时动态重测避让
      if (revalidateStale()) changed = true;   // 画布项重新出现 → 取消待定标记
      if (changed) scheduleRender();
    }, 2000);

    // 轻量 MutationObserver：左侧画布栏出现新节点时即时同步（比 2s 轮询更跟手）。
    // rAF 节流：编辑器 DOM 变动频繁，把同一帧内的多次变动合并为一次全文档扫描，避免卡顿。
    var mo = null;
    try {
      var moScheduled = false;
      mo = new MutationObserver(function () {
        if (moScheduled) return;
        moScheduled = true;
        requestAnimationFrame(function () {
          moScheduled = false;
          var changed = syncFromHistory() || syncActiveScreen();
          refreshLayout(); // 顶部工具栏 DOM 增删/结构变化 → 同步重测避让
          if (revalidateStale()) changed = true;   // 左侧栏重绘后画布项可能已重新出现
          if (changed) scheduleRender();
        });
      });
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}

    // 来自设置页的消息（清除已关闭标签）：仅浏览器扩展侧启用
    if (enableMessageListener && typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
        if (msg && msg.type === "MD_CLEAR_CLOSED") {
          closed = [];
          persistClosed();
          syncFromHistory();
          syncActiveScreen();
          renderList();
          if (typeof sendResponse === "function") sendResponse({ ok: true });
        }
        return false;
      });
    }

    // ---- 真机取证入口（只读：不点击、不改状态、不弹 toast）----------------------------------
    // 目的：在**不触发失败**的情况下回答「真机画布列里的折叠到底是怎么表达的」——
    // 这是本项目反复修不掉的首要障碍（只能靠「失败时自动打印」反推，拿不到折叠态的样本）。
    // 真机用法（Console，单行，见 README.browser.md）：
    //   __mdRtProbe()              → 对标签栏里每条最近画布各输出一条诊断
    //   __mdRtProbe('<cid>')       → 只针对指定 id
    // ⚠ 真机是 isolated world，`__mdRtProbe` 裸调用取不到，必须走
    //   document.querySelector('#md-recent-tabs-root').__mdRtProbe(...)
    // 输出对象与「定位失败诊断」同构（build / cidHitTotal / rowHitTotal / rejectReason /
    // searchBoxSource / panelCollapsedToggles / panelStructuralToggles / anchors …）。
    try {
      global.__mdRtProbe = function (onlyId) {
        var ids = onlyId ? [String(onlyId)] : Object.keys(seen);
        if (!ids.length) ids = getRecentIds();
        var out = [];
        for (var i = 0; i < ids.length; i++) {
          var nm = (seen[ids[i]] && seen[ids[i]].name) || "";
          try { out.push(diagnoseLocateFailure(ids[i], nm)); } catch (e) {}
        }
        try { console.log("[modao-recent-tabs] 只读探针 probe:", out); } catch (e2) {}
        return out;
      };
      // 真机可达性修复（BUG-0019）：content script 跑在 **isolated world**
      // （manifest.json 的 content_scripts 未声明 "world":"MAIN"），挂到 window 上的全局
      // 对 DevTools Console **不可见** ⇒ 这个探针在真机上从来没被取到过（夹具用
      // add_script_tag 注入属页面主世界，所以测试一直是绿的）。DOM 节点属性可跨世界读写，
      // 故把同一个函数再挂到 root 上，真机 Console 用法：
      //   document.querySelector('#md-recent-tabs-root').__mdRtProbe()
      if (root) root.__mdRtProbe = global.__mdRtProbe;
    } catch (e) {}

    var ctrl = {
      refresh: refreshCid,
      destroy: function () {
        try { if (mo) mo.disconnect(); } catch (e) {}
        if (pollTimer) clearInterval(pollTimer);
        if (revealTimer) { clearTimeout(revealTimer); revealTimer = null; }
        revealToken++;   // 使进行中的扫描/搜索定位回调失效
        // v1.0.18：清干在飞的「保持目标行可见」纠偏（定时器 + 全部监听），并移除选中态标记与样式
        if (keepHandle) { try { keepHandle.cancel(); } catch (e) {} keepHandle = null; }
        clearLocatedRow();
        if (locatedStyleEl && locatedStyleEl.parentNode) {
          try { locatedStyleEl.parentNode.removeChild(locatedStyleEl); } catch (e) {}
        }
        locatedStyleEl = null;
        if (locateHandle) { locateHandle.cancel(); locateHandle = null; }
        // 待执行的重渲染也要清掉：否则销毁后仍会对已脱离文档树的旧 bar 跑一次 renderList()
        if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
        if (clickHandler) document.removeEventListener("click", clickHandler, true);
        if (downHandler) document.removeEventListener("mousedown", downHandler, true);
        if (bar && typeof bar.destroy === "function") bar.destroy();
        unbindFloatTrigger();
        try { if (root.parentNode) root.parentNode.removeChild(root); } catch (e) {}
        if (offsetStyle && offsetStyle.parentNode) offsetStyle.parentNode.removeChild(offsetStyle);
        offsetStyle = null;
        if (toolbarEl) { toolbarEl.style.marginTop = ""; toolbarEl = null; }
        for (var ci = 0; ci < contentEls.length; ci++) {
          contentEls[ci].style.marginTop = "";
          contentEls[ci].style.height = "";
        }
        contentEls = [];
        contentBaseMap = null;
        __instance = null; // 允许后续重新 create（P2-3）
      }
    };
    __instance = ctrl;
    return ctrl;
  }

  global.MDRecentTabs = { create: createRecentTabs };
})(typeof window !== "undefined" ? window : this);
