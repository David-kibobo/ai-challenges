# tests/conftest.py
# This file intentionally runs at import time (pytest imports conftest early),
# so the rebuild occurs before test collection/imports happen.
from pathlib import Path
import subprocess
import sys
import os
import traceback


REPO_ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = REPO_ROOT / "src" / "dependency_injector"
PYX = SRC_DIR / "_cwiring.pyx"
C_FILE = SRC_DIR / "_cwiring.c"


SO_PATTERNS = ["_cwiring*.so", "_cwiring*.pyd"]

def _find_existing_so():
    files = []
    for pat in SO_PATTERNS:
        files.extend(SRC_DIR.glob(pat))
    return files

def _needs_rebuild():
   
    so_files = _find_existing_so()
    if not so_files:
        return True

    
    try:
        pyx_mtime = PYX.stat().st_mtime
    except FileNotFoundError:
      
        return False

    newest_so_mtime = max(p.stat().st_mtime for p in so_files)
    return pyx_mtime > newest_so_mtime

def _cleanup_existing_so():
    for p in _find_existing_so():
        try:
            p.unlink()
        except Exception:
          
            pass

def _build_inplace():
    setup_py = REPO_ROOT / "setup.py"
    if not setup_py.exists():
        raise FileNotFoundError(f"setup.py not found at repo root: {REPO_ROOT}")

    
    cmd = [sys.executable, str(setup_py), "build_ext", "--inplace"]
   
    subprocess.run(cmd, cwd=str(REPO_ROOT), check=True)


try:
    if _needs_rebuild():
        print(f"[conftest] Rebuilding Cython extension: {PYX}", file=sys.stderr)
        
        _cleanup_existing_so()
      
        _build_inplace()
        print("[conftest] Rebuild finished.", file=sys.stderr)
    else:
        print("[conftest] Cython extension is up to date. Skipping rebuild.", file=sys.stderr)
except Exception as exc:
   
    print("[conftest] ERROR: failed to (re)build Cython extensions.", file=sys.stderr)
    traceback.print_exc()
  
    raise
