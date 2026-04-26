# Copyright (c) 2026 Rutej Talati. All rights reserved.
# AeroNet — neural surrogate model for vehicle aerodynamics.

"""
Convenience launcher for the FastAPI inference server.

Usage:
    python scripts/start_server.py
    python scripts/start_server.py --port 8001
    python scripts/start_server.py --ckpt /path/to/your.ckpt

Auto-detects the most recent .ckpt under logs/ if --ckpt is not given.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _find_latest_ckpt() -> Path | None:
    """Search logs/ for the most recently modified .ckpt file."""
    logs = PROJECT_ROOT / "logs"
    if not logs.exists():
        return None
    candidates = list(logs.rglob("*.ckpt"))
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default=None, type=str,
                    help="Path to checkpoint. If omitted, auto-find most recent under logs/.")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--device", default="cpu")
    args = ap.parse_args()

    ckpt = Path(args.ckpt) if args.ckpt else _find_latest_ckpt()
    if ckpt is None:
        print(
            "ERROR: No checkpoint found. Train first with:\n"
            "    python scripts/train.py --config configs/smoke_test.yaml --smoke-test\n"
            "Or pass --ckpt /path/to/your.ckpt",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"[start_server] Using checkpoint: {ckpt}")
    print(f"[start_server] Server will listen on http://{args.host}:{args.port}")
    print(f"[start_server] Open http://{args.host}:{args.port}/docs for interactive API.")
    print()

    # Hand off to server.main with the resolved args
    sys.argv = [
        "server.main",
        "--ckpt", str(ckpt),
        "--host", args.host,
        "--port", str(args.port),
        "--device", args.device,
    ]
    sys.path.insert(0, str(PROJECT_ROOT))
    from server.main import main as server_main
    server_main()


if __name__ == "__main__":
    main()
