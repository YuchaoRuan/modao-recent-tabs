#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""modao-recent-tabs 发版工具（打包 + 上传资产）。

本环境没有 `zip` CLI，且 Bash 工具对中文路径做 shell glob 会让 `gh release upload`
报 "no matches found"。本脚本用标准库 zipfile 打包，并用 subprocess argv 列表直传
路径给 `gh`，绕过 shell glob。

子命令：
  build    先把仓库根目录的 8 个浏览器扩展源文件同步到 BROWSER_SRC，再打成
           release/modao-recent-tabs-browser.zip（文件位于 zip 根）。--no-sync 可跳过同步。
  upload   上传资产到指定 tag 的 GitHub Release（经 subprocess，不经 shell）。
  clean    删除 release/ 下遗留的一次性辅助脚本（_zip_browser.py / _upload_assets.py 等）。
  release  build + upload 一步到位（zip 必传，桌面端 asar 作为额外资产传入）。

代理：实测沙箱内直连 GitHub 可达，但经本地代理(127.0.0.1:4608)会被 502 拦截。
故调用 gh 前把 github 相关主机加入 NO_PROXY 并清空 HTTPS_PROXY，走直连。
"""
import argparse
import os
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RELEASE_DIR = ROOT / "release"
BROWSER_SRC = RELEASE_DIR / "modao-recent-tabs-browser"
BROWSER_ZIP = RELEASE_DIR / "modao-recent-tabs-browser.zip"
BROWSER_FILES = [
    "background.js", "content.js", "manifest.json", "options.html",
    "options.js", "recent-tabs-core.js", "tabbar.css", "tabbar.js",
]
REPO = "YuchaoRuan/modao-recent-tabs"
LEGACY_TEMPS = ["_zip_browser.py", "_upload_assets.py"]


def _env():
    env = os.environ.copy()
    # 走直连：把 github 相关主机排除出代理，并清空 HTTPS_PROXY（否则经 4608 代理会 502）
    no_proxy = "api.github.com,github.com,uploads.github.com,*.githubusercontent.com"
    env["NO_PROXY"] = no_proxy
    env["no_proxy"] = no_proxy
    env.pop("HTTPS_PROXY", None)
    env.pop("https_proxy", None)
    return env


def sync_browser_src(force=True):
    """从仓库根目录(ROOT)把 8 个浏览器扩展源文件覆盖同步到 BROWSER_SRC。

    防回归：历史 BUG 因 BROWSER_SRC 内的 recent-tabs-core.js 落后两代（仍是 1.0.18），
    打出的 browser.zip 版本号滞后。此处每次 build 先强制对齐 ROOT，杜绝漏同步。
    """
    BROWSER_SRC.mkdir(parents=True, exist_ok=True)
    missing = [f for f in BROWSER_FILES if not (ROOT / f).is_file()]
    if missing:
        sys.exit(f"missing root source files: {missing}")
    if not force:
        return
    synced = []
    for f in BROWSER_FILES:
        src = ROOT / f
        dst = BROWSER_SRC / f
        data = src.read_bytes()
        if not dst.exists() or dst.read_bytes() != data:
            dst.write_bytes(data)
            synced.append(f)
    if synced:
        print(f"synced {len(synced)} file(s) root -> BROWSER_SRC: {synced}")
    else:
        print("browser src already in sync with root, nothing to copy")


def build(no_sync=False):
    sync_browser_src(force=not no_sync)
    if BROWSER_ZIP.exists():
        BROWSER_ZIP.unlink()
    with zipfile.ZipFile(BROWSER_ZIP, "w", zipfile.ZIP_DEFLATED) as z:
        for f in BROWSER_FILES:
            z.write(BROWSER_SRC / f, f)
    print(f"built {BROWSER_ZIP} ({BROWSER_ZIP.stat().st_size} bytes), "
          f"{len(BROWSER_FILES)} files at root")
    return BROWSER_ZIP


def upload(tag, assets):
    if not assets:
        sys.exit("no assets given")
    args = ["gh", "release", "upload", tag, *assets, "-R", REPO]
    print("RUN:", " ".join(args))
    r = subprocess.run(args, env=_env())
    sys.exit(r.returncode)


def clean():
    removed = []
    for name in LEGACY_TEMPS:
        p = RELEASE_DIR / name
        if p.exists():
            p.unlink()
            removed.append(name)
    for p in RELEASE_DIR.glob("_*.py"):
        if p.exists():
            p.unlink()
            removed.append(p.name)
    print("cleaned:", removed if removed else "nothing to remove")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("build", help="sync 8 browser source files from ROOT then pack browser zip")
    b.add_argument("--no-sync", action="store_true",
                   help="skip syncing 8 browser source files from ROOT to BROWSER_SRC")

    up = sub.add_parser("upload", help="upload assets to a release")
    up.add_argument("--tag", required=True)
    up.add_argument("assets", nargs="*", help="asset file paths")

    sub.add_parser("clean", help="remove legacy temp scripts in release/")

    rl = sub.add_parser("release", help="build zip then upload zip + extra assets")
    rl.add_argument("--tag", required=True)
    rl.add_argument("--no-sync", action="store_true",
                    help="skip syncing 8 browser source files from ROOT to BROWSER_SRC")
    rl.add_argument("assets", nargs="*", help="extra asset paths (e.g. desktop asar)")

    args = ap.parse_args()

    if args.cmd == "build":
        build(args.no_sync)
    elif args.cmd == "upload":
        upload(args.tag, args.assets)
    elif args.cmd == "clean":
        clean()
    elif args.cmd == "release":
        zip_path = build(args.no_sync)
        upload(args.tag, [str(zip_path), *args.assets])


if __name__ == "__main__":
    main()
