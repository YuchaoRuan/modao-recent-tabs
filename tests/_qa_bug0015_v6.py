# -*- coding: utf-8 -*-
"""
QA-BUG0015 V6 独立取证：A/B 的「通用性」（防「只对 v1.0.16 有效」）
用 test_reveal_gap.py --core 依次注入 v1.0.13 / v1.0.16 / 5f08557（v1.0.17）三个历史核心，
确认都能复现失败且【回归】断言总数 > 0（regress.py:193-195 在 reg_total==0 时直接判 FAIL）。
若某个历史核心跑不动夹具导致 0 断言，说明夹具对老核心不兼容，必须报出来。
"""
import os, sys, subprocess, re, json

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TEST = os.path.join(PROJECT_ROOT, "tests", "test_reveal_gap.py")
CORES = {
    "v1.0.13": os.path.join(PROJECT_ROOT, "tests", "_qa_old_v1.0.13.js"),
    "v1.0.16": os.path.join(PROJECT_ROOT, "tests", "_qa_old_v1.0.16.js"),
    "5f08557": os.path.join(PROJECT_ROOT, "tests", "_qa_old_5f08557.js"),
}


def parse_groups(out):
    groups = {"回归": [0, 0], "需求": [0, 0], "保护": [0, 0]}
    for ln in out.splitlines():
        for name, cell in groups.items():
            if ("【%s】" % name) in ln:
                cell[0] += 1
                if "[FAIL]" in ln:
                    cell[1] += 1
    return groups


def main():
    report = {}
    overall_ok = True
    py = r"C:\Users\15020\.workbuddy\binaries\python\envs\default\Scripts\python.exe"
    for ref, core in CORES.items():
        if not os.path.isfile(core):
            print("[V6] %s 核心文件缺失: %s" % (ref, core))
            overall_ok = False
            report[ref] = {"error": "missing core file"}
            continue
        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"
        p = subprocess.run([py, "-u", TEST, "--core", core], cwd=str(PROJECT_ROOT),
                           env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=300)
        out = (p.stdout or "") + (p.stderr or "")
        g = parse_groups(out)
        reg_total, reg_fail = g["回归"]
        # A/B 期望 regression_fail：必须出现【回归】失败，且断言总数 > 0
        ok = (reg_fail > 0) and (reg_total > 0)
        # 同时确认老核心确实弹出了「未找到画布」原话（不是因为别的原因失败）
        has_phrase = "未找到画布" in out
        print("=" * 70)
        print("[V6] ref=%s  rc=%d  【回归】总数=%d 失败=%d  出现原话=%s  -> %s"
              % (ref, p.returncode, reg_total, reg_fail, has_phrase, "OK" if ok else "FAIL"))
        # 打印【回归】相关行
        for ln in out.splitlines():
            if "【回归】" in ln:
                print("      " + ln.strip())
        if not ok:
            overall_ok = False
        report[ref] = {"rc": p.returncode, "reg_total": reg_total, "reg_fail": reg_fail,
                       "has_phrase": has_phrase, "ok": ok}
    print("=" * 70)
    print("[V6] 结论：%s" % ("全部三个历史核心均复现失败且【回归】断言>0" if overall_ok else "存在不满足项，见上"))
    with open(os.path.join(os.path.dirname(__file__), "_qa_bug0015_v6_report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    return 0 if overall_ok else 1


if __name__ == "__main__":
    sys.exit(main())
