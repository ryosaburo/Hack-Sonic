import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { useGameStore } from '../store/gameStore';
import {
  Camera,
  ShakeController,
  Crank,
  drawFishingLine,
  makeDust,
  updateAndDrawDust,
  drawParallaxStars,
  drawMilkyWay,
  milkyWayDensity,
  riverCenterY,
  riverHalfWidth,
  organicResistance,
  springTo,
} from '../engine/physics';
import {
  initAudio,
  playReelClick,
  playBite,
  playPhaseWarning,
  playPhaseSwitch,
  playLineTug,
  playSuccess,
  playFailure,
} from '../engine/audio';
import {
  SEASON_DESCRIPTION,
  SEASON_LABEL,
  SEASON_LOOKS,
  SEASON_ORDER,
  blendLookInto,
  cloneLook,
  rgba,
} from '../engine/seasons';
import { RARITY_CONFIG } from '../types';
import './FishingScene.css';

// 竿の根元・ルアー投入点はプレイヤー位置(pan)からの相対座標
const CATCH_POINT = { x: 0, y: -140 };
const ROD_BASE_Y = 320;
const ROD_LENGTH = 60;

// 無重力の挙動パラメータ。どれも「弱いバネ＋弱い減衰」で、動き出すと止まりにくい。
const CAST_STIFFNESS = 4;
const CAST_DAMPING = 2.4;
const BODY_STIFFNESS = 3;
const BODY_DAMPING = 1.6;
const SPIN_FRICTION = 0.25;

// 糸の張力。張るときは一瞬で張り詰め、緩むときはゆっくり戻る（「グッ」と引かれる感触の非対称さ）
const TENSION_RISE_RATE = 16;
const TENSION_FALL_RATE = 3.5;
// 糸の震え（弦のような振動）の減衰の速さ
const LINE_VIB_DECAY = 5;
// 糸の横ぶれ。獲物が左右に走ると糸の中ほどが遅れてついていき、張った糸が左右に揺り戻す
const LINE_BOW_STIFFNESS = 38;
const LINE_BOW_DAMPING = 3.2;
const LINE_BOW_LAG = 0.3;
const LINE_BOW_MAX = 64;

// 着水点が天の川の中心からこの倍率×川幅より外に出ないようにする（迷子防止）
const RIVER_BOUND = 1.8;
const KEY_PAN_SPEED = 520;
const PAN_FRICTION = 3.5;
// 季節を切り替えたとき、夜空が移ろう速さ（1/s）
const SEASON_BLEND_RATE = 1.6;
// フリック時の慣性速度の上限（world units/s）
const MAX_FLING_SPEED = 2600;

const PAN_KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  KeyD: [1, 0],
  KeyW: [0, -1],
  KeyS: [0, 1],
};

function clampPanY(x: number, y: number): number {
  const center = riverCenterY(x) - CATCH_POINT.y;
  const limit = riverHalfWidth(x) * RIVER_BOUND;
  return Math.min(center + limit, Math.max(center - limit, y));
}

function zoneName(density: number): string {
  if (density > 0.7) return '天の川の本流';
  if (density > 0.35) return '天の川の流れ';
  if (density > 0.12) return '天の川の岸辺';
  return '外縁の闇';
}

const START_PAN_Y = riverCenterY(0) - CATCH_POINT.y;

interface RodState {
  panX: number;
  panY: number;
  floatX: number;
  floatY: number;
  rodAngle: number;
}

function rodBaseOf(e: RodState) {
  return { x: e.panX + e.floatX, y: e.panY + ROD_BASE_Y + e.floatY };
}

function rodTipOf(e: RodState) {
  const base = rodBaseOf(e);
  return { x: base.x + Math.sin(e.rodAngle) * ROD_LENGTH, y: base.y - Math.cos(e.rodAngle) * ROD_LENGTH };
}

function unitVector(x: number, y: number) {
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

export function FishingScene() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const coordRef = useRef<HTMLSpanElement | null>(null);
  const zoneRef = useRef<HTMLSpanElement | null>(null);
  const densityFillRef = useRef<HTMLDivElement | null>(null);
  const [explored, setExplored] = useState(false);
  const [seasonChanged, setSeasonChanged] = useState(false);

  const engineRef = useRef({
    camera: Object.assign(new Camera(), { y: START_PAN_Y, targetY: START_PAN_Y }),
    shake: new ShakeController(),
    crank: new Crank(),
    panX: 0,
    panY: START_PAN_Y,
    panVX: 0,
    panVY: 0,
    drag: null as { id: number; x: number; y: number; time: number } | null,
    keys: new Set<string>(),
    // 釣り人（竿の根元）は宙に浮いていて、魚に引かれると体ごと流される
    floatX: 0,
    floatY: 0,
    floatVX: 0,
    floatVY: 0,
    rodAngle: 0,
    rodAngleVel: 0,
    rodBend: 0,
    rodBendVel: 0,
    lureX: 0,
    lureY: START_PAN_Y + ROD_BASE_Y - ROD_LENGTH,
    lureVX: 0,
    lureVY: 0,
    lureSpin: 0,
    lureSpinVel: 0,
    slack: 0,
    // 糸の張力（0=たるみ, 1=張り詰め, 1超=限界近く）と、引かれた瞬間の震えの振幅
    lineTension: 0,
    lineVib: 0,
    // 糸の中ほどの横方向のふくらみ（+は糸の法線方向）と、次に獲物が走る向き（左右交互）
    lineBow: 0,
    lineBowVel: 0,
    pullSide: 1,
    dust: makeDust(40),
    // 現在の見た目。季節を切り替えると目標の季節へ毎フレーム少しずつ寄っていく
    look: cloneLook(SEASON_LOOKS[useGameStore.getState().season]),
    prevPhase: 'idle',
    prevReelMode: 'tap' as 'tap' | 'hold',
    prevTelegraph: false,
    clickAccumulator: 0,
    pullTimer: 0,
  });

  const phase = useGameStore((s) => s.phase);
  const gauge = useGameStore((s) => s.gauge);
  const timeLeft = useGameStore((s) => s.timeLeft);
  const reelPhaseMode = useGameStore((s) => s.reelPhaseMode);
  const phaseTelegraph = useGameStore((s) => s.phaseTelegraph);
  const currentEntry = useGameStore((s) => s.currentEntry);
  const season = useGameStore((s) => s.season);
  const setSeason = useGameStore((s) => s.setSeason);
  const startCast = useGameStore((s) => s.startCast);
  const pressStart = useGameStore((s) => s.pressStart);
  const pressEnd = useGameStore((s) => s.pressEnd);
  const tickReel = useGameStore((s) => s.tickReel);

  // プレイヤー位置を動かす。カメラも同じだけずらすので、ドラッグ中は画面が指に1:1で吸い付く。
  function movePan(dx: number, dy: number) {
    const e = engineRef.current;
    const nextX = e.panX + dx;
    const nextY = clampPanY(nextX, e.panY + dy);
    e.camera.x += nextX - e.panX;
    e.camera.y += nextY - e.panY;
    if (nextY !== e.panY + dy) e.panVY = 0;
    e.panX = nextX;
    e.panY = nextY;
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    function resize() {
      if (!canvas || !wrapper) return;
      canvas.width = wrapper.clientWidth * dpr;
      canvas.height = wrapper.clientHeight * dpr;
      canvas.style.width = `${wrapper.clientWidth}px`;
      canvas.style.height = `${wrapper.clientHeight}px`;
    }
    resize();
    window.addEventListener('resize', resize);

    // トラックパッドの2本指スクロール / マウスホイールで移動（ブラウザのズームは抑止）
    function onWheel(ev: WheelEvent) {
      ev.preventDefault();
      if (useGameStore.getState().phase !== 'idle') return;
      const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? wrapper!.clientHeight : 1;
      const zoom = engineRef.current.camera.zoom;
      // 縦ホイールのみのマウスでも川に沿って進めるよう、横成分が無いときは縦を横移動に割り当てる
      const horizontalOnly = ev.deltaX === 0 && !ev.shiftKey;
      const dx = horizontalOnly ? ev.deltaY : ev.shiftKey ? ev.deltaY : ev.deltaX;
      const dy = horizontalOnly || ev.shiftKey ? 0 : ev.deltaY;
      engineRef.current.panVX = 0;
      engineRef.current.panVY = 0;
      movePan((dx * unit) / zoom, (dy * unit) / zoom);
      setExplored(true);
    }
    wrapper.addEventListener('wheel', onWheel, { passive: false });

    let raf = 0;
    let last = performance.now();
    let lastHudText = '';

    function loop(now: number) {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const t = now / 1000;
      const ctx = canvas!.getContext('2d');
      if (!ctx) {
        raf = requestAnimationFrame(loop);
        return;
      }

      const state = useGameStore.getState();
      const e = engineRef.current;
      // ---- 自由移動（待機中のみ）：慣性・キーボード ----
      if (state.phase === 'idle') {
        let kx = 0;
        let ky = 0;
        for (const code of e.keys) {
          const dir = PAN_KEYS[code];
          if (dir) {
            kx += dir[0];
            ky += dir[1];
          }
        }
        if (kx !== 0 || ky !== 0) {
          e.panVX = (kx * KEY_PAN_SPEED) / e.camera.zoom;
          e.panVY = (ky * KEY_PAN_SPEED) / e.camera.zoom;
        } else if (!e.drag) {
          const decay = Math.exp(-PAN_FRICTION * dt);
          e.panVX *= decay;
          e.panVY *= decay;
        }
        if (!e.drag && (Math.abs(e.panVX) > 0.5 || Math.abs(e.panVY) > 0.5)) {
          movePan(e.panVX * dt, e.panVY * dt);
        }
      }

      // 移動を反映した後の位置を使う（前フレームの値だとカメラが目標に置いていかれる）
      const anchorX = e.panX;
      const anchorY = e.panY;
      const catchX = anchorX + CATCH_POINT.x;
      const catchY = anchorY + CATCH_POINT.y;

      // ---- フェーズ切替の検知（音・カメラ演出のトリガー） ----
      if (e.prevPhase !== state.phase) {
        if (state.phase === 'cast') {
          e.panVX = 0;
          e.panVY = 0;
          e.keys.clear();
          // 竿先から投入点へ向けて初速を与えるだけ。あとは慣性で進み、糸に引き戻されてふわりと止まる
          const tip = rodTipOf(e);
          e.lureX = tip.x;
          e.lureY = tip.y;
          e.lureVX = catchX - tip.x;
          e.lureVY = catchY - tip.y;
          e.lureSpinVel = (Math.random() - 0.5) * 8;
          e.camera.targetX = anchorX;
          e.camera.targetY = anchorY - 60;
          e.camera.targetZoom = 0.85;
        } else if (state.phase === 'waiting_bite') {
          e.camera.targetX = catchX;
          e.camera.targetY = catchY;
          e.camera.targetZoom = 1.0;
        } else if (state.phase === 'reeling') {
          playBite();
          playLineTug(1);
          e.shake.add(0.15);
          e.camera.targetZoom = 0.95;
          // アタリの瞬間、獲物が釣り人から離れる向きへ一気に走り、糸が張り詰める
          const biteBase = rodBaseOf(e);
          const bite = unitVector(e.lureX - biteBase.x, e.lureY - biteBase.y);
          e.lureVX += bite.x * 200;
          e.lureVY += bite.y * 200;
          e.floatVX += bite.x * 60;
          e.floatVY += bite.y * 60;
          e.rodBendVel += 70;
          e.lineTension = 1.1;
          e.lineVib = 9;
        } else if (state.phase === 'result') {
          if (state.lastResultSuccess) {
            const rarity = state.currentEntry?.rarity ?? 'common';
            const zoomByRarity = { common: 1.2, rare: 1.35, super_rare: 1.5, legendary: 1.8 }[rarity];
            playSuccess(rarity);
            const traumaByRarity = { common: 0.3, rare: 0.45, super_rare: 0.6, legendary: 0.9 }[rarity];
            e.shake.add(traumaByRarity);
            e.camera.targetZoom = zoomByRarity;
          } else {
            playFailure();
            e.camera.targetZoom = 0.8;
            window.setTimeout(() => {
              e.camera.targetZoom = 1.0;
            }, 250);
          }
        } else if (state.phase === 'idle') {
          e.camera.targetZoom = 1.0;
        }
        e.prevPhase = state.phase;
      }

      if (state.phase === 'reeling' && e.prevReelMode !== state.reelPhaseMode) {
        playPhaseSwitch();
        e.shake.add(0.12);
        e.prevReelMode = state.reelPhaseMode;
      }
      if (state.phase === 'reeling' && !e.prevTelegraph && state.phaseTelegraph) {
        playPhaseWarning();
      }
      e.prevTelegraph = state.phaseTelegraph;

      // ---- 巻き上げロジックの時間進行 ----
      if (state.phase === 'reeling') {
        tickReel(dt);
        const rarity = state.currentEntry?.rarity;
        if (rarity && state.isHolding && state.reelPhaseMode === 'hold') {
          e.crank.velocity += 40 * dt * 25;
          e.clickAccumulator += dt;
          const interval = Math.max(0.05, 0.22 - Math.min(e.crank.velocity, 400) / 2500);
          if (e.clickAccumulator > interval) {
            e.clickAccumulator = 0;
            playReelClick();
          }
        }
      }

      e.crank.update(dt);

      // ---- 釣り人の浮遊（ゆっくり漂い、引かれた勢いはなかなか消えない） ----
      [e.floatX, e.floatVX] = springTo(e.floatX, Math.sin(t * 0.23) * 10, e.floatVX, BODY_STIFFNESS, BODY_DAMPING, dt);
      [e.floatY, e.floatVY] = springTo(e.floatY, Math.sin(t * 0.31 + 1) * 8, e.floatVY, BODY_STIFFNESS, BODY_DAMPING, dt);

      // 竿の向き：普段は宙でゆらりと揺れ、巻き上げ中は糸に引かれて獲物の方へ向く
      const base = rodBaseOf(e);
      const fishEnergy = Math.max(0.15, state.gauge / 100);
      const toLureAngle = Math.atan2(e.lureX - base.x, -(e.lureY - base.y));
      const rodTargetAngle =
        state.phase === 'reeling'
          ? Math.max(-0.6, Math.min(0.6, toLureAngle))
          : Math.sin(t * 0.4) * 0.1 + Math.sin(t * 0.17 + 2) * 0.06;
      [e.rodAngle, e.rodAngleVel] = springTo(e.rodAngle, rodTargetAngle, e.rodAngleVel, 30, 5, dt);
      // 竿のしなりは糸の張力に比例させる（張るほど深く曲がる）
      const rodBendTarget = state.phase === 'reeling' ? 3 + e.lineTension * 9 : 0;
      [e.rodBend, e.rodBendVel] = springTo(e.rodBend, rodBendTarget, e.rodBendVel, 120, 12, dt);
      const rodTip = rodTipOf(e);

      // ---- ルアー位置（世界座標）の更新 ----
      let targetLureX = e.lureX;
      let targetLureY = e.lureY;
      let lureStiffness = CAST_STIFFNESS;
      let lureDamping = CAST_DAMPING;
      if (state.phase === 'idle') {
        targetLureX = rodTip.x;
        targetLureY = rodTip.y;
        lureStiffness = 40;
        lureDamping = 8;
      } else if (state.phase === 'reeling') {
        // 常時の低周波なゆらぎ（体力が高い＝魚が元気なほど大きく暴れる）
        const driftX = organicResistance(t, 10) * (0.4 + fishEnergy * 0.4);
        const driftY = organicResistance(t * 0.87 + 4.2, 10) * (0.4 + fishEnergy * 0.4);
        // 獲物は糸を振りほどこうと、糸に対して左右へゆっくり首を振り続ける
        const outwardNow = unitVector(e.lureX - base.x, e.lureY - base.y);
        const sway = Math.sin(t * 1.9) * 40 * (0.4 + fishEnergy * 0.6);
        targetLureX = catchX + driftX - outwardNow.y * sway;
        targetLureY = catchY + driftY + outwardNow.x * sway;
        // 巻き上げ中はバネを柔らかく(damping低め)して、力積による揺り戻しが起きやすいようにする
        lureStiffness = 55;
        lureDamping = 6;

        // 一定間隔で「グッ」と引かれる力積を速度に直接加える（引っ張られている実感）
        // 獲物は糸に対して左右へ交互に走り（ときどき同じ側へ続けて走る）、少し沖へも逃げようとする。
        // 横へ走ると張った糸が横に引きずられ、中ほどが遅れてしなって左右に揺り戻す
        e.pullTimer -= dt;
        if (e.pullTimer <= 0) {
          const outward = unitVector(e.lureX - base.x, e.lureY - base.y);
          if (Math.random() < 0.75) e.pullSide = -e.pullSide;
          const side = e.pullSide;
          const jitter = (Math.random() - 0.5) * 0.5;
          const pull = unitVector(
            -outward.y * side + outward.x * (0.45 + jitter),
            outward.x * side + outward.y * (0.45 + jitter),
          );
          const strength = (80 + Math.random() * 70) * (0.5 + fishEnergy * 0.5);
          e.lureVX += pull.x * strength;
          e.lureVY += pull.y * strength;
          e.lureSpinVel += (Math.random() - 0.5) * 6;
          const along = Math.max(0, pull.x * outward.x + pull.y * outward.y);
          const lateral = Math.abs(pull.x * -outward.y + pull.y * outward.x);
          // 横へ走っても張った糸は引っ張られるので、横方向の成分も張力に効かせる
          const tug = (along + lateral * 0.6) * (strength / 140);
          e.floatVX += outward.x * strength * 0.3 * along;
          e.floatVY += outward.y * strength * 0.3 * along;
          // 竿も獲物が走った側へ振られる（竿の角度は右へ倒れるほど正）
          e.rodAngleVel += -outward.y * side * (0.8 + Math.random() * 0.8);
          e.rodBendVel += 50 * tug;
          e.lineVib = Math.max(e.lineVib, 2 + 6 * tug);
          if (tug > 0.15) playLineTug(tug);
          e.shake.add(0.03 + tug * 0.08);
          e.pullTimer = 0.35 + Math.random() * 0.55;
        }
      } else if (state.phase === 'cast' || state.phase === 'waiting_bite') {
        // 浮きのように上下するのではなく、投入点のまわりをあてもなく漂う
        targetLureX = catchX + Math.sin(t * 0.29) * 14;
        targetLureY = catchY + Math.sin(t * 0.37 + 0.8) * 12;
      } else {
        // 釣り上げた獲物は竿先の少し先で、回りながらふわふわ浮いている
        targetLureX = rodTip.x + Math.sin(e.rodAngle) * 40;
        targetLureY = rodTip.y - Math.cos(e.rodAngle) * 40;
        lureStiffness = 10;
        lureDamping = 3;
      }
      [e.lureX, e.lureVX] = springTo(e.lureX, targetLureX, e.lureVX, lureStiffness, lureDamping, dt);
      [e.lureY, e.lureVY] = springTo(e.lureY, targetLureY, e.lureVY, lureStiffness, lureDamping, dt);
      e.lureSpinVel *= Math.exp(-SPIN_FRICTION * dt);
      e.lureSpin += e.lureSpinVel * dt;

      // ---- 糸の張力 ----
      // 獲物が釣り人から離れる速さ・魚の元気さ・巻き上げ（長押し）の3つで糸が張る
      let tensionTarget = 0;
      if (state.phase === 'reeling') {
        const toLure = unitVector(e.lureX - rodTip.x, e.lureY - rodTip.y);
        const outwardSpeed = e.lureVX * toLure.x + e.lureVY * toLure.y;
        const reelingIn = state.reelPhaseMode === 'hold' && state.isHolding ? 0.35 : 0;
        tensionTarget = Math.min(
          1.3,
          Math.max(0, 0.2 + fishEnergy * 0.4 + Math.max(-0.3, Math.min(0.7, outwardSpeed / 180)) + reelingIn),
        );
      }
      const tensionRate = tensionTarget > e.lineTension ? TENSION_RISE_RATE : TENSION_FALL_RATE;
      e.lineTension += (tensionTarget - e.lineTension) * (1 - Math.exp(-tensionRate * dt));
      e.lineVib *= Math.exp(-LINE_VIB_DECAY * dt);

      // ---- 糸の横ぶれ ----
      // 糸の中ほどは獲物の横移動に遅れてついていくので、横の速さと逆向きにふくらむ。
      // 弱い減衰のバネなので、獲物が止まった後も左右に数回揺り戻す
      let bowTarget = 0;
      if (state.phase === 'reeling') {
        const toLure = unitVector(e.lureX - rodTip.x, e.lureY - rodTip.y);
        const lateralSpeed = e.lureVX * -toLure.y + e.lureVY * toLure.x;
        bowTarget = Math.max(-LINE_BOW_MAX, Math.min(LINE_BOW_MAX, -lateralSpeed * LINE_BOW_LAG));
      }
      [e.lineBow, e.lineBowVel] = springTo(e.lineBow, bowTarget, e.lineBowVel, LINE_BOW_STIFFNESS, LINE_BOW_DAMPING, dt);

      // 糸のたるみ：重力で垂れる代わりに、張りが弱いほど大きくうねる
      const slackTarget =
        state.phase === 'cast'
          ? 30
          : state.phase === 'waiting_bite'
            ? 38
            : state.phase === 'reeling'
              ? Math.max(0, 1 - e.lineTension) * 30
              : state.phase === 'idle'
                ? 0
                : 20;
      // 張ったときは即座に一直線になり、緩むときはふわりとたるむ
      const slackRate = slackTarget < e.slack && state.phase === 'reeling' ? 12 : 2;
      e.slack += (slackTarget - e.slack) * (1 - Math.exp(-slackRate * dt));

      if (state.phase === 'idle') {
        e.camera.targetX = anchorX + Math.sin(t * 0.05) * 10;
        e.camera.targetY = anchorY + Math.sin(t * 0.037) * 6;
      } else if (state.phase === 'reeling') {
        // 暴れるルアー（魚）の位置をカメラが追いかけることで、引かれている実感を強める。
        // ただし追いかけるのは投入点からのずれの半分だけにして、獲物が左右に走り糸が振られる様子が画面に残るようにする
        e.camera.targetX = catchX + (e.lureX - catchX) * 0.45;
        e.camera.targetY = catchY + (e.lureY - catchY) * 0.45 - 20;
      }
      e.camera.update(dt);
      const shakeOffset = e.shake.update(dt, t);
      blendLookInto(e.look, SEASON_LOOKS[state.season], 1 - Math.exp(-SEASON_BLEND_RATE * dt));
      const look = e.look;

      // ---- 現在地HUD（React再描画を避けてDOMを直接更新） ----
      if (state.phase === 'idle') {
        const density = milkyWayDensity(catchX, catchY);
        const hudText = `${Math.round(catchX / 10)},${Math.round(-catchY / 10)}|${zoneName(density)}`;
        if (hudText !== lastHudText) {
          lastHudText = hudText;
          const [coord, zone] = hudText.split('|');
          if (coordRef.current) coordRef.current.textContent = coord.replace(',', ' / ');
          if (zoneRef.current) zoneRef.current.textContent = zone;
        }
        if (densityFillRef.current) {
          densityFillRef.current.style.width = `${Math.round(Math.min(1, density) * 100)}%`;
        }
      } else {
        // 待機画面に戻ったときHUDが作り直されるので、次回は必ず書き込む
        lastHudText = '';
      }

      // ---- 描画 ----
      ctx.save();
      ctx.scale(dpr, dpr);
      const cw = wrapper!.clientWidth;
      const ch = wrapper!.clientHeight;
      ctx.fillStyle = rgba(look.background, 1);
      ctx.fillRect(0, 0, cw, ch);

      drawParallaxStars(ctx, e.camera, cw, ch, t, look);

      e.camera.apply(ctx, cw, ch, shakeOffset);

      drawMilkyWay(ctx, e.camera, cw, ch, t, look);
      updateAndDrawDust(ctx, e.dust, e.camera, dt, look);

      // 待機中は「ここに投げる」投入点を示す
      if (state.phase === 'idle') {
        const pulse = 0.5 + 0.5 * Math.sin(t * 2.4);
        ctx.strokeStyle = `rgba(159,216,255,${0.35 + pulse * 0.35})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(catchX, catchY, 16 + pulse * 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(catchX - 30, catchY);
        ctx.lineTo(catchX - 10, catchY);
        ctx.moveTo(catchX + 10, catchY);
        ctx.lineTo(catchX + 30, catchY);
        ctx.moveTo(catchX, catchY - 30);
        ctx.lineTo(catchX, catchY - 10);
        ctx.moveTo(catchX, catchY + 10);
        ctx.lineTo(catchX, catchY + 30);
        ctx.stroke();
      }

      const lure = { x: e.lureX, y: e.lureY };
      if (state.phase !== 'idle') {
        // 張り詰めている間は糸が細かく唸り続ける
        const hum = Math.max(0, e.lineTension - 0.85) * 5;
        drawFishingLine(ctx, rodTip, lure, e.slack, t, e.lineTension, e.lineVib + hum, e.lineBow);
      }

      // ルアー/獲物（自転しているのが見えるよう十字の印を重ねる）
      if (state.phase !== 'idle') {
        const radius = state.phase === 'reeling' ? 10 : 6;
        ctx.beginPath();
        ctx.fillStyle = state.phase === 'reeling' ? '#ffd76b' : '#9fd8ff';
        ctx.arc(lure.x, lure.y, radius, 0, Math.PI * 2);
        ctx.fill();
        const c = Math.cos(e.lureSpin) * (radius + 4);
        const sn = Math.sin(e.lureSpin) * (radius + 4);
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1.5;
        ctx.moveTo(lure.x - c, lure.y - sn);
        ctx.lineTo(lure.x + c, lure.y + sn);
        ctx.moveTo(lure.x + sn, lure.y - c);
        ctx.lineTo(lure.x - sn, lure.y + c);
        ctx.stroke();
      }

      // 竿（しなりは糸の引かれる側へ曲げる）
      const perpX = Math.cos(e.rodAngle);
      const perpY = Math.sin(e.rodAngle);
      const bendSign = Math.sign(e.lureX - base.x) || 1;
      ctx.beginPath();
      ctx.strokeStyle = '#c8b48a';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.moveTo(base.x, base.y);
      ctx.quadraticCurveTo(
        (base.x + rodTip.x) / 2 + perpX * e.rodBend * bendSign,
        (base.y + rodTip.y) / 2 + perpY * e.rodBend * bendSign,
        rodTip.x,
        rodTip.y,
      );
      ctx.stroke();

      e.camera.restore(ctx);

      // 春霞：画面下ほど濃くかかる淡い霞
      if (look.hazeAlpha > 0.002) {
        const haze = ctx.createLinearGradient(0, 0, 0, ch);
        haze.addColorStop(0, rgba(look.hazeColor, look.hazeAlpha * 0.4));
        haze.addColorStop(1, rgba(look.hazeColor, look.hazeAlpha * 2));
        ctx.fillStyle = haze;
        ctx.fillRect(0, 0, cw, ch);
      }
      ctx.restore();

      raf = requestAnimationFrame(loop);
    }

    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      wrapper.removeEventListener('wheel', onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PCではSpaceキーでも操作できるようにする（onPressStart/onPressEndへ共通化）
  // 待機中は矢印キー / WASD で天の川を移動できる
  useEffect(() => {
    const keys = engineRef.current.keys;
    function onKeyDown(ev: KeyboardEvent) {
      if (ev.code in PAN_KEYS) {
        if (useGameStore.getState().phase !== 'idle') return;
        ev.preventDefault();
        keys.add(ev.code);
        setExplored(true);
        return;
      }
      if (ev.code !== 'Space' || ev.repeat) return;
      ev.preventDefault();
      handlePressStart();
    }
    function onKeyUp(ev: KeyboardEvent) {
      if (ev.code in PAN_KEYS) {
        keys.delete(ev.code);
        return;
      }
      if (ev.code !== 'Space') return;
      ev.preventDefault();
      handlePressEnd();
    }
    function onBlur() {
      keys.clear();
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handlePressStart() {
    initAudio();
    const state = useGameStore.getState();
    if (state.phase === 'reeling') {
      // 無重力なので、糸を巻くと獲物だけでなく自分の体も獲物の方へ少し引き寄せられる
      const e = engineRef.current;
      const base = rodBaseOf(e);
      const dir = unitVector(e.lureX - base.x, e.lureY - base.y);
      e.floatVX += dir.x * 14;
      e.floatVY += dir.y * 14;
      e.lureVX -= dir.x * 18;
      e.lureVY -= dir.y * 18;
      // ひと巻きごとに糸が一瞬ピンと張る
      e.lineTension = Math.min(1.3, e.lineTension + 0.15);
      e.lineVib = Math.max(e.lineVib, 2.5);
      e.crank.onTap();
      if (state.reelPhaseMode === 'tap') playReelClick();
    }
    pressStart();
  }

  function handlePressEnd() {
    pressEnd();
  }

  function beginDrag(ev: ReactPointerEvent<HTMLDivElement>) {
    const e = engineRef.current;
    e.drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, time: ev.timeStamp };
    e.panVX = 0;
    e.panVY = 0;
    ev.currentTarget.setPointerCapture(ev.pointerId);
  }

  function moveDrag(ev: ReactPointerEvent<HTMLDivElement>) {
    const e = engineRef.current;
    const drag = e.drag;
    if (!drag || drag.id !== ev.pointerId) return;
    const zoom = e.camera.zoom;
    const dx = -(ev.clientX - drag.x) / zoom;
    const dy = -(ev.clientY - drag.y) / zoom;
    movePan(dx, dy);
    // 離した瞬間の速度を慣性として引き継ぐため、直近の移動速度を平滑化して持っておく
    const dtSec = Math.max((ev.timeStamp - drag.time) / 1000, 1 / 60);
    const clampSpeed = (v: number) => Math.max(-MAX_FLING_SPEED, Math.min(MAX_FLING_SPEED, v));
    e.panVX = clampSpeed(e.panVX * 0.6 + (dx / dtSec) * 0.4);
    e.panVY = clampSpeed(e.panVY * 0.6 + (dy / dtSec) * 0.4);
    e.drag = { id: drag.id, x: ev.clientX, y: ev.clientY, time: ev.timeStamp };
    if (dx !== 0 || dy !== 0) setExplored(true);
  }

  function endDrag(ev: ReactPointerEvent<HTMLDivElement>) {
    const e = engineRef.current;
    if (!e.drag || e.drag.id !== ev.pointerId) return;
    // 止めてから離した場合は慣性を残さない
    if (ev.timeStamp - e.drag.time > 80) {
      e.panVX = 0;
      e.panVY = 0;
    }
    e.drag = null;
  }

  const config = currentEntry ? RARITY_CONFIG[currentEntry.rarity] : null;
  const isReeling = phase === 'reeling';
  const isIdle = phase === 'idle';
  const seasonStyle = { '--season-accent': rgba(SEASON_LOOKS[season].accent, 1) } as CSSProperties;

  return (
    <div className="fishing-scene" data-season={season} style={seasonStyle}>
      <div
        ref={wrapperRef}
        className={`scene-canvas-wrapper ${isIdle ? 'explorable' : ''}`}
        onPointerDown={(e) => {
          if (useGameStore.getState().phase === 'idle') {
            if ((e.target as HTMLElement).closest('button')) return;
            beginDrag(e);
            return;
          }
          e.preventDefault();
          handlePressStart();
        }}
        onPointerMove={moveDrag}
        onPointerUp={(e) => {
          endDrag(e);
          handlePressEnd();
        }}
        onPointerLeave={handlePressEnd}
        onPointerCancel={(e) => {
          endDrag(e);
          handlePressEnd();
        }}
      >
        <canvas ref={canvasRef} className="scene-canvas" />

        {isIdle && (
          <>
            <div className={`idle-overlay ${explored ? 'explored' : ''}`}>
              <h1 className="title-logo">天の川釣り</h1>
              <p className="title-sub">星々の海で、天体を釣り上げよう</p>
            </div>

            {seasonChanged && (
              <div key={season} className="season-banner">
                <span className="season-banner-name">{SEASON_LABEL[season]}の天の川</span>
                <span className="season-banner-desc">{SEASON_DESCRIPTION[season]}</span>
              </div>
            )}

            <div className="explore-hud">
              <span className="explore-season">{SEASON_LABEL[season]}の天の川</span>
              <span className="explore-zone" ref={zoneRef} />
              <span className="explore-coord">
                座標 <span ref={coordRef} />
              </span>
              <div className="density-bar" aria-label="星の濃さ">
                <div className="density-bar-fill" ref={densityFillRef} />
              </div>
            </div>

            <div className="idle-bottom">
              <div className="season-picker" role="radiogroup" aria-label="季節">
                {SEASON_ORDER.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={s === season}
                    className={`season-option season-option-${s} ${s === season ? 'active' : ''}`}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      if (s === season) return;
                      setSeason(s);
                      setSeasonChanged(true);
                      setExplored(true);
                    }}
                  >
                    {SEASON_LABEL[s]}
                  </button>
                ))}
              </div>
              <p className="explore-hint">ドラッグ・スクロール・矢印キーで天の川を移動</p>
              <button
                type="button"
                className="cast-button"
                onClick={(e) => {
                  e.stopPropagation();
                  initAudio();
                  startCast();
                }}
              >
                ここで竿をキャストする
              </button>
            </div>
          </>
        )}

        {isReeling && config && (
          <div className="reel-hud">
            <div className="gauge-bar">
              <div className="gauge-bar-fill" style={{ width: `${gauge}%` }} />
              <span className="gauge-label">体力 {Math.ceil(gauge)}</span>
            </div>
            <div className="time-bar">
              <div
                className="time-bar-fill"
                style={{ width: `${(timeLeft / config.timeLimit) * 100}%` }}
              />
            </div>
            <div className={`phase-icon ${phaseTelegraph ? 'telegraph' : ''}`}>
              {reelPhaseMode === 'tap' ? '連打！' : '長押し！'}
            </div>
          </div>
        )}

        {(phase === 'cast' || phase === 'waiting_bite') && (
          <div className="wait-hint">
            {phase === 'cast' ? 'ルアーを放っています…' : 'ルアーを漂わせてアタリを待っています…'}
          </div>
        )}
      </div>
    </div>
  );
}
