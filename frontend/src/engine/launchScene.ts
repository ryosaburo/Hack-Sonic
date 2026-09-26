import { Camera, drawMilkyWay, drawParallaxStars, riverCenterY } from './physics';
import { SEASON_LOOKS, type Season } from './seasons';

export const LAUNCH_DURATION = 10.4;
export const LAUNCH_STAGES = [
  { at: 0, label: 'エンジン点火', detail: '地球をあとに、天の川へ。' },
  { at: 1.1, label: 'リフトオフ', detail: '機体上昇。まもなく雲を抜けます。' },
  { at: 3.4, label: '大気圏を抜けて', detail: '窓の向こうに、宇宙が広がる。' },
  { at: 6.2, label: '天の川に到着', detail: 'エンジン停止。釣りデッキを準備します。' },
  { at: 7.5, label: 'ハッチ開放', detail: '今日の釣り場へ、ようこそ。' },
] as const;

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const ease = (n: number) => { const x = clamp(n); return x * x * (3 - 2 * x); };

function path(ctx: CanvasRenderingContext2D, points: number[][], fill: string) {
  ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function line(ctx: CanvasRenderingContext2D, x: number, y: number, x2: number, y2: number, color: string, width = 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color); g.addColorStop(1, 'transparent');
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function rocket(ctx: CanvasRenderingContext2D, time: number, ignited: boolean) {
  if (ignited) {
    const thrust = ease(time / 0.9);
    glow(ctx, 0, 55, 160 * thrust, '#ffba6855');
    const exhaust = ctx.createLinearGradient(0, 5, 0, 245);
    exhaust.addColorStop(0, '#fffef2'); exhaust.addColorStop(0.2, '#bde5ff');
    exhaust.addColorStop(0.5, '#ffbb73dd'); exhaust.addColorStop(1, '#ff794000');
    ctx.fillStyle = exhaust;
    ctx.beginPath(); ctx.moveTo(-21, 0);
    ctx.bezierCurveTo(-38, 85, -12, 165, 0, (215 + 25 * Math.sin(time * 35)) * thrust);
    ctx.bezierCurveTo(12, 165, 38, 85, 21, 0); ctx.fill();
  }
  path(ctx, [[-28, -106], [-65, -17], [-63, 5], [-25, -10]], '#8c9ca9');
  path(ctx, [[28, -106], [65, -17], [63, 5], [25, -10]], '#d8e0e3');
  path(ctx, [[-23, -13], [-27, 8], [27, 8], [23, -13]], '#2d3540');
  const skin = ctx.createLinearGradient(-33, 0, 33, 0);
  skin.addColorStop(0, '#718596'); skin.addColorStop(0.25, '#c9d6dd');
  skin.addColorStop(0.55, '#f3f4ef'); skin.addColorStop(0.82, '#c7d0d1'); skin.addColorStop(1, '#80909d');
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.moveTo(-32, -15); ctx.lineTo(-32, -331);
  ctx.bezierCurveTo(-30, -368, -12, -398, 0, -418);
  ctx.bezierCurveTo(12, -398, 30, -368, 32, -331);
  ctx.lineTo(32, -15); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#263541'; ctx.fillRect(-32, -254, 64, 27); ctx.fillRect(-32, -60, 64, 13);
  for (const y of [-327, -302, -212, -115, -36]) line(ctx, -31, y, 31, y, '#596c7e77');
  ctx.fillStyle = '#1c2b38'; ctx.beginPath(); ctx.roundRect(-15, -317, 30, 22, 8); ctx.fill();
  ctx.fillStyle = '#78b9d0'; ctx.fillRect(-10, -312, 20, 5);
  ctx.save(); ctx.translate(4, -140); ctx.rotate(-Math.PI / 2);
  ctx.font = '10px monospace'; ctx.fillStyle = '#3c4e60'; ctx.fillText('HOSHIFUNE  /  01', 0, 0); ctx.restore();
  ctx.fillStyle = '#ae6d42'; ctx.fillRect(-10, -95, 20, 4);
  for (let y = -203; y < -115; y += 13) {
    ctx.fillStyle = '#697986'; ctx.fillRect(-25, y, 2, 2); ctx.fillRect(23, y, 2, 2);
  }
}

function exterior(ctx: CanvasRenderingContext2D, w: number, h: number, time: number, active: boolean, reduced: boolean) {
  const lift = active ? ease((time - 0.65) / 3.5) : 0;
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#07111f'); sky.addColorStop(0.62, '#1f3b53'); sky.addColorStop(1, '#b19887');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 65; i++) {
    const x = ((i * 197.31) % w), y = ((i * 83.71) % (h * 0.6));
    ctx.fillStyle = `rgba(221,236,249,${0.2 + (i % 4) * 0.12})`;
    ctx.fillRect(x, y, i % 9 === 0 ? 2 : 1, 1);
  }
  glow(ctx, w * 0.86, h * 0.62, h * 0.48, '#c9996430');
  const unit = Math.min(h / 900, w / 420);
  const shipX = w > h * 1.1 ? w * 0.69 : w * 0.53;
  const ground = h * 0.79 + lift * h * 0.7;
  ctx.fillStyle = '#0c1720'; ctx.fillRect(0, ground, w, h);
  path(ctx, [[0, ground], [w * 0.2, ground - 14], [w * 0.4, ground - 5], [w * 0.75, ground - 24], [w, ground - 8], [w, ground + 20], [0, ground + 20]], '#13222d');
  line(ctx, 0, ground + 18, w, ground + 18, '#8ea7b033');
  // Launch gantry: steel trusses, umbilical arms, and floodlights.
  ctx.save(); ctx.translate(shipX, ground); ctx.scale(unit, unit);
  ctx.fillStyle = '#17242f'; ctx.fillRect(-126, -422, 57, 438);
  for (let y = -420; y < 0; y += 42) {
    line(ctx, -126, y, -69, y + 42, '#536473', 2);
    line(ctx, -69, y, -126, y + 42, '#354755', 2);
    line(ctx, -129, y, -65, y, '#8897a1', 2);
  }
  line(ctx, -126, -422, -126, 10, '#7c8990', 3);
  line(ctx, -69, -422, -69, 10, '#7c8990', 3);
  for (const y of [-312, -225, -100]) {
    line(ctx, -70, y, -32 - lift * 40, y, '#96a1a7', 5);
    glow(ctx, -75, y, 16, '#ffd6a044');
    ctx.fillStyle = '#ffe0b0'; ctx.fillRect(-80, y - 3, 6, 3);
  }
  ctx.fillStyle = '#424b50'; ctx.fillRect(-65, 0, 130, 20);
  ctx.fillStyle = '#252e35'; ctx.fillRect(-150, 20, 290, 13);
  ctx.restore();
  const shake = active && !reduced ? Math.sin(time * 49) * 1.5 * (1 - lift) : 0;
  ctx.save(); ctx.translate(shipX + shake, h * 0.79 - lift * h * 0.42);
  ctx.scale(unit, unit); rocket(ctx, time, active); ctx.restore();
  // Deterministic exhaust particles stay bounded, including on long title-screen idles.
  for (let i = 0; i < 32; i++) {
    const age = ((time * (active ? 0.7 : 0.16) + i / 32) % 1);
    const direction = i % 2 ? 1 : -1;
    const spread = active ? 240 : 55;
    const x = shipX + direction * age * spread * unit;
    const y = active ? ground - 12 - age * 65 * unit : ground - 265 * unit - age * 50 * unit;
    glow(ctx, x, y, (18 + age * (active ? 100 : 35)) * unit, `rgba(194,205,211,${(1 - age) * (active ? 0.16 : 0.055)})`);
  }
  for (let i = 0; i < 9; i++) {
    const x = (i / 8) * w;
    ctx.fillStyle = '#d2bc89'; ctx.fillRect(x, ground + 29, 3, 2);
  }
  const cloud = ease((time - 2.65) / 0.75);
  if (active && cloud > 0) {
    ctx.fillStyle = `rgba(187,205,218,${cloud})`; ctx.fillRect(0, 0, w, h);
  }
}

function space(ctx: CanvasRenderingContext2D, w: number, h: number, time: number, season: Season) {
  const look = SEASON_LOOKS[season];
  ctx.fillStyle = `rgb(${look.background.join(',')})`; ctx.fillRect(0, 0, w, h);
  const camera = new Camera();
  camera.y = riverCenterY(0) + 140;
  drawParallaxStars(ctx, camera, w, h, time, look);
  camera.apply(ctx, w, h, { x: 0, y: 0 }); drawMilkyWay(ctx, camera, w, h, time, look); camera.restore(ctx);
  // The blue atmospheric rim falls below the window as the ship leaves Earth.
  const earthY = h * (0.62 + ease((time - 5.5) / 2.1) * 0.8);
  const radius = w * 1.4;
  const earth = ctx.createRadialGradient(w * 0.5, earthY + radius, radius * 0.9, w * 0.5, earthY + radius, radius + h * 0.15);
  earth.addColorStop(0, '#102d49'); earth.addColorStop(0.48, '#225779');
  earth.addColorStop(0.7, '#94d5ea'); earth.addColorStop(0.76, '#4b9ece88'); earth.addColorStop(1, 'transparent');
  ctx.fillStyle = earth; ctx.fillRect(0, 0, w, h);
  const atmosphere = 1 - ease((time - 3.5) / 2.8);
  if (atmosphere > 0) {
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, `rgba(23,83,132,${atmosphere})`);
    sky.addColorStop(1, `rgba(190,220,235,${atmosphere})`);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) {
      const y = (i * 187 + (time - 3.4) * 340) % (h + 240) - 120;
      glow(ctx, (i * 257) % w, y, w * 0.38, `rgba(226,237,245,${atmosphere * 0.4})`);
    }
  }
}

function cabin(ctx: CanvasRenderingContext2D, w: number, h: number, time: number, reduced: boolean) {
  const opened = ease((time - 7.5) / 1.35);
  const advance = reduced ? 0 : ease((time - 8.7) / 1.25);
  ctx.save();
  ctx.translate(w / 2, h / 2); ctx.scale(1 + advance * 0.65, 1 + advance * 0.65); ctx.translate(-w / 2, -h / 2);
  const jitter = reduced ? 0 : (1 - ease((time - 4.3) / 1.8)) * 2;
  ctx.translate(Math.sin(time * 46) * jitter, Math.cos(time * 39) * jitter);
  const left = w * 0.12, right = w * 0.88, top = h * 0.12, bottom = h * 0.73;
  // The hatch has a large observation window; its two halves retract into the hull.
  for (const side of [-1, 1]) {
    ctx.save(); ctx.translate(side * opened * w * 0.57, 0);
    ctx.beginPath(); ctx.rect(side < 0 ? 0 : w / 2, 0, w / 2, h);
    ctx.clip();
    const metal = ctx.createLinearGradient(0, 0, w, h);
    metal.addColorStop(0, '#67737c'); metal.addColorStop(0.3, '#2b343e');
    metal.addColorStop(0.65, '#141c25'); metal.addColorStop(1, '#4c5964');
    ctx.beginPath(); ctx.rect(-10, -10, w + 20, h + 20);
    ctx.roundRect(left, top, right - left, bottom - top, Math.min(70, w * 0.09));
    ctx.fillStyle = metal; ctx.fill('evenodd');
    ctx.beginPath(); ctx.roundRect(left, top, right - left, bottom - top, Math.min(70, w * 0.09));
    ctx.strokeStyle = '#0a111a'; ctx.lineWidth = 24; ctx.stroke();
    ctx.strokeStyle = '#91a3ad'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.roundRect(left - 19, top - 19, right - left + 38, bottom - top + 38, Math.min(85, w * 0.11));
    ctx.strokeStyle = '#7e8b9344'; ctx.lineWidth = 2; ctx.stroke();
    for (let i = 0; i < 10; i++) {
      const x = left + 12 + i * (right - left - 24) / 9;
      for (const y of [top - 28, bottom + 27]) {
        ctx.fillStyle = '#a0a9ac'; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
        line(ctx, x - 2, y, x + 2, y, '#202c36');
      }
    }
    line(ctx, w / 2, 0, w / 2, top - 12, '#080f18', 4);
    line(ctx, w / 2, bottom + 12, w / 2, h, '#080f18', 4);
    // Recessed instrument panels with readable, restrained navigation telemetry.
    const portrait = w <= h * 1.1;
    const panelW = Math.min(w * 0.26, 270), panelH = h * (portrait ? 0.062 : 0.115);
    const panelX = side < 0 ? w * 0.13 : w * 0.87 - panelW;
    const panelY = h * (portrait ? 0.79 : 0.82);
    ctx.fillStyle = '#09151d'; ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = '#72859066'; ctx.lineWidth = 1; ctx.strokeRect(panelX, panelY, panelW, panelH);
    ctx.font = `${Math.max(9, Math.min(12, w / 65))}px monospace`; ctx.fillStyle = '#96cbd3';
    ctx.fillText(side < 0 ? 'FLIGHT / 01' : 'DECK / 01', panelX + 12, panelY + panelH * 0.28);
    ctx.fillStyle = time < 6.2 ? '#c4d5dd' : '#96d9bf';
    ctx.fillText(side < 0 ? (time < 6.2 ? 'ASCENT' : 'ORBIT STABLE') : (time < 7.5 ? 'LOCKED' : 'DEPLOYING'), panelX + 12, panelY + panelH * 0.55);
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = i < (time < 6.2 ? 10 : 3) ? '#79afb7' : '#253743';
      ctx.fillRect(panelX + 12 + i * (panelW - 24) / 12, panelY + panelH - 10, (panelW - 32) / 16, 3);
    }
    ctx.restore();
  }
  if (opened > 0) {
    const deckEnd = h * (0.99 - opened * 0.31);
    path(ctx, [[w * 0.2, h], [w * 0.41, deckEnd], [w * 0.59, deckEnd], [w * 0.8, h]], '#273541');
    for (let i = 1; i < 9; i++) {
      const p = i / 9, y = deckEnd + (h - deckEnd) * p * p;
      line(ctx, w * (0.41 - 0.21 * p * p), y, w * (0.59 + 0.21 * p * p), y, '#8796a344');
    }
    for (const side of [-1, 1]) {
      line(ctx, w * (0.5 + side * 0.29), h, w * (0.5 + side * 0.09), deckEnd, '#b7a87a', 3);
      line(ctx, w * (0.5 + side * 0.31), h * 0.87, w * (0.5 + side * 0.11), deckEnd - h * 0.06, '#899ba9', 3);
      for (const p of [0.2, 0.6, 1]) {
        const x = w * (0.5 + side * (0.09 + 0.2 * p));
        const y = deckEnd + (h - deckEnd) * p;
        line(ctx, x, y, x + side * w * 0.02, y - h * (0.06 + p * 0.07), '#647684', 3);
      }
    }
  }
  ctx.restore();
}

/** Pure presentation: seconds are supplied by the RAF controller, never frame counts. */
export function drawLaunchScene(ctx: CanvasRenderingContext2D, w: number, h: number, time: number, active: boolean, reduced: boolean, season: Season) {
  ctx.save();
  if (!active || time < 3.4) exterior(ctx, w, h, time, active, reduced);
  else {
    space(ctx, w, h, time, season);
    cabin(ctx, w, h, time, reduced);
    const cloud = 1 - ease((time - 3.4) / 0.5);
    if (cloud > 0) { ctx.fillStyle = `rgba(187,205,218,${cloud})`; ctx.fillRect(0, 0, w, h); }
  }
  if (active && time > 9.65) {
    ctx.fillStyle = `rgba(5,6,15,${ease((time - 9.65) / 0.65)})`; ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}
