// Views2DPage.jsx — StatCFD Vehicle Outline Analysis UI
// Mahindra Research Valley / statinsite.com / Copyright (c) 2026 Rutej Talati
//
// Features:
//   - Side / Front / Top / Underside view rendering
//   - Mode A/B/C analysis pipeline
//   - Car identification → real dimension-driven 3-view rendering
//   - Comparison feature: save Car A, save Car B, overlay with red deviation
//   - 3/4 view warnings displayed prominently
//   - URL fetcher with multi-host support
//   - Persistent storage for car history

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "https://rutejtalati16-aeronet.hf.space";

// ─── URL normaliser for major image hosts ─────────────────────────────────────
function normaliseImageUrl(raw) {
  if (!raw) return raw;
  let u = raw.trim();
  // Google Drive
  let m = u.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (m) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  m = u.match(/drive\.google\.com\/open\?id=([^&]+)/);
  if (m) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  // Dropbox
  if (u.includes("dropbox.com") && u.includes("?dl=0")) return u.replace("?dl=0", "?dl=1");
  if (u.includes("dropbox.com") && !u.includes("?dl=")) return u + "?dl=1";
  // Imgur
  m = u.match(/imgur\.com\/([a-zA-Z0-9]+)$/);
  if (m) return `https://i.imgur.com/${m[1]}.jpg`;
  // GitHub blob → raw
  if (u.includes("github.com") && u.includes("/blob/")) {
    return u.replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/");
  }
  // Reddit preview → original
  if (u.includes("preview.redd.it")) {
    return u.split("?")[0].replace("preview.redd.it", "i.redd.it");
  }
  return u;
}

// ─── Async URL fetcher (race through proxies) ─────────────────────────────────
async function fetchImageFromUrl(url) {
  const norm = normaliseImageUrl(url);
  const proxies = [
    (u) => u,  // direct
    (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    (u) => `https://cors-anywhere.herokuapp.com/${u}`,
  ];
  const attempt = (urlBuilder) => new Promise(async (resolve, reject) => {
    try {
      const r = await fetch(urlBuilder(norm), { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return reject(new Error(`HTTP ${r.status}`));
      const blob = await r.blob();
      if (!blob.type.startsWith("image/") && blob.size < 1024) return reject(new Error("Not an image"));
      resolve(blob);
    } catch (e) { reject(e); }
  });
  const errors = [];
  for (const p of proxies) {
    try { return await attempt(p); }
    catch (e) { errors.push(e.message); }
  }
  throw new Error(`All proxies failed: ${errors.slice(0, 3).join(" | ")}`);
}

// ─── Pretty number formatter ───────────────────────────────────────────────────
const fmt = (n, d = 2) => (n == null || isNaN(n)) ? "—" : Number(n).toFixed(d);
const pct = (n, d = 0) => (n == null || isNaN(n)) ? "—" : `${(n * 100).toFixed(d)}%`;

// ═══════════════════════════════════════════════════════════════════════════════
// SIDE VIEW — uses extracted technical_outline_pts
// ═══════════════════════════════════════════════════════════════════════════════
function SideView({ contourPts, contourPtsB, geo, method, viewMode, comparisonMode, comparison }) {
  const CW = 1080, CH = 380;
  const PAD_X = 30, PAD_Y = 60;

  // Compute draw region from points
  const { drawPath, drawPathB, deviationSegments, drawW, drawH, drawOX, drawOY, gY } = useMemo(() => {
    if (!contourPts || !Array.isArray(contourPts) || contourPts.length < 10) return {};
    const xs = contourPts.map(p => p[0]);
    const ys = contourPts.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const cw = maxX - minX || 1, ch = maxY - minY || 1;

    const draw_w = CW - 2 * PAD_X;
    const draw_h = CH - 2 * PAD_Y;
    // Scale to fit
    const sx = draw_w / cw, sy = draw_h / ch;
    const s = Math.min(sx, sy);
    const final_w = cw * s, final_h = ch * s;
    const ox = (CW - final_w) / 2;
    // Anchor car bottom to ground line
    const ground_y = CH - PAD_Y;
    const oy = ground_y - final_h;

    const toScreen = (p) => [
      ox + (p[0] - minX) * s,
      oy + (p[1] - minY) * s,
    ];

    // Path A (white)
    const sA = contourPts.map(toScreen);
    const pathA = sA.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ") + " Z";

    // Path B (blue, if exists)
    let pathB = null;
    if (comparisonMode && contourPtsB && contourPtsB.length > 0) {
      const xsB = contourPtsB.map(p => p[0]);
      const ysB = contourPtsB.map(p => p[1]);
      const minXB = Math.min(...xsB), maxXB = Math.max(...xsB);
      const minYB = Math.min(...ysB), maxYB = Math.max(...ysB);
      const cwB = maxXB - minXB || 1, chB = maxYB - minYB || 1;
      // Use the SAME scale as A so they compare visually
      const sB = Math.min(draw_w / Math.max(cw, cwB), draw_h / Math.max(ch, chB));
      const final_w_B = cwB * sB, final_h_B = chB * sB;
      const ox_B = (CW - final_w_B) / 2;
      const oy_B = ground_y - final_h_B;
      const toScreenB = (p) => [
        ox_B + (p[0] - minXB) * sB,
        oy_B + (p[1] - minYB) * sB,
      ];
      const sBpts = contourPtsB.map(toScreenB);
      pathB = sBpts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ") + " Z";
    }

    // Deviation segments (red highlights)
    let devSegs = [];
    if (comparisonMode && comparison && comparison.deviation_map && comparison.aligned_pts_a) {
      const devs = comparison.deviation_map;
      const meanDev = devs.reduce((a, b) => a + b, 0) / devs.length;
      const threshold = meanDev * 1.8; // segments >1.8x mean dev are "key differences"
      const aligned = comparison.aligned_pts_a;
      // Map aligned coords back to screen
      // The aligned coords are Procrustes-normalised, so we need to map them
      // proportionally onto our drawn A path. We'll just walk the original A pts
      // and colour those whose corresponding deviation > threshold.
      const N = devs.length;
      const ratio = sA.length / N;
      for (let i = 0; i < N; i++) {
        if (devs[i] > threshold) {
          const idxA = Math.floor(i * ratio);
          const idxA2 = Math.min(sA.length - 1, Math.floor((i + 1) * ratio));
          if (idxA2 > idxA) {
            const seg = sA.slice(idxA, idxA2 + 1);
            if (seg.length >= 2) {
              devSegs.push(seg.map((p, j) => `${j === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" "));
            }
          }
        }
      }
    }

    return {
      drawPath: pathA, drawPathB: pathB, deviationSegments: devSegs,
      drawW: final_w, drawH: final_h, drawOX: ox, drawOY: oy, gY: ground_y,
    };
  }, [contourPts, contourPtsB, comparisonMode, comparison]);

  if (!drawPath) {
    return (
      <div style={{ width: CW, height: CH, background: "#04070d",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "rgba(255,255,255,0.3)", fontSize: 11, fontFamily: "'IBM Plex Mono'" }}>
        ▷ Upload an image and analyse to see the outline
      </div>
    );
  }

  const has34warning = geo?._quality?.warnings?.some(w =>
    w.includes("3/4") || w.includes("quarter") || w.includes("front/rear"));
  const wheels = geo?._wheels || [];

  return (
    <svg width={CW} height={CH} viewBox={`0 0 ${CW} ${CH}`}
      style={{ background: "#04070d", borderRadius: 6, display: "block" }}>
      <defs>
        <filter id="ssd" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.2" />
        </filter>
      </defs>

      {/* Ground line */}
      <line x1={PAD_X * 0.5} y1={gY} x2={CW - PAD_X * 0.5} y2={gY}
        stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" strokeDasharray="2,3" />

      {/* Filled background to prevent bleed-through */}
      <path d={drawPath} fill="rgba(4,10,18,0.96)" stroke="none" />

      {/* Path A (white) */}
      <path d={drawPath} fill="none" stroke="rgba(255,255,255,0.92)"
        strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />

      {/* Path B (blue, comparison mode) */}
      {drawPathB && (
        <path d={drawPathB} fill="none" stroke="rgba(64,156,255,0.85)"
          strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
      )}

      {/* Deviation segments (red) */}
      {deviationSegments.map((seg, i) => (
        <path key={i} d={seg} fill="none" stroke="rgba(255,69,58,0.9)"
          strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      ))}

      {/* Wheel circles overlay */}
      {!comparisonMode && wheels.map((w, i) => {
        if (!w?.nx == null || !w?.ny == null || !w?.nr == null) return null;
        if (w.nx === undefined || w.ny === undefined || w.nr === undefined) return null;
        // nx/ny are normalised to the vehicle bbox (same coordinate space as contourPts)
        // Map to screen using the same transform computed for the contour
        // drawOX, drawOY, drawW, drawH are from the useMemo above
        if (!drawOX && drawOX !== 0) return null;
        const xs = contourPts.map(p => p[0]);
        const ys = contourPts.map(p => p[1]);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        const cw = maxX - minX || 1, ch = maxY - minY || 1;
        const draw_w = CW - 2 * PAD_X, draw_h = CH - 2 * PAD_Y;
        const s = Math.min(draw_w / cw, draw_h / ch);
        const ox = (CW - cw * s) / 2;
        const oy = gY - ch * s;
        // nx is in [0,1] relative to bbox. contourPts x values are also [0,1] relative to bbox.
        // So the wheel screen position is: ox + (nx - minX) * s
        const wxAdj = ox + (w.nx - minX) * s;
        const wyAdj = oy + (w.ny - minY) * s;
        // Wheel radius: nr is wheel_r/bbox_width. Scale by draw_w and cap physically
        const wr = Math.max(draw_h * 0.09,
                    Math.min(draw_h * 0.14, w.nr * cw * s));
        return (
          <g key={i}>
            <circle cx={wxAdj} cy={wyAdj} r={wr}
              fill="none" stroke="rgba(255,255,255,0.20)" strokeWidth="1" />
            <circle cx={wxAdj} cy={wyAdj} r={wr * 0.42}
              fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="0.6" />
          </g>
        );
      })}

      {/* Watermark */}
      <text x={CW / 2} y={CH / 2} textAnchor="middle"
        fill="rgba(255,255,255,0.04)" fontSize="11"
        fontFamily="'IBM Plex Mono',monospace">
        © 2026 Rutej Talati
      </text>

      {/* Footer */}
      <text x={CW / 2} y={CH - 5} textAnchor="middle" fill="rgba(255,255,255,0.10)"
        fontSize="8" fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.10em">
        SIDE · {contourPts.length}pts · {method || "yolo+sam2"}
        {comparisonMode ? " · COMPARISON" : ""}
      </text>

      {/* 3/4 view warning */}
      {has34warning && !comparisonMode && (
        <g>
          <rect x={8} y={CH - 32} width={310} height={20} rx={4}
            fill="rgba(255,159,10,0.14)" stroke="rgba(255,159,10,0.4)" strokeWidth="0.5" />
          <text x={16} y={CH - 18} fill="rgba(255,159,10,0.92)" fontSize="9"
            fontFamily="'IBM Plex Mono',monospace">
            ⚠ 3/4 view detected — front outline may be distorted
          </text>
        </g>
      )}

      {/* Comparison legend */}
      {comparisonMode && (
        <g>
          <rect x={8} y={8} width={200} height={56} rx={4}
            fill="rgba(0,0,0,0.5)" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" />
          <line x1={18} y1={22} x2={36} y2={22} stroke="rgba(255,255,255,0.92)" strokeWidth="2" />
          <text x={42} y={26} fill="rgba(255,255,255,0.9)" fontSize="9"
            fontFamily="'IBM Plex Mono',monospace">Car A</text>
          <line x1={18} y1={38} x2={36} y2={38} stroke="rgba(64,156,255,0.85)" strokeWidth="2" />
          <text x={42} y={42} fill="rgba(64,156,255,0.9)" fontSize="9"
            fontFamily="'IBM Plex Mono',monospace">Car B</text>
          <line x1={18} y1={54} x2={36} y2={54} stroke="rgba(255,69,58,0.9)" strokeWidth="2.5" />
          <text x={42} y={58} fill="rgba(255,69,58,0.92)" fontSize="9"
            fontFamily="'IBM Plex Mono',monospace">Key differences</text>
        </g>
      )}
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// FRONT VIEW — uses car_dimensions if available, else generic body type templates
// ═══════════════════════════════════════════════════════════════════════════════
function FrontView({ geo, carDims }) {
  const CW = 1080, CH = 380;

  // Derive dimensions from car_dimensions if available, else generic
  const front_aspect   = carDims?.front_aspect || 1.20;     // width/height
  const wheel_track    = carDims?.wheel_track_norm || 0.85; // track/width
  const body_type      = (carDims?.body_type || geo?.bodyType || "notchback").toLowerCase();
  const ws_rake        = geo?.wsAngleDeg || 58;

  // SVG layout — front view is height-dominant
  const PAD = 80;
  const draw_h = CH - 2 * PAD;
  const draw_w = draw_h * front_aspect;
  const ox = (CW - draw_w) / 2;
  const oy = PAD;

  // Greenhouse height fraction (40% of total height for sedans, 35% for SUVs)
  const gh_frac = body_type === "suv" ? 0.34 :
                  body_type === "fastback" ? 0.42 : 0.40;
  const greenhouse_h = draw_h * gh_frac;

  // Build the outline
  const baseY = oy + draw_h;          // ground/wheel base
  const roofY = oy;                    // top
  const shoulderY = oy + greenhouse_h; // body shoulder line
  const bodyL = ox;
  const bodyR = ox + draw_w;
  const cabinL = ox + draw_w * (1 - 0.85) / 2;
  const cabinR = ox + draw_w - draw_w * (1 - 0.85) / 2;
  const cabinTopL = ox + draw_w * 0.18;
  const cabinTopR = ox + draw_w * 0.82;

  // Body outline path — front view symmetric silhouette
  const bodyPath = `
    M ${bodyL.toFixed(1)} ${baseY.toFixed(1)}
    L ${bodyL.toFixed(1)} ${(shoulderY + 2).toFixed(1)}
    Q ${bodyL.toFixed(1)} ${shoulderY.toFixed(1)} ${cabinL.toFixed(1)} ${shoulderY.toFixed(1)}
    L ${cabinTopL.toFixed(1)} ${(roofY + 4).toFixed(1)}
    Q ${cabinTopL.toFixed(1)} ${roofY.toFixed(1)} ${(cabinTopL + 8).toFixed(1)} ${roofY.toFixed(1)}
    L ${(cabinTopR - 8).toFixed(1)} ${roofY.toFixed(1)}
    Q ${cabinTopR.toFixed(1)} ${roofY.toFixed(1)} ${cabinTopR.toFixed(1)} ${(roofY + 4).toFixed(1)}
    L ${cabinR.toFixed(1)} ${shoulderY.toFixed(1)}
    Q ${bodyR.toFixed(1)} ${shoulderY.toFixed(1)} ${bodyR.toFixed(1)} ${(shoulderY + 2).toFixed(1)}
    L ${bodyR.toFixed(1)} ${baseY.toFixed(1)}
    Z
  `;

  // Wheel positions (viewed head-on: 2 wheels visible left/right at base)
  const trackPx = draw_w * wheel_track;
  const wheelLeftX  = ox + (draw_w - trackPx) / 2 + draw_w * 0.025;
  const wheelRightX = ox + draw_w - (draw_w - trackPx) / 2 - draw_w * 0.025;
  const wheelY = baseY - draw_h * 0.06;
  const wheelR = draw_h * 0.13;

  return (
    <svg width={CW} height={CH} viewBox={`0 0 ${CW} ${CH}`}
      style={{ background: "#04070d", borderRadius: 6, display: "block" }}>
      <line x1={PAD * 0.4} y1={baseY} x2={CW - PAD * 0.4} y2={baseY}
        stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" strokeDasharray="2,3" />

      <path d={bodyPath} fill="rgba(4,10,18,0.96)"
        stroke="rgba(255,255,255,0.92)" strokeWidth="1.4"
        strokeLinejoin="round" strokeLinecap="round" />

      {/* Wheels */}
      {[wheelLeftX, wheelRightX].map((wx, i) => (
        <g key={i}>
          <ellipse cx={wx} cy={wheelY} rx={wheelR * 0.42} ry={wheelR}
            fill="rgba(20,20,20,0.9)"
            stroke="rgba(255,255,255,0.6)" strokeWidth="1" />
          <ellipse cx={wx} cy={wheelY} rx={wheelR * 0.20} ry={wheelR * 0.45}
            fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="0.5" />
        </g>
      ))}

      {/* Headlights hint */}
      <ellipse cx={ox + draw_w * 0.22} cy={oy + draw_h * 0.55}
        rx={draw_w * 0.10} ry={draw_h * 0.06}
        fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="0.6" />
      <ellipse cx={ox + draw_w * 0.78} cy={oy + draw_h * 0.55}
        rx={draw_w * 0.10} ry={draw_h * 0.06}
        fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="0.6" />

      {/* Grille hint */}
      <rect x={ox + draw_w * 0.36} y={oy + draw_h * 0.66}
        width={draw_w * 0.28} height={draw_h * 0.08}
        fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="0.6" rx="2" />

      <text x={CW / 2} y={CH - 5} textAnchor="middle" fill="rgba(255,255,255,0.10)"
        fontSize="8" fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.10em">
        FRONT · {carDims?.car_id || body_type.toUpperCase()}
        {carDims?.confidence ? ` · conf ${(carDims.confidence * 100).toFixed(0)}%` : ""}
      </text>

      {carDims?.overall_width_mm && (
        <g>
          <text x={ox + draw_w / 2} y={CH - 20} textAnchor="middle"
            fill="rgba(255,255,255,0.4)" fontSize="9"
            fontFamily="'IBM Plex Mono',monospace">
            {carDims.overall_width_mm} mm · H {carDims.overall_height_mm} mm
          </text>
        </g>
      )}
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOP VIEW — uses car_dimensions for proper length/width ratio
// ═══════════════════════════════════════════════════════════════════════════════
function TopView({ geo, carDims }) {
  const CW = 1080, CH = 380;

  const top_aspect    = carDims?.top_aspect || 2.5;          // length/width
  const wheel_track   = carDims?.wheel_track_norm || 0.85;
  const wheelbase_norm= carDims?.wheelbase_norm || 0.60;     // wheelbase/length
  const body_type     = (carDims?.body_type || geo?.bodyType || "notchback").toLowerCase();

  const PAD = 80;
  const draw_w = CW - 2 * PAD;
  const draw_h = draw_w / top_aspect;
  const ox = PAD;
  const oy = (CH - draw_h) / 2;

  // Top-view body outline — slightly tapered front and rear
  const front_taper = body_type === "fastback" ? 0.06 : 0.04;
  const rear_taper  = body_type === "fastback" ? 0.04 :
                      body_type === "estate" ? 0.02 : 0.05;

  const bodyL = ox;
  const bodyR = ox + draw_w;
  const bodyT = oy;
  const bodyB = oy + draw_h;
  const insetT = draw_w * front_taper;
  const insetR = draw_w * rear_taper;
  const cabinT = oy + draw_h * 0.05;
  const cabinB = oy + draw_h * 0.95;

  const bodyPath = `
    M ${(bodyL + insetT).toFixed(1)} ${bodyT.toFixed(1)}
    L ${(bodyR - insetR).toFixed(1)} ${bodyT.toFixed(1)}
    Q ${bodyR.toFixed(1)} ${bodyT.toFixed(1)} ${bodyR.toFixed(1)} ${cabinT.toFixed(1)}
    L ${bodyR.toFixed(1)} ${cabinB.toFixed(1)}
    Q ${bodyR.toFixed(1)} ${bodyB.toFixed(1)} ${(bodyR - insetR).toFixed(1)} ${bodyB.toFixed(1)}
    L ${(bodyL + insetT).toFixed(1)} ${bodyB.toFixed(1)}
    Q ${bodyL.toFixed(1)} ${bodyB.toFixed(1)} ${bodyL.toFixed(1)} ${cabinB.toFixed(1)}
    L ${bodyL.toFixed(1)} ${cabinT.toFixed(1)}
    Q ${bodyL.toFixed(1)} ${bodyT.toFixed(1)} ${(bodyL + insetT).toFixed(1)} ${bodyT.toFixed(1)}
    Z
  `;

  // Wheels — 4 wheels at corners, positioned by wheelbase + track
  const wbPx = draw_w * wheelbase_norm;
  const wb_offset = (draw_w - wbPx) / 2;
  const trackPx = draw_h * wheel_track;
  const wheel_w = draw_h * 0.06;
  const wheel_h = draw_w * 0.045;

  const wheels = [
    { x: ox + wb_offset, y: oy + (draw_h - trackPx) / 2 },              // FL
    { x: ox + wb_offset, y: oy + draw_h - (draw_h - trackPx) / 2 },     // RL
    { x: ox + wb_offset + wbPx, y: oy + (draw_h - trackPx) / 2 },        // FR
    { x: ox + wb_offset + wbPx, y: oy + draw_h - (draw_h - trackPx) / 2 }, // RR
  ];

  // Cabin/glass area
  const cabinX1 = ox + draw_w * 0.32;
  const cabinX2 = ox + draw_w * 0.78;
  const cabinY1 = oy + draw_h * 0.18;
  const cabinY2 = oy + draw_h * 0.82;

  return (
    <svg width={CW} height={CH} viewBox={`0 0 ${CW} ${CH}`}
      style={{ background: "#04070d", borderRadius: 6, display: "block" }}>

      <path d={bodyPath} fill="rgba(4,10,18,0.96)"
        stroke="rgba(255,255,255,0.92)" strokeWidth="1.4"
        strokeLinejoin="round" strokeLinecap="round" />

      {/* Cabin / windscreen / rear window region */}
      <rect x={cabinX1} y={cabinY1} width={cabinX2 - cabinX1} height={cabinY2 - cabinY1}
        fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="0.6" rx="3" />
      {/* Windscreen line */}
      <line x1={cabinX1} y1={cabinY1} x2={cabinX1 + 15} y2={cabinY1 - 8}
        stroke="rgba(255,255,255,0.10)" strokeWidth="0.5" />
      <line x1={cabinX1} y1={cabinY2} x2={cabinX1 + 15} y2={cabinY2 + 8}
        stroke="rgba(255,255,255,0.10)" strokeWidth="0.5" />
      {/* Rear window */}
      <line x1={cabinX2} y1={cabinY1} x2={cabinX2 - 12} y2={cabinY1 - 6}
        stroke="rgba(255,255,255,0.10)" strokeWidth="0.5" />
      <line x1={cabinX2} y1={cabinY2} x2={cabinX2 - 12} y2={cabinY2 + 6}
        stroke="rgba(255,255,255,0.10)" strokeWidth="0.5" />

      {/* Mirrors */}
      <ellipse cx={cabinX1 - 6} cy={cabinY1 + 8} rx={3} ry={4}
        fill="rgba(255,255,255,0.12)" />
      <ellipse cx={cabinX1 - 6} cy={cabinY2 - 8} rx={3} ry={4}
        fill="rgba(255,255,255,0.12)" />

      {/* 4 Wheels */}
      {wheels.map((w, i) => (
        <ellipse key={i} cx={w.x} cy={w.y} rx={wheel_h} ry={wheel_w}
          fill="rgba(20,20,20,0.9)"
          stroke="rgba(255,255,255,0.55)" strokeWidth="1" />
      ))}

      {/* Centre dashed line */}
      <line x1={ox} y1={oy + draw_h / 2} x2={ox + draw_w} y2={oy + draw_h / 2}
        stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" strokeDasharray="3,4" />

      <text x={CW / 2} y={CH - 5} textAnchor="middle" fill="rgba(255,255,255,0.10)"
        fontSize="8" fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.10em">
        TOP · {carDims?.car_id || body_type.toUpperCase()}
      </text>

      {carDims?.overall_length_mm && (
        <text x={ox + draw_w / 2} y={CH - 20} textAnchor="middle"
          fill="rgba(255,255,255,0.4)" fontSize="9"
          fontFamily="'IBM Plex Mono',monospace">
          L {carDims.overall_length_mm} mm · W {carDims.overall_width_mm} mm · WB {carDims.wheelbase_mm} mm
        </text>
      )}
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// UNDERSIDE VIEW — uses car_dimensions for proper geometry
// ═══════════════════════════════════════════════════════════════════════════════
function UnderView({ geo, carDims }) {
  const CW = 1080, CH = 380;
  const under_aspect  = carDims?.under_aspect || 2.5;
  const wheel_track   = carDims?.wheel_track_norm || 0.85;
  const wheelbase_norm= carDims?.wheelbase_norm || 0.60;
  const body_type     = (carDims?.body_type || geo?.bodyType || "notchback").toLowerCase();

  const PAD = 80;
  const draw_w = CW - 2 * PAD;
  const draw_h = draw_w / under_aspect;
  const ox = PAD;
  const oy = (CH - draw_h) / 2;

  const bodyL = ox;
  const bodyR = ox + draw_w;
  const bodyT = oy;
  const bodyB = oy + draw_h;

  // Underside has a similar outline to top but with mechanical features visible
  const bodyPath = `
    M ${(bodyL + draw_w * 0.04).toFixed(1)} ${bodyT.toFixed(1)}
    L ${(bodyR - draw_w * 0.04).toFixed(1)} ${bodyT.toFixed(1)}
    Q ${bodyR.toFixed(1)} ${bodyT.toFixed(1)} ${bodyR.toFixed(1)} ${(bodyT + draw_h * 0.10).toFixed(1)}
    L ${bodyR.toFixed(1)} ${(bodyB - draw_h * 0.10).toFixed(1)}
    Q ${bodyR.toFixed(1)} ${bodyB.toFixed(1)} ${(bodyR - draw_w * 0.04).toFixed(1)} ${bodyB.toFixed(1)}
    L ${(bodyL + draw_w * 0.04).toFixed(1)} ${bodyB.toFixed(1)}
    Q ${bodyL.toFixed(1)} ${bodyB.toFixed(1)} ${bodyL.toFixed(1)} ${(bodyB - draw_h * 0.10).toFixed(1)}
    L ${bodyL.toFixed(1)} ${(bodyT + draw_h * 0.10).toFixed(1)}
    Q ${bodyL.toFixed(1)} ${bodyT.toFixed(1)} ${(bodyL + draw_w * 0.04).toFixed(1)} ${bodyT.toFixed(1)}
    Z
  `;

  // 4 wheels
  const wbPx = draw_w * wheelbase_norm;
  const wb_offset = (draw_w - wbPx) / 2;
  const trackPx = draw_h * wheel_track;
  const wheel_h = draw_w * 0.045;
  const wheel_w = draw_h * 0.07;
  const wheels = [
    { x: ox + wb_offset, y: oy + (draw_h - trackPx) / 2 },
    { x: ox + wb_offset, y: oy + draw_h - (draw_h - trackPx) / 2 },
    { x: ox + wb_offset + wbPx, y: oy + (draw_h - trackPx) / 2 },
    { x: ox + wb_offset + wbPx, y: oy + draw_h - (draw_h - trackPx) / 2 },
  ];

  // Engine/transmission/axle hints (underbody features)
  // Engine block (front)
  const engineX = ox + draw_w * 0.10;
  const engineW = draw_w * 0.18;
  const engineY = oy + draw_h * 0.30;
  const engineH = draw_h * 0.40;

  // Drive shaft (centre)
  const shaftY = oy + draw_h / 2;

  // Exhaust (rear)
  const exhaustY = oy + draw_h * 0.55;

  // Fuel tank / battery (between rear wheels)
  const tankX = ox + wb_offset + wbPx * 0.55;
  const tankW = wbPx * 0.30;
  const tankY = oy + draw_h * 0.25;
  const tankH = draw_h * 0.50;

  return (
    <svg width={CW} height={CH} viewBox={`0 0 ${CW} ${CH}`}
      style={{ background: "#04070d", borderRadius: 6, display: "block" }}>

      <path d={bodyPath} fill="rgba(4,10,18,0.96)"
        stroke="rgba(255,255,255,0.92)" strokeWidth="1.4"
        strokeLinejoin="round" strokeLinecap="round" />

      {/* Engine block */}
      <rect x={engineX} y={engineY} width={engineW} height={engineH}
        fill="rgba(255,255,255,0.04)"
        stroke="rgba(255,255,255,0.20)" strokeWidth="0.6" rx="3" />

      {/* Drive shaft */}
      <line x1={engineX + engineW} y1={shaftY}
        x2={ox + wb_offset + wbPx * 0.85} y2={shaftY}
        stroke="rgba(255,255,255,0.18)" strokeWidth="2" />

      {/* Fuel tank / battery pack */}
      <rect x={tankX} y={tankY} width={tankW} height={tankH}
        fill="rgba(255,255,255,0.02)"
        stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" rx="2" strokeDasharray="3,2" />

      {/* Exhaust pipe */}
      <line x1={ox + draw_w * 0.40} y1={exhaustY}
        x2={ox + draw_w * 0.95} y2={exhaustY}
        stroke="rgba(255,255,255,0.12)" strokeWidth="1" strokeDasharray="2,2" />

      {/* 4 Wheels */}
      {wheels.map((w, i) => (
        <g key={i}>
          <ellipse cx={w.x} cy={w.y} rx={wheel_h} ry={wheel_w}
            fill="rgba(15,15,15,0.9)"
            stroke="rgba(255,255,255,0.5)" strokeWidth="1" />
          <ellipse cx={w.x} cy={w.y} rx={wheel_h * 0.4} ry={wheel_w * 0.4}
            fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="0.4" />
        </g>
      ))}

      {/* Front and rear axles */}
      <line x1={wheels[0].x} y1={wheels[0].y} x2={wheels[2].x} y2={wheels[2].y}
        stroke="rgba(255,255,255,0.08)" strokeWidth="0.8" />
      <line x1={wheels[1].x} y1={wheels[1].y} x2={wheels[3].x} y2={wheels[3].y}
        stroke="rgba(255,255,255,0.08)" strokeWidth="0.8" />

      <text x={CW / 2} y={CH - 5} textAnchor="middle" fill="rgba(255,255,255,0.10)"
        fontSize="8" fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.10em">
        UNDERSIDE · {carDims?.car_id || body_type.toUpperCase()}
      </text>

      {carDims?.wheelbase_mm && (
        <text x={ox + draw_w / 2} y={CH - 20} textAnchor="middle"
          fill="rgba(255,255,255,0.4)" fontSize="9"
          fontFamily="'IBM Plex Mono',monospace">
          WB {carDims.wheelbase_mm} mm · Track {carDims.track_width_mm} mm
        </text>
      )}
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════
export default function Views2DPage() {
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [imageUrl, setImageUrl] = useState("");
  const [analysisMode, setAnalysisMode] = useState("A");
  const [analysing, setAnalysing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [result, setResult] = useState(null);
  const [activeView, setActiveView] = useState("Side");
  const [error, setError] = useState(null);

  // Comparison state
  const [carHistory, setCarHistory] = useState([null, null]); // [A, B]
  const [comparisonMode, setComparisonMode] = useState(false);
  const [comparison, setComparison] = useState(null);
  const [comparing, setComparing] = useState(false);

  // Run counter
  const [runCount, setRunCount] = useState(0);

  const fileInputRef = useRef(null);

  // ─── File upload ─────────────────────────────────────────────────────────────
  const handleFile = useCallback((file) => {
    if (!file) return;
    setImageFile(file);
    setImageUrl("");
    setError(null);
    setResult(null);
    const reader = new FileReader();
    reader.onload = (e) => setImagePreview(e.target.result);
    reader.readAsDataURL(file);
  }, []);

  const handleUrlLoad = useCallback(async () => {
    if (!imageUrl) return;
    setAnalysing(true);
    setProgressMsg("Fetching image…");
    try {
      const blob = await fetchImageFromUrl(imageUrl);
      const file = new File([blob], "url-image.jpg", { type: blob.type || "image/jpeg" });
      handleFile(file);
    } catch (e) {
      setError(`URL fetch failed: ${e.message}`);
    } finally {
      setAnalysing(false);
      setProgressMsg("");
    }
  }, [imageUrl, handleFile]);

  // ─── Analyse vehicle ─────────────────────────────────────────────────────────
  const analyseVehicle = useCallback(async () => {
    if (!imageFile) {
      setError("Please upload an image first");
      return;
    }
    setAnalysing(true);
    setError(null);
    setProgress(0);
    setProgressMsg("Starting…");
    setResult(null);

    try {
      // Start the job
      const fd = new FormData();
      fd.append("image", imageFile);
      fd.append("mode", analysisMode);
      const startResp = await fetch(`${API_BASE}/analyze-contour/start`, {
        method: "POST", body: fd,
      });
      if (!startResp.ok) throw new Error(`Start failed: HTTP ${startResp.status}`);
      const { job_id } = await startResp.json();
      if (!job_id) throw new Error("No job_id returned");

      // Poll for result
      const poll = async () => {
        const r = await fetch(`${API_BASE}/analyze-contour/result/${job_id}`);
        if (!r.ok) throw new Error(`Poll failed: HTTP ${r.status}`);
        return r.json();
      };

      let final = null;
      for (let i = 0; i < 200; i++) {  // up to ~10 minutes
        await new Promise(res => setTimeout(res, 3000));
        const data = await poll();
        if (data.status === "running") {
          if (data.last_event) {
            setProgress(data.last_event.pct || 0);
            setProgressMsg(data.last_event.msg || "Processing…");
          }
        } else if (data.status === "done") {
          final = data.result;
          break;
        } else if (data.status === "error") {
          throw new Error(data.error || "Analysis failed");
        }
      }
      if (!final) throw new Error("Analysis timeout");

      setResult(final);
      setRunCount(c => c + 1);
      setProgress(100);
      setProgressMsg("Done");
    } catch (e) {
      setError(e.message || "Analysis failed");
    } finally {
      setAnalysing(false);
    }
  }, [imageFile, analysisMode]);

  // ─── Save Car A / B ──────────────────────────────────────────────────────────
  const saveAs = useCallback((slot) => {
    if (!result) return;
    const entry = {
      pts: result.technical_outline_pts,
      geo: result.geometry,
      car_dims: result.car_dimensions,
      preview: imagePreview,
      method: result.method,
      keypoints: result.keypoints,
      saved_at: new Date().toISOString(),
    };
    const newHistory = [...carHistory];
    newHistory[slot] = entry;
    setCarHistory(newHistory);
  }, [result, imagePreview, carHistory]);

  // ─── Compare A vs B ──────────────────────────────────────────────────────────
  const runComparison = useCallback(async () => {
    if (!carHistory[0] || !carHistory[1]) {
      setError("Save both Car A and Car B first");
      return;
    }
    setComparing(true);
    setError(null);
    try {
      const resp = await fetch(`${API_BASE}/compare-contours`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pts_a: carHistory[0].pts,
          pts_b: carHistory[1].pts,
          geo_a: carHistory[0].geo,
          geo_b: carHistory[1].geo,
        }),
      });
      if (!resp.ok) throw new Error(`Compare failed: HTTP ${resp.status}`);
      const data = await resp.json();
      setComparison(data);
      setComparisonMode(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setComparing(false);
    }
  }, [carHistory]);

  const exitComparison = () => {
    setComparisonMode(false);
    setComparison(null);
  };

  const clearHistory = () => {
    setCarHistory([null, null]);
    setComparisonMode(false);
    setComparison(null);
  };

  // ─── Export SVG ──────────────────────────────────────────────────────────────
  const exportSvg = () => {
    if (!result?.outline_svg) return;
    const blob = new Blob([result.outline_svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `outline_${Date.now()}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── Derived values ──────────────────────────────────────────────────────────
  // For SideView, attach quality + wheels to geo
  const geoForSide = useMemo(() => {
    if (!result) return null;
    return {
      ...result.geometry,
      _quality: result.quality,
      _wheels: result.keypoints?.wheels || [],
    };
  }, [result]);

  const contourPts = comparisonMode ? carHistory[0]?.pts : result?.technical_outline_pts;
  const contourPtsB = comparisonMode ? carHistory[1]?.pts : null;
  const carDims = comparisonMode ? carHistory[0]?.car_dims : result?.car_dimensions;
  const geoToUse = comparisonMode ? carHistory[0]?.geo : geoForSide;

  // ─── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "320px 1fr 360px",
      height: "100vh",
      background: "#000",
      color: "#fff",
      fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
      overflow: "hidden",
    }}>
      {/* ═══ LEFT PANEL ═══ */}
      <div style={{ padding: "16px", overflowY: "auto", borderRight: "1px solid rgba(255,255,255,0.06)" }}>
        {/* 01. UPLOAD */}
        <div style={{ display: "flex", justifyContent: "space-between",
          alignItems: "baseline", marginBottom: 8 }}>
          <span style={{ color: "#409cff", fontSize: 11, fontFamily: "'IBM Plex Mono'" }}>01</span>
          <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, letterSpacing: "0.1em" }}>UPLOAD</span>
        </div>
        <div
          onClick={() => fileInputRef.current?.click()}
          style={{
            width: "100%", height: 180,
            background: imagePreview ? `url(${imagePreview})` : "rgba(255,255,255,0.03)",
            backgroundSize: "contain", backgroundPosition: "center", backgroundRepeat: "no-repeat",
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: 6,
            cursor: "pointer", position: "relative", marginBottom: 10,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
          {!imagePreview && (
            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11 }}>Click to upload image</div>
          )}
          {imagePreview && (
            <div style={{
              position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)",
              background: "rgba(0,0,0,0.55)", padding: "3px 10px", borderRadius: 12,
              fontSize: 10, color: "rgba(255,255,255,0.85)",
            }}>click to change</div>
          )}
          <input ref={fileInputRef} type="file" accept="image/*"
            onChange={(e) => handleFile(e.target.files[0])}
            style={{ display: "none" }} />
        </div>

        {/* URL Input */}
        <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
          <input
            type="url"
            placeholder="🔗 Load from URL"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            style={{
              flex: 1, padding: "6px 8px", fontSize: 10,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.10)", color: "#fff",
              borderRadius: 4, fontFamily: "'IBM Plex Mono'",
            }} />
          <button onClick={handleUrlLoad} disabled={!imageUrl}
            style={{
              padding: "6px 10px", fontSize: 10,
              background: imageUrl ? "rgba(64,156,255,0.2)" : "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.10)",
              color: imageUrl ? "#409cff" : "rgba(255,255,255,0.3)",
              borderRadius: 4, cursor: imageUrl ? "pointer" : "default",
            }}>Load</button>
        </div>

        {imageFile && (
          <div style={{
            background: "rgba(255,255,255,0.04)", padding: "5px 8px",
            borderRadius: 4, fontSize: 10, color: "rgba(255,255,255,0.7)",
            display: "flex", justifyContent: "space-between", marginBottom: 14,
            fontFamily: "'IBM Plex Mono'",
          }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {imageFile.name.length > 22 ? imageFile.name.slice(0, 19) + "…" : imageFile.name}
            </span>
            <span>{(imageFile.size / 1024).toFixed(0)} KB</span>
          </div>
        )}

        {/* ANALYSIS MODE */}
        <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 10,
          letterSpacing: "0.1em", marginBottom: 6 }}>ANALYSIS MODE</div>
        {[
          { key: "A", title: "Silhouette", sub: "~30s · outline only", icon: "◎" },
          { key: "B", title: "Panels", sub: "~90s · lines + markers", icon: "⊞" },
          { key: "C", title: "Full Aero", sub: "~150s · panels + ΔCd + ID", icon: "⬡" },
        ].map(m => (
          <div key={m.key}
            onClick={() => setAnalysisMode(m.key)}
            style={{
              padding: "10px 12px", marginBottom: 5,
              background: analysisMode === m.key ? "rgba(64,156,255,0.10)" : "rgba(255,255,255,0.02)",
              border: `1px solid ${analysisMode === m.key ? "rgba(64,156,255,0.35)" : "rgba(255,255,255,0.06)"}`,
              borderRadius: 6, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 10,
            }}>
            <span style={{ fontSize: 14, color: analysisMode === m.key ? "#409cff" : "rgba(255,255,255,0.4)" }}>
              {m.icon}
            </span>
            <div>
              <div style={{ color: analysisMode === m.key ? "#409cff" : "#fff",
                fontSize: 12, fontWeight: 500 }}>{m.title}</div>
              <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 9 }}>{m.sub}</div>
            </div>
          </div>
        ))}

        {/* ANALYSE BUTTON */}
        <button
          onClick={analyseVehicle}
          disabled={!imageFile || analysing}
          style={{
            width: "100%", padding: "10px",
            marginTop: 14,
            background: imageFile && !analysing ? "#409cff" : "rgba(255,255,255,0.06)",
            color: imageFile && !analysing ? "#fff" : "rgba(255,255,255,0.4)",
            border: "none", borderRadius: 6,
            fontSize: 12, fontWeight: 600, cursor: imageFile && !analysing ? "pointer" : "default",
          }}>
          {analysing ? `▷ Analysing… ${progress}%` : "▷ Analyse Vehicle"}
        </button>

        {analysing && (
          <div style={{ marginTop: 10 }}>
            <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${progress}%`, background: "#409cff",
                transition: "width 0.4s ease" }} />
            </div>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 9,
              marginTop: 4, fontFamily: "'IBM Plex Mono'" }}>
              {progressMsg}
            </div>
          </div>
        )}

        {error && (
          <div style={{
            padding: "8px 10px", marginTop: 12,
            background: "rgba(255,69,58,0.10)", border: "1px solid rgba(255,69,58,0.4)",
            borderRadius: 4, color: "#ff453a", fontSize: 10,
          }}>{error}</div>
        )}

        {/* COMPARISON CONTROLS */}
        <div style={{ marginTop: 18 }}>
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 10,
            letterSpacing: "0.1em", marginBottom: 6,
            display: "flex", justifyContent: "space-between" }}>
            <span>COMPARISON</span>
            {(carHistory[0] || carHistory[1]) && (
              <span onClick={clearHistory} style={{ cursor: "pointer", color: "#ff9f0a" }}>clear</span>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <button
              onClick={() => saveAs(0)}
              disabled={!result}
              style={{
                padding: "8px 4px",
                background: carHistory[0] ? "rgba(64,156,255,0.2)" :
                  result ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.02)",
                border: `1px solid ${carHistory[0] ? "rgba(64,156,255,0.4)" : "rgba(255,255,255,0.10)"}`,
                color: carHistory[0] ? "#409cff" : result ? "#fff" : "rgba(255,255,255,0.3)",
                borderRadius: 4, fontSize: 10, cursor: result ? "pointer" : "default",
              }}>
              {carHistory[0] ? "✓ Car A saved" : "Save as Car A"}
            </button>
            <button
              onClick={() => saveAs(1)}
              disabled={!result || !carHistory[0]}
              style={{
                padding: "8px 4px",
                background: carHistory[1] ? "rgba(64,156,255,0.2)" :
                  (result && carHistory[0]) ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.02)",
                border: `1px solid ${carHistory[1] ? "rgba(64,156,255,0.4)" : "rgba(255,255,255,0.10)"}`,
                color: carHistory[1] ? "#409cff" : (result && carHistory[0]) ? "#fff" : "rgba(255,255,255,0.3)",
                borderRadius: 4, fontSize: 10,
                cursor: (result && carHistory[0]) ? "pointer" : "default",
              }}>
              {carHistory[1] ? "✓ Car B saved" : "Save as Car B"}
            </button>
          </div>

          {carHistory[0] && (
            <div style={{ marginTop: 6, padding: "5px 7px",
              background: "rgba(255,255,255,0.02)",
              borderRadius: 3, fontSize: 9, color: "rgba(255,255,255,0.6)",
              fontFamily: "'IBM Plex Mono'" }}>
              A: {carHistory[0].car_dims?.car_id || "—"} · Cd {carHistory[0].geo?.Cd}
            </div>
          )}
          {carHistory[1] && (
            <div style={{ marginTop: 4, padding: "5px 7px",
              background: "rgba(255,255,255,0.02)",
              borderRadius: 3, fontSize: 9, color: "rgba(64,156,255,0.7)",
              fontFamily: "'IBM Plex Mono'" }}>
              B: {carHistory[1].car_dims?.car_id || "—"} · Cd {carHistory[1].geo?.Cd}
            </div>
          )}

          {!comparisonMode ? (
            <button
              onClick={runComparison}
              disabled={!carHistory[0] || !carHistory[1] || comparing}
              style={{
                width: "100%", padding: "8px", marginTop: 8,
                background: (carHistory[0] && carHistory[1] && !comparing) ? "rgba(255,69,58,0.2)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${(carHistory[0] && carHistory[1]) ? "rgba(255,69,58,0.4)" : "rgba(255,255,255,0.10)"}`,
                color: (carHistory[0] && carHistory[1]) ? "#ff453a" : "rgba(255,255,255,0.3)",
                borderRadius: 4, fontSize: 10, fontWeight: 600,
                cursor: (carHistory[0] && carHistory[1] && !comparing) ? "pointer" : "default",
              }}>
              {comparing ? "Computing…" : "▷ Compare A vs B"}
            </button>
          ) : (
            <button
              onClick={exitComparison}
              style={{
                width: "100%", padding: "8px", marginTop: 8,
                background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)",
                color: "#fff", borderRadius: 4, fontSize: 10, cursor: "pointer",
              }}>
              ✕ Exit Comparison
            </button>
          )}
        </div>

        {/* 02. RESULT */}
        {result && !comparisonMode && (
          <div style={{ marginTop: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between",
              alignItems: "baseline", marginBottom: 6 }}>
              <span style={{ color: "#409cff", fontSize: 11, fontFamily: "'IBM Plex Mono'" }}>02</span>
              <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, letterSpacing: "0.1em" }}>RESULT</span>
            </div>
            <div style={{ background: "rgba(255,255,255,0.02)",
              borderRadius: 6, padding: "10px",
              border: "1px solid rgba(255,255,255,0.06)" }}>
              {[
                ["Method", result.method],
                ["Points", `${result.technical_outline_pts?.length || 0} pt`],
                ["Wheels", `${result.keypoints?.wheels?.length || 0} found`],
                ["Aspect", fmt(result.geometry?.aspectRatio)],
                ["WS rake", `${fmt(result.geometry?.wsAngleDeg, 0)}°`],
                ["Rear slant", `${fmt(result.geometry?.rearSlantAngleDeg, 0)}°`],
                ["Ahmed", result.geometry?.ahmedRegime],
                ["Cd est.", fmt(result.geometry?.Cd, 3)],
                ["CdA", fmt(result.geometry?.CdA, 4)],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between",
                  fontSize: 11, padding: "4px 0",
                  borderBottom: "0.5px solid rgba(255,255,255,0.04)" }}>
                  <span style={{ color: "rgba(255,255,255,0.55)" }}>{k}</span>
                  <span style={{ color: "#409cff", fontFamily: "'IBM Plex Mono'" }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ═══ CENTRE PANEL ═══ */}
      <div style={{ padding: "16px", overflow: "hidden",
        display: "flex", flexDirection: "column" }}>
        {/* View tabs */}
        <div style={{ display: "flex", gap: 6, marginBottom: 12,
          alignItems: "center" }}>
          {["Side", "Front", "Top", "Underside"].map(v => (
            <div
              key={v}
              onClick={() => setActiveView(v)}
              style={{
                padding: "6px 16px", borderRadius: 16,
                background: activeView === v ? "rgba(64,156,255,0.15)" : "transparent",
                border: `1px solid ${activeView === v ? "rgba(64,156,255,0.40)" : "rgba(255,255,255,0.08)"}`,
                color: activeView === v ? "#409cff" : "rgba(255,255,255,0.55)",
                fontSize: 11, cursor: "pointer", fontFamily: "'IBM Plex Mono'",
              }}>{v}</div>
          ))}
          {comparisonMode && (
            <div style={{
              padding: "6px 14px", marginLeft: 8,
              background: "rgba(255,69,58,0.15)", borderRadius: 16,
              border: "1px solid rgba(255,69,58,0.4)",
              color: "#ff453a", fontSize: 11, fontFamily: "'IBM Plex Mono'",
            }}>● Comparison Mode</div>
          )}
          <div style={{ flex: 1 }} />
          {result?.outline_svg && !comparisonMode && (
            <div onClick={exportSvg}
              style={{
                color: "rgba(255,255,255,0.5)", fontSize: 10, cursor: "pointer",
                padding: "4px 10px", border: "1px solid rgba(255,255,255,0.10)",
                borderRadius: 4,
              }}>Export SVG</div>
          )}
        </div>

        {/* Main canvas */}
        <div style={{
          flex: 1, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
        }}>
          {activeView === "Side" && (
            <SideView
              contourPts={contourPts}
              contourPtsB={contourPtsB}
              geo={geoToUse}
              method={result?.method || carHistory[0]?.method || "—"}
              comparisonMode={comparisonMode}
              comparison={comparison}
            />
          )}
          {activeView === "Front" && <FrontView geo={geoToUse} carDims={carDims} />}
          {activeView === "Top" && <TopView geo={geoToUse} carDims={carDims} />}
          {activeView === "Underside" && <UnderView geo={geoToUse} carDims={carDims} />}
        </div>

        {/* Bottom thumbnail strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
          gap: 8, marginTop: 10 }}>
          {["Side", "Front", "Top", "Underside"].map(v => (
            <div key={v}
              onClick={() => setActiveView(v)}
              style={{
                background: activeView === v ? "rgba(64,156,255,0.08)" : "rgba(4,7,13,1)",
                border: `1px solid ${activeView === v ? "rgba(64,156,255,0.4)" : "rgba(255,255,255,0.06)"}`,
                borderRadius: 6, height: 100, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "rgba(255,255,255,0.30)", fontSize: 10,
                position: "relative",
              }}>
              <span style={{ position: "absolute", bottom: 6, left: "50%",
                transform: "translateX(-50%)",
                color: activeView === v ? "#409cff" : "rgba(255,255,255,0.5)",
                fontSize: 10, fontFamily: "'IBM Plex Mono'" }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ RIGHT PANEL ═══ */}
      <div style={{ padding: "16px", overflowY: "auto",
        borderLeft: "1px solid rgba(255,255,255,0.06)" }}>

        {/* COMPARISON RESULTS */}
        {comparisonMode && comparison && (
          <div>
            <div style={{ color: "#ff453a", fontSize: 11, fontFamily: "'IBM Plex Mono'",
              marginBottom: 8, letterSpacing: "0.1em" }}>COMPARISON RESULT</div>
            <div style={{ background: "rgba(255,69,58,0.08)", padding: 10, borderRadius: 6,
              border: "1px solid rgba(255,69,58,0.25)" }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#ff453a",
                fontFamily: "'IBM Plex Mono'" }}>
                {comparison.overlap_pct}%
              </div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)" }}>Geometric similarity</div>
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 10, marginBottom: 6 }}>
                Region Deviations
              </div>
              {Object.entries(comparison.region_deviations || {}).map(([region, dev]) => (
                <div key={region} style={{ display: "flex", justifyContent: "space-between",
                  fontSize: 11, padding: "4px 0",
                  borderBottom: "0.5px solid rgba(255,255,255,0.04)" }}>
                  <span style={{ color: "rgba(255,255,255,0.7)" }}>{region}</span>
                  <span style={{ color: dev > 0.05 ? "#ff453a" : "#409cff",
                    fontFamily: "'IBM Plex Mono'" }}>
                    {fmt(dev, 4)}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 14, padding: 10,
              background: "rgba(255,255,255,0.02)", borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ display: "flex", justifyContent: "space-between",
                fontSize: 11, padding: "3px 0" }}>
                <span style={{ color: "rgba(255,255,255,0.55)" }}>Cd delta</span>
                <span style={{ color: "#409cff", fontFamily: "'IBM Plex Mono'" }}>
                  {comparison.cd_delta > 0 ? "+" : ""}{fmt(comparison.cd_delta, 3)}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between",
                fontSize: 11, padding: "3px 0" }}>
                <span style={{ color: "rgba(255,255,255,0.55)" }}>Roof delta</span>
                <span style={{ color: "#409cff", fontFamily: "'IBM Plex Mono'" }}>{fmt(comparison.roofline_delta, 4)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between",
                fontSize: 11, padding: "3px 0" }}>
                <span style={{ color: "rgba(255,255,255,0.55)" }}>Taper delta</span>
                <span style={{ color: "#409cff", fontFamily: "'IBM Plex Mono'" }}>{fmt(comparison.taper_delta, 4)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between",
                fontSize: 11, padding: "3px 0" }}>
                <span style={{ color: "rgba(255,255,255,0.55)" }}>Frontal delta</span>
                <span style={{ color: "#409cff", fontFamily: "'IBM Plex Mono'" }}>{fmt(comparison.frontal_delta, 4)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between",
                fontSize: 11, padding: "3px 0" }}>
                <span style={{ color: "rgba(255,255,255,0.55)" }}>Mean dev.</span>
                <span style={{ color: "#409cff", fontFamily: "'IBM Plex Mono'" }}>{fmt(comparison.mean_deviation, 4)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between",
                fontSize: 11, padding: "3px 0" }}>
                <span style={{ color: "rgba(255,255,255,0.55)" }}>Max dev.</span>
                <span style={{ color: "#ff453a", fontFamily: "'IBM Plex Mono'" }}>{fmt(comparison.max_deviation, 4)}</span>
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 10, marginBottom: 6 }}>
                Cars
              </div>
              <div style={{ padding: 8, background: "rgba(255,255,255,0.02)",
                borderRadius: 4, marginBottom: 6, fontSize: 10 }}>
                <div style={{ color: "#fff", marginBottom: 2 }}>
                  ⚪ A: {carHistory[0]?.car_dims?.car_id || "Unknown"}
                </div>
                <div style={{ color: "rgba(255,255,255,0.55)", fontFamily: "'IBM Plex Mono'", fontSize: 9 }}>
                  {carHistory[0]?.geo?.bodyType} · Cd {carHistory[0]?.geo?.Cd}
                </div>
              </div>
              <div style={{ padding: 8, background: "rgba(64,156,255,0.05)",
                borderRadius: 4, fontSize: 10 }}>
                <div style={{ color: "#409cff", marginBottom: 2 }}>
                  🔵 B: {carHistory[1]?.car_dims?.car_id || "Unknown"}
                </div>
                <div style={{ color: "rgba(255,255,255,0.55)", fontFamily: "'IBM Plex Mono'", fontSize: 9 }}>
                  {carHistory[1]?.geo?.bodyType} · Cd {carHistory[1]?.geo?.Cd}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SINGLE CAR RESULTS */}
        {!comparisonMode && result && (
          <>
            {/* 03. WHEELS */}
            <div style={{ display: "flex", justifyContent: "space-between",
              alignItems: "baseline", marginBottom: 6 }}>
              <span style={{ color: "#409cff", fontSize: 11, fontFamily: "'IBM Plex Mono'" }}>03</span>
            </div>
            {result.keypoints?.wheels?.map((w, i) => (
              <div key={i} style={{ background: "rgba(255,255,255,0.02)",
                borderRadius: 6, padding: 10, marginBottom: 8,
                border: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ color: "#409cff", fontSize: 11,
                  fontFamily: "'IBM Plex Mono'", marginBottom: 4 }}>
                  Wheel {i + 1}
                </div>
                {[["cx", pct(w.nx, 1)], ["cy", pct(w.ny, 1)],
                  ["r", pct(w.nr, 1)]].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between",
                    fontSize: 10, padding: "2px 0" }}>
                    <span style={{ color: "rgba(255,255,255,0.5)" }}>{k}</span>
                    <span style={{ color: "rgba(255,255,255,0.85)",
                      fontFamily: "'IBM Plex Mono'" }}>{v}</span>
                  </div>
                ))}
              </div>
            ))}

            {/* 04. CAR ID */}
            {result.car_dimensions && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between",
                  alignItems: "baseline", marginBottom: 6, marginTop: 10 }}>
                  <span style={{ color: "#409cff", fontSize: 11, fontFamily: "'IBM Plex Mono'" }}>04</span>
                  <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 10,
                    letterSpacing: "0.1em" }}>CAR ID</span>
                </div>
                <div style={{ background: "rgba(255,255,255,0.02)",
                  borderRadius: 6, padding: 10, marginBottom: 8,
                  border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", marginBottom: 6 }}>
                    {result.car_dimensions.car_id}
                  </div>
                  {[
                    ["Body", result.car_dimensions.body_type],
                    ["Year", result.car_dimensions.year],
                    ["Length", `${result.car_dimensions.overall_length_mm} mm`],
                    ["Width", `${result.car_dimensions.overall_width_mm} mm`],
                    ["Height", `${result.car_dimensions.overall_height_mm} mm`],
                    ["Wheelbase", `${result.car_dimensions.wheelbase_mm} mm`],
                    ["Track", `${result.car_dimensions.track_width_mm} mm`],
                    ["Cd (db)", fmt(result.car_dimensions.drag_cd, 3)],
                    ["Conf.", pct(result.car_dimensions.confidence, 0)],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between",
                      fontSize: 10, padding: "2px 0",
                      borderBottom: "0.5px solid rgba(255,255,255,0.03)" }}>
                      <span style={{ color: "rgba(255,255,255,0.5)" }}>{k}</span>
                      <span style={{ color: "rgba(255,255,255,0.85)",
                        fontFamily: "'IBM Plex Mono'" }}>{v}</span>
                    </div>
                  ))}
                  <div style={{ marginTop: 6, fontSize: 8, color: "rgba(255,255,255,0.35)",
                    fontFamily: "'IBM Plex Mono'", fontStyle: "italic" }}>
                    {result.car_dimensions.source}
                  </div>
                </div>
              </>
            )}

            {/* GEOMETRY */}
            <div style={{ background: "rgba(255,255,255,0.02)",
              borderRadius: 6, padding: 10, marginBottom: 8,
              border: "1px solid rgba(255,255,255,0.06)" }}>
              {[
                ["Hood", pct(result.geometry?.hoodRatio)],
                ["Cabin", pct(result.geometry?.cabinRatio)],
                ["Boot", pct(result.geometry?.bootRatio)],
                ["Aspect", fmt(result.geometry?.aspectRatio)],
                ["WS rake", `${fmt(result.geometry?.wsAngleDeg, 0)}°`],
                ["Rear drop", pct(result.geometry?.rearDrop)],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between",
                  fontSize: 10, padding: "2px 0" }}>
                  <span style={{ color: "rgba(255,255,255,0.5)" }}>{k}</span>
                  <span style={{ color: "rgba(255,255,255,0.85)",
                    fontFamily: "'IBM Plex Mono'" }}>{v}</span>
                </div>
              ))}
            </div>

            {/* QUALITY */}
            {result.quality && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between",
                  alignItems: "baseline", marginBottom: 6, marginTop: 10 }}>
                  <span style={{ color: "#409cff", fontSize: 11, fontFamily: "'IBM Plex Mono'" }}>05</span>
                </div>
                <div style={{ background: "rgba(255,255,255,0.02)",
                  borderRadius: 6, padding: 10, marginBottom: 8,
                  border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between",
                    alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 18, fontWeight: 600, color: "#fff" }}>
                      {result.quality.score}/100
                    </span>
                    <span style={{
                      fontSize: 9, padding: "2px 8px", borderRadius: 3,
                      background: result.quality.status === "accepted" ? "rgba(48,209,88,0.15)" :
                        result.quality.status === "review" ? "rgba(255,159,10,0.15)" :
                          "rgba(255,69,58,0.15)",
                      color: result.quality.status === "accepted" ? "#30d158" :
                        result.quality.status === "review" ? "#ff9f0a" : "#ff453a",
                      letterSpacing: "0.1em",
                    }}>
                      {result.quality.status?.toUpperCase()}
                    </span>
                  </div>
                  <div style={{ height: 3, background: "rgba(255,255,255,0.06)",
                    borderRadius: 2, marginBottom: 8 }}>
                    <div style={{ height: "100%", width: `${result.quality.score}%`,
                      background: "#409cff", borderRadius: 2 }} />
                  </div>
                  {result.quality.warnings?.map((w, i) => (
                    <div key={i} style={{
                      fontSize: 9,
                      color: w.includes("3/4") || w.includes("quarter") || w.includes("front/rear")
                        ? "#ff453a" : "#ff9f0a",
                      fontFamily: "'IBM Plex Mono'",
                      padding: "3px 0", lineHeight: 1.5,
                      borderBottom: "0.5px solid rgba(255,255,255,0.04)",
                      fontWeight: w.includes("3/4") || w.includes("quarter") ? 600 : 400,
                    }}>
                      ⚠ {w}
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* AHMED REGIME */}
            {result.geometry?.ahmedRegime && (
              <div style={{ display: "flex", justifyContent: "space-between",
                alignItems: "center", padding: "8px 10px",
                background: "rgba(255,159,10,0.08)",
                border: "1px solid rgba(255,159,10,0.25)",
                borderRadius: 6, marginTop: 8 }}>
                <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 10 }}>Ahmed</span>
                <span style={{ background: "rgba(255,159,10,0.18)",
                  color: "#ff9f0a", padding: "3px 10px", borderRadius: 4,
                  fontSize: 10, fontFamily: "'IBM Plex Mono'", fontWeight: 600,
                  letterSpacing: "0.1em",
                }}>
                  {result.geometry.ahmedRegime.toUpperCase()} {fmt(result.geometry.rearSlantAngleDeg, 0)}°
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        height: 28, background: "rgba(0,0,0,0.65)",
        borderTop: "1px solid rgba(255,255,255,0.05)",
        padding: "0 16px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        fontSize: 10, color: "rgba(255,255,255,0.5)",
        fontFamily: "'IBM Plex Mono'",
      }}>
        <span>main · 97e4b36 · DrivAerML · 484 HF-LES cases · val Cd err 5.4%</span>
        <span>Runs: {runCount} · {analysing ? "● Analysing" : "● Ready"}</span>
      </div>
    </div>
  );
}
