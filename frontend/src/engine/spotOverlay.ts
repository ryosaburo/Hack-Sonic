// 購入した釣り場情報（銀の流れなど）を、図鑑・交換所と同じ観測台帳の意匠で夜空に重ねる。
// 文字は置かず、淡い銀の霞・流れる光・細い二重罫・四隅の見当マークだけで範囲を示す。
import type { Spot } from './economy';
import { rgba, type RGB } from './seasons';

const SILVER: RGB = [214, 221, 233];
const BRASS: RGB = [184, 149, 90];
// 流れる光の帯の速さ（world units/s）
const SHEEN_SPEED = 38;

// 範囲に入った・出たときに色を急に切り替えず、なめらかに寄せる（0:範囲外〜1:範囲内）
const insideMix = new Map<string, number>();

function mixRGB(a: RGB, b: RGB, k: number): RGB {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

// ワールド座標で描画する（camera.apply の後に呼ぶ）。zoom で割って、罫線は常に画面上で細いままにする
export function drawSpotOverlay(
  ctx: CanvasRenderingContext2D,
  spot: Spot,
  inside: boolean,
  t: number,
  dt: number,
  zoom: number,
) {
  const prev = insideMix.get(spot.id) ?? (inside ? 1 : 0);
  const k = prev + ((inside ? 1 : 0) - prev) * (1 - Math.exp(-6 * dt));
  insideMix.set(spot.id, k);

  const px = 1 / zoom;
  const x = spot.x_min;
  const y = spot.y_min;
  const w = spot.x_max - spot.x_min;
  const h = spot.y_max - spot.y_min;
  const frame = mixRGB(SILVER, BRASS, k);

  ctx.save();

  // 中央ほど明るく、縁へ溶けていく銀の霞
  const mist = ctx.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, Math.max(w, h) * 0.6);
  mist.addColorStop(0, rgba(SILVER, 0.05 + 0.03 * k));
  mist.addColorStop(1, rgba(SILVER, 0.01));
  ctx.fillStyle = mist;
  ctx.fillRect(x, y, w, h);

  // 天の川の流れに沿って、斜めの光の帯がゆっくり通り過ぎる
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const band = w * 0.35;
  const pos = x - band + ((t * SHEEN_SPEED) % (w + band * 2));
  const sheen = ctx.createLinearGradient(pos - band, y, pos + band, y + h * 0.4);
  sheen.addColorStop(0, rgba(SILVER, 0));
  sheen.addColorStop(0.5, rgba(SILVER, 0.045 + 0.05 * k));
  sheen.addColorStop(1, rgba(SILVER, 0));
  ctx.fillStyle = sheen;
  ctx.fillRect(x, y, w, h);
  ctx.restore();

  // 細い二重罫（外側を濃く、内側は控えめに）
  ctx.lineWidth = px;
  ctx.strokeStyle = rgba(frame, 0.28 + 0.32 * k);
  ctx.strokeRect(x, y, w, h);
  const inset = 6 * px;
  ctx.strokeStyle = rgba(frame, 0.1 + 0.12 * k);
  ctx.strokeRect(x + inset, y + inset, w - inset * 2, h - inset * 2);

  // 各辺の中央に、内向きの目盛りを一本ずつ
  const tick = 10 * px;
  ctx.strokeStyle = rgba(frame, 0.35 + 0.35 * k);
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y);
  ctx.lineTo(x + w / 2, y + tick);
  ctx.moveTo(x + w / 2, y + h);
  ctx.lineTo(x + w / 2, y + h - tick);
  ctx.moveTo(x, y + h / 2);
  ctx.lineTo(x + tick, y + h / 2);
  ctx.moveTo(x + w, y + h / 2);
  ctx.lineTo(x + w - tick, y + h / 2);
  ctx.stroke();

  // 四隅の見当マーク（図鑑の図版と同じ意匠）。範囲内では真鍮色が淡く光る
  const arm = 18 * px;
  const gap = 5 * px;
  ctx.lineWidth = 1.5 * px;
  ctx.strokeStyle = rgba(BRASS, 0.55 + 0.4 * k);
  ctx.shadowColor = rgba(BRASS, 0.6 * k);
  ctx.shadowBlur = 10 * k;
  ctx.beginPath();
  const corners: [number, number, number, number][] = [
    [x, y, -1, -1],
    [x + w, y, 1, -1],
    [x, y + h, -1, 1],
    [x + w, y + h, 1, 1],
  ];
  for (const [cx, cy, sx, sy] of corners) {
    const ox = cx + sx * gap;
    const oy = cy + sy * gap;
    ctx.moveTo(ox, oy - sy * arm);
    ctx.lineTo(ox, oy);
    ctx.lineTo(ox - sx * arm, oy);
  }
  ctx.stroke();

  ctx.restore();
}
