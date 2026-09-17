# -*- coding: utf-8 -*-
"""QA 独立复核：跑 test_canvas_panel_only 全部 T0-T19，结果落 JSON（utf-8）并记退出码。"""
import os
import sys
import json

sys.path.insert(0, os.path.dirname(__file__))
import test_canvas_panel_only as M
from harness import start_server
from playwright.sync_api import sync_playwright

funcs = [(n, getattr(M, n)) for n in dir(M) if n.startswith("test_t") and callable(getattr(M, n))]


def main():
    httpd, base = start_server()
    out = {}
    total = 0
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        for name, fn in funcs:
            try:
                t = fn(browser, base)
                out[name] = [{"s": s, "m": m} for s, m in t.results]
                total += sum(1 for s, _ in t.results if s == "FAIL")
            except Exception as e:  # noqa
                out[name] = [{"s": "ERROR", "m": repr(e)}]
                total += 1
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    with open(os.path.join(root, "tests", "_qa_canvas_all.json"), "w", encoding="utf-8") as f:
        json.dump({"total_fails": total, "cases": out}, f, ensure_ascii=False, indent=2)
    print("TOTAL_FAILS=%d" % total)
    sys.exit(1 if total else 0)


if __name__ == "__main__":
    main()
