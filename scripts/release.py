#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""modao-recent-tabs 发版工具（打包 + 上传资产）。

本环境没有 `zip` CLI，且 Bash 工具对中文路径做 shell glob 会让 `gh release upload`
报 "no matches found"。本脚本用标准库 zipfile 打包，并用 subprocess argv 列表直传
路径给 `gh`，绕过 shell glob。

子命令：
  build    把 release/modao-recent-tabs-browser/ 的 8 个扩展文件打成
           release/modao-recent-tabs-browser.zip（文件位于 zip 根）。
  upload   上传资产到指定 tag 的 GitHub Release（经 subprocess，不经 shell）。
  clean    删除 release/ 下遗留的一次性辅助脚本（_zip_browser.py / _upload_assets.py 等）。
  release  build + upload 一步到位（zip 必传，桌面端 asar 作为额外资产传入）。

代理：本机只能经本地代理访问 GitHub API，故调用 gh 前清空 NO_PROXY 并确保 HTTPS_PROXY。
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
    env.pop("NO_PROXY", None)
    env.pop("no_proxy", None)
    if not env.get("HTTPS_PROXY") and not env.get("https_proxy"):
        env["HTTPS_PROXY"] = "http://127.0.0.1:4608"
    return env


def build():
    if not BROWSER_SRC.is_dir():
        sys.exit(f"browser source dir not found: {BROWSER_SRC}")
    missing = [f for f in BROWSER_FILES if not (BROWSER_SRC / f).is_file()]
    if missing:
        sys.exit(f"missing source files: {missing}")
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

    sub.add_parser("build", help="pack browser extension zip")

    up = sub.add_parser("upload", help="upload assets to a release")
    up.add_argument("--tag", required=True)
    up.add_argument("assets", nargs="*", help="asset file paths")

    sub.add_parser("clean", help="remove legacy temp scripts in release/")

    rl = sub.add_parser("release", help="build zip then upload zip + extra assets")
    rl.add_argument("--tag", required=True)
    rl.add_argument("assets", nargs="*", help="extra asset paths (e.g. desktop asar)")

    args = ap.parse_args()

    if args.cmd == "build":
        build()
    elif args.cmd == "upload":
        upload(args.tag, args.assets)
    elif args.cmd == "clean":
        clean()
    elif args.cmd == "release":
        zip_path = build()
        upload(args.tag, [str(zip_path), *args.assets])


if __name__ == "__main__":
    main()
