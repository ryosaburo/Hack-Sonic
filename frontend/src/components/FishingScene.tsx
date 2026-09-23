import { useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import {
  Camera,
  ShakeController,
  Crank,
  drawFishingLine,
  makeStarLayer,
  drawStarLayer,
  organicResistance,
  springTo,
  type StarLayer,
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

const ROD_TIP = { x: 0, y: 260 };
const CATCH_POINT = { x: 0, y: -140 };

export function FishingScene() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const engineRef = useRef({
    camera: new Camera(),
    shake: new ShakeController(),
    crank: new Crank(),
    layers: [] as StarLayer[],
    rodTipY: ROD_TIP.y,
    rodTipVel: 0,
    lureX: ROD_TIP.x,
    lureY: ROD_TIP.y,
    lureVX: 0,
    lureVY: 0,
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

    const engine = engineRef.current;
    engine.layers = [
      makeStarLayer(60, 1600, 0.1, 0.8, 'rgba(255,255,255,0.35)'),
      makeStarLayer(50, 1400, 0.3, 1.2, 'rgba(255,255,255,0.55)'),
      makeStarLayer(35, 1200, 0.6, 1.8, 'rgba(255,255,255,0.85)'),
    ];

    let raf = 0;
    let last = performance.now();

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

      // ---- フェーズ切替の検知（音・カメラ演出のトリガー） ----
      if (e.prevPhase !== state.phase) {
        if (state.phase === 'cast') {
          e.camera.targetY = -60;
          e.camera.targetZoom = 0.85;
        } else if (state.phase === 'waiting_bite') {
          e.camera.targetX = CATCH_POINT.x;
          e.camera.targetY = CATCH_POINT.y;
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
          e.camera.targetX = 0;
          e.camera.targetY = 0;
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

      // ---- ルアー位置（世界座標）の更新 ----
      let targetLureX = e.lureX;
      let targetLureY = e.lureY;
      if (state.phase === 'idle') {
        targetLureX = ROD_TIP.x;
        targetLureY = ROD_TIP.y;
      } else if (state.phase === 'reeling') {
        // 常時の低周波なゆらぎ（体力が高い＝魚が元気なほど大きく暴れる）
        const tensionFrac = Math.max(0.15, state.gauge / 100);
        const driftX = organicResistance(t, 10) * (0.4 + tensionFrac * 0.4);
        const driftY = organicResistance(t * 0.87 + 4.2, 8) * (0.4 + tensionFrac * 0.4);
        targetLureX = CATCH_POINT.x + driftX;
        targetLureY = CATCH_POINT.y + driftY;

        // 一定間隔で「グッ」と引かれる力積を速度に直接加える（引っ張られている実感）
        e.pullTimer -= dt;
        if (e.pullTimer <= 0) {
          const angle = Math.random() * Math.PI * 2;
          const strength = (70 + Math.random() * 70) * (0.5 + tensionFrac * 0.5);
          e.lureVX += Math.cos(angle) * strength;
          e.lureVY += Math.sin(angle) * strength * 0.5;
          e.shake.add(0.04 + tensionFrac * 0.06);
          e.pullTimer = 0.35 + Math.random() * 0.55;
        }
      } else if (state.phase === 'cast' || state.phase === 'waiting_bite') {
        targetLureX = CATCH_POINT.x;
        targetLureY = CATCH_POINT.y + Math.sin(t * 0.8) * 4;
      } else {
        targetLureX = ROD_TIP.x;
        targetLureY = ROD_TIP.y - 40;
      }
      // 巻き上げ中はバネを柔らかく(damping低め)して、力積による揺り戻しが起きやすいようにする
      const lureStiffness = state.phase === 'reeling' ? 55 : 40;
      const lureDamping = state.phase === 'reeling' ? 6 : 8;
      [e.lureX, e.lureVX] = springTo(e.lureX, targetLureX, e.lureVX, lureStiffness, lureDamping, dt);
      [e.lureY, e.lureVY] = springTo(e.lureY, targetLureY, e.lureVY, lureStiffness, lureDamping, dt);

      // 竿先のしなり（ゲージ変化に応じて瞬間移動させず追従させる）
      const rodTargetY = state.phase === 'reeling' ? ROD_TIP.y + (100 - state.gauge) * 0.3 : ROD_TIP.y;
      [e.rodTipY, e.rodTipVel] = springTo(e.rodTipY, rodTargetY, e.rodTipVel, 120, 12, dt);

      e.camera.update(dt);
      if (state.phase === 'idle') {
        e.camera.targetX = Math.sin(t * 0.05) * 10;
        e.camera.targetY = Math.sin(t * 0.037) * 6;
      } else if (state.phase === 'reeling') {
        // 暴れるルアー（魚）の位置をカメラが追いかけることで、引かれている実感を強める
        e.camera.targetX = e.lureX;
        e.camera.targetY = e.lureY - 20;
      }
      const shakeOffset = e.shake.update(dt, t);

      // ---- 描画 ----
      ctx.save();
      ctx.scale(dpr, dpr);
      const cw = wrapper!.clientWidth;
      const ch = wrapper!.clientHeight;
      ctx.fillStyle = '#05060f';
      ctx.fillRect(0, 0, cw, ch);

      for (const layer of e.layers) {
        drawStarLayer(ctx, e.camera, layer);
      }

      e.camera.apply(ctx, cw, ch, shakeOffset);

      const rodTip = { x: ROD_TIP.x, y: e.rodTipY };
      const lure = { x: e.lureX, y: e.lureY };
      const tension = Math.max(0.15, state.gauge / 100);
      if (state.phase !== 'idle') {
        drawFishingLine(ctx, rodTip, lure, tension);
      }

      // ルアー/獲物
      if (state.phase !== 'idle') {
        ctx.beginPath();
        ctx.fillStyle = state.phase === 'reeling' ? '#ffd76b' : '#9fd8ff';
        ctx.arc(lure.x, lure.y, state.phase === 'reeling' ? 10 : 6, 0, Math.PI * 2);
        ctx.fill();
      }

      // 竿先
      ctx.beginPath();
      ctx.strokeStyle = '#c8b48a';
      ctx.lineWidth = 4;
      ctx.moveTo(0, 320);
      ctx.lineTo(rodTip.x, rodTip.y);
      ctx.stroke();

      e.camera.restore(ctx);
      ctx.restore();

      raf = requestAnimationFrame(loop);
    }

    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PCではSpaceキーでも操作できるようにする（onPressStart/onPressEndへ共通化）
  useEffect(() => {
    function onKeyDown(ev: KeyboardEvent) {
      if (ev.code !== 'Space' || ev.repeat) return;
      ev.preventDefault();
      handlePressStart();
    }
    function onKeyUp(ev: KeyboardEvent) {
      if (ev.code !== 'Space') return;
      ev.preventDefault();
      handlePressEnd();
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handlePressStart() {
    initAudio();
    const state = useGameStore.getState();
    if (state.phase === 'reeling') {
      engineRef.current.crank.onTap();
      if (state.reelPhaseMode === 'tap') playReelClick();
    }
    pressStart();
  }

  function handlePressEnd() {
    pressEnd();
  }

  const config = currentEntry ? RARITY_CONFIG[currentEntry.rarity] : null;
  const isReeling = phase === 'reeling';
  const isIdle = phase === 'idle';

  return (
    <div className="fishing-scene">
      <div
        ref={wrapperRef}
        className="scene-canvas-wrapper"
        onPointerDown={(e) => {
          e.preventDefault();
          handlePressStart();
        }}
        onPointerUp={handlePressEnd}
        onPointerLeave={handlePressEnd}
        onPointerCancel={handlePressEnd}
      >
        <canvas ref={canvasRef} className="scene-canvas" />

        {isIdle && (
          <div className="idle-overlay">
            <h1 className="title-logo">天の川釣り</h1>
            <p className="title-sub">星々の海で、天体を釣り上げよう</p>
            <button
              type="button"
              className="cast-button"
              onClick={(e) => {
                e.stopPropagation();
                initAudio();
                startCast();
              }}
            >
              竿をキャストする
            </button>
          </div>
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
            {phase === 'cast' ? 'ルアーを投げ込んでいます…' : 'アタリを待っています…'}
          </div>
        )}
      </div>
    </div>
  );
}
