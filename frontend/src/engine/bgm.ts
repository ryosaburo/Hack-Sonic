// 釣り画面のBGM。音声ファイルは使わず、Web Audio APIで宇宙のドローン・アンビエントをその場で合成する。
//  土台：少しずつ音程をずらした和音の持続音（こもった柔らかい音色）。30〜60秒ごとに次の和音へ重ね合わせながら移る
//  低音：和音の根音の低い持続音が、ゆっくり波打つ
//  装飾：ときどき高い「チーン」というきらめきが鳴り、長い残響の中へ消えていく
// 季節ごとに和音・明るさ・きらめきの量と残響を変え、季節を切り替えると数秒かけて移ろう。
import { initAudio } from './audio';
import type { Season } from './seasons';

interface SeasonTone {
  // 和音の進行（MIDIノート番号。先頭が根音）
  chords: number[][];
  // 和音の明るさ（こもらせるローパスの周波数）
  cutoff: number;
  // きらめきの間隔（秒）の範囲
  pingEvery: [number, number];
  // きらめきを和音の構成音から何半音上で鳴らすか
  pingOctave: number;
  // 残響の量
  reverb: number;
}

//  春：柔らかく明るいメジャー9th。夏：温かく厚い響き。秋：澄んだマイナー。冬：冷たく透明なsus和音と高いきらめき
const SEASON_TONES: Record<Season, SeasonTone> = {
  spring: {
    chords: [
      [50, 57, 61, 64, 66],
      [47, 54, 57, 62, 64],
      [43, 50, 54, 57, 61],
      [45, 52, 57, 59, 64],
    ],
    cutoff: 950,
    pingEvery: [5, 12],
    pingOctave: 24,
    reverb: 0.55,
  },
  summer: {
    chords: [
      [51, 58, 62, 65, 70],
      [48, 55, 58, 62, 67],
      [44, 51, 55, 58, 63],
      [46, 53, 58, 60, 65],
    ],
    cutoff: 1400,
    pingEvery: [4, 10],
    pingOctave: 24,
    reverb: 0.5,
  },
  autumn: {
    chords: [
      [45, 52, 55, 59, 64],
      [41, 48, 52, 55, 60],
      [43, 50, 53, 57, 62],
      [40, 47, 52, 55, 59],
    ],
    cutoff: 1000,
    pingEvery: [7, 15],
    pingOctave: 24,
    reverb: 0.6,
  },
  winter: {
    chords: [
      [49, 56, 61, 63, 68],
      [47, 54, 59, 61, 66],
      [42, 49, 54, 56, 61],
      [44, 51, 56, 58, 63],
    ],
    cutoff: 750,
    pingEvery: [3, 8],
    pingOctave: 36,
    reverb: 0.75,
  },
};

const MASTER_LEVEL = 0.5;
// 巻き上げ・結果・魚拓演出の間は、効果音が主役になるよう下げる
const DUCKED_RATIO = 0.4;
const CHORD_FADE = 8;
// 和音は表の1オクターブ上で鳴らし、小さなスピーカーでも聞こえる帯域に置く（低音は表の根音の1オクターブ下）
const PAD_TRANSPOSE = 12;
const CHORD_HOLD: [number, number] = [30, 60];
const FADE_IN = 1.5;

const midiToHz = (note: number) => 440 * 2 ** ((note - 69) / 12);
const between = ([min, max]: [number, number]) => min + Math.random() * (max - min);

interface ChordLayer {
  gain: GainNode;
  oscs: OscillatorNode[];
}

interface Graph {
  ctx: AudioContext;
  master: GainNode;
  padFilter: BiquadFilterNode;
  filterDepth: GainNode;
  reverbReturn: GainNode;
  pingBus: GainNode;
  bass: OscillatorNode;
}

let graph: Graph | null = null;
let season: Season = 'spring';
let chordIndex = 0;
let chord: number[] = [];
let layer: ChordLayer | null = null;
let chordTimer = 0;
let pingTimer = 0;
let ducked = false;

// 長い残響（指数減衰するステレオのノイズを、そのまま響きの型として使う）
function makeImpulse(ctx: AudioContext, seconds: number) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
  }
  return buffer;
}

// ゆっくり揺れる揺らぎ（LFO）。target に depth ぶんの振れ幅で足し込む
function lfo(ctx: AudioContext, hz: number, depth: number, target: AudioParam) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = hz;
  gain.gain.value = depth;
  osc.connect(gain);
  gain.connect(target);
  osc.start();
  return gain;
}

function buildGraph(): Graph {
  const ctx = initAudio();
  const tone = SEASON_TONES[season];

  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  const convolver = ctx.createConvolver();
  convolver.buffer = makeImpulse(ctx, 5);
  const reverbReturn = ctx.createGain();
  reverbReturn.gain.value = tone.reverb;
  convolver.connect(reverbReturn);
  reverbReturn.connect(master);

  // 和音：ローパスでこもらせ、明るさをゆっくり揺らす
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = 'lowpass';
  padFilter.frequency.value = tone.cutoff;
  padFilter.Q.value = 0.4;
  const filterDepth = lfo(ctx, 0.035, tone.cutoff * 0.35, padFilter.frequency);
  const padBus = ctx.createGain();
  padBus.gain.value = 0.8;
  padFilter.connect(padBus);
  padBus.connect(master);
  const padSend = ctx.createGain();
  padSend.gain.value = 0.5;
  padBus.connect(padSend);
  padSend.connect(convolver);

  // 低音：根音の1オクターブ下を三角波で。音量がゆっくり波打つ
  const bass = ctx.createOscillator();
  bass.type = 'triangle';
  // ノートPCのスピーカーでは200Hz以下がほぼ鳴らないので、低音は支え程度にとどめて和音を主役にする
  const bassGain = ctx.createGain();
  bassGain.gain.value = 0.022;
  lfo(ctx, 0.06, 0.01, bassGain.gain);
  bass.connect(bassGain);
  bassGain.connect(master);
  bass.start();

  // きらめき：ほとんどを残響に送り、遠くで鳴っているように聞かせる
  const pingBus = ctx.createGain();
  const pingDry = ctx.createGain();
  pingDry.gain.value = 0.35;
  pingBus.connect(pingDry);
  pingDry.connect(master);
  pingBus.connect(convolver);

  return { ctx, master, padFilter, filterDepth, reverbReturn, pingBus, bass };
}

function playChord(g: Graph, notes: number[]): ChordLayer {
  const { ctx } = g;
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(1, now + CHORD_FADE);
  gain.connect(g.padFilter);
  // 各音を少しだけずらした2本のノコギリ波で鳴らし、うなりでゆっくり揺らめかせる。高い声部ほど控えめに
  const oscs = notes.flatMap((note, i) =>
    [-7, 7].map((cents) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = midiToHz(note + PAD_TRANSPOSE);
      osc.detune.value = cents + (Math.random() - 0.5) * 4;
      const voice = ctx.createGain();
      voice.gain.value = 0.055 / (1 + i * 0.25);
      osc.connect(voice);
      voice.connect(gain);
      osc.start(now);
      return osc;
    }),
  );
  return { gain, oscs };
}

function releaseChord(g: Graph, old: ChordLayer) {
  const now = g.ctx.currentTime;
  old.gain.gain.cancelScheduledValues(now);
  old.gain.gain.setValueAtTime(old.gain.gain.value, now);
  old.gain.gain.linearRampToValueAtTime(0, now + CHORD_FADE);
  for (const osc of old.oscs) osc.stop(now + CHORD_FADE + 0.1);
  window.setTimeout(() => old.gain.disconnect(), (CHORD_FADE + 0.5) * 1000);
}

function moveToChord(g: Graph, notes: number[]) {
  if (layer) releaseChord(g, layer);
  layer = playChord(g, notes);
  chord = notes;
  g.bass.frequency.setTargetAtTime(midiToHz(notes[0] - 12), g.ctx.currentTime, 2.5);
}

function scheduleNextChord() {
  window.clearTimeout(chordTimer);
  chordTimer = window.setTimeout(() => {
    if (!graph) return;
    const chords = SEASON_TONES[season].chords;
    chordIndex = (chordIndex + 1) % chords.length;
    moveToChord(graph, chords[chordIndex]);
    scheduleNextChord();
  }, between(CHORD_HOLD) * 1000);
}

function ping(g: Graph) {
  const { ctx } = g;
  const tone = SEASON_TONES[season];
  const pool = chord.slice(1);
  const freq = midiToHz(pool[Math.floor(Math.random() * pool.length)] + tone.pingOctave);
  const now = ctx.currentTime;

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(0.06, now + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, now + 3.5);
  const pan = ctx.createStereoPanner();
  pan.pan.value = Math.random() * 1.4 - 0.7;
  env.connect(pan);
  pan.connect(g.pingBus);

  // 基音に、ベルらしい非整数倍の倍音を短く重ねる
  const fundamental = ctx.createOscillator();
  fundamental.frequency.value = freq;
  fundamental.connect(env);
  const partial = ctx.createOscillator();
  partial.frequency.value = freq * 2.76;
  const partialGain = ctx.createGain();
  partialGain.gain.setValueAtTime(0.25, now);
  partialGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
  partial.connect(partialGain);
  partialGain.connect(env);
  for (const osc of [fundamental, partial]) {
    osc.start(now);
    osc.stop(now + 3.6);
  }
  window.setTimeout(() => pan.disconnect(), 4000);
}

function schedulePing() {
  window.clearTimeout(pingTimer);
  pingTimer = window.setTimeout(() => {
    if (!graph) return;
    if (!document.hidden) ping(graph);
    schedulePing();
  }, between(SEASON_TONES[season].pingEvery) * 1000);
}

// タブが見えていないときは止め、巻き上げ中などは下げる
function applyLevel() {
  if (!graph) return;
  const level = document.hidden ? 0 : ducked ? MASTER_LEVEL * DUCKED_RATIO : MASTER_LEVEL;
  graph.master.gain.setTargetAtTime(level, graph.ctx.currentTime, document.hidden ? 0.2 : FADE_IN);
}

// 釣り画面に着いたときに呼ぶ。AudioContextは出発・スキップの操作で解禁されているので自動再生の制限にかからない
export function startBgm(initialSeason: Season) {
  if (graph) return;
  season = initialSeason;
  graph = buildGraph();
  chordIndex = 0;
  moveToChord(graph, SEASON_TONES[season].chords[0]);
  scheduleNextChord();
  schedulePing();
  document.addEventListener('visibilitychange', applyLevel);
  applyLevel();
}

export function setBgmSeason(next: Season) {
  if (!graph || next === season) return;
  season = next;
  const tone = SEASON_TONES[season];
  const now = graph.ctx.currentTime;
  graph.padFilter.frequency.setTargetAtTime(tone.cutoff, now, 2);
  graph.filterDepth.gain.setTargetAtTime(tone.cutoff * 0.35, now, 2);
  graph.reverbReturn.gain.setTargetAtTime(tone.reverb, now, 2);
  chordIndex = 0;
  moveToChord(graph, tone.chords[0]);
  scheduleNextChord();
  schedulePing();
}

export function setBgmDucked(next: boolean) {
  if (ducked === next) return;
  ducked = next;
  applyLevel();
}
