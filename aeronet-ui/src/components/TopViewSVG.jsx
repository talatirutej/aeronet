// FrontViewSVG.jsx — Engineering front view outline
// Renders the actual extracted contour from the front photo.
// Also exports TopViewSVG (synthetic from geometry params).
// Copyright (c) 2026 Rutej Talati / statinsite.com

// ── FrontViewSVG ─────────────────────────────────────────────────────────────
// Renders the real extracted front contour, same approach as SideViewSVG.
// Key differences from side view:
//   - bboxAspect is 0.6–0.9 (taller than wide) → canvas scales to portrait shape
//   - No arch voids (wheel arches are part of the contour already)
//   - Shows track width measurement line between wheel centres
//   - Shows symmetry warning if photo is off-axis
//   - Shows frontal area measurement annotation

export default function FrontViewSVG({ g, showSep, isDrawing, drawDone }) {
  const CW = 320, CH = 320, CPAD = 18
  const scale_x = CW - CPAD * 2
  const scale_y = CH - 36
  const off_x   = CPAD
  const off_y   = 8

  // Empty state
  if (!g || !g._contourPts || g._contourPts.length <= 10) {
    return (
      <svg viewBox={`0 0 ${CW} ${CH}`} style={{ width:'100%', height:'100%' }} preserveAspectRatio="xMidYMid meet">
        <rect width={CW} height={CH} fill="#070d14"/>
        <text x={CW/2} y={CH/2} textAnchor="middle" fill="rgba(255,255,255,0.07)"
          fontSize="10" fontFamily="'IBM Plex Mono',monospace">Upload front photo</text>
      </svg>
    )
  }

  const rawPts = g._smoothPts ?? g._contourPts

  // ── Scale to canvas ───────────────────────────────────────────────────────
  // Front view bbox is typically portrait (aspect 0.65–0.95).
  // Scale so the car fills the canvas appropriately.
  const bboxAspect   = g._bboxAspect ?? 0.80
  const canvasAspect = scale_x / scale_y

  let draw_w, draw_h
  if (bboxAspect > canvasAspect) {
    // Wider than canvas → constrain by width
    draw_w = scale_x * 0.88; draw_h = draw_w / bboxAspect
  } else {
    // Taller than canvas → constrain by height
    draw_h = scale_y * 0.88; draw_w = draw_h * bboxAspect
    if (draw_w > scale_x * 0.88) { draw_w = scale_x * 0.88; draw_h = draw_w / bboxAspect }
  }

  const draw_ox = off_x + (scale_x - draw_w) / 2
  const draw_oy = off_y + (scale_y - draw_h) * 0.45
  const toSVG   = ([nx, ny]) => [draw_ox + nx * draw_w, draw_oy + ny * draw_h]

  // Build path
  const pathD = rawPts.map((p, i) => {
    const [sx, sy] = toSVG(p)
    return `${i === 0 ? 'M' : 'L'}${sx.toFixed(2)},${sy.toFixed(2)}`
  }).join(' ') + ' Z'

  const gY = Math.min(draw_oy + draw_h + 6, CH - 10)

  // ── Measurements from geometry ────────────────────────────────────────────
  const keypoints = g._keypoints
  const rawWheels = keypoints?.wheels ?? []

  // Track width line — between left and right wheel centres
  const trackLine = rawWheels.length >= 2 ? {
    x1: draw_ox + rawWheels[0].nx * draw_w,
    x2: draw_ox + rawWheels[1].nx * draw_w,
    y:  draw_oy + (rawWheels[0].ny * draw_h + rawWheels[1].ny * draw_h) / 2,
  } : null

  // Frontal area from geometry
  const frontalArea = g.frontalAreaNorm ?? null
  const symmetryScore = g.symmetryScore ?? null
  const isOffAxis = symmetryScore !== null && symmetryScore < 0.80

  // Centre line (symmetry axis)
  const centreX = draw_ox + draw_w / 2

  // Widest point annotation
  const shoulderW = g.shoulderWidthNorm ?? null
  const shoulderLineW = shoulderW ? shoulderW * draw_h : null  // shoulderWidthNorm is normalised to car height

  return (
    <svg viewBox={`0 0 ${CW} ${CH}`} style={{ width:'100%', height:'100%' }} preserveAspectRatio="xMidYMid meet">
      <rect width={CW} height={CH} fill="#070d14"/>

      {/* Ground line */}
      <line x1={draw_ox} y1={gY} x2={draw_ox + draw_w} y2={gY}
        stroke="rgba(255,255,255,0.06)" strokeWidth=".5"/>

      {/* Symmetry centre line — faint vertical */}
      <line x1={centreX.toFixed(1)} y1={draw_oy.toFixed(1)}
        x2={centreX.toFixed(1)} y2={gY.toFixed(1)}
        stroke={isOffAxis ? 'rgba(255,159,10,0.25)' : 'rgba(255,255,255,0.05)'}
        strokeWidth=".5" strokeDasharray="3 3"/>

      {/* The actual extracted front outline */}
      <path
        d={pathD}
        fill="none"
        stroke="rgba(255,255,255,0.92)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        style={{
          strokeDasharray: 3000,
          strokeDashoffset: isDrawing || drawDone ? 0 : 3000,
          transition: isDrawing ? 'stroke-dashoffset 2.4s cubic-bezier(0.4,0,0.2,1)' : 'none',
        }}/>

      {/* Track width measurement line */}
      {drawDone && trackLine && (
        <g opacity="0" style={{ animation: 'wheel-in 0.5s ease 1.2s forwards' }}>
          <line
            x1={trackLine.x1.toFixed(1)} y1={trackLine.y.toFixed(1)}
            x2={trackLine.x2.toFixed(1)} y2={trackLine.y.toFixed(1)}
            stroke="rgba(10,132,255,0.55)" strokeWidth="1" strokeDasharray="3 2"/>
          {/* End tick marks */}
          <line x1={trackLine.x1.toFixed(1)} y1={(trackLine.y-4).toFixed(1)}
            x2={trackLine.x1.toFixed(1)} y2={(trackLine.y+4).toFixed(1)}
            stroke="rgba(10,132,255,0.55)" strokeWidth="1"/>
          <line x1={trackLine.x2.toFixed(1)} y1={(trackLine.y-4).toFixed(1)}
            x2={trackLine.x2.toFixed(1)} y2={(trackLine.y+4).toFixed(1)}
            stroke="rgba(10,132,255,0.55)" strokeWidth="1"/>
          <text
            x={((trackLine.x1 + trackLine.x2) / 2).toFixed(1)}
            y={(trackLine.y - 7).toFixed(1)}
            textAnchor="middle"
            fill="rgba(10,132,255,0.65)"
            fontSize="7"
            fontFamily="'IBM Plex Mono',monospace">
            TRACK
          </text>
        </g>
      )}

      {/* Off-axis warning */}
      {drawDone && isOffAxis && (
        <g>
          <rect x={CPAD} y={CH-22} width={CW-CPAD*2} height={14} rx="3"
            fill="rgba(255,159,10,0.12)" stroke="rgba(255,159,10,0.3)" strokeWidth=".5"/>
          <text x={CW/2} y={CH-12} textAnchor="middle"
            fill="rgba(255,159,10,0.85)" fontSize="7"
            fontFamily="'IBM Plex Mono',monospace">
            ⚠ Off-axis photo — frontal area may be inaccurate
          </text>
        </g>
      )}

      {/* Frontal area annotation */}
      {drawDone && frontalArea && (
        <text x={draw_ox + 4} y={draw_oy - 2}
          fill="rgba(10,132,255,0.5)" fontSize="7"
          fontFamily="'IBM Plex Mono',monospace">
          Af={frontalArea.toFixed(3)}
        </text>
      )}

      {/* Symmetry score */}
      {drawDone && symmetryScore !== null && (
        <text x={CW - CPAD - 2} y={draw_oy - 2}
          textAnchor="end"
          fill={isOffAxis ? 'rgba(255,159,10,0.6)' : 'rgba(48,209,88,0.5)'}
          fontSize="7"
          fontFamily="'IBM Plex Mono',monospace">
          sym={symmetryScore.toFixed(2)}
        </text>
      )}

      {/* Status text */}
      <text x={CW/2} y={CH-3} textAnchor="middle" fill="rgba(255,255,255,0.07)"
        fontSize="8" fontFamily="'IBM Plex Mono',monospace" letterSpacing=".12em">
        FRONT · {g._contourPts?.length ?? 0}pts · {g._method ?? ''}
      </text>
    </svg>
  )
}

// ── TopViewSVG ────────────────────────────────────────────────────────────────
// Synthetic top view from geometry parameters.
// Until a real top-view contour extractor is built, this uses the
// side-view geometry to reconstruct a plan-view silhouette.

export function TopViewSVG({ g }) {
  const W = 300, H = 220, cx = W/2, cy = H/2+6
  const kp     = g?._keypoints, wheels = kp?.wheels ?? []
  const bl     = Math.round(Math.min(175, Math.max(125, (g?.aspectRatio??2.0)*70)))
  const bw     = 68
  const hoodEnd  = cy + bl*((g?.hoodRatio??0.28)-0.50)
  const cabinEnd = cy + bl*((g?.hoodRatio??0.28)+(g?.cabinRatio??0.44)-0.50)
  const ghW    = bw*0.41
  const fwy    = wheels.length>=1 ? cy+bl*(wheels[0].nx*1.1-0.55) : cy-bl*0.28
  const rwy    = wheels.length>=2 ? cy+bl*(wheels[1].nx*1.1-0.55) : cy+bl*0.26
  const wR     = wheels.length>=1 ? Math.max(8, Math.min(16, wheels[0].r/800*W*0.9)) : 10
  const wTrack = bw*0.52
  const body = [
    `M ${cx} ${cy-bl/2+5}`,
    `Q ${cx-bw*0.24} ${cy-bl/2+1} ${cx-bw*0.48} ${cy-bl/2+22}`,
    `Q ${cx-bw*0.50} ${cy-bl/2+52} ${cx-bw*0.50} ${cy}`,
    `Q ${cx-bw*0.50} ${cy+bl*0.12} ${cx-bw*0.44} ${cy+bl/2-10}`,
    `Q ${cx-bw*0.30} ${cy+bl/2-2} ${cx} ${cy+bl/2-2}`,
    `Q ${cx+bw*0.30} ${cy+bl/2-2} ${cx+bw*0.44} ${cy+bl/2-10}`,
    `Q ${cx+bw*0.50} ${cy+bl*0.12} ${cx+bw*0.50} ${cy}`,
    `Q ${cx+bw*0.50} ${cy-bl/2+52} ${cx+bw*0.48} ${cy-bl/2+22}`,
    `Q ${cx+bw*0.24} ${cy-bl/2+1} ${cx} ${cy-bl/2+5}`,
    'Z',
  ].join(' ')
  const ghPath = [
    `M ${cx} ${hoodEnd-4}`,
    `Q ${cx-ghW*0.50} ${hoodEnd+2} ${cx-ghW*0.52} ${hoodEnd+16}`,
    `L ${cx-ghW*0.52} ${cabinEnd-10}`,
    `Q ${cx-ghW*0.44} ${cabinEnd} ${cx} ${cabinEnd}`,
    `Q ${cx+ghW*0.44} ${cabinEnd} ${cx+ghW*0.52} ${cabinEnd-10}`,
    `L ${cx+ghW*0.52} ${hoodEnd+16}`,
    `Q ${cx+ghW*0.50} ${hoodEnd+2} ${cx} ${hoodEnd-4}`,
    'Z',
  ].join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'100%'}} preserveAspectRatio="xMidYMid meet">
      <rect width={W} height={H} fill="#070d14"/>
      <path d={body}   fill="none" stroke="rgba(10,132,255,0.65)" strokeWidth="1.1"/>
      <path d={ghPath} fill="none" stroke="rgba(10,132,255,0.32)" strokeWidth=".9"/>
      {[[-wTrack,fwy],[wTrack,fwy],[-wTrack,rwy],[wTrack,rwy]].map(([wx,wy],i)=>(
        <ellipse key={i} cx={cx+wx} cy={wy} rx={wR*0.44} ry={wR}
          fill="none" stroke="rgba(10,132,255,0.72)" strokeWidth="1.2"/>
      ))}
      <text x={cx} y={H-4} textAnchor="middle" fill="rgba(255,255,255,0.1)"
        fontSize="9" fontFamily="'IBM Plex Mono',monospace" letterSpacing=".12em">TOP</text>
    </svg>
  )
}
