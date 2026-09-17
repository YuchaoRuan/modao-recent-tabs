# -*- coding: utf-8 -*-
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
import importlib
import test_relocate_collapsed as T
names = [n for n in dir(T) if "test_e" in n or "setup_full" in n or "boot" in n]
print("HAS test_e1:", hasattr(T, "test_e1_full_render_scrolled_out"))
print("MATCHES:", names)
print("FILE:", getattr(T, "__file__", "?"))
