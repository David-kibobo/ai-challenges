
"""
Package init for dependency_injector.
Ensures Cython extensions (_cwiring) are rebuilt before first import if needed.
"""
import sys
import subprocess
from pathlib import Path

def _ensure_cython_built_if_needed():
    repo_root = Path(__file__).resolve().parent.parent
    src_dir = repo_root / "src" / "dependency_injector"
    pyx = src_dir / "_cwiring.pyx"

    if not pyx.exists():
        return

    so_candidates = list(src_dir.glob("_cwiring*.so")) + list(src_dir.glob("_cwiring*.pyd"))
    newest_so_mtime = max((p.stat().st_mtime for p in so_candidates), default=0)
    pyx_mtime = pyx.stat().st_mtime if pyx.exists() else 0

    if newest_so_mtime == 0 or pyx_mtime > newest_so_mtime:
        for p in so_candidates:
            try:
                p.unlink()
            except Exception:
                pass
        setup_py = repo_root / "setup.py"
        subprocess.run([sys.executable, str(setup_py), "build_ext", "--inplace"],
                       cwd=str(repo_root), check=True)

_ensure_cython_built_if_needed()



"""Top-level package."""

__version__ = "4.48.2"
"""Version number.

:type: str
"""
