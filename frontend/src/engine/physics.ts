// 仕様書 12章・13章: 「実際に操作している感」を高める物理表現レイヤー。
// ゲージ制のロジック自体はstore側にあり、ここは見た目だけを物理っぽく変換する。

export function springTo(
  current: number,
  target: number,
  velocity: number,
  stiffness: number,
  damping: number,
  dt: number,
): [number, number] {
  const force = (target - current) * stiffness - velocity * damping;
  const newVelocity = velocity + force * dt;
  const newValue = current + newVelocity * dt;
  return [newValue, newVelocity];
}

export function organicResistance(t: number, baseValue: number): number {
  const noise =
    Math.sin(t * 2.1) * 0.5 +
    Math.sin(t * 5.3 + 1.7) * 0.3 +
    Math.sin(t * 11.0 + 0.4) * 0.2;
  return baseValue * (1 + noise * 0.25);
}

export class Crank {
  angle = 0;
  velocity = 0;

  onTap() {
    this.velocity += 25;
  }

  update(dt: number) {
    this.velocity *= Math.pow(0.05, dt);
    this.angle += this.velocity * dt;
  }
}

export interface Vec2 {
  x: number;
  y: number;
}

export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  vx = 0;
  vy = 0;
  vzoom = 0;
  targetX = 0;
  targetY = 0;
  targetZoom = 1;
  stiffness = 90;
  damping = 14;
  zoomStiffness = 60;
  zoomDamping = 14;
  maxZoom = 1.8;

  update(dt: number) {
    [this.x, this.vx] = springTo(this.x, this.targetX, this.vx, this.stiffness, this.damping, dt);
    [this.y, this.vy] = springTo(this.y, this.targetY, this.vy, this.stiffness, this.damping, dt);
    const clampedTargetZoom = Math.min(this.targetZoom, this.maxZoom);
    [this.zoom, this.vzoom] = springTo(
      this.zoom,
      clampedTargetZoom,
      this.vzoom,
      this.zoomStiffness,
      this.zoomDamping,
      dt,
    );
  }

  apply(ctx: CanvasRenderingContext2D, w: number, h: number, shake: Vec2) {
    ctx.save();
    ctx.translate(w / 2 + shake.x, h / 2 + shake.y);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }

  restore(ctx: CanvasRenderingContext2D) {
    ctx.restore();
  }
}

// trauma方式の画面シェイク（13章）
export class ShakeController {
  trauma = 0;

  add(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dt: number, t: number): Vec2 {
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    const shake = this.trauma * this.trauma;
    return {
      x: 12 * shake * Math.sin(t * 37.1),
      y: 12 * shake * Math.sin(t * 29.3 + 2.1),
    };
  }
}

export function drawFishingLine(
  ctx: CanvasRenderingContext2D,
  rodTip: Vec2,
  lurePos: Vec2,
  tension: number,
) {
  const sag = (1 - tension) * 40;
  const midX = (rodTip.x + lurePos.x) / 2;
  const midY = (rodTip.y + lurePos.y) / 2 + sag;
  ctx.beginPath();
  ctx.moveTo(rodTip.x, rodTip.y);
  ctx.quadraticCurveTo(midX, midY, lurePos.x, lurePos.y);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

export interface StarLayer {
  stars: Vec2[];
  depthFactor: number;
  radius: number;
  color: string;
}

export function makeStarLayer(count: number, spread: number, depthFactor: number, radius: number, color: string): StarLayer {
  const stars: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: (Math.random() - 0.5) * spread,
      y: (Math.random() - 0.5) * spread,
    });
  }
  return { stars, depthFactor, radius, color };
}

export function drawStarLayer(ctx: CanvasRenderingContext2D, camera: Camera, layer: StarLayer) {
  const offsetX = -camera.x * layer.depthFactor;
  const offsetY = -camera.y * layer.depthFactor;
  ctx.fillStyle = layer.color;
  for (const s of layer.stars) {
    ctx.beginPath();
    ctx.arc(s.x + offsetX, s.y + offsetY, layer.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}
