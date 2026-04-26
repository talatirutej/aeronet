# Copyright (c) 2026 Rutej Talati. All rights reserved.
# AeroNet — neural surrogate model for vehicle aerodynamics.

"""
Preprocess raw DrivAerStar VTK surface files into a .pt cache.

Usage:
    python scripts/preprocess_drivaerstar.py \
        --vtk-dir /path/to/DrivAerStar/vtk_F \
        --cache-dir ./cache/fastback \
        --n-points 16384 \
        --num-workers 8 \
        --body-class 1
"""

from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import torch
from tqdm import tqdm

# Make `src/` importable when run directly
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from aeronet.data import preprocess_case, compute_normalization


def _process_one(args):
    vtk_path, cache_dir, n_points = args
    vtk_path = Path(vtk_path)
    case_id = vtk_path.stem
    out_path = Path(cache_dir) / f"{case_id}.pt"
    if out_path.exists():
        return case_id, "skip"
    try:
        case = preprocess_case(vtk_path, n_points=n_points, fps_device="cpu")
        torch.save(case, out_path)
        return case_id, "ok"
    except Exception as e:
        return case_id, f"error: {e}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vtk-dir", required=True, type=Path,
                    help="Directory of *.vtk files from DrivAerStar.")
    ap.add_argument("--cache-dir", required=True, type=Path,
                    help="Output directory for processed .pt files.")
    ap.add_argument("--n-points", type=int, default=16384,
                    help="Points per case after FPS subsampling.")
    ap.add_argument("--num-workers", type=int, default=max(1, mp.cpu_count() // 2))
    ap.add_argument("--body-class", type=int, default=0,
                    help="0=Notchback, 1=Fastback, 2=Estate. Saved into manifest.")
    ap.add_argument("--u-ref", type=float, default=40.0,
                    help="Inflow velocity used in DrivAerStar runs (m/s).")
    ap.add_argument("--rho", type=float, default=1.25,
                    help="Air density used in DrivAerStar runs (kg/m^3).")
    ap.add_argument("--a-ref", type=float, default=2.37,
                    help="Reference frontal area (m^2). DrivAerStar uses ~2.37.")
    ap.add_argument("--limit", type=int, default=None,
                    help="If set, process only the first N cases (for testing).")
    args = ap.parse_args()

    args.cache_dir.mkdir(parents=True, exist_ok=True)
    vtk_paths = sorted(args.vtk_dir.glob("*.vtk"))
    if args.limit:
        vtk_paths = vtk_paths[: args.limit]
    print(f"Found {len(vtk_paths)} VTK files in {args.vtk_dir}")

    work = [(p, args.cache_dir, args.n_points) for p in vtk_paths]

    results = {"ok": 0, "skip": 0, "error": 0}
    with ProcessPoolExecutor(max_workers=args.num_workers) as ex:
        futures = [ex.submit(_process_one, w) for w in work]
        for fut in tqdm(as_completed(futures), total=len(futures), desc="Preprocessing"):
            case_id, status = fut.result()
            if status == "ok":
                results["ok"] += 1
            elif status == "skip":
                results["skip"] += 1
            else:
                results["error"] += 1
                print(f"  [error] {case_id}: {status}")

    print(f"Done. ok={results['ok']} skip={results['skip']} error={results['error']}")

    # Build the manifest of successfully cached cases.
    case_files = sorted(args.cache_dir.glob("*.pt"))
    case_ids = [p.stem for p in case_files]
    manifest = {
        "case_ids": case_ids,
        "n_points": args.n_points,
        "body_class": args.body_class,
        "u_ref": args.u_ref,
        "rho": args.rho,
        "a_ref": args.a_ref,
    }
    (args.cache_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"Wrote manifest: {args.cache_dir/'manifest.json'} ({len(case_ids)} cases)")

    # Compute and save normalization stats over all cached cases (treating
    # them as one "train pool"; the actual train/val split happens at training
    # time and stats over a 200-case sample are stable enough either way).
    if case_ids:
        print("Computing normalization stats over cached cases...")
        norm = compute_normalization(args.cache_dir, case_ids, max_cases_for_stats=200)
        norm.save(args.cache_dir / "normalization.json")
        print(f"Saved {args.cache_dir/'normalization.json'}: "
              f"p_mean={norm.p_mean:.2f} p_std={norm.p_std:.2f} "
              f"tau_mean={norm.tau_mean} tau_std={norm.tau_std}")


if __name__ == "__main__":
    main()
