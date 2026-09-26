// 釣竿の描画（カーボンロッド風）。物理は FishingScene 側で決まり、ここでは渡された形をなぞって描くだけ。
// 毎フレーム呼ばれるので、点列は使い回しのバッファに書き込み、色の文字列も新しく作らない。
import type { Vec2 } from './physics';

export interface RodDrawParams {
  base: Vec2;
  tip: Vec2;
  angle: number;
  // 中点の制御点を法線方向へずらす量と向き（FishingScene の二次ベジェと同じ定義）
  bend: number;
  bendSign: number;
  // 糸の張力（0=たるみ, 1=張り詰め, 1超=限界近く）
  tension: number;
  reelAngle: number;
  // 巻き上げ中の操作切り替えの予兆
  telegraph: boolean;
  reducedMotion: boolean;
  t: number;
  // 太さ・部品の大きさの倍率（竿の長さに合わせる）
  scale: number;
}

// e.crank.angle は巻きの勢いがそのまま積算されていて速すぎるので、見た目の回転に縮める
export const REEL_TURN_PER_CRANK = 0.04;

const ROD_BODY = '#1a1d24';
const ROD_GRIP = '#262a33';
const ROD_GROOVE = '#3a3f4b';
const ROD_HIGHLIGHT = 'rgba(170,190,215,0.55)';
const ROD_WEAVE = 'rgba(200,215,235,1)';
const ROD_METAL = '#8e97a6';
const ROD_METAL_DARK = '#4a515e';
const ROD_TENSION = 'rgb(255,200,120)';

const SAMPLES = 16;
const BASE_WIDTH = 6;
const TIP_WIDTH = 1.5;
// s は曲線上の位置（根元0〜先端1）
const GRIP_END_INDEX = 3; // s = 0.2
const GRIP_GROOVES = [0.03, 0.07, 0.11, 0.15];
const REEL_S = 0.27;
const REEL_RADIUS = 3.5;
const REEL_HANDLE = 4;
const GUIDE_S = [0.35, 0.6, 0.8];
const GUIDE_RADIUS = [2.2, 1.6, 1.2];
const TENSION_START_INDEX = 11; // s ≒ 0.75
const TOP_GUIDE_RADIUS = 0.8;
const WEAVE_ALPHA = 0.08;
const TELEGRAPH_BLINK_HZ = 8;
// 光源は左上。ハイライトはこの向きに面した縁に引く
const LIGHT_X = -0.6;
const LIGHT_Y = -0.8;

const px = new Float32Array(SAMPLES);
const py = new Float32Array(SAMPLES);
const nx = new Float32Array(SAMPLES);
const ny = new Float32Array(SAMPLES);
// 太さは根元寄りで残るようにゆるく細らせる
function widthAt(s: number) {
  return TIP_WIDTH + (BASE_WIDTH - TIP_WIDTH) * Math.pow(1 - s, 1.2);
}

// サンプル点の太さは形が変わらないので一度だけ計算する
const widths = Float32Array.from({ length: SAMPLES }, (_, i) => widthAt(i / (SAMPLES - 1)));

// drawRod の間だけ有効な大きさの倍率
let k = 1;

let weavePattern: CanvasPattern | null | undefined;

// 綾織りを示す細い斜線のパターン（最初の1回だけ作る。竿の大きさによらず同じ細かさ）
function getWeavePattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (weavePattern !== undefined) return weavePattern;
  const tile = document.createElement('canvas');
  tile.width = 6;
  tile.height = 6;
  const g = tile.getContext('2d');
  if (g) {
    g.strokeStyle = ROD_WEAVE;
    g.lineWidth = 0.7;
    g.beginPath();
    g.moveTo(-1, 7);
    g.lineTo(7, -1);
    g.stroke();
  }
  weavePattern = g ? ctx.createPattern(tile, 'repeat') : null;
  return weavePattern;
}

// 曲線上の任意の位置の点と、糸側（曲線の内側）を向いた法線
const at = { x: 0, y: 0, nx: 0, ny: 0 };
let ctrlX = 0;
let ctrlY = 0;
let sideX = 0;
let sideY = 0;

function evalAt(p: RodDrawParams, s: number) {
  const u = 1 - s;
  at.x = u * u * p.base.x + 2 * u * s * ctrlX + s * s * p.tip.x;
  at.y = u * u * p.base.y + 2 * u * s * ctrlY + s * s * p.tip.y;
  const dx = 2 * u * (ctrlX - p.base.x) + 2 * s * (p.tip.x - ctrlX);
  const dy = 2 * u * (ctrlY - p.base.y) + 2 * s * (p.tip.y - ctrlY);
  const len = Math.hypot(dx, dy) || 1;
  let ox = -dy / len;
  let oy = dx / len;
  if (ox * sideX + oy * sideY < 0) {
    ox = -ox;
    oy = -oy;
  }
  at.nx = ox;
  at.ny = oy;
}

// from〜to のサンプル区間を、太さ w(i)+extra のポリゴンとしてパスに積む
function tracePolygon(ctx: CanvasRenderingContext2D, from: number, to: number, extra: number) {
  ctx.beginPath();
  for (let i = from; i <= to; i++) {
    const h = (widths[i] + extra) * k / 2;
    if (i === from) ctx.moveTo(px[i] + nx[i] * h, py[i] + ny[i] * h);
    else ctx.lineTo(px[i] + nx[i] * h, py[i] + ny[i] * h);
  }
  for (let i = to; i >= from; i--) {
    const h = (widths[i] + extra) * k / 2;
    ctx.lineTo(px[i] - nx[i] * h, py[i] - ny[i] * h);
  }
  ctx.closePath();
}

// 竿を横切る短い線（グリップの溝やリング）
function strokeAcross(ctx: CanvasRenderingContext2D, p: RodDrawParams, s: number, halfWidth: number) {
  evalAt(p, s);
  const h = halfWidth * k;
  ctx.moveTo(at.x + at.nx * h, at.y + at.ny * h);
  ctx.lineTo(at.x - at.nx * h, at.y - at.ny * h);
}

export function drawRod(ctx: CanvasRenderingContext2D, p: RodDrawParams) {
  k = p.scale;
  // 制御点は FishingScene の従来の計算と同じ
  const perpX = Math.cos(p.angle);
  const perpY = Math.sin(p.angle);
  ctrlX = (p.base.x + p.tip.x) / 2 + perpX * p.bend * p.bendSign;
  ctrlY = (p.base.y + p.tip.y) / 2 + perpY * p.bend * p.bendSign;
  // ガイドは実物の竿と同じく曲線の内側（糸が走る側）に付ける
  sideX = -perpX * p.bendSign;
  sideY = -perpY * p.bendSign;

  for (let i = 0; i < SAMPLES; i++) {
    evalAt(p, i / (SAMPLES - 1));
    px[i] = at.x;
    py[i] = at.y;
    nx[i] = at.nx;
    ny[i] = at.ny;
  }
  // 最後の点は rodTipOf(e) そのもの（糸の始点とずらさない）
  px[SAMPLES - 1] = p.tip.x;
  py[SAMPLES - 1] = p.tip.y;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // ---- 本体と綾織り ----
  tracePolygon(ctx, 0, SAMPLES - 1, 0);
  ctx.fillStyle = ROD_BODY;
  ctx.fill();
  const weave = getWeavePattern(ctx);
  if (weave) {
    ctx.globalAlpha = WEAVE_ALPHA;
    ctx.fillStyle = weave;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ---- 張力が高いときは竿先の区間だけ糸の張り色に寄せる ----
  const warm = Math.min(1, Math.max(0, (p.tension - 0.6) / 0.5)) * 0.5;
  if (warm > 0) {
    tracePolygon(ctx, TENSION_START_INDEX, SAMPLES - 1, 0);
    ctx.globalAlpha = warm;
    ctx.fillStyle = ROD_TENSION;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ---- 光源側の縁のハイライト（先へ行くほど薄く） ----
  const mid = SAMPLES >> 1;
  const lit = nx[mid] * LIGHT_X + ny[mid] * LIGHT_Y > 0 ? 1 : -1;
  ctx.strokeStyle = ROD_HIGHLIGHT;
  ctx.lineWidth = 0.6 * k;
  for (let i = GRIP_END_INDEX; i < SAMPLES - 1; i++) {
    const h0 = widths[i] * k * 0.3 * lit;
    const h1 = widths[i + 1] * k * 0.3 * lit;
    ctx.globalAlpha = 1 - (i / (SAMPLES - 1)) * 0.7;
    ctx.beginPath();
    ctx.moveTo(px[i] + nx[i] * h0, py[i] + ny[i] * h0);
    ctx.lineTo(px[i + 1] + nx[i + 1] * h1, py[i + 1] + ny[i + 1] * h1);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // ---- グリップ（少し太く明るい区間＋溝＋境目の金属リング） ----
  tracePolygon(ctx, 0, GRIP_END_INDEX, 1);
  ctx.fillStyle = ROD_GRIP;
  ctx.fill();
  ctx.strokeStyle = ROD_GROOVE;
  ctx.lineWidth = 0.5 * k;
  ctx.beginPath();
  // 毎フレーム呼ばれるので、イテレーターを作らない添字ループにする
  for (let i = 0; i < GRIP_GROOVES.length; i++) {
    strokeAcross(ctx, p, GRIP_GROOVES[i], (widthAt(GRIP_GROOVES[i]) + 1) / 2);
  }
  ctx.stroke();
  ctx.strokeStyle = ROD_METAL;
  ctx.lineWidth = 0.8 * k;
  ctx.beginPath();
  strokeAcross(ctx, p, GRIP_END_INDEX / (SAMPLES - 1), (widths[GRIP_END_INDEX] + 1.8) / 2);
  ctx.stroke();

  // ---- リール（ガイドと反対側に吊るす。ハンドルは巻いた量だけ回る） ----
  evalAt(p, REEL_S);
  const reelFoot = (widthAt(REEL_S) / 2) * k;
  const reelR = REEL_RADIUS * k;
  const reelX = at.x - at.nx * (reelFoot + reelR + k);
  const reelY = at.y - at.ny * (reelFoot + reelR + k);
  ctx.strokeStyle = ROD_METAL;
  ctx.lineWidth = 0.8 * k;
  ctx.beginPath();
  ctx.moveTo(at.x - at.nx * reelFoot, at.y - at.ny * reelFoot);
  ctx.lineTo(reelX + at.nx * reelR, reelY + at.ny * reelR);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(reelX, reelY, reelR, 0, Math.PI * 2);
  ctx.fillStyle = ROD_METAL_DARK;
  ctx.fill();
  ctx.stroke();
  const hx = Math.cos(p.reelAngle) * REEL_HANDLE * k;
  const hy = Math.sin(p.reelAngle) * REEL_HANDLE * k;
  ctx.lineWidth = k;
  ctx.beginPath();
  ctx.moveTo(reelX, reelY);
  ctx.lineTo(reelX + hx, reelY + hy);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(reelX + hx, reelY + hy, 0.9 * k, 0, Math.PI * 2);
  ctx.fillStyle = ROD_METAL;
  ctx.fill();

  // ---- ガイド（曲線上の固定位置に、糸側へ小さな輪） ----
  ctx.strokeStyle = ROD_METAL;
  ctx.lineWidth = 0.6 * k;
  for (let g = 0; g < GUIDE_S.length; g++) {
    const s = GUIDE_S[g];
    const r = GUIDE_RADIUS[g] * k;
    evalAt(p, s);
    const foot = (widthAt(s) / 2) * k;
    const gx = at.x + at.nx * (foot + r + 0.6 * k);
    const gy = at.y + at.ny * (foot + r + 0.6 * k);
    ctx.beginPath();
    ctx.moveTo(at.x + at.nx * foot, at.y + at.ny * foot);
    ctx.lineTo(gx - at.nx * r, gy - at.ny * r);
    ctx.moveTo(gx + r, gy);
    ctx.arc(gx, gy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // ---- トップガイド（竿先の点。予兆の間は小さく明滅する） ----
  const tipX = p.tip.x;
  const tipY = p.tip.y;
  ctx.beginPath();
  ctx.arc(tipX, tipY, TOP_GUIDE_RADIUS * k, 0, Math.PI * 2);
  ctx.fillStyle = ROD_METAL;
  ctx.fill();
  const blink = p.telegraph
    ? p.reducedMotion || Math.sin(p.t * Math.PI * 2 * TELEGRAPH_BLINK_HZ) > 0
      ? 0.9
      : 0.2
    : warm;
  if (blink > 0) {
    ctx.globalAlpha = blink;
    ctx.fillStyle = ROD_TENSION;
    ctx.fill();
  }

  ctx.restore();
}
