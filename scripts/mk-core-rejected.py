# -*- coding: utf-8 -*-
"""生成一份「被否决的旧定位实现（preferCanvas 门控版）」等价核心，用于反向对照。

背景：历史上的「旧 1.0.18」曾采用「用 canvasPanelPresent()/preferCanvas 门控候选」的
定位实现，真机复验仍然失败（BUG-0013，即 tests/test_relocate_collapsed.py 的 D1/D2
锁定）→ 该实现**已被否决**，本仓库改用「只允许两个拒绝理由（inLayerTree / layerItem）」
的定位实现（见 recent-tabs-core.js 顶部注释与 findCanvasEl）。

本脚本把当前核心的 findCanvasEl 与 canvasPanelPresent **按被否决实现的原样**还原
（preferCanvas 门控 + canvasPanelPresent 死亡兜底分支），得到一份「被否决实现等价核心」，
作为「坏版本」对照，证明锁定用例在该实现上必须失败。

用法：
  python scripts/mk-core-rejected.py                                # → 仓库根 _core-rejected.js
  python tests/test_relocate_collapsed.py --core _core-rejected.js  # C/D（及 E 组）必须失败

注：`_core-rejected.js` 已列入 .gitignore（`_core*.js`）。
"""
import io
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = io.open(os.path.join(ROOT, "recent-tabs-core.js"), encoding="utf-8").read()

# A. findCanvasEl：恢复被否决实现的 preferCanvas 门控
a_old = (
    "      var p = currentPanels();\n"
    "      var best = null, bestRank = 99;\n"
)
a_new = (
    "      var p = currentPanels();\n"
    "      var preferCanvas = allowFallback !== false && canvasPanelPresent(p);\n"
    "      var best = null, bestRank = 99;\n"
)
assert src.count(a_old) == 1, "A anchor not unique: %d" % src.count(a_old)
src = src.replace(a_old, a_new, 1)

# B. findCanvasEl：恢复被否决实现的「canvasWrapped/page 由 preferCanvas 压制」
b_old = (
    "          var el = els[j];\n"
    "          // \u552f\u4e8c\u7684\u62d2\u7edd\u7406\u7531\uff08\u89c1\u4e0a\uff09\uff1a\u547d\u4e2d\u5373\u8df3\u8fc7\u3002\n"
    "          if (rejectReason(el, p) !== \"\") continue;\n"
    "          var rank = LOCATE_PRIORITY[classifyItem(el, p)] || 99;\n"
    "          if (rank < bestRank) { best = el; bestRank = rank; }\n"
)
b_new = (
    "          var el = els[j];\n"
    "          var k = classifyItem(el, p);\n"
    "          if (k === \"layer\") continue;\n"
    "          if ((k === \"canvasWrapped\" || k === \"page\") && !preferCanvas) continue;\n"
    "          var rank = LOCATE_PRIORITY[k] || 99;\n"
    "          if (rank < bestRank) { best = el; bestRank = rank; }\n"
)
assert src.count(b_old) == 1, "B anchor not unique: %d" % src.count(b_old)
src = src.replace(b_old, b_new, 1)

# C. canvasPanelPresent：恢复被否决实现的死亡兜底分支（靠 classifyItem==="canvas"，恒 false）
c_old = (
    "      if (p.canvas.length > 0) return true;\n"
    "      var els = document.querySelectorAll(CANVAS_ITEM_SELECTOR);\n"
    "      for (var i = 0; i < els.length; i++) {\n"
    "        if (insideAny(els[i], p.pageList)) continue;"
    "   // \u4e0b\u90e8\u300c\u9875\u9762\u300d\u5217\u7684\u884c\u4e0d\u7b97\u300c\u753b\u5e03\u5217\u5b58\u5728\u300d\n"
    "        if (rejectReason(els[i], p) !== \"\") continue;"
    "  // \u56fe\u5c42\u6811 / \u5e26 layer-item \u7684\u884c\u4e0d\u7b97\n"
    "        return true;\n"
    "      }\n"
    "      return false;\n"
)
c_new = (
    "      if (p.canvas.length > 0) return true;\n"
    "      var els = document.querySelectorAll(CANVAS_ITEM_SELECTOR);\n"
    "      for (var i = 0; i < els.length; i++) {\n"
    "        if (classifyItem(els[i], p) === \"canvas\") return true; // 被否决实现的死亡分支\n"
    "      }\n"
    "      return false;\n"
)
assert src.count(c_old) == 1, "C anchor not unique: %d" % src.count(c_old)
src = src.replace(c_old, c_new, 1)

out = os.path.join(ROOT, "_core-rejected.js")
io.open(out, "w", encoding="utf-8", newline="\n").write(src)
print("wrote", out)
