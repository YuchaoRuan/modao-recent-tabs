# -*- coding: utf-8 -*-
"""QA 独立复核：只跑 E1-E5（BUG-0014 定位/选中态），用 --core 切换被测核心。
输出 JSON 到 tests/_qa_e_results.json，并打印结构化结果。UTF-8 落盘。"""
import os
import sys
import json

sys.path.insert(0, os.path.dirname(__file__))
import test_relocate_collapsed as T

CORE = None
args = sys.argv[1:]
i = 0
while i < len(args):
    if args[i] == "--core" and i + 1 < len(args):
        CORE = os.path.abspath(args[i + 1])
        i += 2
        continue
    i += 1
TAG = "CURRENT"
if CORE:
    T.CORE_PATH = CORE
    TAG = "PREV"

from harness import start_server
from playwright.sync_api import sync_playwright

FUNCS = [
    ("E1", T.test_e1_full_render_scrolled_out_relocate),
    ("E2", T.test_e2_reset_on_switch_keeps_row_visible),
    ("E3", T.test_e3_selected_state_moves_and_no_residue),
    ("E4", T.test_e4_user_scroll_not_stolen),
    ("E5", T.test_e5_full_render_no_page_layer_click),
]

httpd, base = start_server()
out = {}
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
    for name, fn in FUNCS:
        try:
            t = fn(browser, base)
            out[name] = [{"s": s, "m": m} for s, m in t.results]
        except Exception as e:  # noqa
            out[name] = [{"s": "ERROR", "m": repr(e)}]

root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
with open(os.path.join(root, "tests", "_qa_e_results_%s.json" % TAG), "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)

for name, res in out.items():
    print("=== %s ===" % name)
    for s, m in res:
        print("  [%s] %s" % (s, m))
total = sum(1 for r in out.values() for x in r if x["s"] in ("FAIL", "ERROR"))
print("CORE=%s  TOTAL FAILS=%d" % (CORE or "CURRENT", total))
sys.exit(1 if total else 0)
