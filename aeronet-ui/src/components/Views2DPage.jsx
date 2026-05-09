// Views2DPage.jsx — StatCFD Vehicle Outline Analysis UI
// Mahindra Research Valley / statinsite.com / Copyright (c) 2026 Rutej Talati

import React, { useState, useRef, useCallback, useMemo } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "https://rutejtalati16-aeronet.hf.space";

// ─── URL normaliser ────────────────────────────────────────────────────────────
function normaliseImageUrl(raw) {
  if (!raw) return raw;
  let u = raw.trim();
  let m = u.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (m) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  m = u.match(/drive\.google\.com\/open\?id=([^&]+)/);
  if (m) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  if (u.includes("dropbox.com") && u.includes("?dl=0")) return u.replace("?dl=0", "?dl=1");
  if (u.includes("dropbox.com") && !u.includes("?dl=")) return u + "?dl=1";
  m = u.match(/imgur\.com\/([a-zA-Z0-9]+)$/);
  if (m) return `https://i.imgur.com/${m[1]}.jpg`;
  if (u.includes("github.com") && u.includes("/blob/"))
    return u.replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/");
  if (u.includes("preview.redd.it"))
    return u.split("?")[0].replace("preview.redd.it", "i.redd.it");
  return u;
}

async function fetchImageFromUrl(url) {
  const norm = normaliseImageUrl(url);
  const proxies = [
    (u) => u,
    (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  ];
  const errors = [];
  for (const p of proxies) {
    try {
      const r = await fetch(p(norm), { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      if (!blob.type.startsWith("image/") && blob.size < 1024) throw new Error("Not an image");
      return blob;
    } catch (e) { errors.push(e.message); }
  }
  throw new Error(`All proxies failed: ${errors.slice(0, 2).join(" | ")}`);
}

const fmt = (n, d = 2) => (n == null || isNaN(n)) ? "—" : Number(n).toFixed(d);
const pct = (n, d = 0) => (n == null || isNaN(n)) ? "—" : `${(n * 100).toFixed(d)}%`;

// ─── Shared row component ──────────────────────────────────────────────────────
function Row({ label, value, highlight }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      fontSize: 10, padding: "3px 0", borderBottom: "0.5px solid rgba(255,255,255,0.04)",
    }}>
      <span style={{ color: "rgba(255,255,255,0.5)" }}>{label}</span>
      <span style={{
        color: highlight || "#409cff",
        fontFamily: "'IBM Plex Mono'", fontSize: 10,
      }}>{value}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIDE VIEW
// ═══════════════════════════════════════════════════════════════════════════════
function SideView({ contourPts, contourPtsB, geo, method, comparisonMode, comparison }) {
  const CW = 1080, CH = 370;
  const PAD_X = 30, PAD_Y = 55;

  const { drawPath, drawPathB, deviationSegments, gY, screenPts } = useMemo(() => {
    if (!contourPts || !Array.isArray(contourPts) || contourPts.length < 10) return {};
    const xs = contourPts.map(p => p[0]);
    const ys = contourPts.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const cw = maxX - minX || 1, ch = maxY - minY || 1;
    const draw_w = CW - 2 * PAD_X, draw_h = CH - 2 * PAD_Y;
    const s = Math.min(draw_w / cw, draw_h / ch);
    const final_w = cw * s, final_h = ch * s;
    const ox = (CW - final_w) / 2;
    const ground_y = CH - PAD_Y;
    const oy = ground_y - final_h;
    const toScreen = (p) => [ox + (p[0] - minX) * s, oy + (p[1] - minY) * s];
    const sA = contourPts.map(toScreen);
    const pathA = sA.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ") + " Z";

    let pathB = null;
    if (comparisonMode && contourPtsB && contourPtsB.length >= 10) {
      const xsB = contourPtsB.map(p => p[0]), ysB = contourPtsB.map(p => p[1]);
      const minXB = Math.min(...xsB), maxXB = Math.max(...xsB);
      const minYB = Math.min(...ysB), maxYB = Math.max(...ysB);
      const cwB = maxXB - minXB || 1, chB = maxYB - minYB || 1;
      const sB_scale = Math.min(draw_w / Math.max(cw, cwB), draw_h / Math.max(ch, chB));
      const ox_B = (CW - cwB * sB_scale) / 2;
      const oy_B = ground_y - chB * sB_scale;
      const toScreenB = (p) => [ox_B + (p[0] - minXB) * sB_scale, oy_B + (p[1] - minYB) * sB_scale];
      const sBpts = contourPtsB.map(toScreenB);
      pathB = sBpts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ") + " Z";
    }

    let devSegs = [];
    if (comparisonMode && comparison?.deviation_map) {
      const devs = comparison.deviation_map;
      const meanDev = devs.reduce((a, b) => a + b, 0) / devs.length;
      const threshold = meanDev * 1.8;
      const N = devs.length;
      const ratio = sA.length / N;
      for (let i = 0; i < N; i++) {
        if (devs[i] > threshold) {
          const i0 = Math.floor(i * ratio);
          const i1 = Math.min(sA.length - 1, Math.floor((i + 1) * ratio));
          if (i1 > i0) {
            const seg = sA.slice(i0, i1 + 1);
            if (seg.length >= 2)
              devSegs.push(seg.map((p, j) => `${j === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" "));
          }
        }
      }
    }

    return { drawPath: pathA, drawPathB: pathB, deviationSegments: devSegs, gY: ground_y, screenPts: { sA, minX, minY, cw, ch, s, ox, oy } };
  }, [contourPts, contourPtsB, comparisonMode, comparison]);

  if (!drawPath) {
    return (
      <div style={{
        width: "100%", height: CH, background: "#04070d", borderRadius: 8,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "rgba(255,255,255,0.2)", fontSize: 11, fontFamily: "'IBM Plex Mono'",
        border: "1px solid rgba(255,255,255,0.05)",
      }}>
        Upload an image and analyse to see the outline
      </div>
    );
  }

  const wheels = geo?._wheels || [];
  const has34 = geo?._quality?.warnings?.some(w => w.includes("3/4") || w.includes("quarter"));

  return (
    <svg width="100%" viewBox={`0 0 ${CW} ${CH}`}
      style={{ borderRadius: 8, display: "block", border: "1px solid rgba(255,255,255,0.05)" }}>
      <rect width={CW} height={CH} fill="#04070d" />
      <line x1={PAD_X * 0.5} y1={gY} x2={CW - PAD_X * 0.5} y2={gY}
        stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" strokeDasharray="2,4" />
      <path d={drawPath} fill="rgba(4,10,18,0.97)" stroke="none" />
      <path d={drawPath} fill="none" stroke="rgba(255,255,255,0.92)"
        strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
      {drawPathB && (
        <path d={drawPathB} fill="none" stroke="rgba(64,156,255,0.85)"
          strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
      )}
      {deviationSegments.map((seg, i) => (
        <path key={i} d={seg} fill="none" stroke="rgba(255,69,58,0.92)"
          strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      ))}

      {/* Wheels */}
      {!comparisonMode && screenPts && wheels.map((w, i) => {
        if (w?.nx == null || w?.ny == null || w?.nr == null) return null;
        const { minX, minY, cw, ch, s, ox, oy } = screenPts;
        const wxAdj = ox + (w.nx - minX) * s;
        const wyAdj = oy + (w.ny - minY) * s;
        const wr = Math.max((CH - 2*PAD_Y) * 0.09, Math.min((CH - 2*PAD_Y) * 0.14, w.nr * cw * s));
        return (
          <g key={i}>
            <circle cx={wxAdj} cy={wyAdj} r={wr}
              fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
            <circle cx={wxAdj} cy={wyAdj} r={wr * 0.42}
              fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="0.6" />
          </g>
        );
      })}

      {/* Footer label */}
      <text x={CW / 2} y={CH - 6} textAnchor="middle" fill="rgba(255,255,255,0.08)"
        fontSize="8" fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.10em">
        SIDE · {contourPts.length}pts · {method || "yolo+sam2"}
        {comparisonMode ? " · COMPARISON" : ""}
      </text>

      {/* 3/4 warning */}
      {has34 && !comparisonMode && (
        <g>
          <rect x={8} y={CH - 30} width={300} height={18} rx={3}
            fill="rgba(255,159,10,0.12)" stroke="rgba(255,159,10,0.35)" strokeWidth="0.5" />
          <text x={16} y={CH - 18} fill="rgba(255,159,10,0.9)" fontSize="8.5"
            fontFamily="'IBM Plex Mono',monospace">
            ⚠ 3/4 view — front outline may be distorted
          </text>
        </g>
      )}

      {/* Comparison legend */}
      {comparisonMode && (
        <g>
          <rect x={10} y={10} width={180} height={52} rx={4}
            fill="rgba(0,0,0,0.55)" stroke="rgba(255,255,255,0.12)" strokeWidth="0.5" />
          <line x1={20} y1={24} x2={38} y2={24} stroke="rgba(255,255,255,0.9)" strokeWidth="1.8" />
          <text x={44} y={28} fill="rgba(255,255,255,0.9)" fontSize="9" fontFamily="'IBM Plex Mono',monospace">Car A</text>
          <line x1={20} y1={38} x2={38} y2={38} stroke="rgba(64,156,255,0.85)" strokeWidth="1.8" />
          <text x={44} y={42} fill="rgba(64,156,255,0.9)" fontSize="9" fontFamily="'IBM Plex Mono',monospace">Car B</text>
          <line x1={20} y1={52} x2={38} y2={52} stroke="rgba(255,69,58,0.9)" strokeWidth="2.5" />
          <text x={44} y={56} fill="rgba(255,69,58,0.9)" fontSize="9" fontFamily="'IBM Plex Mono',monospace">Key differences</text>
        </g>
      )}

      <text x={CW / 2} y={CH / 2} textAnchor="middle"
        fill="rgba(255,255,255,0.03)" fontSize="11" fontFamily="'IBM Plex Mono',monospace">
        © 2026 Rutej Talati
      </text>
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// FRONT VIEW
// ═══════════════════════════════════════════════════════════════════════════════
function FrontView({ geo, carDims }) {
  const CW = 1080, CH = 370;
  const fa = carDims?.front_aspect || 1.20;
  const wt = carDims?.wheel_track_norm || 0.85;
  const bt = (carDims?.body_type || geo?.bodyType || "notchback").toLowerCase();
  const PAD = 75;
  const dh = CH - 2 * PAD, dw = dh * fa;
  const ox = (CW - dw) / 2, oy = PAD;
  const gh = dh * (bt === "suv" ? 0.34 : bt === "fastback" ? 0.42 : 0.40);
  const baseY = oy + dh, roofY = oy, shoulderY = oy + gh;
  const cL = ox + dw * 0.18, cR = ox + dw * 0.82;
  const bodyPath = `M${ox.toFixed(1)},${baseY.toFixed(1)} L${ox.toFixed(1)},${(shoulderY+2).toFixed(1)} Q${ox.toFixed(1)},${shoulderY.toFixed(1)} ${(ox+dw*0.18).toFixed(1)},${shoulderY.toFixed(1)} L${cL.toFixed(1)},${(roofY+4).toFixed(1)} Q${cL.toFixed(1)},${roofY.toFixed(1)} ${(cL+8).toFixed(1)},${roofY.toFixed(1)} L${(cR-8).toFixed(1)},${roofY.toFixed(1)} Q${cR.toFixed(1)},${roofY.toFixed(1)} ${cR.toFixed(1)},${(roofY+4).toFixed(1)} L${(ox+dw*0.82).toFixed(1)},${shoulderY.toFixed(1)} Q${(ox+dw).toFixed(1)},${shoulderY.toFixed(1)} ${(ox+dw).toFixed(1)},${(shoulderY+2).toFixed(1)} L${(ox+dw).toFixed(1)},${baseY.toFixed(1)} Z`;
  const tPx = dw * wt;
  const wLx = ox + (dw - tPx) / 2 + dw * 0.025;
  const wRx = ox + dw - (dw - tPx) / 2 - dw * 0.025;
  const wY = baseY - dh * 0.06, wr = dh * 0.13;
  return (
    <svg width="100%" viewBox={`0 0 ${CW} ${CH}`}
      style={{ borderRadius: 8, display: "block", border: "1px solid rgba(255,255,255,0.05)" }}>
      <rect width={CW} height={CH} fill="#04070d" />
      <line x1={PAD*0.4} y1={baseY} x2={CW-PAD*0.4} y2={baseY}
        stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" strokeDasharray="2,4" />
      <path d={bodyPath} fill="rgba(4,10,18,0.97)" stroke="rgba(255,255,255,0.92)"
        strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
      {[wLx, wRx].map((wx, i) => (
        <g key={i}>
          <ellipse cx={wx} cy={wY} rx={wr*0.42} ry={wr}
            fill="rgba(20,20,20,0.9)" stroke="rgba(255,255,255,0.6)" strokeWidth="1" />
          <ellipse cx={wx} cy={wY} rx={wr*0.20} ry={wr*0.45}
            fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" />
        </g>
      ))}
      <ellipse cx={ox+dw*0.22} cy={oy+dh*0.55} rx={dw*0.10} ry={dh*0.06}
        fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="0.6" />
      <ellipse cx={ox+dw*0.78} cy={oy+dh*0.55} rx={dw*0.10} ry={dh*0.06}
        fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="0.6" />
      <rect x={ox+dw*0.36} y={oy+dh*0.66} width={dw*0.28} height={dh*0.08}
        fill="none" stroke="rgba(255,255,255,0.13)" strokeWidth="0.6" rx="2" />
      <text x={CW/2} y={CH-6} textAnchor="middle" fill="rgba(255,255,255,0.08)"
        fontSize="8" fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.10em">
        FRONT · {carDims?.car_id || bt.toUpperCase()}
      </text>
      {carDims?.overall_width_mm && (
        <text x={CW/2} y={CH-20} textAnchor="middle" fill="rgba(255,255,255,0.35)"
          fontSize="9" fontFamily="'IBM Plex Mono',monospace">
          {carDims.overall_width_mm} mm × {carDims.overall_height_mm} mm
        </text>
      )}
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOP VIEW
// ═══════════════════════════════════════════════════════════════════════════════
function TopView({ geo, carDims }) {
  const CW = 1080, CH = 370;
  const ta = carDims?.top_aspect || 2.5;
  const wt = carDims?.wheel_track_norm || 0.85;
  const wb = carDims?.wheelbase_norm || 0.60;
  const bt = (carDims?.body_type || geo?.bodyType || "notchback").toLowerCase();
  const PAD = 75;
  const dw = CW - 2*PAD, dh = dw / ta;
  const ox = PAD, oy = (CH - dh) / 2;
  const ft = bt === "fastback" ? 0.06 : 0.04;
  const rt = bt === "fastback" ? 0.04 : bt === "estate" ? 0.02 : 0.05;
  const bodyPath = `M${(ox+dw*ft).toFixed(1)},${oy.toFixed(1)} L${(ox+dw*(1-rt)).toFixed(1)},${oy.toFixed(1)} Q${(ox+dw).toFixed(1)},${oy.toFixed(1)} ${(ox+dw).toFixed(1)},${(oy+dh*0.10).toFixed(1)} L${(ox+dw).toFixed(1)},${(oy+dh*0.90).toFixed(1)} Q${(ox+dw).toFixed(1)},${(oy+dh).toFixed(1)} ${(ox+dw*(1-rt)).toFixed(1)},${(oy+dh).toFixed(1)} L${(ox+dw*ft).toFixed(1)},${(oy+dh).toFixed(1)} Q${ox.toFixed(1)},${(oy+dh).toFixed(1)} ${ox.toFixed(1)},${(oy+dh*0.90).toFixed(1)} L${ox.toFixed(1)},${(oy+dh*0.10).toFixed(1)} Q${ox.toFixed(1)},${oy.toFixed(1)} ${(ox+dw*ft).toFixed(1)},${oy.toFixed(1)} Z`;
  const wbPx = dw * wb, wbOff = (dw - wbPx) / 2;
  const tPx = dh * wt;
  const wh = dw * 0.045, ww = dh * 0.06;
  const wheels = [
    { x: ox+wbOff, y: oy+(dh-tPx)/2 }, { x: ox+wbOff, y: oy+dh-(dh-tPx)/2 },
    { x: ox+wbOff+wbPx, y: oy+(dh-tPx)/2 }, { x: ox+wbOff+wbPx, y: oy+dh-(dh-tPx)/2 },
  ];
  const cx1 = ox+dw*0.32, cx2 = ox+dw*0.78, cy1 = oy+dh*0.18, cy2 = oy+dh*0.82;
  return (
    <svg width="100%" viewBox={`0 0 ${CW} ${CH}`}
      style={{ borderRadius: 8, display: "block", border: "1px solid rgba(255,255,255,0.05)" }}>
      <rect width={CW} height={CH} fill="#04070d" />
      <path d={bodyPath} fill="rgba(4,10,18,0.97)" stroke="rgba(255,255,255,0.92)"
        strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
      <rect x={cx1} y={cy1} width={cx2-cx1} height={cy2-cy1}
        fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="0.6" rx="3" />
      {wheels.map((w, i) => (
        <ellipse key={i} cx={w.x} cy={w.y} rx={wh} ry={ww}
          fill="rgba(20,20,20,0.9)" stroke="rgba(255,255,255,0.55)" strokeWidth="1" />
      ))}
      <line x1={ox} y1={oy+dh/2} x2={ox+dw} y2={oy+dh/2}
        stroke="rgba(255,255,255,0.04)" strokeWidth="0.5" strokeDasharray="3,5" />
      <text x={CW/2} y={CH-6} textAnchor="middle" fill="rgba(255,255,255,0.08)"
        fontSize="8" fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.10em">
        TOP · {carDims?.car_id || bt.toUpperCase()}
      </text>
      {carDims?.overall_length_mm && (
        <text x={CW/2} y={CH-20} textAnchor="middle" fill="rgba(255,255,255,0.35)"
          fontSize="9" fontFamily="'IBM Plex Mono',monospace">
          L {carDims.overall_length_mm} mm · W {carDims.overall_width_mm} mm · WB {carDims.wheelbase_mm} mm
        </text>
      )}
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// UNDERSIDE VIEW
// ═══════════════════════════════════════════════════════════════════════════════
function UnderView({ geo, carDims }) {
  const CW = 1080, CH = 370;
  const ua = carDims?.under_aspect || 2.5;
  const wt = carDims?.wheel_track_norm || 0.85;
  const wb = carDims?.wheelbase_norm || 0.60;
  const bt = (carDims?.body_type || geo?.bodyType || "notchback").toLowerCase();
  const PAD = 75;
  const dw = CW - 2*PAD, dh = dw / ua;
  const ox = PAD, oy = (CH - dh) / 2;
  const bodyPath = `M${(ox+dw*0.04).toFixed(1)},${oy.toFixed(1)} L${(ox+dw*0.96).toFixed(1)},${oy.toFixed(1)} Q${(ox+dw).toFixed(1)},${oy.toFixed(1)} ${(ox+dw).toFixed(1)},${(oy+dh*0.10).toFixed(1)} L${(ox+dw).toFixed(1)},${(oy+dh*0.90).toFixed(1)} Q${(ox+dw).toFixed(1)},${(oy+dh).toFixed(1)} ${(ox+dw*0.96).toFixed(1)},${(oy+dh).toFixed(1)} L${(ox+dw*0.04).toFixed(1)},${(oy+dh).toFixed(1)} Q${ox.toFixed(1)},${(oy+dh).toFixed(1)} ${ox.toFixed(1)},${(oy+dh*0.90).toFixed(1)} L${ox.toFixed(1)},${(oy+dh*0.10).toFixed(1)} Q${ox.toFixed(1)},${oy.toFixed(1)} ${(ox+dw*0.04).toFixed(1)},${oy.toFixed(1)} Z`;
  const wbPx = dw * wb, wbOff = (dw - wbPx) / 2;
  const tPx = dh * wt;
  const wh = dw * 0.045, ww = dh * 0.07;
  const wheels = [
    { x: ox+wbOff, y: oy+(dh-tPx)/2 }, { x: ox+wbOff, y: oy+dh-(dh-tPx)/2 },
    { x: ox+wbOff+wbPx, y: oy+(dh-tPx)/2 }, { x: ox+wbOff+wbPx, y: oy+dh-(dh-tPx)/2 },
  ];
  const eX = ox+dw*0.10, eW = dw*0.18, eY = oy+dh*0.30, eH = dh*0.40;
  const shY = oy+dh/2;
  const tX = ox+wbOff+wbPx*0.55, tW = wbPx*0.30, tY = oy+dh*0.25, tH = dh*0.50;
  return (
    <svg width="100%" viewBox={`0 0 ${CW} ${CH}`}
      style={{ borderRadius: 8, display: "block", border: "1px solid rgba(255,255,255,0.05)" }}>
      <rect width={CW} height={CH} fill="#04070d" />
      <path d={bodyPath} fill="rgba(4,10,18,0.97)" stroke="rgba(255,255,255,0.92)"
        strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
      <rect x={eX} y={eY} width={eW} height={eH}
        fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.18)" strokeWidth="0.6" rx="3" />
      <line x1={eX+eW} y1={shY} x2={ox+wbOff+wbPx*0.85} y2={shY}
        stroke="rgba(255,255,255,0.16)" strokeWidth="2" />
      <rect x={tX} y={tY} width={tW} height={tH}
        fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.12)" strokeWidth="0.5" rx="2" strokeDasharray="3,2" />
      <line x1={ox+dw*0.40} y1={oy+dh*0.55} x2={ox+dw*0.95} y2={oy+dh*0.55}
        stroke="rgba(255,255,255,0.10)" strokeWidth="1" strokeDasharray="2,2" />
      {wheels.map((w, i) => (
        <g key={i}>
          <ellipse cx={w.x} cy={w.y} rx={wh} ry={ww}
            fill="rgba(15,15,15,0.9)" stroke="rgba(255,255,255,0.5)" strokeWidth="1" />
          <ellipse cx={w.x} cy={w.y} rx={wh*0.4} ry={ww*0.4}
            fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="0.4" />
        </g>
      ))}
      <line x1={wheels[0].x} y1={wheels[0].y} x2={wheels[2].x} y2={wheels[2].y}
        stroke="rgba(255,255,255,0.07)" strokeWidth="0.8" />
      <line x1={wheels[1].x} y1={wheels[1].y} x2={wheels[3].x} y2={wheels[3].y}
        stroke="rgba(255,255,255,0.07)" strokeWidth="0.8" />
      <text x={CW/2} y={CH-6} textAnchor="middle" fill="rgba(255,255,255,0.08)"
        fontSize="8" fontFamily="'IBM Plex Mono',monospace" letterSpacing="0.10em">
        UNDERSIDE · {carDims?.car_id || bt.toUpperCase()}
      </text>
      {carDims?.wheelbase_mm && (
        <text x={CW/2} y={CH-20} textAnchor="middle" fill="rgba(255,255,255,0.35)"
          fontSize="9" fontFamily="'IBM Plex Mono',monospace">
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
  // Suppress WebGL context loss errors — these come from Three.js in the
  // Vite bundle (possibly a HF Spaces default component). Our views are
  // pure SVG and are unaffected, but we silence the console noise.
  React.useEffect(() => {
    const suppress = (e) => {
      if (e?.message?.includes?.("Context Lost") ||
          e?.message?.includes?.("WebGL") ||
          e?.message?.includes?.("THREE")) {
        e.preventDefault?.();
        e.stopPropagation?.();
      }
    };
    const suppressUnhandled = (e) => {
      if (e?.reason?.message?.includes?.("Context") ||
          e?.reason?.message?.includes?.("WebGL")) {
        e.preventDefault?.();
      }
    };
    window.addEventListener("error", suppress);
    window.addEventListener("unhandledrejection", suppressUnhandled);
    // Also handle WebGL context lost on any canvas elements
    const handleContextLost = (e) => { e.preventDefault(); };
    document.querySelectorAll("canvas").forEach(c =>
      c.addEventListener("webglcontextlost", handleContextLost));
    return () => {
      window.removeEventListener("error", suppress);
      window.removeEventListener("unhandledrejection", suppressUnhandled);
    };
  }, []);

  const [imageFile, setImageFile]     = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [imageUrl, setImageUrl]       = useState("");
  const [analysisMode, setAnalysisMode] = useState("A");
  const [analysing, setAnalysing]     = useState(false);
  const [progress, setProgress]       = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [result, setResult]           = useState(null);
  const [activeView, setActiveView]   = useState("Side");
  const [error, setError]             = useState(null);
  const [dragOver, setDragOver]       = useState(false);
  const [runCount, setRunCount]       = useState(0);

  // Comparison
  const [carHistory, setCarHistory]   = useState([null, null]);
  const [comparisonMode, setComparisonMode] = useState(false);
  const [comparison, setComparison]   = useState(null);
  const [comparing, setComparing]     = useState(false);

  const fileInputRef = useRef(null);

  // ─── File handling ────────────────────────────────────────────────────────────
  const handleFile = useCallback((file) => {
    if (!file || !file.type.startsWith("image/")) return;
    setImageFile(file);
    setImageUrl("");
    setError(null);
    setResult(null);
    const reader = new FileReader();
    reader.onload = (e) => setImagePreview(e.target.result);
    reader.readAsDataURL(file);
  }, []);

  // Drag and drop handlers
  const onDragOver = useCallback((e) => { e.preventDefault(); setDragOver(true); }, []);
  const onDragLeave = useCallback((e) => { e.preventDefault(); setDragOver(false); }, []);
  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  // Paste from clipboard
  const onPaste = useCallback((e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        handleFile(item.getAsFile());
        break;
      }
    }
  }, [handleFile]);

  const handleUrlLoad = useCallback(async () => {
    if (!imageUrl) return;
    setAnalysing(true); setProgressMsg("Fetching image…");
    try {
      const blob = await fetchImageFromUrl(imageUrl);
      handleFile(new File([blob], "url-image.jpg", { type: blob.type || "image/jpeg" }));
    } catch (e) {
      setError(`URL fetch failed: ${e.message}`);
    } finally {
      setAnalysing(false); setProgressMsg("");
    }
  }, [imageUrl, handleFile]);

  // ─── Analysis ─────────────────────────────────────────────────────────────────
  const analyseVehicle = useCallback(async () => {
    if (!imageFile) { setError("Please upload an image first"); return; }
    setAnalysing(true); setError(null); setProgress(0);
    setProgressMsg("Starting…"); setResult(null);
    try {
      const fd = new FormData();
      fd.append("image", imageFile);
      fd.append("mode", analysisMode);
      const startResp = await fetch(`${API_BASE}/analyze-contour/start`, { method: "POST", body: fd });
      if (!startResp.ok) throw new Error(`HTTP ${startResp.status}`);
      const { job_id } = await startResp.json();
      if (!job_id) throw new Error("No job_id returned");
      let final = null;
      for (let i = 0; i < 200; i++) {
        await new Promise(res => setTimeout(res, 3000));
        const data = await (await fetch(`${API_BASE}/analyze-contour/result/${job_id}`)).json();
        if (data.status === "running") {
          if (data.last_event) { setProgress(data.last_event.pct || 0); setProgressMsg(data.last_event.msg || "Processing…"); }
        } else if (data.status === "done") { final = data.result; break; }
        else if (data.status === "error") throw new Error(data.error || "Analysis failed");
      }
      if (!final) throw new Error("Analysis timeout");
      setResult(final); setRunCount(c => c + 1); setProgress(100); setProgressMsg("Done ✓");
    } catch (e) {
      setError(e.message || "Analysis failed");
    } finally {
      setAnalysing(false);
    }
  }, [imageFile, analysisMode]);

  // ─── Comparison ───────────────────────────────────────────────────────────────
  const saveAs = useCallback((slot) => {
    if (!result) return;
    const newH = [...carHistory];
    newH[slot] = {
      pts: result.technical_outline_pts,
      geo: result.geometry,
      car_dims: result.car_dimensions,
      method: result.method,
      preview: imagePreview,
      saved_at: new Date().toISOString(),
    };
    setCarHistory(newH);
  }, [result, imagePreview, carHistory]);

  const runComparison = useCallback(async () => {
    if (!carHistory[0] || !carHistory[1]) return;
    setComparing(true); setError(null);
    try {
      const resp = await fetch(`${API_BASE}/compare-contours`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pts_a: carHistory[0].pts, pts_b: carHistory[1].pts,
          geo_a: carHistory[0].geo, geo_b: carHistory[1].geo,
        }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      setComparison(await resp.json());
      setComparisonMode(true);
    } catch (e) { setError(e.message); }
    finally { setComparing(false); }
  }, [carHistory]);

  const exportSvg = () => {
    if (!result?.outline_svg) return;
    const blob = new Blob([result.outline_svg], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `outline_${Date.now()}.svg`;
    a.click();
  };

  // ─── Derived ──────────────────────────────────────────────────────────────────
  const geoForSide = useMemo(() => !result ? null : {
    ...result.geometry,
    _quality: result.quality,
    _wheels: result.keypoints?.wheels || [],
  }, [result]);

  const contourPts = comparisonMode ? carHistory[0]?.pts : result?.technical_outline_pts;
  const contourPtsB = comparisonMode ? carHistory[1]?.pts : null;
  const carDims = comparisonMode ? carHistory[0]?.car_dims : result?.car_dimensions;
  const geoToUse = comparisonMode ? { ...carHistory[0]?.geo, _quality: null, _wheels: [] } : geoForSide;

  // ─── Section header component ─────────────────────────────────────────────────
  const SectionLabel = ({ num, label }) => (
    <div style={{ display: "flex", justifyContent: "space-between",
      alignItems: "baseline", marginBottom: 6, marginTop: 14 }}>
      <span style={{ color: "#409cff", fontSize: 10, fontFamily: "'IBM Plex Mono'" }}>{num}</span>
      <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 9, letterSpacing: "0.12em" }}>{label}</span>
    </div>
  );

  return (
    <div
      onPaste={onPaste}
      style={{
        display: "grid",
        gridTemplateColumns: "300px 1fr",
        height: "100vh",
        background: "#000",
        color: "#fff",
        fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
        overflow: "hidden",
      }}>

      {/* ═══ LEFT PANEL ═══ */}
      <div style={{
        overflowY: "auto", padding: "14px 14px 40px",
        borderRight: "1px solid rgba(255,255,255,0.06)",
        display: "flex", flexDirection: "column", gap: 0,
      }}>

        {/* ── UPLOAD (drag & drop) ── */}
        <SectionLabel num="01" label="UPLOAD" />
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          style={{
            height: 160,
            background: imagePreview
              ? `url(${imagePreview}) center/contain no-repeat rgba(4,7,13,1)`
              : dragOver ? "rgba(64,156,255,0.08)" : "rgba(255,255,255,0.02)",
            border: `1.5px dashed ${dragOver ? "rgba(64,156,255,0.6)" : imagePreview ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.14)"}`,
            borderRadius: 8, cursor: "pointer", position: "relative",
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            transition: "border-color 0.15s, background 0.15s",
          }}>
          {!imagePreview && (
            <>
              <div style={{ fontSize: 22, marginBottom: 6, opacity: 0.4 }}>⤓</div>
              <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 10, textAlign: "center", lineHeight: 1.5 }}>
                Drop image, click to browse<br />
                <span style={{ color: "rgba(255,255,255,0.25)", fontSize: 9 }}>or paste from clipboard</span>
              </div>
            </>
          )}
          {imagePreview && (
            <div style={{
              position: "absolute", bottom: 6, left: "50%", transform: "translateX(-50%)",
              background: "rgba(0,0,0,0.6)", padding: "2px 10px", borderRadius: 10,
              fontSize: 9, color: "rgba(255,255,255,0.7)", whiteSpace: "nowrap",
            }}>
              click to change
            </div>
          )}
          {dragOver && (
            <div style={{
              position: "absolute", inset: 0, borderRadius: 7,
              background: "rgba(64,156,255,0.12)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#409cff", fontSize: 12, fontWeight: 600,
            }}>Drop to load</div>
          )}
          <input ref={fileInputRef} type="file" accept="image/*"
            onChange={(e) => handleFile(e.target.files[0])}
            style={{ display: "none" }} />
        </div>

        {/* File name */}
        {imageFile && (
          <div style={{
            marginTop: 6, padding: "4px 8px",
            background: "rgba(255,255,255,0.03)", borderRadius: 4,
            fontSize: 9, color: "rgba(255,255,255,0.5)",
            display: "flex", justifyContent: "space-between",
            fontFamily: "'IBM Plex Mono'",
          }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>
              {imageFile.name}
            </span>
            <span>{(imageFile.size / 1024).toFixed(0)} KB</span>
          </div>
        )}

        {/* URL loader */}
        <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
          <input type="url" placeholder="🔗 or paste image URL"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleUrlLoad()}
            style={{
              flex: 1, padding: "5px 8px", fontSize: 9,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.10)", color: "#fff",
              borderRadius: 4, fontFamily: "'IBM Plex Mono'", outline: "none",
            }} />
          <button onClick={handleUrlLoad} disabled={!imageUrl}
            style={{
              padding: "5px 10px", fontSize: 9,
              background: imageUrl ? "rgba(64,156,255,0.2)" : "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.10)",
              color: imageUrl ? "#409cff" : "rgba(255,255,255,0.3)",
              borderRadius: 4, cursor: imageUrl ? "pointer" : "default",
            }}>Load</button>
        </div>

        {/* ── ANALYSIS MODE ── */}
        <SectionLabel num="02" label="MODE" />
        {[
          { key: "A", icon: "◎", title: "Silhouette", sub: "~30s · outline only" },
          { key: "B", icon: "⊞", title: "Panels",     sub: "~90s · lines + markers" },
          { key: "C", icon: "⬡", title: "Full Aero",  sub: "~150s · ΔCd + ID" },
        ].map(m => (
          <div key={m.key} onClick={() => setAnalysisMode(m.key)}
            style={{
              padding: "8px 10px", marginBottom: 4,
              background: analysisMode === m.key ? "rgba(64,156,255,0.09)" : "rgba(255,255,255,0.02)",
              border: `1px solid ${analysisMode === m.key ? "rgba(64,156,255,0.35)" : "rgba(255,255,255,0.06)"}`,
              borderRadius: 6, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 10,
            }}>
            <span style={{ fontSize: 13, color: analysisMode === m.key ? "#409cff" : "rgba(255,255,255,0.35)" }}>{m.icon}</span>
            <div>
              <div style={{ fontSize: 11, fontWeight: 500, color: analysisMode === m.key ? "#409cff" : "#fff" }}>{m.title}</div>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)" }}>{m.sub}</div>
            </div>
          </div>
        ))}

        {/* Analyse button */}
        <button onClick={analyseVehicle} disabled={!imageFile || analysing}
          style={{
            width: "100%", padding: "9px", marginTop: 10,
            background: imageFile && !analysing ? "#409cff" : "rgba(255,255,255,0.05)",
            color: imageFile && !analysing ? "#fff" : "rgba(255,255,255,0.35)",
            border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600,
            cursor: imageFile && !analysing ? "pointer" : "default",
          }}>
          {analysing ? `Analysing… ${progress}%` : "▷  Analyse Vehicle"}
        </button>

        {/* Progress bar */}
        {analysing && (
          <div style={{ marginTop: 8 }}>
            <div style={{ height: 2, background: "rgba(255,255,255,0.06)", borderRadius: 1, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${progress}%`, background: "#409cff", transition: "width 0.4s" }} />
            </div>
            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 9, marginTop: 4, fontFamily: "'IBM Plex Mono'" }}>
              {progressMsg}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            padding: "7px 10px", marginTop: 10,
            background: "rgba(255,69,58,0.10)", border: "1px solid rgba(255,69,58,0.35)",
            borderRadius: 4, color: "#ff453a", fontSize: 9,
          }}>{error}</div>
        )}

        {/* ── COMPARISON ── */}
        <SectionLabel num="03" label="COMPARISON" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {[0, 1].map(slot => (
            <button key={slot} onClick={() => saveAs(slot)}
              disabled={!result || (slot === 1 && !carHistory[0])}
              style={{
                padding: "7px 4px",
                background: carHistory[slot] ? "rgba(64,156,255,0.15)" :
                  (result && (slot === 0 || carHistory[0])) ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.02)",
                border: `1px solid ${carHistory[slot] ? "rgba(64,156,255,0.4)" : "rgba(255,255,255,0.08)"}`,
                color: carHistory[slot] ? "#409cff" :
                  (result && (slot === 0 || carHistory[0])) ? "#fff" : "rgba(255,255,255,0.3)",
                borderRadius: 4, fontSize: 9,
                cursor: (result && (slot === 0 || carHistory[0])) ? "pointer" : "default",
              }}>
              {carHistory[slot] ? `✓ Car ${slot === 0 ? "A" : "B"} saved` : `Save as Car ${slot === 0 ? "A" : "B"}`}
            </button>
          ))}
        </div>

        {carHistory[0] && (
          <div style={{ marginTop: 5, padding: "4px 7px", background: "rgba(255,255,255,0.02)",
            borderRadius: 3, fontSize: 9, color: "rgba(255,255,255,0.5)", fontFamily: "'IBM Plex Mono'" }}>
            A: {carHistory[0].car_dims?.car_id || "—"} · Cd {carHistory[0].geo?.Cd}
          </div>
        )}
        {carHistory[1] && (
          <div style={{ marginTop: 4, padding: "4px 7px", background: "rgba(64,156,255,0.04)",
            borderRadius: 3, fontSize: 9, color: "rgba(64,156,255,0.7)", fontFamily: "'IBM Plex Mono'" }}>
            B: {carHistory[1].car_dims?.car_id || "—"} · Cd {carHistory[1].geo?.Cd}
          </div>
        )}

        {!comparisonMode ? (
          <button onClick={runComparison}
            disabled={!carHistory[0] || !carHistory[1] || comparing}
            style={{
              width: "100%", padding: "7px", marginTop: 8,
              background: (carHistory[0] && carHistory[1] && !comparing) ? "rgba(255,69,58,0.18)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${(carHistory[0] && carHistory[1]) ? "rgba(255,69,58,0.4)" : "rgba(255,255,255,0.08)"}`,
              color: (carHistory[0] && carHistory[1]) ? "#ff453a" : "rgba(255,255,255,0.3)",
              borderRadius: 4, fontSize: 9, fontWeight: 600,
              cursor: (carHistory[0] && carHistory[1] && !comparing) ? "pointer" : "default",
            }}>
            {comparing ? "Computing…" : "▷  Compare A vs B"}
          </button>
        ) : (
          <button onClick={() => { setComparisonMode(false); setComparison(null); }}
            style={{
              width: "100%", padding: "7px", marginTop: 8,
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)",
              color: "#fff", borderRadius: 4, fontSize: 9, cursor: "pointer",
            }}>✕  Exit Comparison</button>
        )}

        {(carHistory[0] || carHistory[1]) && (
          <div onClick={() => { setCarHistory([null,null]); setComparisonMode(false); setComparison(null); }}
            style={{ textAlign: "center", marginTop: 6, fontSize: 9,
              color: "rgba(255,159,10,0.7)", cursor: "pointer" }}>clear history</div>
        )}

        {/* ── COMPARISON RESULTS ── */}
        {comparisonMode && comparison && (
          <>
            <SectionLabel num="" label="RESULT" />
            <div style={{ background: "rgba(255,69,58,0.08)", padding: 10, borderRadius: 6,
              border: "1px solid rgba(255,69,58,0.2)" }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#ff453a", fontFamily: "'IBM Plex Mono'" }}>
                {comparison.overlap_pct}%
              </div>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.5)" }}>Geometric similarity</div>
            </div>
            <div style={{ marginTop: 8 }}>
              {Object.entries(comparison.region_deviations || {}).map(([region, dev]) => (
                <Row key={region} label={region}
                  value={fmt(dev, 4)}
                  highlight={dev > 0.05 ? "#ff453a" : "#409cff"} />
              ))}
            </div>
            <div style={{ marginTop: 8, padding: 8, background: "rgba(255,255,255,0.02)",
              borderRadius: 5, border: "1px solid rgba(255,255,255,0.05)" }}>
              <Row label="Cd delta" value={(comparison.cd_delta > 0 ? "+" : "") + fmt(comparison.cd_delta, 3)} />
              <Row label="Roofline" value={fmt(comparison.roofline_delta, 4)} />
              <Row label="Taper"    value={fmt(comparison.taper_delta, 4)} />
              <Row label="Frontal"  value={fmt(comparison.frontal_delta, 4)} />
              <Row label="Mean dev" value={fmt(comparison.mean_deviation, 4)} />
              <Row label="Max dev"  value={fmt(comparison.max_deviation, 4)} highlight="#ff453a" />
            </div>
          </>
        )}

        {/* ── RESULTS ── */}
        {!comparisonMode && result && (
          <>
            <SectionLabel num="04" label="RESULT" />
            <div style={{ padding: 8, background: "rgba(255,255,255,0.02)", borderRadius: 5,
              border: "1px solid rgba(255,255,255,0.05)" }}>
              <Row label="Method"  value={result.method} />
              <Row label="Points"  value={`${result.technical_outline_pts?.length || 0}`} />
              <Row label="Wheels"  value={`${result.keypoints?.wheels?.length || 0}`} />
              <Row label="Aspect"  value={fmt(result.geometry?.aspectRatio)} />
              <Row label="WS rake" value={`${fmt(result.geometry?.wsAngleDeg, 0)}°`} />
              <Row label="Rear slant" value={`${fmt(result.geometry?.rearSlantAngleDeg, 0)}°`} />
              <Row label="Cd est." value={fmt(result.geometry?.Cd, 3)} />
              <Row label="CdA"     value={fmt(result.geometry?.CdA, 4)} />
            </div>

            {/* Geometry ratios */}
            <div style={{ marginTop: 6, padding: 8, background: "rgba(255,255,255,0.02)", borderRadius: 5,
              border: "1px solid rgba(255,255,255,0.05)" }}>
              <Row label="Hood"     value={pct(result.geometry?.hoodRatio)} />
              <Row label="Cabin"    value={pct(result.geometry?.cabinRatio)} />
              <Row label="Boot"     value={pct(result.geometry?.bootRatio)} />
              <Row label="Rear drop" value={pct(result.geometry?.rearDrop)} />
            </div>

            {/* Car ID */}
            {result.car_dimensions?.car_id && (
              <>
                <SectionLabel num="05" label="CAR ID" />
                <div style={{ padding: 8, background: "rgba(255,255,255,0.02)", borderRadius: 5,
                  border: "1px solid rgba(255,255,255,0.05)" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", marginBottom: 5 }}>
                    {result.car_dimensions.car_id}
                  </div>
                  {[
                    ["Year",      result.car_dimensions.year],
                    ["Body",      result.car_dimensions.body_type],
                    ["Length",    `${result.car_dimensions.overall_length_mm} mm`],
                    ["Width",     `${result.car_dimensions.overall_width_mm} mm`],
                    ["Height",    `${result.car_dimensions.overall_height_mm} mm`],
                    ["Wheelbase", `${result.car_dimensions.wheelbase_mm} mm`],
                    ["Cd (ref.)", fmt(result.car_dimensions.drag_cd, 3)],
                    ["Confidence", pct(result.car_dimensions.confidence, 0)],
                  ].map(([k, v]) => <Row key={k} label={k} value={v} />)}
                </div>
              </>
            )}

            {/* Quality */}
            {result.quality && (
              <>
                <SectionLabel num="06" label="QUALITY" />
                <div style={{ padding: 8, background: "rgba(255,255,255,0.02)", borderRadius: 5,
                  border: "1px solid rgba(255,255,255,0.05)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>{result.quality.score}/100</span>
                    <span style={{
                      fontSize: 8, padding: "2px 7px", borderRadius: 3, letterSpacing: "0.1em",
                      background: result.quality.status === "accepted" ? "rgba(48,209,88,0.15)" :
                        result.quality.status === "review" ? "rgba(255,159,10,0.15)" : "rgba(255,69,58,0.15)",
                      color: result.quality.status === "accepted" ? "#30d158" :
                        result.quality.status === "review" ? "#ff9f0a" : "#ff453a",
                    }}>{result.quality.status?.toUpperCase()}</span>
                  </div>
                  <div style={{ height: 2, background: "rgba(255,255,255,0.06)", borderRadius: 1, marginBottom: 6 }}>
                    <div style={{ height: "100%", width: `${result.quality.score}%`,
                      background: "#409cff", borderRadius: 1 }} />
                  </div>
                  {result.quality.warnings?.map((w, i) => (
                    <div key={i} style={{
                      fontSize: 8.5, lineHeight: 1.5, padding: "2px 0",
                      borderBottom: "0.5px solid rgba(255,255,255,0.04)",
                      color: w.includes("3/4") || w.includes("quarter") || w.includes("front/rear") ? "#ff453a" : "#ff9f0a",
                      fontFamily: "'IBM Plex Mono'",
                      fontWeight: w.includes("3/4") || w.includes("quarter") ? 600 : 400,
                    }}>⚠ {w}</div>
                  ))}
                </div>
              </>
            )}

            {/* Ahmed regime */}
            {result.geometry?.ahmedRegime && (
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "7px 10px", marginTop: 8,
                background: "rgba(255,159,10,0.07)", border: "1px solid rgba(255,159,10,0.22)", borderRadius: 5,
              }}>
                <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 9 }}>Ahmed body</span>
                <span style={{
                  color: "#ff9f0a", fontSize: 9, fontWeight: 700,
                  fontFamily: "'IBM Plex Mono'", letterSpacing: "0.08em",
                }}>
                  {result.geometry.ahmedRegime.toUpperCase()} {fmt(result.geometry.rearSlantAngleDeg, 0)}°
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* ═══ CENTRE / MAIN CANVAS ═══ */}
      <div style={{
        display: "flex", flexDirection: "column", overflow: "hidden", padding: "14px",
      }}>
        {/* Tab bar */}
        <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center" }}>
          {["Side", "Front", "Top", "Underside"].map(v => (
            <div key={v} onClick={() => setActiveView(v)}
              style={{
                padding: "5px 14px", borderRadius: 14,
                background: activeView === v ? "rgba(64,156,255,0.15)" : "transparent",
                border: `1px solid ${activeView === v ? "rgba(64,156,255,0.40)" : "rgba(255,255,255,0.08)"}`,
                color: activeView === v ? "#409cff" : "rgba(255,255,255,0.5)",
                fontSize: 10, cursor: "pointer", fontFamily: "'IBM Plex Mono'",
              }}>{v}</div>
          ))}
          {comparisonMode && (
            <div style={{
              padding: "5px 12px", marginLeft: 6,
              background: "rgba(255,69,58,0.14)", borderRadius: 14,
              border: "1px solid rgba(255,69,58,0.4)",
              color: "#ff453a", fontSize: 10, fontFamily: "'IBM Plex Mono'",
            }}>● Comparing A vs B</div>
          )}
          <div style={{ flex: 1 }} />
          {result?.outline_svg && !comparisonMode && (
            <div onClick={exportSvg}
              style={{
                padding: "4px 10px", fontSize: 9, cursor: "pointer",
                border: "1px solid rgba(255,255,255,0.10)", borderRadius: 4,
                color: "rgba(255,255,255,0.5)",
              }}>Export SVG</div>
          )}
        </div>

        {/* Main view */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {activeView === "Side" && (
            <SideView contourPts={contourPts} contourPtsB={contourPtsB}
              geo={geoToUse} method={result?.method || carHistory[0]?.method || "—"}
              comparisonMode={comparisonMode} comparison={comparison} />
          )}
          {activeView === "Front"     && <FrontView geo={geoToUse} carDims={carDims} />}
          {activeView === "Top"       && <TopView   geo={geoToUse} carDims={carDims} />}
          {activeView === "Underside" && <UnderView geo={geoToUse} carDims={carDims} />}
        </div>

        {/* Thumbnail strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginTop: 10 }}>
          {["Side","Front","Top","Underside"].map(v => (
            <div key={v} onClick={() => setActiveView(v)}
              style={{
                height: 88, borderRadius: 6, cursor: "pointer",
                background: activeView === v ? "rgba(64,156,255,0.07)" : "rgba(4,7,13,1)",
                border: `1px solid ${activeView === v ? "rgba(64,156,255,0.4)" : "rgba(255,255,255,0.06)"}`,
                display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: 7,
              }}>
              <span style={{
                color: activeView === v ? "#409cff" : "rgba(255,255,255,0.4)",
                fontSize: 9, fontFamily: "'IBM Plex Mono'",
              }}>{v}</span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          marginTop: 10, paddingTop: 8,
          borderTop: "1px solid rgba(255,255,255,0.05)",
          display: "flex", justifyContent: "space-between",
          fontSize: 9, color: "rgba(255,255,255,0.35)", fontFamily: "'IBM Plex Mono'",
        }}>
          <span>main · 97e4b36 · DrivAerML · 484 HF-LES cases · val Cd err 5.4%</span>
          <span>Runs: {runCount} · {analysing ? "● Analysing" : "● Ready"}</span>
        </div>
      </div>
    </div>
  );
}
