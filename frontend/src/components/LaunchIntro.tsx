import { useEffect, useRef, useState } from 'react';
import { createLaunchAudio } from '../engine/launchAudio';
import { drawLaunchScene, LAUNCH_DURATION, LAUNCH_STAGES } from '../engine/launchScene';
import { useGameStore } from '../store/gameStore';
import { useAccount } from '../auth/account';
import { supabase } from '../auth/supabase';
import './LaunchIntro.css';

const ARRIVAL_KEY = 'space-fishing:launch-arrived:v1';

function hasArrived() {
  try { return localStorage.getItem(ARRIVAL_KEY) === '1'; }
  catch { return false; }
}

export function LaunchIntro({ onComplete }: { onComplete: () => void }) {
  const [returning] = useState(hasArrived);
  const [launched, setLaunched] = useState(false);
  const [stage, setStage] = useState(0);
  const [muted, setMuted] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<ReturnType<typeof createLaunchAudio> | null>(null);
  const mutedRef = useRef(false);
  const startedRef = useRef(false);
  const guideRef = useRef<HTMLDialogElement>(null);
  const season = useGameStore((s) => s.season);
  const signedInEmail = useAccount((s) => s.email);
  const openAccount = useAccount((s) => s.openPanel);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let width = 0, height = 0, dpr = 1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width; height = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas); resize();
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0, elapsed = 0, last = performance.now(), previousStage = 0;
    const visibility = () => {
      last = performance.now();
      audioRef.current?.update(elapsed, !document.hidden && !mutedRef.current);
    };
    document.addEventListener('visibilitychange', visibility);
    const tick = (now: number) => {
      // Background tabs do not silently finish the first journey or keep playing sound.
      const delta = document.hidden ? 0 : Math.max(0, Math.min((now - last) / 1000, 0.1));
      last = now; elapsed += delta;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawLaunchScene(ctx, width, height, elapsed, launched, motion.matches, season);
      if (launched) {
        audioRef.current?.update(elapsed, !mutedRef.current && !document.hidden);
        const next = LAUNCH_STAGES.findLastIndex((item) => elapsed >= item.at);
        if (next !== previousStage) { previousStage = next; setStage(next); }
        if (progressRef.current) progressRef.current.style.transform = `scaleX(${Math.min(1, elapsed / LAUNCH_DURATION)})`;
        if (clockRef.current) clockRef.current.textContent = `T + ${elapsed.toFixed(1).padStart(4, '0')}`;
        if (elapsed >= LAUNCH_DURATION) {
          try { localStorage.setItem(ARRIVAL_KEY, '1'); } catch { /* Storage denial must not prevent playing. */ }
          audioRef.current?.stop(); audioRef.current = null;
          onComplete();
          return;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [launched, onComplete, season]);

  useEffect(() => () => {
    audioRef.current?.stop(); audioRef.current = null;
  }, []);

  useEffect(() => {
    if (launched) statusRef.current?.focus();
  }, [launched]);

  const depart = () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setLaunched(true);
    // AudioContext is unlocked inside the departure gesture, including on touch screens.
    try { audioRef.current = createLaunchAudio(); } catch { /* Visual journey remains available without audio. */ }
  };

  return (
    <section className={`launch-intro ${launched ? 'is-launched' : ''}`} aria-label="宇宙への出発" data-stage={launched ? stage : 'ready'}>
      <canvas ref={canvasRef} className="launch-canvas" aria-hidden="true" />
      <div className="launch-shade" aria-hidden="true" />
      <header className="launch-header">
        <span className="launch-wordmark">HOSHIFUNE <span>航行記録 / 01</span></span>
        <button type="button" className="launch-sound" aria-label="演出をミュート" aria-pressed={muted} onClick={() => {
          mutedRef.current = !muted;
          setMuted(!muted);
        }}>{muted ? '音 OFF' : '音 ON'} <span aria-hidden="true">{muted ? '·' : '≋'}</span></button>
      </header>

      {!launched ? (
        <>
          <div className="launch-content">
            <div className="launch-title">
              <p className="launch-eyebrow"><span /> EARTH → MILKY WAY</p>
              <h1>釣りに行こう。<br />天の川まで。</h1>
              <p className="launch-description">地球を離れ、星の海へ。<br />あなただけの一匹に、出会う旅。</p>
            </div>
            <div className="launch-actions">
              <button type="button" className="launch-depart" onClick={depart}>出発する <span aria-hidden="true">↗</span></button>
              <button type="button" className="launch-guide-open" onClick={() => guideRef.current?.showModal()}>遊び方</button>
              {supabase && (
                <button type="button" className="launch-guide-open" onClick={() => openAccount()}>
                  {signedInEmail ? `ログイン中：${signedInEmail}` : 'ログインして続きから遊ぶ'}
                </button>
              )}
              {returning && <button type="button" className="launch-skip" onClick={onComplete}>演出をスキップして釣りへ <span aria-hidden="true">→</span></button>}
              <p className="launch-duration">地球 → 天の川 · 約10秒の旅</p>
            </div>
          </div>
          <dialog ref={guideRef} className="launch-guide" aria-labelledby="launch-guide-title" onClick={(e) => {
            // 枠の外（背景）をクリックしたら閉じる
            if (e.target === e.currentTarget) e.currentTarget.close();
          }}>
            <h2 id="launch-guide-title">遊び方</h2>
            <ol>
              <li><b>探す</b><span>ドラッグ・スクロール・矢印キー（WASD）で天の川を移動。場所によって出会える獲物が変わります。</span></li>
              <li><b>投げる</b><span>「ここで竿をキャストする」でルアーを放ち、アタリを待ちます。</span></li>
              <li><b>巻く</b><span>画面の表示に合わせて操作し、制限時間内に獲物の体力を0にすれば釣り上げ成功。</span>
                <span className="launch-guide-keys"><em>連打！</em>画面をタップ / Spaceキーを連打</span>
                <span className="launch-guide-keys"><em>長押し！</em>画面を押し続ける / Spaceキーを長押し</span>
                <span>合図が光ったら操作が切り替わる前触れ。手を止めると獲物は体力を回復します。</span></li>
              <li><b>集める</b><span>釣った獲物は図鑑に登録。季節を切り替えると出会える獲物も変わります。</span></li>
            </ol>
            <form method="dialog"><button type="submit" className="launch-guide-close">閉じる</button></form>
          </dialog>
          <footer className="launch-footer"><span>01 / EARTH LAUNCH SITE</span><span><i /> 出発準備完了</span></footer>
        </>
      ) : (
        <div className="launch-flight" ref={statusRef} tabIndex={-1}>
          <div className="launch-flight-meta"><span>FLIGHT 01 / {String(stage + 1).padStart(2, '0')}</span><span ref={clockRef}>T + 00.0</span></div>
          <div role="status" aria-live="polite" aria-atomic="true">
            <h2>{LAUNCH_STAGES[stage].label}</h2>
            <p>{LAUNCH_STAGES[stage].detail}</p>
          </div>
          <div className="launch-progress" aria-hidden="true"><div ref={progressRef} /></div>
        </div>
      )}
    </section>
  );
}
