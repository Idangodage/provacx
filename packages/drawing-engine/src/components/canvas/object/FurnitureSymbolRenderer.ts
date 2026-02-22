/**
 * FurnitureSymbolRenderer
 *
 * Canvas 2D multi-view rendering functions for furniture and fixture symbols.
 * Supports plan, front elevation, and end elevation views with detailed
 * materials (wood grain, fabric sheen, glass reflections, metal gradients).
 */

// =============================================================================
// Types
// =============================================================================

export type FurnitureViewMode = 'plan' | 'front' | 'end';

export type FurnitureRenderType =
  | 'dining-chair'
  | 'office-chair'
  | 'armchair'
  | 'sofa-2'
  | 'sofa-3'
  | 'dining-table'
  | 'round-table'
  | 'coffee-table'
  | 'bed-single'
  | 'bed-double'
  | 'bed-queen'
  | 'bed-king'
  | 'nightstand'
  | 'dresser'
  | 'wardrobe'
  | 'tv-stand'
  | 'bookshelf'
  | 'buffet'
  | 'sink'
  | 'stove'
  | 'fridge'
  | 'toilet'
  | 'bathtub'
  | 'shower';

// =============================================================================
// Material Palette
// =============================================================================

const MAT = {
  oak:     { t: '#5a3820', f: '#4a2c16', s: '#3a2010' },
  walnut:  { t: '#2e1c0c', f: '#241408', s: '#1c0e04' },
  white:   { t: '#c8c8c8', f: '#b0b0b0', s: '#909090' },
  fabric:  { t: '#3c3430', f: '#302a28', s: '#261e1e' },
  cushion: { t: '#4c3c34', f: '#3e3028', s: '#302420' },
  metal:   { t: '#484848', f: '#383838', s: '#2c2c2c' },
  chrome:  { t: '#606060', f: '#505050', s: '#404040' },
  glass:   { t: 'rgba(120,200,255,0.3)', f: 'rgba(100,180,240,0.2)', s: 'rgba(80,160,220,0.15)' },
  ceramic: { t: '#e0e0e0', f: '#d0d0d0', s: '#b0b0b0' },
  steel:   { t: '#707070', f: '#606060', s: '#505050' },
};

// =============================================================================
// Drawing Helpers
// =============================================================================

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  r: number, fill?: string | CanvasGradient, stroke?: string, lw?: number
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw ?? 1; ctx.stroke(); }
}

function woodGrain(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, horiz: boolean): void {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 0.6;
  if (horiz) {
    for (let i = y; i < y + h; i += 4) {
      ctx.beginPath(); ctx.moveTo(x, i); ctx.lineTo(x + w, i + (Math.random() - 0.5) * 1.5); ctx.stroke();
    }
  } else {
    for (let i = x; i < x + w; i += 4) {
      ctx.beginPath(); ctx.moveTo(i, y); ctx.lineTo(i + (Math.random() - 0.5) * 1.5, y + h); ctx.stroke();
    }
  }
  ctx.restore();
}

function fabricSheen(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, 'rgba(255,255,255,0.06)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.02)');
  g.addColorStop(1, 'rgba(0,0,0,0.06)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

function planShadow(ctx: CanvasRenderingContext2D, cx: number, cy: number, rw: number, rh: number): void {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath();
  ctx.ellipse(cx + rw * 0.02, cy + rh * 0.02, rw, rh, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function legPlan(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, col: string): void {
  ctx.fillStyle = col;
  ctx.fillRect(x - size / 2, y - size / 2, size, size);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x - size / 2, y - size / 2, size, size);
}

function legFront(
  ctx: CanvasRenderingContext2D,
  x: number, z0: number, z1: number, thick: number, col: string
): void {
  const g = ctx.createLinearGradient(x, 0, x + thick, 0);
  g.addColorStop(0, col);
  g.addColorStop(0.4, lighten(col, 15));
  g.addColorStop(1, col);
  ctx.fillStyle = g;
  ctx.fillRect(x, z0, thick, z1 - z0);
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 0.6;
  ctx.strokeRect(x, z0, thick, z1 - z0);
}

function floorLine(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number): void {
  ctx.strokeStyle = '#666';
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.05)';
  ctx.fillRect(x0, y, x1 - x0, 3);
}

function lighten(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, ((num >> 16) & 255) + amount);
  const g = Math.min(255, ((num >> 8) & 255) + amount);
  const b = Math.min(255, (num & 255) + amount);
  return `rgb(${r},${g},${b})`;
}

// =============================================================================
// Plan View Renderers
// =============================================================================

function planDiningChair(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, d: number): void {
  planShadow(ctx, cx, cy, w * 0.48, d * 0.48);
  // Seat
  roundRect(ctx, cx - w / 2, cy - d / 2 + d * 0.08, w, d * 0.75, w * 0.06, MAT.oak.t, 'rgba(0,0,0,0.4)', 0.7);
  woodGrain(ctx, cx - w / 2, cy - d / 2 + d * 0.08, w, d * 0.75, true);
  // Back bar
  roundRect(ctx, cx - w / 2, cy - d / 2, w, d * 0.14, 2, MAT.oak.f, 'rgba(0,0,0,0.35)', 0.7);
  // Legs
  const lg = w * 0.06;
  [[-0.42, -0.42], [-0.42, 0.32], [0.42, -0.42], [0.42, 0.32]].forEach(([fx, fy]) =>
    legPlan(ctx, cx + w * fx, cy + d * fy, lg, MAT.oak.s));
}

function planOfficeChair(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, d: number): void {
  const r = w / 2;
  planShadow(ctx, cx, cy, r, r);
  // 5-star base
  ctx.strokeStyle = '#3a3a3a';
  ctx.lineWidth = w * 0.04;
  ctx.lineCap = 'round';
  const baseR = r * 0.82;
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5 - Math.PI / 2;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * baseR, cy + Math.sin(a) * baseR);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * baseR, cy + Math.sin(a) * baseR, w * 0.04, 0, Math.PI * 2);
    ctx.fillStyle = '#282828'; ctx.fill();
  }
  ctx.lineCap = 'butt';
  // Seat
  const sg = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.2, r * 0.1, cx, cy, r * 0.85);
  sg.addColorStop(0, MAT.fabric.t);
  sg.addColorStop(1, MAT.fabric.s);
  ctx.fillStyle = sg;
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.85, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 0.8; ctx.stroke();
  fabricSheen(ctx, cx - r * 0.85, cy - r * 0.85, r * 1.7, r * 1.7);
  // Backrest
  roundRect(ctx, cx - r * 0.72, cy - r * 1.1, r * 1.44, r * 0.4, 3, MAT.fabric.t, 'rgba(0,0,0,0.35)', 0.7);
  // Armrests
  roundRect(ctx, cx - r * 1.1, cy - r * 0.3, r * 0.3, r * 0.6, 2, MAT.metal.t, 'rgba(0,0,0,0.35)', 0.7);
  roundRect(ctx, cx + r * 0.8, cy - r * 0.3, r * 0.3, r * 0.6, 2, MAT.metal.t, 'rgba(0,0,0,0.35)', 0.7);
}

function planArmchair(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, d: number): void {
  const arm = w * 0.11, back = d * 0.19;
  planShadow(ctx, cx, cy, w * 0.50, d * 0.50);
  roundRect(ctx, cx - w / 2, cy - d / 2, w, d, w * 0.04, MAT.fabric.f, 'rgba(0,0,0,0.35)', 0.7);
  // Armrests
  roundRect(ctx, cx - w / 2, cy - d / 2 + d * 0.1, arm, d * 0.8, 2, MAT.fabric.t, 'rgba(0,0,0,0.25)', 0.6);
  roundRect(ctx, cx + w / 2 - arm, cy - d / 2 + d * 0.1, arm, d * 0.8, 2, MAT.fabric.t, 'rgba(0,0,0,0.25)', 0.6);
  // Back
  roundRect(ctx, cx - w / 2 + arm * 0.1, cy - d / 2, w - arm * 0.2, back, 2, MAT.fabric.s, 'rgba(0,0,0,0.25)', 0.6);
  // Seat cushion
  roundRect(ctx, cx - w / 2 + arm * 1.1, cy - d / 2 + back + 3, w - arm * 2.2, d - back - 6, 3, MAT.cushion.t, 'rgba(0,0,0,0.25)', 0.6);
  fabricSheen(ctx, cx - w / 2 + arm * 1.1, cy - d / 2 + back + 3, w - arm * 2.2, d - back - 6);
  // Legs
  const lg = w * 0.035;
  [[0.08, 0.08], [0.92, 0.08], [0.08, 0.9], [0.92, 0.9]].forEach(([fx, fy]) =>
    legPlan(ctx, cx - w / 2 + w * fx, cy - d / 2 + d * fy, lg, MAT.oak.s));
}

function planSofa(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, d: number, seats: number): void {
  const arm = w * 0.045, back = d * 0.22;
  planShadow(ctx, cx, cy, w * 0.50, d * 0.50);
  roundRect(ctx, cx - w / 2, cy - d / 2, w, d, w * 0.015, MAT.fabric.f, 'rgba(0,0,0,0.35)', 0.7);
  // Arms
  roundRect(ctx, cx - w / 2, cy - d / 2 + d * 0.06, arm, d * 0.88, 2, MAT.fabric.t, 'rgba(0,0,0,0.25)', 0.6);
  roundRect(ctx, cx + w / 2 - arm, cy - d / 2 + d * 0.06, arm, d * 0.88, 2, MAT.fabric.t, 'rgba(0,0,0,0.25)', 0.6);
  // Back
  roundRect(ctx, cx - w / 2 + arm * 0.1, cy - d / 2, w - arm * 0.2, back, 2, MAT.fabric.s, 'rgba(0,0,0,0.25)', 0.6);
  // Seat cushions
  const si = arm, sw = (w - si * 2 - (seats - 1) * 2) / seats;
  for (let i = 0; i < seats; i++) {
    const sx = cx - w / 2 + si + i * (sw + 2);
    roundRect(ctx, sx, cy - d / 2 + back + 3, sw, d - back - 6, 3, MAT.cushion.t, 'rgba(0,0,0,0.2)', 0.5);
    fabricSheen(ctx, sx, cy - d / 2 + back + 3, sw, d - back - 6);
  }
  // Back cushions
  for (let i = 0; i < seats; i++) {
    const sx = cx - w / 2 + si + i * (sw + 2);
    roundRect(ctx, sx, cy - d / 2 + 3, sw, back - 6, 2, MAT.cushion.f, 'rgba(0,0,0,0.2)', 0.4);
  }
  // Legs
  const lg = w * 0.018;
  [[0.03, 0.07], [0.97, 0.07], [0.03, 0.93], [0.97, 0.93]].forEach(([fx, fy]) =>
    legPlan(ctx, cx - w / 2 + w * fx, cy - d / 2 + d * fy, lg, MAT.oak.s));
}

function planDiningTable(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, d: number): void {
  planShadow(ctx, cx, cy, w * 0.50, d * 0.50);
  const g = ctx.createLinearGradient(cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2);
  g.addColorStop(0, MAT.oak.t);
  g.addColorStop(0.5, '#6a4830');
  g.addColorStop(1, MAT.oak.f);
  roundRect(ctx, cx - w / 2, cy - d / 2, w, d, w * 0.01, g, 'rgba(0,0,0,0.35)', 0.7);
  woodGrain(ctx, cx - w / 2, cy - d / 2, w, d, false);
  // Apron inset
  const li = w * 0.04;
  roundRect(ctx, cx - w / 2 + li, cy - d / 2 + li, w - li * 2, d - li * 2, 2, undefined, 'rgba(0,0,0,0.15)', 0.5);
  // Legs
  const lg = w * 0.035;
  [[0.04, 0.06], [0.96, 0.06], [0.04, 0.94], [0.96, 0.94]].forEach(([fx, fy]) =>
    legPlan(ctx, cx - w / 2 + w * fx, cy - d / 2 + d * fy, lg, MAT.oak.s));
  // Center guides
  ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.lineWidth = 0.5; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(cx - w / 2 + 12, cy); ctx.lineTo(cx + w / 2 - 12, cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy - d / 2 + 8); ctx.lineTo(cx, cy + d / 2 - 8); ctx.stroke();
  ctx.setLineDash([]);
}

function planRoundTable(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, _d: number): void {
  const r = w / 2;
  planShadow(ctx, cx, cy, r, r);
  const g = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.2, r * 0.05, cx, cy, r);
  g.addColorStop(0, '#6a4830');
  g.addColorStop(0.7, MAT.oak.t);
  g.addColorStop(1, MAT.oak.f);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  // Circular grain
  ctx.strokeStyle = 'rgba(0,0,0,0.06)'; ctx.lineWidth = 0.5;
  for (let ri = r * 0.2; ri < r; ri += r * 0.12) {
    ctx.beginPath(); ctx.arc(cx, cy, ri, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  // Pedestal
  const pedR = r * 0.18;
  ctx.beginPath(); ctx.arc(cx, cy, pedR, 0, Math.PI * 2);
  ctx.fillStyle = MAT.oak.s; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.6; ctx.stroke();
  // Crosshairs
  ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 0.4; ctx.setLineDash([2, 2]);
  ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke();
  ctx.setLineDash([]);
}

function planCoffeeTable(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, d: number): void {
  planShadow(ctx, cx, cy, w * 0.50, d * 0.50);
  // Glass top
  const g = ctx.createLinearGradient(cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2);
  g.addColorStop(0, 'rgba(140,210,255,0.22)');
  g.addColorStop(0.5, 'rgba(160,220,255,0.16)');
  g.addColorStop(1, 'rgba(120,190,240,0.2)');
  roundRect(ctx, cx - w / 2, cy - d / 2, w, d, w * 0.03, g, 'rgba(80,160,230,0.45)', 0.8);
  // Reflection
  ctx.strokeStyle = 'rgba(200,240,255,0.15)'; ctx.lineWidth = w * 0.012;
  ctx.beginPath(); ctx.moveTo(cx - w * 0.35, cy - d * 0.36); ctx.lineTo(cx + w * 0.2, cy - d * 0.36); ctx.stroke();
  // Frame inset
  roundRect(ctx, cx - w / 2 + w * 0.03, cy - d / 2 + d * 0.06, w * 0.94, d * 0.88, w * 0.025, undefined, 'rgba(80,160,230,0.25)', 0.5);
  // Metal legs
  const lg = w * 0.025;
  [[0.05, 0.1], [0.95, 0.1], [0.05, 0.9], [0.95, 0.9]].forEach(([fx, fy]) =>
    legPlan(ctx, cx - w / 2 + w * fx, cy - d / 2 + d * fy, lg, MAT.chrome.t));
}

function planBed(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, d: number): void {
  planShadow(ctx, cx, cy, w * 0.50, d * 0.50);
  // Mattress
  roundRect(ctx, cx - w / 2, cy - d / 2, w, d, w * 0.03, MAT.white.t, 'rgba(0,0,0,0.25)', 0.7);
  // Pillow area
  const pillowH = d * 0.12;
  roundRect(ctx, cx - w / 2 + w * 0.08, cy - d / 2 + d * 0.03, w * 0.84, pillowH, 3, MAT.white.f, 'rgba(0,0,0,0.15)', 0.5);
  // Quilt line
  ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(cx - w / 2 + w * 0.06, cy - d / 2 + pillowH + d * 0.08);
  ctx.lineTo(cx + w / 2 - w * 0.06, cy - d / 2 + pillowH + d * 0.08);
  ctx.stroke();
  // Headboard
  roundRect(ctx, cx - w / 2, cy - d / 2 - d * 0.03, w, d * 0.05, 2, MAT.oak.f, 'rgba(0,0,0,0.3)', 0.7);
  // Legs
  const lg = w * 0.03;
  [[0.04, 0.04], [0.96, 0.04], [0.04, 0.96], [0.96, 0.96]].forEach(([fx, fy]) =>
    legPlan(ctx, cx - w / 2 + w * fx, cy - d / 2 + d * fy, lg, MAT.oak.s));
}

function planNightstand(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, d: number): void {
  planShadow(ctx, cx, cy, w * 0.48, d * 0.48);
  roundRect(ctx, cx - w / 2, cy - d / 2, w, d, 2, MAT.oak.t, 'rgba(0,0,0,0.35)', 0.7);
  woodGrain(ctx, cx - w / 2, cy - d / 2, w, d, true);
  // Drawer line
  ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(cx - w / 2 + 3, cy); ctx.lineTo(cx + w / 2 - 3, cy); ctx.stroke();
  // Knob
  ctx.beginPath(); ctx.arc(cx, cy - d * 0.25, w * 0.04, 0, Math.PI * 2);
  ctx.fillStyle = MAT.chrome.t; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy + d * 0.25, w * 0.04, 0, Math.PI * 2);
  ctx.fillStyle = MAT.chrome.t; ctx.fill();
}

function planDresser(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, d: number): void {
  planShadow(ctx, cx, cy, w * 0.48, d * 0.48);
  roundRect(ctx, cx - w / 2, cy - d / 2, w, d, 2, MAT.oak.t, 'rgba(0,0,0,0.35)', 0.7);
  woodGrain(ctx, cx - w / 2, cy - d / 2, w, d, true);
  // Drawer lines
  const rows = 4;
  for (let i = 1; i < rows; i++) {
    const ly = cy - d / 2 + d * (i / rows);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(cx - w / 2 + 3, ly); ctx.lineTo(cx + w / 2 - 3, ly); ctx.stroke();
  }
  // Knobs
  for (let i = 0; i < rows; i++) {
    const ky = cy - d / 2 + d * ((i + 0.5) / rows);
    ctx.beginPath(); ctx.arc(cx - w * 0.15, ky, w * 0.025, 0, Math.PI * 2);
    ctx.fillStyle = MAT.chrome.t; ctx.fill();
    ctx.beginPath(); ctx.arc(cx + w * 0.15, ky, w * 0.025, 0, Math.PI * 2);
    ctx.fillStyle = MAT.chrome.t; ctx.fill();
  }
}

function planWardrobe(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, d: number): void {
  planShadow(ctx, cx, cy, w * 0.48, d * 0.48);
  roundRect(ctx, cx - w / 2, cy - d / 2, w, d, 2, MAT.oak.t, 'rgba(0,0,0,0.35)', 0.7);
  woodGrain(ctx, cx - w / 2, cy - d / 2, w, d, false);
  // Door divider
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.7;
  ctx.beginPath(); ctx.moveTo(cx, cy - d / 2 + 3); ctx.lineTo(cx, cy + d / 2 - 3); ctx.stroke();
  // Handles
  ctx.strokeStyle = MAT.chrome.t; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(cx - w * 0.08, cy - d * 0.1); ctx.lineTo(cx - w * 0.08, cy + d * 0.1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx + w * 0.08, cy - d * 0.1); ctx.lineTo(cx + w * 0.08, cy + d * 0.1); ctx.stroke();
}

function planTvStand(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, d: number): void {
  planShadow(ctx, cx, cy, w * 0.48, d * 0.48);
  roundRect(ctx, cx - w / 2, cy - d / 2, w, d, 2, MAT.oak.t, 'rgba(0,0,0,0.35)', 0.7);
  woodGrain(ctx, cx - w / 2, cy - d / 2, w, d, true);
  // Shelf line
  ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(cx - w / 2 + 3, cy); ctx.lineTo(cx + w / 2 - 3, cy); ctx.stroke();
  // Cable hole
  ctx.beginPath(); ctx.arc(cx, cy + d * 0.3, w * 0.02, 0, Math.PI * 2);
  ctx.fillStyle = '#1a1a1a'; ctx.fill();
}

function planBookshelf(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, d: number): void {
  planShadow(ctx, cx, cy, w * 0.48, d * 0.48);
  roundRect(ctx, cx - w / 2, cy - d / 2, w, d, 2, MAT.oak.t, 'rgba(0,0,0,0.35)', 0.7);
  // Shelf lines
  for (let i = 1; i < 5; i++) {
    const ly = cy - d / 2 + d * (i / 5);
    ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(cx - w / 2 + 2, ly); ctx.lineTo(cx + w / 2 - 2, ly); ctx.stroke();
  }
  // Book spines (decorative)
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  for (let i = 0; i < 5; i++) {
    const bx = cx - w / 2 + w * 0.1 + i * w * 0.16;
    ctx.fillRect(bx, cy - d / 2 + 3, w * 0.12, d - 6);
  }
}

function planBuffet(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, d: number): void {
  planShadow(ctx, cx, cy, w * 0.48, d * 0.48);
  roundRect(ctx, cx - w / 2, cy - d / 2, w, d, 2, MAT.oak.t, 'rgba(0,0,0,0.35)', 0.7);
  woodGrain(ctx, cx - w / 2, cy - d / 2, w, d, true);
  // 3 door sections
  for (let i = 0; i < 2; i++) {
    const lx = cx - w / 2 + w * ((i + 1) / 3);
    ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(lx, cy - d / 2 + 3); ctx.lineTo(lx, cy + d / 2 - 3); ctx.stroke();
  }
  // Knobs
  for (let i = 0; i < 3; i++) {
    const kx = cx - w / 2 + w * ((i + 0.5) / 3);
    ctx.beginPath(); ctx.arc(kx, cy, w * 0.015, 0, Math.PI * 2);
    ctx.fillStyle = MAT.chrome.t; ctx.fill();
  }
}

function planSink(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, d: number): void {
  planShadow(ctx, cx, cy, w * 0.48, d * 0.48);
  // Counter
  roundRect(ctx, cx - w / 2, cy - d / 2, w, d, 2, MAT.ceramic.t, 'rgba(0,0,0,0.25)', 0.7);
  // Basin
  roundRect(ctx, cx - w * 0.38, cy - d * 0.35, w * 0.76, d * 0.6, w * 0.06, MAT.ceramic.f, 'rgba(0,0,0,0.2)', 0.6);
  // Drain
  ctx.beginPath(); ctx.arc(cx, cy + d * 0.05, w * 0.04, 0, Math.PI * 2);
  ctx.fillStyle = '#888'; ctx.fill();
  // Faucet
  roundRect(ctx, cx - w * 0.06, cy - d * 0.42, w * 0.12, d * 0.1, 2, MAT.chrome.t, 'rgba(0,0,0,0.3)', 0.6);
}

function planStove(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, d: number): void {
  planShadow(ctx, cx, cy, w * 0.48, d * 0.48);
  roundRect(ctx, cx - w / 2, cy - d / 2, w, d, 2, '#2a2a2a', 'rgba(0,0,0,0.4)', 0.7);
  // 4 burners
  const br = w * 0.14;
  [[-0.25, -0.28], [0.25, -0.28], [-0.25, 0.22], [0.25, 0.22]].forEach(([fx, fy]) => {
    ctx.beginPath();
    ctx.arc(cx + w * fx, cy + d * fy, br, 0, Math.PI * 2);
    ctx.strokeStyle = '#555'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + w * fx, cy + d * fy, br * 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = '#444'; ctx.lineWidth = 0.8; ctx.stroke();
  });
  // Control panel
  roundRect(ctx, cx - w * 0.4, cy + d * 0.38, w * 0.8, d * 0.08, 1, '#333', 'rgba(0,0,0,0.3)', 0.5);
}

function planFridge(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, d: number): void {
  planShadow(ctx, cx, cy, w * 0.48, d * 0.48);
  roundRect(ctx, cx - w / 2, cy - d / 2, w, d, 2, MAT.white.t, 'rgba(0,0,0,0.25)', 0.7);
  // Door divider
  ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(cx - w / 2 + 3, cy - d * 0.1); ctx.lineTo(cx + w / 2 - 3, cy - d * 0.1); ctx.stroke();
  // Handle
  ctx.strokeStyle = MAT.chrome.t; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(cx + w * 0.35, cy - d * 0.35); ctx.lineTo(cx + w * 0.35, cy - d * 0.15); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx + w * 0.35, cy + d * 0.1); ctx.lineTo(cx + w * 0.35, cy + d * 0.3); ctx.stroke();
}

function planToilet(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, d: number): void {
  planShadow(ctx, cx, cy, w * 0.48, d * 0.48);
  // Tank
  roundRect(ctx, cx - w * 0.38, cy - d / 2, w * 0.76, d * 0.25, 3, MAT.ceramic.t, 'rgba(0,0,0,0.2)', 0.6);
  // Bowl
  ctx.beginPath();
  ctx.ellipse(cx, cy + d * 0.1, w * 0.4, d * 0.35, 0, 0, Math.PI * 2);
  ctx.fillStyle = MAT.ceramic.t; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.7; ctx.stroke();
  // Inner bowl
  ctx.beginPath();
  ctx.ellipse(cx, cy + d * 0.12, w * 0.28, d * 0.24, 0, 0, Math.PI * 2);
  ctx.fillStyle = MAT.ceramic.f; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 0.5; ctx.stroke();
  // Seat
  ctx.beginPath();
  ctx.ellipse(cx, cy + d * 0.1, w * 0.36, d * 0.32, 0, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1; ctx.stroke();
}

function planBathtub(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, d: number): void {
  planShadow(ctx, cx, cy, w * 0.48, d * 0.48);
  // Outer
  roundRect(ctx, cx - w / 2, cy - d / 2, w, d, w * 0.06, MAT.ceramic.t, 'rgba(0,0,0,0.25)', 0.7);
  // Inner
  roundRect(ctx, cx - w / 2 + w * 0.06, cy - d / 2 + d * 0.06, w * 0.88, d * 0.88, w * 0.05, MAT.ceramic.f, 'rgba(0,0,0,0.15)', 0.5);
  // Drain
  ctx.beginPath(); ctx.arc(cx, cy + d * 0.3, w * 0.03, 0, Math.PI * 2);
  ctx.fillStyle = '#888'; ctx.fill();
  // Faucet
  roundRect(ctx, cx - w * 0.06, cy - d / 2 + d * 0.02, w * 0.12, d * 0.06, 2, MAT.chrome.t, 'rgba(0,0,0,0.3)', 0.6);
}

function planShower(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, d: number): void {
  planShadow(ctx, cx, cy, w * 0.48, d * 0.48);
  // Base
  roundRect(ctx, cx - w / 2, cy - d / 2, w, d, 3, MAT.ceramic.f, 'rgba(0,0,0,0.2)', 0.6);
  // Drain
  ctx.beginPath(); ctx.arc(cx, cy, w * 0.04, 0, Math.PI * 2);
  ctx.fillStyle = '#888'; ctx.fill();
  // Shower head circle
  ctx.beginPath(); ctx.arc(cx, cy - d * 0.3, w * 0.08, 0, Math.PI * 2);
  ctx.strokeStyle = MAT.chrome.t; ctx.lineWidth = 1; ctx.stroke();
  // Glass door line
  ctx.strokeStyle = 'rgba(80,180,240,0.4)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(cx - w / 2 + 2, cy + d / 2 - 2); ctx.lineTo(cx + w / 2 - 2, cy + d / 2 - 2); ctx.stroke();
}

// =============================================================================
// Front Elevation Renderers
// =============================================================================

function frontDiningChair(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number): void {
  const seatH = h * 0.55, backH = h, legT = w * 0.07, zfl = cy + h / 2, zt = zfl - backH;
  floorLine(ctx, cx - w / 2 - 6, cx + w / 2 + 6, zfl);
  // Legs
  legFront(ctx, cx - w / 2 + w * 0.06, zfl - h * 0.01, zfl, legT, MAT.oak.s);
  legFront(ctx, cx + w / 2 - w * 0.06 - legT, zfl - h * 0.01, zfl, legT, MAT.oak.s);
  legFront(ctx, cx - w / 2 + w * 0.06, zt, zfl - seatH, legT, MAT.oak.s);
  legFront(ctx, cx + w / 2 - w * 0.06 - legT, zt, zfl - seatH, legT, MAT.oak.s);
  // Seat slab
  const seatY = zfl - seatH, stk = legT * 0.8;
  roundRect(ctx, cx - w / 2, seatY, w, stk, 1, MAT.oak.t, 'rgba(0,0,0,0.3)', 0.6);
  woodGrain(ctx, cx - w / 2, seatY, w, stk, true);
  // Seat cushion
  roundRect(ctx, cx - w / 2 + w * 0.06, seatY - stk * 1.8, w * 0.88, stk * 1.8, 2, MAT.cushion.f, 'rgba(0,0,0,0.3)', 0.6);
  fabricSheen(ctx, cx - w / 2 + w * 0.06, seatY - stk * 1.8, w * 0.88, stk * 1.8);
  // Back top rail
  roundRect(ctx, cx - w / 2, zt, w, legT * 0.6, 1, MAT.oak.f, 'rgba(0,0,0,0.3)', 0.6);
  // Back slats
  const slatCnt = 4, slatW = legT * 0.5, slatH = (seatY - zt - legT * 0.6 - legT * 0.3);
  for (let i = 0; i < slatCnt; i++) {
    const sx = cx - w / 2 + w * 0.12 + i * (w * 0.76 / (slatCnt - 1)) - slatW / 2;
    ctx.fillStyle = MAT.oak.f;
    ctx.fillRect(sx, zt + legT * 0.6, slatW, slatH);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.5;
    ctx.strokeRect(sx, zt + legT * 0.6, slatW, slatH);
  }
  // Bottom stretcher
  roundRect(ctx, cx - w / 2, zfl - h * 0.2, w, legT * 0.4, 1, MAT.oak.s, 'rgba(0,0,0,0.25)', 0.5);
}

function frontOfficeChair(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number): void {
  const seatH = h * 0.42, zfl = cy + h / 2, zt = zfl - h;
  floorLine(ctx, cx - w * 0.85, cx + w * 0.85, zfl);
  // Base arms
  ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = w * 0.06; ctx.lineCap = 'round';
  [[-0.38, 0], [0.38, 0]].forEach(([fx]) => {
    ctx.beginPath(); ctx.moveTo(cx, zfl - h * 0.1);
    ctx.lineTo(cx + w * fx, zfl - h * 0.02); ctx.stroke();
  });
  ctx.lineCap = 'butt';
  // Casters
  for (const i of [-1, 1]) {
    ctx.beginPath(); ctx.arc(cx + i * w * 0.35, zfl, w * 0.04, 0, Math.PI * 2);
    ctx.fillStyle = '#282828'; ctx.fill();
  }
  // Column
  const colW = w * 0.06;
  const cg = ctx.createLinearGradient(cx - colW / 2, 0, cx + colW / 2, 0);
  cg.addColorStop(0, MAT.chrome.s); cg.addColorStop(0.5, MAT.chrome.t); cg.addColorStop(1, MAT.chrome.s);
  ctx.fillStyle = cg;
  ctx.fillRect(cx - colW / 2, zfl - seatH * 1.05, colW, seatH * 0.9);
  // Seat
  const seatY = zfl - seatH * 1.05, seatT = h * 0.06;
  roundRect(ctx, cx - w / 2 + w * 0.06, seatY - seatT, w * 0.88, seatT * 1.2, 2, MAT.fabric.f, 'rgba(0,0,0,0.3)', 0.6);
  fabricSheen(ctx, cx - w / 2 + w * 0.06, seatY - seatT, w * 0.88, seatT * 1.2);
  // Armrests
  const armY = seatY - seatT * 0.7, armH = seatT * 0.5;
  ctx.fillStyle = MAT.metal.f;
  ctx.fillRect(cx - w / 2 - colW * 0.5, armY - armH, colW * 1.2, armH);
  ctx.fillRect(cx + w / 2 - colW * 0.7, armY - armH, colW * 1.2, armH);
  // Back rest
  const backBot = seatY - seatT, backTop = zt + h * 0.04;
  const bg = ctx.createLinearGradient(cx - w / 2 + w * 0.1, 0, cx + w / 2 - w * 0.1, 0);
  bg.addColorStop(0, MAT.fabric.s); bg.addColorStop(0.3, MAT.fabric.t); bg.addColorStop(1, MAT.fabric.s);
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.roundRect(cx - w / 2 + w * 0.1, backTop, w * 0.8, backBot - backTop, 3); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.7; ctx.stroke();
  fabricSheen(ctx, cx - w / 2 + w * 0.1, backTop, w * 0.8, backBot - backTop);
  // Lumbar indent
  ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 0.6;
  ctx.beginPath(); ctx.arc(cx, backBot - h * 0.14, w * 0.25, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
}

function frontArmchair(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number): void {
  const arm = w * 0.11, legH = h * 0.14, zfl = cy + h / 2, zt = zfl - h;
  floorLine(ctx, cx - w / 2 - 6, cx + w / 2 + 6, zfl);
  const legT = w * 0.04;
  // Legs
  legFront(ctx, cx - w / 2 + w * 0.06, zfl - legH, zfl, legT, MAT.oak.s);
  legFront(ctx, cx + w / 2 - w * 0.06 - legT, zfl - legH, zfl, legT, MAT.oak.s);
  // Body
  const bodyH = h * 0.6;
  const bg = ctx.createLinearGradient(cx - w / 2, zfl - bodyH, cx, zfl);
  bg.addColorStop(0, MAT.fabric.t); bg.addColorStop(1, MAT.fabric.f);
  roundRect(ctx, cx - w / 2, zfl - bodyH, w, bodyH, 3, bg, 'rgba(0,0,0,0.3)', 0.7);
  fabricSheen(ctx, cx - w / 2, zfl - bodyH, w, bodyH);
  // Arms
  roundRect(ctx, cx - w / 2, zfl - h * 0.52, arm, h * 0.12, 2, MAT.fabric.f, 'rgba(0,0,0,0.25)', 0.6);
  roundRect(ctx, cx + w / 2 - arm, zfl - h * 0.52, arm, h * 0.12, 2, MAT.fabric.f, 'rgba(0,0,0,0.25)', 0.6);
  // Seat cushion
  roundRect(ctx, cx - w / 2 + arm * 1.1, zfl - h * 0.6, w - arm * 2.2, h * 0.1, 2, MAT.cushion.t, 'rgba(0,0,0,0.2)', 0.5);
  // Back cushion
  roundRect(ctx, cx - w / 2 + arm * 0.9, zt + h * 0.04, w - arm * 1.8, h * 0.35, 3, MAT.cushion.f, 'rgba(0,0,0,0.2)', 0.5);
  fabricSheen(ctx, cx - w / 2 + arm * 0.9, zt + h * 0.04, w - arm * 1.8, h * 0.35);
}

function frontSofa(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number, seats: number): void {
  const arm = w * 0.045, legH = h * 0.13, seatH = h * 0.5, zfl = cy + h / 2, zt = zfl - h;
  const legSz = w * 0.02;
  floorLine(ctx, cx - w / 2 - 6, cx + w / 2 + 6, zfl);
  // Legs
  for (const fx of [0.04, 0.5, 0.96]) legFront(ctx, cx - w / 2 + w * fx - legSz, zfl - legH, zfl, legSz * 2, MAT.oak.s);
  // Body
  const bg = ctx.createLinearGradient(cx - w / 2, zt, cx + w / 2, zfl);
  bg.addColorStop(0, MAT.fabric.t); bg.addColorStop(0.5, MAT.fabric.f); bg.addColorStop(1, MAT.fabric.s);
  roundRect(ctx, cx - w / 2, zt, w, h, 2, bg, 'rgba(0,0,0,0.3)', 0.7);
  fabricSheen(ctx, cx - w / 2, zt, w, h);
  // Arms
  const armW = arm;
  roundRect(ctx, cx - w / 2, zfl - seatH - h * 0.06, armW, h * 0.16, 2, MAT.fabric.t, 'rgba(0,0,0,0.25)', 0.6);
  roundRect(ctx, cx + w / 2 - armW, zfl - seatH - h * 0.06, armW, h * 0.16, 2, MAT.fabric.t, 'rgba(0,0,0,0.25)', 0.6);
  // Seat cushions
  const si = armW, sw = (w - si * 2 - (seats - 1) * 2) / seats;
  for (let i = 0; i < seats; i++) {
    roundRect(ctx, cx - w / 2 + si + i * (sw + 2), zfl - seatH - h * 0.1, sw, h * 0.12, 2, MAT.cushion.t, 'rgba(0,0,0,0.2)', 0.5);
  }
  // Back cushions
  const backH = h * 0.38;
  for (let i = 0; i < seats; i++) {
    roundRect(ctx, cx - w / 2 + si + i * (sw + 2), zt + h * 0.04, sw, backH, 3, MAT.cushion.f, 'rgba(0,0,0,0.2)', 0.5);
  }
}

function frontDiningTable(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number): void {
  const topT = h * 0.05, apronH = h * 0.1, legSz = w * 0.04;
  const zfl = cy + h / 2, zt = zfl - h;
  floorLine(ctx, cx - w / 2 - 6, cx + w / 2 + 6, zfl);
  // Legs
  legFront(ctx, cx - w / 2 + w * 0.04, zfl - h * 0.01, zfl, legSz, MAT.oak.s);
  legFront(ctx, cx + w / 2 - w * 0.04 - legSz, zfl - h * 0.01, zfl, legSz, MAT.oak.s);
  // Apron
  ctx.fillStyle = MAT.oak.f;
  ctx.fillRect(cx - w / 2 + w * 0.04, zt + topT, w - w * 0.08, apronH);
  woodGrain(ctx, cx - w / 2 + w * 0.04, zt + topT, w - w * 0.08, apronH, false);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.6;
  ctx.strokeRect(cx - w / 2 + w * 0.04, zt + topT, w - w * 0.08, apronH);
  // Tabletop
  const g = ctx.createLinearGradient(cx - w / 2, zt, cx + w / 2, zt);
  g.addColorStop(0, MAT.oak.f); g.addColorStop(0.5, MAT.oak.t); g.addColorStop(1, MAT.oak.f);
  ctx.fillStyle = g;
  ctx.fillRect(cx - w / 2 - 4, zt, w + 8, topT);
  woodGrain(ctx, cx - w / 2 - 4, zt, w + 8, topT, false);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.8;
  ctx.strokeRect(cx - w / 2 - 4, zt, w + 8, topT);
}

function frontRoundTable(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number): void {
  const topT = h * 0.04, pedW = w * 0.12, baseW = w * 0.6;
  const zfl = cy + h / 2, zt = zfl - h;
  floorLine(ctx, cx - w / 2 - 6, cx + w / 2 + 6, zfl);
  // Pedestal
  const pg = ctx.createLinearGradient(cx - pedW / 2, 0, cx + pedW / 2, 0);
  pg.addColorStop(0, MAT.oak.s); pg.addColorStop(0.4, MAT.oak.f); pg.addColorStop(1, MAT.oak.s);
  ctx.fillStyle = pg;
  ctx.fillRect(cx - pedW / 2, zt + topT + h * 0.02, pedW, h * 0.86);
  woodGrain(ctx, cx - pedW / 2, zt + topT + h * 0.02, pedW, h * 0.86, false);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.6;
  ctx.strokeRect(cx - pedW / 2, zt + topT + h * 0.02, pedW, h * 0.86);
  // Base
  roundRect(ctx, cx - baseW / 2, zfl - h * 0.07, baseW, h * 0.07, 1, MAT.oak.t, 'rgba(0,0,0,0.25)', 0.7);
  // Top
  const g = ctx.createLinearGradient(cx - w / 2, zt, cx + w / 2, zt);
  g.addColorStop(0, MAT.oak.f); g.addColorStop(0.5, MAT.oak.t); g.addColorStop(1, MAT.oak.f);
  ctx.fillStyle = g;
  ctx.fillRect(cx - w / 2 - 4, zt, w + 8, topT);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.8;
  ctx.strokeRect(cx - w / 2 - 4, zt, w + 8, topT);
}

function frontCoffeeTable(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number): void {
  const topT = h * 0.03, legSz = w * 0.025;
  const zfl = cy + h / 2, zt = zfl - h;
  floorLine(ctx, cx - w / 2 - 6, cx + w / 2 + 6, zfl);
  // Legs
  legFront(ctx, cx - w / 2 + w * 0.04, zfl - h * 0.01, zfl, legSz, MAT.chrome.f);
  legFront(ctx, cx + w / 2 - w * 0.04 - legSz, zfl - h * 0.01, zfl, legSz, MAT.chrome.f);
  // Shelf
  roundRect(ctx, cx - w / 2 + w * 0.1, zfl - h * 0.28, w * 0.8, legSz * 0.6, 1, MAT.chrome.s, 'rgba(0,0,0,0.2)', 0.5);
  // Glass top
  const tg = ctx.createLinearGradient(cx - w / 2, zt, cx - w / 2, zt + topT * 2);
  tg.addColorStop(0, 'rgba(160,220,255,0.3)');
  tg.addColorStop(1, 'rgba(100,180,240,0.12)');
  ctx.fillStyle = tg;
  ctx.fillRect(cx - w / 2 - 3, zt, w + 6, topT * 2);
  ctx.strokeStyle = 'rgba(80,180,240,0.5)'; ctx.lineWidth = 0.8;
  ctx.strokeRect(cx - w / 2 - 3, zt, w + 6, topT * 2);
  // Reflection
  ctx.strokeStyle = 'rgba(200,240,255,0.25)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx - w * 0.35, zt + topT * 0.5); ctx.lineTo(cx, zt + topT * 0.5); ctx.stroke();
}

function frontBed(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number): void {
  const zfl = cy + h / 2, zt = zfl - h;
  const legH = h * 0.15, mattH = h * 0.35, headH = h;
  floorLine(ctx, cx - w / 2 - 6, cx + w / 2 + 6, zfl);
  const legT = w * 0.04;
  // Legs
  legFront(ctx, cx - w / 2 + w * 0.04, zfl - legH, zfl, legT, MAT.oak.s);
  legFront(ctx, cx + w / 2 - w * 0.04 - legT, zfl - legH, zfl, legT, MAT.oak.s);
  // Headboard
  roundRect(ctx, cx - w / 2, zt, w, headH * 0.45, 3, MAT.oak.f, 'rgba(0,0,0,0.3)', 0.7);
  woodGrain(ctx, cx - w / 2, zt, w, headH * 0.45, false);
  // Mattress
  roundRect(ctx, cx - w / 2 + w * 0.02, zfl - mattH - legH, w * 0.96, mattH, 3, MAT.white.t, 'rgba(0,0,0,0.2)', 0.6);
  // Pillow
  roundRect(ctx, cx - w / 2 + w * 0.08, zfl - mattH - legH - h * 0.06, w * 0.84, h * 0.06, 3, MAT.white.f, 'rgba(0,0,0,0.15)', 0.5);
  // Quilt fold line
  ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(cx - w / 2 + w * 0.05, zfl - legH - mattH * 0.5);
  ctx.lineTo(cx + w / 2 - w * 0.05, zfl - legH - mattH * 0.5);
  ctx.stroke();
}

function frontGenericBox(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number, mat: { t: string; f: string; s: string }): void {
  const zfl = cy + h / 2, zt = zfl - h;
  floorLine(ctx, cx - w / 2 - 6, cx + w / 2 + 6, zfl);
  roundRect(ctx, cx - w / 2, zt, w, h, 2, mat.t, 'rgba(0,0,0,0.3)', 0.7);
  woodGrain(ctx, cx - w / 2, zt, w, h, false);
}

function frontToilet(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number): void {
  const zfl = cy + h / 2, zt = zfl - h;
  floorLine(ctx, cx - w / 2 - 6, cx + w / 2 + 6, zfl);
  // Tank
  roundRect(ctx, cx - w * 0.3, zt, w * 0.6, h * 0.45, 3, MAT.ceramic.t, 'rgba(0,0,0,0.2)', 0.6);
  // Bowl
  roundRect(ctx, cx - w * 0.4, zt + h * 0.4, w * 0.8, h * 0.55, w * 0.1, MAT.ceramic.t, 'rgba(0,0,0,0.2)', 0.6);
  // Seat rim
  ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(cx - w * 0.35, zt + h * 0.42, w * 0.7, h * 0.08, 2);
  ctx.stroke();
  // Flush button
  roundRect(ctx, cx - w * 0.06, zt + h * 0.02, w * 0.12, h * 0.06, 2, MAT.chrome.t, 'rgba(0,0,0,0.25)', 0.5);
}

function frontBathtub(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number): void {
  const zfl = cy + h / 2, zt = zfl - h;
  floorLine(ctx, cx - w / 2 - 6, cx + w / 2 + 6, zfl);
  // Outer
  roundRect(ctx, cx - w / 2, zt, w, h, w * 0.04, MAT.ceramic.t, 'rgba(0,0,0,0.25)', 0.7);
  // Inner top rim
  roundRect(ctx, cx - w / 2 + w * 0.04, zt + h * 0.04, w * 0.92, h * 0.08, 2, MAT.ceramic.f, 'rgba(0,0,0,0.15)', 0.5);
  // Faucet
  roundRect(ctx, cx + w * 0.3, zt - h * 0.08, w * 0.08, h * 0.12, 2, MAT.chrome.t, 'rgba(0,0,0,0.3)', 0.6);
}

function frontSink(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number): void {
  const zfl = cy + h / 2, zt = zfl - h;
  floorLine(ctx, cx - w / 2 - 6, cx + w / 2 + 6, zfl);
  // Pedestal
  roundRect(ctx, cx - w * 0.15, zfl - h * 0.55, w * 0.3, h * 0.55, 2, MAT.ceramic.t, 'rgba(0,0,0,0.2)', 0.6);
  // Basin
  roundRect(ctx, cx - w / 2, zt + h * 0.1, w, h * 0.35, w * 0.05, MAT.ceramic.t, 'rgba(0,0,0,0.25)', 0.7);
  // Inner basin
  roundRect(ctx, cx - w * 0.38, zt + h * 0.15, w * 0.76, h * 0.25, w * 0.03, MAT.ceramic.f, 'rgba(0,0,0,0.15)', 0.5);
  // Faucet
  roundRect(ctx, cx - w * 0.06, zt, w * 0.12, h * 0.12, 2, MAT.chrome.t, 'rgba(0,0,0,0.3)', 0.6);
}

function frontStove(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number): void {
  const zfl = cy + h / 2, zt = zfl - h;
  floorLine(ctx, cx - w / 2 - 6, cx + w / 2 + 6, zfl);
  roundRect(ctx, cx - w / 2, zt, w, h, 2, '#2a2a2a', 'rgba(0,0,0,0.35)', 0.7);
  // Oven door
  roundRect(ctx, cx - w * 0.42, zt + h * 0.15, w * 0.84, h * 0.55, 3, '#1e1e1e', 'rgba(0,0,0,0.3)', 0.6);
  // Oven glass
  roundRect(ctx, cx - w * 0.35, zt + h * 0.22, w * 0.7, h * 0.35, 2, 'rgba(40,40,40,0.8)', 'rgba(80,80,80,0.5)', 0.5);
  // Handle
  ctx.strokeStyle = MAT.chrome.t; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(cx - w * 0.3, zt + h * 0.12); ctx.lineTo(cx + w * 0.3, zt + h * 0.12); ctx.stroke();
  // Control knobs
  for (let i = 0; i < 4; i++) {
    const kx = cx - w * 0.3 + i * (w * 0.6 / 3);
    ctx.beginPath(); ctx.arc(kx, zt + h * 0.05, w * 0.025, 0, Math.PI * 2);
    ctx.fillStyle = '#555'; ctx.fill();
  }
}

function frontFridge(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number): void {
  const zfl = cy + h / 2, zt = zfl - h;
  floorLine(ctx, cx - w / 2 - 6, cx + w / 2 + 6, zfl);
  roundRect(ctx, cx - w / 2, zt, w, h, 2, MAT.white.t, 'rgba(0,0,0,0.25)', 0.7);
  // Door divider
  const divY = zt + h * 0.4;
  ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(cx - w / 2 + 3, divY); ctx.lineTo(cx + w / 2 - 3, divY); ctx.stroke();
  // Handle
  ctx.strokeStyle = MAT.chrome.t; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx + w * 0.35, zt + h * 0.08); ctx.lineTo(cx + w * 0.35, zt + h * 0.3); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx + w * 0.35, divY + h * 0.06); ctx.lineTo(cx + w * 0.35, divY + h * 0.2); ctx.stroke();
}

function frontShower(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number): void {
  const zfl = cy + h / 2, zt = zfl - h;
  floorLine(ctx, cx - w / 2 - 6, cx + w / 2 + 6, zfl);
  // Glass panels
  roundRect(ctx, cx - w / 2, zt, w, h, 2, 'rgba(140,210,255,0.08)', 'rgba(80,180,240,0.35)', 0.8);
  // Shower base
  roundRect(ctx, cx - w / 2, zfl - h * 0.05, w, h * 0.05, 1, MAT.ceramic.f, 'rgba(0,0,0,0.2)', 0.6);
  // Shower head
  ctx.strokeStyle = MAT.chrome.t; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(cx, zt + h * 0.08); ctx.lineTo(cx, zt + h * 0.2); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, zt + h * 0.06, w * 0.06, 0, Math.PI * 2);
  ctx.strokeStyle = MAT.chrome.t; ctx.lineWidth = 1; ctx.stroke();
  // Door frame
  ctx.strokeStyle = MAT.chrome.f; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx, zt); ctx.lineTo(cx, zfl); ctx.stroke();
}

// =============================================================================
// End Elevation Renderers (side view — depth along X axis)
// =============================================================================

function endDiningChair(ctx: CanvasRenderingContext2D, cx: number, cy: number, d: number, h: number): void {
  const seatH = h * 0.55, legT = d * 0.07, zfl = cy + h / 2, zt = zfl - h;
  floorLine(ctx, cx - d / 2 - 6, cx + d / 2 + 6, zfl);
  const seatY = zfl - seatH;
  // Front leg
  legFront(ctx, cx - d / 2 + d * 0.08, zfl - h * 0.01, zfl, legT, MAT.oak.s);
  // Back leg (extended to top)
  legFront(ctx, cx + d / 2 - d * 0.2, zt, seatY, legT * 1.2, MAT.oak.s);
  legFront(ctx, cx + d / 2 - d * 0.2, seatY, zfl, legT, MAT.oak.s);
  // Seat slab
  const stk = legT * 0.8;
  roundRect(ctx, cx - d / 2 + d * 0.04, seatY, d * 0.82, stk, 1, MAT.oak.t, 'rgba(0,0,0,0.3)', 0.6);
  woodGrain(ctx, cx - d / 2 + d * 0.04, seatY, d * 0.82, stk, false);
  // Cushion
  roundRect(ctx, cx - d / 2 + d * 0.08, seatY - stk * 1.8, d * 0.74, stk * 1.8, 2, MAT.cushion.f, 'rgba(0,0,0,0.3)', 0.6);
  // Back top rail (side)
  roundRect(ctx, cx + d / 2 - d * 0.24, zt, legT * 1.4, legT * 0.6, 1, MAT.oak.f, 'rgba(0,0,0,0.3)', 0.6);
}

function endGenericSide(ctx: CanvasRenderingContext2D, cx: number, cy: number, d: number, h: number, mat: { t: string; f: string; s: string }): void {
  const zfl = cy + h / 2, zt = zfl - h;
  floorLine(ctx, cx - d / 2 - 6, cx + d / 2 + 6, zfl);
  roundRect(ctx, cx - d / 2, zt, d, h, 2, mat.t, 'rgba(0,0,0,0.3)', 0.7);
}

// =============================================================================
// Main Dispatch Functions
// =============================================================================

export function renderFurniturePlan(
  ctx: CanvasRenderingContext2D,
  renderType: string,
  cx: number,
  cy: number,
  widthPx: number,
  depthPx: number
): void {
  ctx.save();
  switch (renderType) {
    case 'dining-chair': planDiningChair(ctx, cx, cy, widthPx, depthPx); break;
    case 'office-chair': planOfficeChair(ctx, cx, cy, widthPx, depthPx); break;
    case 'armchair': planArmchair(ctx, cx, cy, widthPx, depthPx); break;
    case 'sofa-2': planSofa(ctx, cx, cy, widthPx, depthPx, 2); break;
    case 'sofa-3': planSofa(ctx, cx, cy, widthPx, depthPx, 3); break;
    case 'dining-table': planDiningTable(ctx, cx, cy, widthPx, depthPx); break;
    case 'round-table': planRoundTable(ctx, cx, cy, widthPx, depthPx); break;
    case 'coffee-table': planCoffeeTable(ctx, cx, cy, widthPx, depthPx); break;
    case 'bed-single':
    case 'bed-double':
    case 'bed-queen':
    case 'bed-king': planBed(ctx, cx, cy, widthPx, depthPx); break;
    case 'nightstand': planNightstand(ctx, cx, cy, widthPx, depthPx); break;
    case 'dresser': planDresser(ctx, cx, cy, widthPx, depthPx); break;
    case 'wardrobe': planWardrobe(ctx, cx, cy, widthPx, depthPx); break;
    case 'tv-stand': planTvStand(ctx, cx, cy, widthPx, depthPx); break;
    case 'bookshelf': planBookshelf(ctx, cx, cy, widthPx, depthPx); break;
    case 'buffet': planBuffet(ctx, cx, cy, widthPx, depthPx); break;
    case 'sink': planSink(ctx, cx, cy, widthPx, depthPx); break;
    case 'stove': planStove(ctx, cx, cy, widthPx, depthPx); break;
    case 'fridge': planFridge(ctx, cx, cy, widthPx, depthPx); break;
    case 'toilet': planToilet(ctx, cx, cy, widthPx, depthPx); break;
    case 'bathtub': planBathtub(ctx, cx, cy, widthPx, depthPx); break;
    case 'shower': planShower(ctx, cx, cy, widthPx, depthPx); break;
    default: break; // Fall through to generic rendering
  }
  ctx.restore();
}

export function renderFurnitureFront(
  ctx: CanvasRenderingContext2D,
  renderType: string,
  cx: number,
  cy: number,
  widthPx: number,
  heightPx: number
): void {
  ctx.save();
  switch (renderType) {
    case 'dining-chair': frontDiningChair(ctx, cx, cy, widthPx, heightPx); break;
    case 'office-chair': frontOfficeChair(ctx, cx, cy, widthPx, heightPx); break;
    case 'armchair': frontArmchair(ctx, cx, cy, widthPx, heightPx); break;
    case 'sofa-2': frontSofa(ctx, cx, cy, widthPx, heightPx, 2); break;
    case 'sofa-3': frontSofa(ctx, cx, cy, widthPx, heightPx, 3); break;
    case 'dining-table': frontDiningTable(ctx, cx, cy, widthPx, heightPx); break;
    case 'round-table': frontRoundTable(ctx, cx, cy, widthPx, heightPx); break;
    case 'coffee-table': frontCoffeeTable(ctx, cx, cy, widthPx, heightPx); break;
    case 'bed-single':
    case 'bed-double':
    case 'bed-queen':
    case 'bed-king': frontBed(ctx, cx, cy, widthPx, heightPx); break;
    case 'nightstand':
    case 'dresser':
    case 'wardrobe':
    case 'tv-stand':
    case 'bookshelf':
    case 'buffet': frontGenericBox(ctx, cx, cy, widthPx, heightPx, MAT.oak); break;
    case 'sink': frontSink(ctx, cx, cy, widthPx, heightPx); break;
    case 'stove': frontStove(ctx, cx, cy, widthPx, heightPx); break;
    case 'fridge': frontFridge(ctx, cx, cy, widthPx, heightPx); break;
    case 'toilet': frontToilet(ctx, cx, cy, widthPx, heightPx); break;
    case 'bathtub': frontBathtub(ctx, cx, cy, widthPx, heightPx); break;
    case 'shower': frontShower(ctx, cx, cy, widthPx, heightPx); break;
    default: break;
  }
  ctx.restore();
}

export function renderFurnitureEnd(
  ctx: CanvasRenderingContext2D,
  renderType: string,
  cx: number,
  cy: number,
  depthPx: number,
  heightPx: number
): void {
  ctx.save();
  switch (renderType) {
    case 'dining-chair': endDiningChair(ctx, cx, cy, depthPx, heightPx); break;
    // For most items, the end view is a simple box or similar to front rotated
    case 'office-chair': frontOfficeChair(ctx, cx, cy, depthPx, heightPx); break;
    case 'armchair': endGenericSide(ctx, cx, cy, depthPx, heightPx, MAT.fabric); break;
    case 'sofa-2':
    case 'sofa-3': endGenericSide(ctx, cx, cy, depthPx, heightPx, MAT.fabric); break;
    case 'dining-table': frontDiningTable(ctx, cx, cy, depthPx, heightPx); break;
    case 'round-table': frontRoundTable(ctx, cx, cy, depthPx, heightPx); break;
    case 'coffee-table': frontCoffeeTable(ctx, cx, cy, depthPx, heightPx); break;
    case 'bed-single':
    case 'bed-double':
    case 'bed-queen':
    case 'bed-king': endGenericSide(ctx, cx, cy, depthPx, heightPx, MAT.white); break;
    case 'nightstand':
    case 'dresser':
    case 'wardrobe':
    case 'tv-stand':
    case 'bookshelf':
    case 'buffet': frontGenericBox(ctx, cx, cy, depthPx, heightPx, MAT.oak); break;
    case 'sink': frontSink(ctx, cx, cy, depthPx, heightPx); break;
    case 'stove': frontStove(ctx, cx, cy, depthPx, heightPx); break;
    case 'fridge': frontFridge(ctx, cx, cy, depthPx, heightPx); break;
    case 'toilet': frontToilet(ctx, cx, cy, depthPx, heightPx); break;
    case 'bathtub': endGenericSide(ctx, cx, cy, depthPx, heightPx, MAT.ceramic); break;
    case 'shower': frontShower(ctx, cx, cy, depthPx, heightPx); break;
    default: break;
  }
  ctx.restore();
}

/** Check if a renderType has a dedicated renderer */
export function hasRenderer(renderType: string | undefined): boolean {
  if (!renderType) return false;
  const supported: Set<string> = new Set([
    'dining-chair', 'office-chair', 'armchair', 'sofa-2', 'sofa-3',
    'dining-table', 'round-table', 'coffee-table',
    'bed-single', 'bed-double', 'bed-queen', 'bed-king',
    'nightstand', 'dresser', 'wardrobe', 'tv-stand', 'bookshelf', 'buffet',
    'sink', 'stove', 'fridge', 'toilet', 'bathtub', 'shower',
  ]);
  return supported.has(renderType);
}
