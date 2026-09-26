// 仕様書 12章・13章: 「実際に操作している感」を高める物理表現レイヤー。
// ゲージ制のロジック自体はstore側にあり、ここは見た目だけを物理っぽく変換する。

import { rgba, type SeasonLook } from './seasons';

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
// tension（0〜1超）が高いほど糸は細く明るく張り詰めて風にも流されにくくなり、
// vibration は獲物に引かれた瞬間の弦のような細かい震えの振幅、
// bow は獲物が左右に走ったときに糸の中ほどが横へふくらむ量（+は法線方向）。
const LINE_SEGMENTS = 28;
const linePoints: Vec2[] = Array.from({ length: LINE_SEGMENTS + 1 }, () => ({ x: 0, y: 0 }));

export function drawFishingLine(
  ctx: CanvasRenderingContext2D,
  rodTip: Vec2,
  lurePos: Vec2,
  slack: number,
  t: number,
  tension = 0,
  vibration = 0,
  bow = 0,
) {
  const dx = lurePos.x - rodTip.x;
  const dy = lurePos.y - rodTip.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const taut = Math.min(1, tension);
  const windScale = 1 - taut * 0.8;
  linePoints[0].x = rodTip.x;
  linePoints[0].y = rodTip.y;
  for (let i = 1; i <= LINE_SEGMENTS; i++) {
    const s = i / LINE_SEGMENTS;
    const envelope = Math.sin(Math.PI * s);
    const wave =
      0.55 * Math.sin(Math.PI * 2 * s + t * 0.7) +
      0.3 * Math.sin(Math.PI * 4.6 * s - t * 1.1 + 1.3) +
      0.15 * Math.sin(t * 0.35 + 2.1);
    // 弦の基本振動と2倍振動を重ねた速い震え（両端は固定）
    const vib =
      vibration * (Math.sin(Math.PI * s) * Math.sin(t * 61) + 0.45 * Math.sin(Math.PI * 2 * s) * Math.sin(t * 97 + 1.1));
    // 横ぶれは竿先寄りが大きく遅れる非対称な弧にする（獲物側は獲物と一緒に動くため）
    const bowShape = envelope * (1.25 - 0.5 * s);
    const off = slack * envelope * wave + vib + bow * bowShape;
    const px = rodTip.x + dx * s + nx * off;
    const py = rodTip.y + dy * s + ny * off;
    // 両端（竿先・ルアー）は固定し、中間点ほど強く風を受ける
    const wind = stellarWind(px, py, t);
    const windEnvelope = Math.pow(envelope, 1.5) * windScale;
    linePoints[i].x = px + wind.x * windEnvelope;
    linePoints[i].y = py + wind.y * windEnvelope;
  }

  const tracePath = () => {
    ctx.beginPath();
    ctx.moveTo(linePoints[0].x, linePoints[0].y);
    for (let i = 1; i <= LINE_SEGMENTS; i++) ctx.lineTo(linePoints[i].x, linePoints[i].y);
  };

  // 張り詰めた糸は熱を帯びたように淡く光る
  const glow = Math.max(0, tension - 0.45);
  if (glow > 0) {
    tracePath();
    ctx.strokeStyle = `rgba(255,200,120,${Math.min(0.4, glow * 0.45)})`;
    ctx.lineWidth = 4 + glow * 3;
    ctx.stroke();
  }
  tracePath();
  // たるみ時は白く半透明、張るほど明るい琥珀色になり、引き伸ばされて細くなる
  const g = Math.round(255 - 40 * taut);
  const b = Math.round(255 - 110 * taut);
  ctx.strokeStyle = `rgba(255,${g},${b},${0.6 + 0.35 * taut})`;
  ctx.lineWidth = 1.5 - 0.5 * taut;
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
export function updateAndDrawDust(
  ctx: CanvasRenderingContext2D,
  motes: DustMote[],
  camera: Camera,
  dt: number,
  look: SeasonLook,
) {
  const half = DUST_FIELD / 2;
  ctx.strokeStyle = rgba(look.dustColor, 0.45);
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
// widthScale は季節による見た目の太さ。釣り場の判定には既定値(1)を使う。
export function milkyWayDensity(x: number, y: number, widthScale = 1): number {
  const d = (y - riverCenterY(x)) / (riverHalfWidth(x) * widthScale);
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
export function drawParallaxStars(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  w: number,
  h: number,
  t: number,
  look: SeasonLook,
) {
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
          const twinkle = 1 - look.twinkle * 0.6 * (1 - Math.sin(t * (1 + rand() * 2) + rand() * 6.28));
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

const BAND_CELL = 200;
const RIFT_CELL = 70;
const BRIGHT_STAR_CELL = 400;
const GALAXY_CELL = 900;

// 天の川本体（ワールド座標で描画するので camera.apply の後に呼ぶ）
// 見た目は季節ごとの look で変わる（形・流れは季節によらず共通）
export function drawMilkyWay(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  w: number,
  h: number,
  t: number,
  look: SeasonLook,
) {
  const margin = 400;
  const x0 = camera.x - w / (2 * camera.zoom) - margin;
  const x1 = camera.x + w / (2 * camera.zoom) + margin;
  const y0 = camera.y - h / (2 * camera.zoom) - margin;
  const y1 = camera.y + h / (2 * camera.zoom) + margin;
  const density = (x: number, y: number) => milkyWayDensity(x, y, look.widthScale);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // 川の中心線に沿った帯状の輝き（夏は銀河中心のバルジで黄金色に、春は霞んだ桜色に光る）
  if (look.bandAlpha > 0.005) {
    for (let ix = Math.floor(x0 / BAND_CELL); ix <= Math.floor(x1 / BAND_CELL); ix++) {
      const cx = (ix + 0.5) * BAND_CELL;
      const cy = riverCenterY(cx);
      const r = riverHalfWidth(cx) * look.widthScale * 1.1;
      if (cy + r < y0 || cy - r > y1) continue;
      const alpha = look.bandAlpha * (0.65 + 0.35 * Math.sin(cx / 700 + 0.4));
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, rgba(look.bandGlow, alpha));
      g.addColorStop(1, rgba(look.bandGlow, 0));
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  }

  // 星雲のにじみ
  for (let ix = Math.floor(x0 / NEBULA_CELL); ix <= Math.floor(x1 / NEBULA_CELL); ix++) {
    for (let iy = Math.floor(y0 / NEBULA_CELL); iy <= Math.floor(y1 / NEBULA_CELL); iy++) {
      const rand = cellRandom(ix, iy, 101);
      const cx = (ix + rand()) * NEBULA_CELL;
      const cy = (iy + rand()) * NEBULA_CELL;
      const d = density(cx, cy);
      if (d < 0.05) continue;
      const r = 220 + rand() * 260;
      const color = look.nebulaColors[Math.floor(rand() * look.nebulaColors.length)];
      const alpha = Math.min(0.5, d * (0.12 + rand() * 0.12) * look.nebulaAlpha);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, rgba(color, alpha));
      g.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  }

  // 天の川から離れた暗い空に浮かぶ系外銀河（春の銀河団、秋のアンドロメダ）
  if (look.galaxyRate > 0.01) {
    for (let ix = Math.floor(x0 / GALAXY_CELL); ix <= Math.floor(x1 / GALAXY_CELL); ix++) {
      for (let iy = Math.floor(y0 / GALAXY_CELL); iy <= Math.floor(y1 / GALAXY_CELL); iy++) {
        const rand = cellRandom(ix, iy, 404);
        // 出現率が上がるにつれて閾値の低いものから順にフェードインする
        const fade = Math.min(1, (look.galaxyRate - rand()) * 4);
        const cx = (ix + rand()) * GALAXY_CELL;
        const cy = (iy + rand()) * GALAXY_CELL;
        const dark = 1 - Math.min(1, density(cx, cy) * 3);
        if (fade <= 0 || dark <= 0) continue;
        const r = 26 + rand() * 50;
        const tilt = rand() * Math.PI;
        const flat = 0.25 + rand() * 0.35;
        const color = look.starColors[Math.floor(rand() * look.starColors.length)];
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(tilt);
        ctx.scale(1, flat);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
        g.addColorStop(0, rgba(color, 0.55 * fade * dark));
        g.addColorStop(0.18, rgba(color, 0.22 * fade * dark));
        g.addColorStop(1, rgba(color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }
  ctx.restore();

  // 川の流れに沿ってゆっくり流れる星々（密度は固定座標で評価するので川の形は動かない）
  const flow = riverFlowPhase(t);
  const starStyles = look.starColors.map((c) => rgba(c, 1));
  for (let ix = Math.floor((x0 - flow) / RIVER_STAR_CELL); ix <= Math.floor((x1 - flow) / RIVER_STAR_CELL); ix++) {
    for (let iy = Math.floor(y0 / RIVER_STAR_CELL); iy <= Math.floor(y1 / RIVER_STAR_CELL); iy++) {
      const cellX = (ix + 0.5) * RIVER_STAR_CELL + flow;
      const cellY = (iy + 0.5) * RIVER_STAR_CELL;
      const count = Math.round(Math.pow(density(cellX, cellY), 1.2) * 26 * look.starDensity);
      if (count === 0) continue;
      const rand = cellRandom(ix, iy, 202);
      for (let i = 0; i < count; i++) {
        const sx = (ix + rand()) * RIVER_STAR_CELL + flow;
        const sy = (iy + rand()) * RIVER_STAR_CELL;
        const radius = 0.6 + rand() * rand() * 2.2;
        const twinkle = 1 - look.twinkle * (1 - Math.sin(t * (1.5 + rand() * 3) + rand() * 6.28));
        ctx.globalAlpha = Math.max(0, (0.35 + rand() * 0.55) * twinkle);
        ctx.fillStyle = starStyles[Math.floor(rand() * starStyles.length)];
        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;

  // 暗黒星雲の裂け目。川の中心付近を2本の暗い帯が途切れながら走り、星と光を覆い隠す（夏に最も濃い）
  if (look.riftStrength > 0.02) {
    for (let ix = Math.floor(x0 / RIFT_CELL); ix <= Math.floor(x1 / RIFT_CELL); ix++) {
      const rand = cellRandom(ix, 0, 303);
      const cx = (ix + rand()) * RIFT_CELL;
      const half = riverHalfWidth(cx) * look.widthScale;
      const center = riverCenterY(cx);
      for (let lane = 0; lane < 2; lane++) {
        // 2本の帯は付いたり離れたりしながら、ところどころで途切れる
        const offset = half * (lane === 0 ? 0.08 : -0.22) * (1 + Math.sin(cx / 520 + lane * 2.3));
        const presence = 0.5 + 0.5 * Math.sin(cx / (lane === 0 ? 380 : 260) + lane * 1.7);
        if (presence < 0.15) continue;
        const cy = center + offset + (rand() - 0.5) * half * 0.12;
        const r = half * (lane === 0 ? 0.2 : 0.13) * (0.7 + rand() * 0.6);
        if (cy + r < y0 || cy - r > y1) continue;
        const alpha = look.riftStrength * presence * 0.6;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, rgba(look.background, alpha));
        g.addColorStop(1, rgba(look.background, 0));
        ctx.fillStyle = g;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
    }
  }

  // 一等星（光条つき）。冬のダイヤモンドのように、川の濃さに関係なく空全体に散らばる
  if (look.brightStarRate > 0.01) {
    for (let ix = Math.floor(x0 / BRIGHT_STAR_CELL); ix <= Math.floor(x1 / BRIGHT_STAR_CELL); ix++) {
      for (let iy = Math.floor(y0 / BRIGHT_STAR_CELL); iy <= Math.floor(y1 / BRIGHT_STAR_CELL); iy++) {
        const rand = cellRandom(ix, iy, 505);
        const fade = Math.min(1, (look.brightStarRate - rand()) * 4);
        const sx = (ix + rand()) * BRIGHT_STAR_CELL;
        const sy = (iy + rand()) * BRIGHT_STAR_CELL;
        const color = look.brightStarColors[Math.floor(rand() * look.brightStarColors.length)];
        const size = 1.6 + rand() * 1.4;
        const speed = 2 + rand() * 4;
        const seed = rand() * 6.28;
        if (fade <= 0) continue;
        const twinkle = 1 - look.twinkle * 0.7 * (1 - Math.sin(t * speed + seed));
        const alpha = fade * twinkle;
        const glowR = size * 7;
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowR);
        g.addColorStop(0, rgba(color, 0.9 * alpha));
        g.addColorStop(0.15, rgba(color, 0.35 * alpha));
        g.addColorStop(1, rgba(color, 0));
        ctx.fillStyle = g;
        ctx.fillRect(sx - glowR, sy - glowR, glowR * 2, glowR * 2);
        // 光条（またたきに合わせて伸び縮みする）
        const spike = size * (5 + 5 * twinkle);
        ctx.strokeStyle = rgba(color, 0.6 * alpha);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(sx - spike, sy);
        ctx.lineTo(sx + spike, sy);
        ctx.moveTo(sx, sy - spike);
        ctx.lineTo(sx, sy + spike);
        ctx.stroke();
        ctx.fillStyle = rgba([255, 255, 255], alpha);
        ctx.beginPath();
        ctx.arc(sx, sy, size * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
