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

// 無重力の釣り糸：下へ垂れず、たるんだ分は糸に沿って波打ちながらゆっくりうねる。
// slack=0で一直線（張っている）、大きいほど大きくうねる。
// さらに天の川の流れ（恒星風）に晒されて、中間点が微弱にそよぐ。
export function drawFishingLine(
  ctx: CanvasRenderingContext2D,
  rodTip: Vec2,
  lurePos: Vec2,
  slack: number,
  t: number,
) {
  const dx = lurePos.x - rodTip.x;
  const dy = lurePos.y - rodTip.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const segments = 28;
  ctx.beginPath();
  ctx.moveTo(rodTip.x, rodTip.y);
  for (let i = 1; i <= segments; i++) {
    const s = i / segments;
    const envelope = Math.sin(Math.PI * s);
    const wave =
      0.55 * Math.sin(Math.PI * 2 * s + t * 0.7) +
      0.3 * Math.sin(Math.PI * 4.6 * s - t * 1.1 + 1.3) +
      0.15 * Math.sin(t * 0.35 + 2.1);
    const off = slack * envelope * wave;
    const px = rodTip.x + dx * s + nx * off;
    const py = rodTip.y + dy * s + ny * off;
    // 両端（竿先・ルアー）は固定し、中間点ほど強く風を受ける
    const wind = stellarWind(px, py, t);
    const windEnvelope = Math.pow(envelope, 1.5);
    ctx.lineTo(px + wind.x * windEnvelope, py + wind.y * windEnvelope);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

// 周囲を漂う宇宙塵。重力が無いので、それぞれが等速で直進し、ゆっくり自転し続ける。
export interface DustMote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  size: number;
}

const DUST_FIELD = 1400;

export function makeDust(count: number): DustMote[] {
  const motes: DustMote[] = [];
  for (let i = 0; i < count; i++) {
    const dir = Math.random() * Math.PI * 2;
    const speed = 4 + Math.random() * 14;
    motes.push({
      x: (Math.random() - 0.5) * DUST_FIELD,
      y: (Math.random() - 0.5) * DUST_FIELD,
      vx: Math.cos(dir) * speed,
      vy: Math.sin(dir) * speed,
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 1.6,
      size: 1.5 + Math.random() * 2.5,
    });
  }
  return motes;
}

// ワールド座標で描画（camera.apply の後に呼ぶ）。カメラ周辺の箱の中でループさせる。
export function updateAndDrawDust(ctx: CanvasRenderingContext2D, motes: DustMote[], camera: Camera, dt: number) {
  const half = DUST_FIELD / 2;
  ctx.strokeStyle = 'rgba(200,220,255,0.45)';
  ctx.lineWidth = 1;
  for (const m of motes) {
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    m.angle += m.spin * dt;
    m.x = camera.x - half + ((((m.x - camera.x + half) % DUST_FIELD) + DUST_FIELD) % DUST_FIELD);
    m.y = camera.y - half + ((((m.y - camera.y + half) % DUST_FIELD) + DUST_FIELD) % DUST_FIELD);
    const c = Math.cos(m.angle) * m.size;
    const sn = Math.sin(m.angle) * m.size;
    ctx.beginPath();
    ctx.moveTo(m.x - c, m.y - sn);
    ctx.lineTo(m.x + c, m.y + sn);
    ctx.stroke();
  }
}

// ---- 天の川ワールド（どこまでもスクロールできるよう、座標から決定的に手続き生成する） ----

// 天の川の中心線。x方向にうねりながら無限に続く「川」として定義する。
export function riverCenterY(x: number): number {
  return 260 * Math.sin(x / 1400) + 140 * Math.sin(x / 570 + 1.3);
}

export function riverHalfWidth(x: number): number {
  return 380 + 120 * Math.sin(x / 900 + 0.7);
}

// 0〜1。1に近いほど天の川の本流（星が濃い）。
export function milkyWayDensity(x: number, y: number): number {
  const d = (y - riverCenterY(x)) / riverHalfWidth(x);
  const clump = 0.75 + 0.25 * Math.sin(x / 310 + Math.sin(y / 230) * 2);
  return Math.exp(-d * d * 1.6) * clump;
}

// セル座標から同じ乱数列を再現する（mulberry32）
function cellRandom(ix: number, iy: number, seed: number): () => number {
  let a = (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(seed, 83492791)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PARALLAX_LAYERS = [
  { depth: 0.08, cell: 260, count: 3, radius: 0.7, alpha: 0.35, seed: 11 },
  { depth: 0.2, cell: 300, count: 3, radius: 1.0, alpha: 0.5, seed: 23 },
  { depth: 0.4, cell: 340, count: 2, radius: 1.3, alpha: 0.7, seed: 37 },
];

// 遠景の星（画面座標で描画。カメラ移動に対して遅れて動くことで奥行きを出す）
export function drawParallaxStars(ctx: CanvasRenderingContext2D, camera: Camera, w: number, h: number, t: number) {
  ctx.fillStyle = '#ffffff';
  for (const layer of PARALLAX_LAYERS) {
    const lx = camera.x * layer.depth;
    const ly = camera.y * layer.depth;
    const ix0 = Math.floor((lx - w / 2) / layer.cell);
    const ix1 = Math.floor((lx + w / 2) / layer.cell);
    const iy0 = Math.floor((ly - h / 2) / layer.cell);
    const iy1 = Math.floor((ly + h / 2) / layer.cell);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iy = iy0; iy <= iy1; iy++) {
        const rand = cellRandom(ix, iy, layer.seed);
        for (let i = 0; i < layer.count; i++) {
          const sx = (ix + rand()) * layer.cell - lx + w / 2;
          const sy = (iy + rand()) * layer.cell - ly + h / 2;
          const twinkle = 0.75 + 0.25 * Math.sin(t * (1 + rand() * 2) + rand() * 6.28);
          ctx.globalAlpha = layer.alpha * twinkle;
          ctx.beginPath();
          ctx.arc(sx, sy, layer.radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
  ctx.globalAlpha = 1;
}

const NEBULA_COLORS = ['120,150,255', '170,120,255', '255,140,200', '255,210,150', '120,220,255'];
const NEBULA_CELL = 240;
const RIVER_STAR_CELL = 160;
const RIVER_FLOW_SPEED = 14;

// 天の川の流れの位相（流れに沿った移動量）。星の流れと恒星風のうねりが同じ値を参照して同期する。
export function riverFlowPhase(t: number): number {
  return t * RIVER_FLOW_SPEED;
}

// 恒星風（プラズマの流れ）：天の川の流れに乗って伝わる微弱なサイン波。
// 流れの位相から波の位相を決めるので、うねりの山は星と同じ速さで下流へ運ばれていく。
// 向きは川の接線方向、強さは本流ほど強く、外縁の闇でもわずかに残る。
const STELLAR_WIND_AMPLITUDE = 5;
const STELLAR_WIND_WAVELENGTH = 90;
const STELLAR_WIND_RIPPLE = 140;

export function stellarWind(x: number, y: number, t: number): Vec2 {
  const phase = ((x - riverFlowPhase(t)) / STELLAR_WIND_WAVELENGTH) * Math.PI * 2 + y / STELLAR_WIND_RIPPLE;
  const gust = Math.sin(phase) * 0.7 + Math.sin(phase * 1.9 + t * 1.3) * 0.3;
  const strength = STELLAR_WIND_AMPLITUDE * (0.3 + 0.7 * Math.min(1, milkyWayDensity(x, y))) * gust;
  // 川の中心線の傾きから接線ベクトルを求める
  const slope = (riverCenterY(x + 1) - riverCenterY(x - 1)) / 2;
  const tangentLen = Math.hypot(1, slope);
  return { x: strength / tangentLen, y: (strength * slope) / tangentLen };
}

// 天の川本体（ワールド座標で描画するので camera.apply の後に呼ぶ）
export function drawMilkyWay(ctx: CanvasRenderingContext2D, camera: Camera, w: number, h: number, t: number) {
  const margin = 400;
  const x0 = camera.x - w / (2 * camera.zoom) - margin;
  const x1 = camera.x + w / (2 * camera.zoom) + margin;
  const y0 = camera.y - h / (2 * camera.zoom) - margin;
  const y1 = camera.y + h / (2 * camera.zoom) + margin;

  // 星雲のにじみ
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let ix = Math.floor(x0 / NEBULA_CELL); ix <= Math.floor(x1 / NEBULA_CELL); ix++) {
    for (let iy = Math.floor(y0 / NEBULA_CELL); iy <= Math.floor(y1 / NEBULA_CELL); iy++) {
      const rand = cellRandom(ix, iy, 101);
      const cx = (ix + rand()) * NEBULA_CELL;
      const cy = (iy + rand()) * NEBULA_CELL;
      const density = milkyWayDensity(cx, cy);
      if (density < 0.05) continue;
      const r = 220 + rand() * 260;
      const color = NEBULA_COLORS[Math.floor(rand() * NEBULA_COLORS.length)];
      const alpha = density * (0.12 + rand() * 0.12);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `rgba(${color},${alpha})`);
      g.addColorStop(1, `rgba(${color},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  }
  ctx.restore();

  // 川の流れに沿ってゆっくり流れる星々（密度は固定座標で評価するので川の形は動かない）
  const flow = riverFlowPhase(t);
  ctx.fillStyle = '#ffffff';
  for (let ix = Math.floor((x0 - flow) / RIVER_STAR_CELL); ix <= Math.floor((x1 - flow) / RIVER_STAR_CELL); ix++) {
    for (let iy = Math.floor(y0 / RIVER_STAR_CELL); iy <= Math.floor(y1 / RIVER_STAR_CELL); iy++) {
      const cellX = (ix + 0.5) * RIVER_STAR_CELL + flow;
      const cellY = (iy + 0.5) * RIVER_STAR_CELL;
      const count = Math.round(Math.pow(milkyWayDensity(cellX, cellY), 1.2) * 26);
      if (count === 0) continue;
      const rand = cellRandom(ix, iy, 202);
      for (let i = 0; i < count; i++) {
        const sx = (ix + rand()) * RIVER_STAR_CELL + flow;
        const sy = (iy + rand()) * RIVER_STAR_CELL;
        const radius = 0.6 + rand() * rand() * 2.2;
        const twinkle = 0.6 + 0.4 * Math.sin(t * (1.5 + rand() * 3) + rand() * 6.28);
        ctx.globalAlpha = (0.35 + rand() * 0.55) * twinkle;
        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;
}
