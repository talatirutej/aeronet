# Copyright (c) 2026 Rutej Talati. All rights reserved.
# AeroNet — neural surrogate model for vehicle aerodynamics.

"""
Run inference with a trained AeroNet on a single VTK or a folder of VTKs.

Outputs:
  - <out_dir>/<case_id>_predicted.vtk  : surface mesh with predicted fields
  - <out_dir>/predictions.csv          : Cd, Cl, Cs per case

Usage:
    python scripts/predict.py \
        --ckpt logs/checkpoints/aeronet-best.ckpt \
        --vtk-input path/to/cars.vtk_or_dir \
        --out-dir ./predictions \
        --u-ref 40 --rho 1.25 --a-ref 2.37
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from aeronet import (
    AeroNetLitModule, integrate_force_coefficients, denormalize_fields,
)
from aeronet.data import preprocess_case


def _save_prediction_vtk(out_path: Path, xyz: np.ndarray, normals: np.ndarray,
                         pred_p: np.ndarray, pred_tau: np.ndarray, area: np.ndarray):
    """Write a minimal VTK polydata with predicted fields. Uses pyvista for
    the actual write."""
    import pyvista as pv
    cloud = pv.PolyData(xyz.astype(np.float32))
    cloud["Normals"] = normals.astype(np.float32)
    cloud["Pressure_pred"] = pred_p.astype(np.float32)
    cloud["WallShearStress_pred"] = pred_tau.astype(np.float32)
    cloud["Area"] = area.astype(np.float32)
    cloud.save(str(out_path))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True, type=str)
    ap.add_argument("--vtk-input", required=True, type=str,
                    help="A .vtk file or a directory containing .vtk files.")
    ap.add_argument("--out-dir", required=True, type=str)
    ap.add_argument("--n-points", type=int, default=16384)
    ap.add_argument("--u-ref", type=float, default=40.0)
    ap.add_argument("--rho", type=float, default=1.25)
    ap.add_argument("--a-ref", type=float, default=2.37)
    ap.add_argument("--body-class", type=int, default=0)
    ap.add_argument("--device", type=str, default="cuda" if torch.cuda.is_available() else "cpu")
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Resolve input list
    inp = Path(args.vtk_input)
    if inp.is_dir():
        files = sorted(inp.glob("*.vtk"))
    else:
        files = [inp]
    print(f"Predicting on {len(files)} files. Device: {args.device}")

    # Load model
    lit = AeroNetLitModule.load_from_checkpoint(args.ckpt, map_location=args.device)
    lit.eval().to(args.device)
    norm = lit.norm

    rows = []
    with torch.inference_mode():
        for vtk in files:
            case_id = vtk.stem
            print(f"  -> {case_id}")
            case = preprocess_case(vtk, n_points=args.n_points, fps_device="cpu")

            xyz_n = torch.from_numpy(case["xyz"]).unsqueeze(0).to(args.device)
            normals = torch.from_numpy(case["normals"]).unsqueeze(0).to(args.device)
            area = torch.from_numpy(case["area"]).unsqueeze(0).to(args.device)
            global_cond = torch.tensor(
                [[args.u_ref / 50.0, args.rho / 1.25, args.a_ref / 2.5, args.body_class / 2.0]],
                dtype=torch.float32, device=args.device,
            )

            pred_norm = lit.model(xyz_n, normals, global_cond)       # (1, N, 4)
            pred_phys = denormalize_fields(pred_norm, norm)          # (1, N, 4)

            coeffs = integrate_force_coefficients(
                pred_phys, normals, area,
                u_ref=torch.tensor([args.u_ref], device=args.device),
                rho=torch.tensor([args.rho], device=args.device),
                a_ref=torch.tensor([args.a_ref], device=args.device),
            )
            cd = float(coeffs["Cd"].cpu())
            cl = float(coeffs["Cl"].cpu())
            cs = float(coeffs["Cs"].cpu())
            print(f"     Cd = {cd:.4f}   Cl = {cl:.4f}   Cs = {cs:.4f}")

            # Restore world-coords (un-normalize) before writing VTK so the
            # output is in metres and matches the original mesh frame.
            xyz_world = case["xyz"] * float(case["L_ref"]) + case["centre"]
            pred_phys_np = pred_phys.squeeze(0).cpu().numpy()
            _save_prediction_vtk(
                out_dir / f"{case_id}_predicted.vtk",
                xyz_world,
                case["normals"],
                pred_phys_np[:, 0],
                pred_phys_np[:, 1:4],
                case["area"],
            )
            rows.append((case_id, cd, cl, cs))

    csv_path = out_dir / "predictions.csv"
    with open(csv_path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["case_id", "Cd", "Cl", "Cs"])
        w.writerows(rows)
    print(f"Wrote {csv_path}")


if __name__ == "__main__":
    main()
