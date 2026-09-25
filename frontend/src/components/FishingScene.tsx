import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
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
  playSuccess,
  playFailure,
} from '../engine/audio';
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

// 着水点が天の川の中心からこの倍率×川幅より外に出ないようにする（迷子防止）
const RIVER_BOUND = 1.8;
const KEY_PAN_SPEED = 520;
const PAN_FRICTION = 3.5;
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
    dust: makeDust(40),
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
          e.shake.add(0.15);
          e.camera.targetZoom = 0.95;
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
      const tensionFrac = Math.max(0.15, state.gauge / 100);
      const toLureAngle = Math.atan2(e.lureX - base.x, -(e.lureY - base.y));
      const rodTargetAngle =
        state.phase === 'reeling'
          ? Math.max(-0.6, Math.min(0.6, toLureAngle))
          : Math.sin(t * 0.4) * 0.1 + Math.sin(t * 0.17 + 2) * 0.06;
      [e.rodAngle, e.rodAngleVel] = springTo(e.rodAngle, rodTargetAngle, e.rodAngleVel, 30, 5, dt);
      const rodBendTarget = state.phase === 'reeling' ? 6 + tensionFrac * 14 : 0;
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
        const driftX = organicResistance(t, 10) * (0.4 + tensionFrac * 0.4);
        const driftY = organicResistance(t * 0.87 + 4.2, 10) * (0.4 + tensionFrac * 0.4);
        targetLureX = catchX + driftX;
        targetLureY = catchY + driftY;
        // 巻き上げ中はバネを柔らかく(damping低め)して、力積による揺り戻しが起きやすいようにする
        lureStiffness = 55;
        lureDamping = 6;

        // 一定間隔で「グッ」と引かれる力積を速度に直接加える（引っ張られている実感）
        // 無重力なので上下左右どの向きにも同じ強さで暴れ、反作用で釣り人の体も引き寄せられる
        e.pullTimer -= dt;
        if (e.pullTimer <= 0) {
          const angle = Math.random() * Math.PI * 2;
          const strength = (70 + Math.random() * 70) * (0.5 + tensionFrac * 0.5);
          e.lureVX += Math.cos(angle) * strength;
          e.lureVY += Math.sin(angle) * strength;
          e.lureSpinVel += (Math.random() - 0.5) * 6;
          const dir = unitVector(e.lureX - base.x, e.lureY - base.y);
          e.floatVX += dir.x * strength * 0.3;
          e.floatVY += dir.y * strength * 0.3;
          e.rodAngleVel += (Math.random() - 0.5) * 1.5;
          e.shake.add(0.04 + tensionFrac * 0.06);
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

      // 糸のたるみ：重力で垂れる代わりに、張りが弱いほど大きくうねる
      const slackTarget =
        state.phase === 'cast'
          ? 30
          : state.phase === 'waiting_bite'
            ? 38
            : state.phase === 'reeling'
              ? (1 - tensionFrac) * 26
              : state.phase === 'idle'
                ? 0
                : 20;
      e.slack += (slackTarget - e.slack) * (1 - Math.exp(-2 * dt));

      if (state.phase === 'idle') {
        e.camera.targetX = anchorX + Math.sin(t * 0.05) * 10;
        e.camera.targetY = anchorY + Math.sin(t * 0.037) * 6;
      } else if (state.phase === 'reeling') {
        // 暴れるルアー（魚）の位置をカメラが追いかけることで、引かれている実感を強める
        e.camera.targetX = e.lureX;
        e.camera.targetY = e.lureY - 20;
      }
      e.camera.update(dt);
      const shakeOffset = e.shake.update(dt, t);

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
      ctx.fillStyle = '#05060f';
      ctx.fillRect(0, 0, cw, ch);

      drawParallaxStars(ctx, e.camera, cw, ch, t);

      e.camera.apply(ctx, cw, ch, shakeOffset);

      drawMilkyWay(ctx, e.camera, cw, ch, t);
      updateAndDrawDust(ctx, e.dust, e.camera, dt);

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
        drawFishingLine(ctx, rodTip, lure, e.slack, t);
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

  return (
    <div className="fishing-scene">
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

            <div className="explore-hud">
              <span className="explore-zone" ref={zoneRef} />
              <span className="explore-coord">
                座標 <span ref={coordRef} />
              </span>
              <div className="density-bar" aria-label="星の濃さ">
                <div className="density-bar-fill" ref={densityFillRef} />
              </div>
            </div>

            <div className="idle-bottom">
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
