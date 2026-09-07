# -*- coding: utf-8 -*-
"""诊断：revealCanvasEl 滚动扫描到底能覆盖到哪些行？末尾行是否被跳过？"""
import os, sys
sys.path.insert(0, r"D:/WorkBuddy/墨刀/modao-recent-tabs/tests")
from playwright.sync_api import sync_playwright
from harness import start_server, new_page

FIXTURE = r"D:/WorkBuddy/墨刀/modao-recent-tabs/tests/fixtures/mock-modao-design-qa.html"
CID = "QACID"

httpd, base = start_server()
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=["--no-sandbox"])
    ctx, page = new_page(b)
    page.goto(base + "/workspace", wait_until="load")
    page.set_content(open(FIXTURE, encoding="utf-8").read())
    page.evaluate("(cid) => history.replaceState({}, '', '/proto/design/' + cid)", CID)

    info = page.evaluate(
        """() => {
            var sc = document.getElementById('rn-virtual');
            var step = Math.max(120, Math.floor(sc.clientHeight * 0.75));
            var maxTop = Math.max(0, sc.scrollHeight - sc.clientHeight);
            // 复现 revealCanvasEl 的扫描序列
            var pos = 0, tries = 0, visited = [], covered = {};
            while (tries < 24 && pos <= maxTop) {
              visited.push(pos);
              sc.scrollTop = pos;
              window.__mock.render();
              var ids = window.__mock.domIds();
              ids.forEach(function (i) { covered[i] = true; });
              pos += step; tries++;
            }
            var all = window.__mock.rows().map(function (r) { return r.cid; });
            var missed = all.filter(function (c) { return !covered[c]; });
            return { clientHeight: sc.clientHeight, scrollHeight: sc.scrollHeight,
                     step: step, maxTop: maxTop, tries: tries, visited: visited,
                     lastVisited: visited[visited.length - 1],
                     total: all.length, missed: missed };
        }"""
    )
    print("clientHeight =", info["clientHeight"])
    print("scrollHeight =", info["scrollHeight"])
    print("step =", info["step"], " maxTop =", info["maxTop"])
    print("tries =", info["tries"], " lastVisited =", info["lastVisited"])
    print("visited =", info["visited"])
    print("total rows =", info["total"])
    print("MISSED cids =", info["missed"])
    ctx.close()
    os._exit(0)
