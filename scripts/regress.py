#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""modao-recent-tabs 回归门禁（发版前必跑，rc=0 才允许提交/发版）。

做四件事：
  1. 一致性校验：根目录与 desktop/ 的核心副本必须逐字节一致；
     VERSION / manifest.json version / 核心 MD_VERSION 三处版本必须一致。
  2. 全量回归：跑 tests/ 下所有 test_*.py（含 v1.0.18 新增的折叠/滚动定位回归）。
  3. A/B 对照：按 tests/ab_expectations.json 声明的矩阵，抽取历史版本核心跑用例，
     确认「上一好版本行为一致、引入缺陷的版本能复现」——而不是只跑当前源码自证清白。
  4. 汇总矩阵，任一不符合预期即 rc=1。

用法：
  python scripts/regress.py                 # 全量 + A/B
  python scripts/regress.py --no-ab         # 只跑全量（快，约 12 分钟）
  python scripts/regress.py --only test_relocate_collapsed.py
  python scripts/regress.py --keep-ab-core  # 保留抽出的历史核心，便于手工复现

约定：本文件与 CHANGELOG.md、tests/ab_expectations.json 配套 —— 每次修缺陷都要在
      CHANGELOG 登记、加用例（【回归】/【需求】/【保护】分组标注）、并在 A/B 矩阵补对照。
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CORE = ROOT / "recent-tabs-core.js"
CORE_DESKTOP = ROOT / "desktop" / "recent-tabs-core.js"
VERSION_FILE = ROOT / "VERSION"
MANIFEST = ROOT / "manifest.json"
TESTS = ROOT / "tests"
AB_MATRIX = TESTS / "ab_expectations.json"

GIT_CANDIDATES = [
    "git",
    r"C:\Users\15020\.workbuddy\binaries\PortableGit\versions\1.2.0\cmd\git.exe",
]


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def parse_groups(out):
    """统计用例输出里 【回归】/【需求】/【保护】 三组断言的总数与失败数。"""
    groups = {"回归": [0, 0], "需求": [0, 0], "保护": [0, 0]}
    for ln in out.splitlines():
        for name, cell in groups.items():
            if ("【%s】" % name) in ln:
                cell[0] += 1
                if "[FAIL]" in ln:
                    cell[1] += 1
    return groups


def git_bin():
    for c in GIT_CANDIDATES:
        if os.path.isabs(c):
            if os.path.isfile(c):
                return c
        else:
            w = shutil.which(c)
            if w:
                return w
    return None


def _read_text(p):
    """读文本并剥掉 BOM（Windows 上用 `Set-Content -Encoding utf8` 会写 BOM，
    若按 utf-8 读会残留 \\ufeff 导致版本比对假失败）。"""
    return Path(p).read_text(encoding="utf-8-sig").strip().lstrip("\ufeff")


def check_consistency():
    """返回 [(ok, 说明)]。"""
    out = []
    try:
        same = sha(CORE) == sha(CORE_DESKTOP)
        out.append((same, "根目录 recent-tabs-core.js 与 desktop/ 副本一致"
                          + ("" if same else " —— 请同步：Copy-Item recent-tabs-core.js desktop\\recent-tabs-core.js -Force")))
    except OSError as e:
        out.append((False, "核心副本读取失败: %s" % e))
        return out

    ver_file = _read_text(VERSION_FILE) if VERSION_FILE.is_file() else None
    try:
        ver_manifest = json.loads(Path(MANIFEST).read_text(encoding="utf-8-sig")).get("version")
    except Exception as e:
        ver_manifest = None
        out.append((False, "manifest.json 解析失败: %s" % e))
    m = re.search(r'var MD_VERSION\s*=\s*"([^"]+)"', Path(CORE).read_text(encoding="utf-8-sig"))
    ver_core = m.group(1) if m else None
    ok = ver_file == ver_manifest == ver_core and ver_file is not None
    out.append((ok, "三处版本一致: VERSION=%r / manifest=%r / MD_VERSION=%r"
                     % (ver_file, ver_manifest, ver_core)))
    return out


def run_suite(path, extra=None, timeout=1800):
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    args = [sys.executable, "-u", str(path)] + (extra or [])
    try:
        p = subprocess.run(args, cwd=str(ROOT), env=env, capture_output=True,
                           text=True, encoding="utf-8", errors="replace", timeout=timeout)
        return p.returncode, (p.stdout or "") + (p.stderr or "")
    except subprocess.TimeoutExpired:
        return 124, "TIMEOUT after %ss" % timeout


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-ab", action="store_true", help="跳过 A/B 对照")
    ap.add_argument("--only", default=None, help="只跑指定用例文件名（仍会做一致性校验）")
    ap.add_argument("--keep-ab-core", action="store_true", help="保留抽出的历史版本核心文件")
    args = ap.parse_args()

    print("=" * 78)
    print("modao-recent-tabs 回归门禁   python =", sys.executable)
    print("=" * 78)

    failed = 0

    print("\n[1/4] 一致性校验")
    for ok, msg in check_consistency():
        print(("  [OK]   " if ok else "  [FAIL] ") + msg)
        if not ok:
            failed += 1

    print("\n[2/4] 全量回归")
    suites = sorted(TESTS.glob("test_*.py"))
    if args.only:
        suites = [s for s in suites if s.name == args.only]
    if not suites:
        print("  [FAIL] 未找到用例文件")
        failed += 1
    for s in suites:
        rc, out = run_suite(s)
        nfail = out.count("[FAIL]")
        print("  %-38s rc=%-3s [FAIL]x%d" % (s.name, rc, nfail))
        if rc != 0 or nfail:
            failed += 1
            tail = [ln for ln in out.splitlines() if "[FAIL]" in ln][:12]
            for ln in tail:
                print("        " + ln.strip())

    print("\n[3/4] A/B 对照（防「只跑当前源码自证清白」）")
    if args.no_ab:
        print("  [SKIP] --no-ab")
    elif not AB_MATRIX.is_file():
        print("  [SKIP] 缺少 %s（A/B 矩阵未声明）" % AB_MATRIX.name)
    else:
        g = git_bin()
        if not g:
            print("  [FAIL] 找不到 git，无法抽取历史版本核心")
            failed += 1
        else:
            cfg = json.loads(AB_MATRIX.read_text(encoding="utf-8-sig"))
            tmp = Path(tempfile.gettempdir())
            for fname, entries in cfg.items():
                if fname.startswith("_"):
                    continue
                path = TESTS / fname
                for e in entries:
                    ref, expect = e["ref"], e["expect"]
                    p = subprocess.run([g, "-C", str(ROOT), "show", "%s:recent-tabs-core.js" % ref],
                                       capture_output=True, text=True, encoding="utf-8",
                                       errors="replace")
                    if p.returncode != 0:
                        print("  [FAIL] 取不到 %s 的核心：%s" % (ref, (p.stderr or "").strip()[:120]))
                        failed += 1
                        continue
                    core_old = tmp / ("core_%s.js" % re.sub(r"[^0-9A-Za-z]", "", ref))
                    core_old.write_text(p.stdout, encoding="utf-8")

                    if not path.is_file():
                        print("  [FAIL] 缺少用例 %s" % fname)
                        failed += 1
                        continue
                    rc, out = run_suite(path, ["--core", str(core_old)])
                    cnt = parse_groups(out)
                    reg_total, reg_fail = cnt["回归"]
                    ok = (reg_fail == 0) if expect == "regression_pass" else (reg_fail > 0)
                    print("  %-26s %-34s 【回归】%d 条 / 失败 %d 条  → %s"
                          % (fname, ref, reg_total, reg_fail, "OK" if ok else "FAIL"))
                    if reg_total == 0:
                        print("        [FAIL] 一条【回归】断言都没跑到，夹具/用例可疑")
                        ok = False
                    if not ok:
                        failed += 1
                        tail = [ln for ln in out.splitlines() if "【回归】" in ln and "[FAIL]" in ln][:8]
                        for ln in tail:
                            print("        " + ln.strip())
                    else:
                        ev = "复现到用户原话" if ("未找到画布" in out) else "（未出现原话文案，请确认）"
                        print("        期望=%s 已满足；%s" % (expect, ev if expect == "regression_fail" else "行为一致"))
                    if not args.keep_ab_core:
                        try:
                            core_old.unlink()
                        except OSError:
                            pass

    print("\n[4/4] 结论")
    if failed:
        print("  ✗ 门禁未通过：%d 项失败。修完再提交/发版。" % failed)
    else:
        print("  ✓ 门禁通过：一致性 + 全量回归 + A/B 对照全部符合预期。")
    print("  提醒：修了缺陷请同步更新 CHANGELOG.md（现象/根因/修复/锁定用例）。")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
