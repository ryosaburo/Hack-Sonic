// 仕様書 6章: Web Audio APIによる音響フィードバック。
// 振動(Vibration API)は採用せず、低音のサム音+画面演出の組み合わせで表現する。
import type { Rarity } from '../types';

let ctx: AudioContext | null = null;
let lastReelClickAt = 0;
const REEL_CLICK_THROTTLE_MS = 45;

// AudioContextは自動再生制限があるため、最初の「キャスト」操作の中で呼ぶこと。
export function initAudio() {
  if (!ctx) {
    ctx = new AudioContext();
  }
  if (ctx.state === 'suspended') {
    void ctx.resume();
  }
  return ctx;
}

function tone(freq: number, durationMs: number, gainValue: number, type: OscillatorType = 'sine', delayMs = 0) {
  if (!ctx) return;
  const startAt = ctx.currentTime + delayMs / 1000;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startAt);
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(gainValue, startAt + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationMs / 1000);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + durationMs / 1000 + 0.02);
}

export function playReelClick() {
  const now = performance.now();
  if (now - lastReelClickAt < REEL_CLICK_THROTTLE_MS) return;
  lastReelClickAt = now;
  tone(400, 30, 0.06, 'square');
}

export function playBite() {
  tone(800, 80, 0.15, 'triangle');
}

export function playPhaseWarning() {
  tone(600, 120, 0.05, 'sine');
}

export function playPhaseSwitch() {
  tone(500, 60, 0.1, 'square', 0);
  tone(500, 60, 0.1, 'square', 80);
  tone(500, 60, 0.1, 'square', 160);
}

export function playFailure() {
  tone(150, 220, 0.12, 'sine');
}

export function playSuccess(rarity: Rarity) {
  switch (rarity) {
    case 'common':
      tone(120, 220, 0.18, 'sine');
      break;
    case 'rare':
      tone(120, 180, 0.18, 'sine');
      tone(140, 180, 0.18, 'sine', 120);
      break;
    case 'super_rare':
      tone(110, 180, 0.18, 'sine');
      tone(130, 180, 0.18, 'sine', 110);
      tone(150, 180, 0.18, 'sine', 220);
      tone(900, 150, 0.08, 'triangle', 300);
      break;
    case 'legendary':
      tone(100, 200, 0.2, 'sine');
      tone(120, 200, 0.2, 'sine', 120);
      tone(140, 200, 0.2, 'sine', 240);
      tone(160, 200, 0.2, 'sine', 360);
      tone(80, 900, 0.1, 'sine', 400);
      break;
  }
}
