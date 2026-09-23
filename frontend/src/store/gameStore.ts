import { create } from 'zustand';
import type { CatalogEntry, CollectionRecord, GamePhase, Rarity, ReelPhaseMode } from '../types';
import { RARITY_CONFIG } from '../types';
import * as api from '../api/client';
import catalogMock from '../data/catalog.mock.json';

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

// バックエンド未接続時のフォールバック抽選（担当Aがバックエンド完成前に演出を作り込めるように）。
function drawFromMockCatalog(): CatalogEntry {
  const catalog = catalogMock as CatalogEntry[];
  const totalWeight = catalog.reduce((sum, c) => sum + c.weight, 0);
  let r = Math.random() * totalWeight;
  for (const entry of catalog) {
    r -= entry.weight;
    if (r <= 0) return entry;
  }
  return catalog[0];
}

interface GameState {
  phase: GamePhase;
  usingBackend: boolean;
  catalog: CatalogEntry[];
  collection: Record<string, CollectionRecord>;

  attemptId: string | null;
  currentEntry: CatalogEntry | null;

  gauge: number;
  timeLeft: number;
  reelPhaseMode: ReelPhaseMode;
  phaseTimer: number;
  phaseTelegraph: boolean;
  isHolding: boolean;
  tapPulse: number; // 連打が起きたフレームで演出用にインクリメントする値

  lastResultSuccess: boolean | null;
  isNewSpecies: boolean;
  catchCount: number;

  loadCatalog: () => Promise<void>;
  startCast: () => Promise<void>;
  triggerBite: () => void;
  pressStart: () => void;
  pressEnd: () => void;
  tickReel: (dt: number) => void;
  keepGyotaku: () => void;
  releaseCatch: () => void;
  returnToIdle: () => void;
  openZukan: () => void;
  closeZukan: () => void;
  _resolve: (success: boolean) => Promise<void>;
}

export const useGameStore = create<GameState>((set, get) => ({
  phase: 'idle',
  usingBackend: false,
  catalog: catalogMock as CatalogEntry[],
  collection: {},

  attemptId: null,
  currentEntry: null,

  gauge: 100,
  timeLeft: 0,
  reelPhaseMode: 'tap',
  phaseTimer: 0,
  phaseTelegraph: false,
  isHolding: false,
  tapPulse: 0,

  lastResultSuccess: null,
  isNewSpecies: false,
  catchCount: 0,

  loadCatalog: async () => {
    try {
      const [catalog, collectionList] = await Promise.all([api.fetchCatalog(), api.fetchCollection()]);
      const collection: Record<string, CollectionRecord> = {};
      for (const c of collectionList) collection[c.species_id] = c;
      set({ catalog, collection, usingBackend: true });
    } catch {
      // バックエンド未起動時はモックカタログのみで進行する。
      set({ usingBackend: false });
    }
  },

  startCast: async () => {
    const state = get();
    let rarity: Rarity;
    let attemptId: string | null = null;
    let timeLimit: number;
    let entry: CatalogEntry;

    if (state.usingBackend) {
      try {
        const res = await api.castStart();
        rarity = res.rarity;
        attemptId = res.attempt_id;
        timeLimit = res.time_limit;
        const candidates = state.catalog.filter((c) => c.rarity === rarity);
        entry = candidates[Math.floor(Math.random() * candidates.length)] ?? drawFromMockCatalog();
      } catch {
        entry = drawFromMockCatalog();
        rarity = entry.rarity;
        timeLimit = RARITY_CONFIG[rarity].timeLimit;
      }
    } else {
      entry = drawFromMockCatalog();
      rarity = entry.rarity;
      timeLimit = RARITY_CONFIG[rarity].timeLimit;
    }

    set({
      phase: 'cast',
      currentEntry: entry,
      attemptId,
      gauge: 100,
      timeLeft: timeLimit,
      reelPhaseMode: 'tap',
      phaseTelegraph: false,
      isHolding: false,
      lastResultSuccess: null,
    });

    const config = RARITY_CONFIG[rarity];
    set({ phaseTimer: randomBetween(config.phaseSwitchMin, config.phaseSwitchMax) });

    // キャスト→アタリ待ちの間（飛距離演出の分の“間”）
    window.setTimeout(() => {
      if (get().phase === 'cast') {
        set({ phase: 'waiting_bite' });
        const biteDelay = randomBetween(800, 2200);
        window.setTimeout(() => {
          if (get().phase === 'waiting_bite') get().triggerBite();
        }, biteDelay);
      }
    }, 600);
  },

  triggerBite: () => {
    if (get().phase !== 'waiting_bite') return;
    set({ phase: 'reeling' });
  },

  pressStart: () => {
    const state = get();
    if (state.phase !== 'reeling') return;
    set({ isHolding: true });
    if (state.reelPhaseMode === 'tap') {
      const rarity = state.currentEntry?.rarity ?? 'common';
      const config = RARITY_CONFIG[rarity];
      set((s) => ({ gauge: Math.max(0, s.gauge - config.tapDecrease), tapPulse: s.tapPulse + 1 }));
    }
  },

  pressEnd: () => {
    set({ isHolding: false });
  },

  tickReel: (dt: number) => {
    const state = get();
    if (state.phase !== 'reeling' || !state.currentEntry) return;
    const rarity = state.currentEntry.rarity;
    const config = RARITY_CONFIG[rarity];

    let gauge = state.gauge;
    if (state.reelPhaseMode === 'hold' && state.isHolding) {
      gauge -= config.holdDecreasePerSec * dt;
    } else {
      gauge += config.recoverPerSec * dt;
    }
    gauge = Math.min(100, Math.max(0, gauge));

    let phaseTimer = state.phaseTimer - dt;
    let reelPhaseMode = state.reelPhaseMode;
    let phaseTelegraph = state.phaseTelegraph;
    if (phaseTimer <= config.telegraphSeconds) phaseTelegraph = true;
    if (phaseTimer <= 0) {
      reelPhaseMode = reelPhaseMode === 'tap' ? 'hold' : 'tap';
      phaseTimer = randomBetween(config.phaseSwitchMin, config.phaseSwitchMax);
      phaseTelegraph = false;
    }

    const timeLeft = Math.max(0, state.timeLeft - dt);

    set({ gauge, phaseTimer, reelPhaseMode, phaseTelegraph, timeLeft });

    if (gauge <= 0) {
      get()._resolve(true);
    } else if (timeLeft <= 0) {
      get()._resolve(false);
    }
  },

  // 内部専用（結果確定）
  _resolve: async (success: boolean) => {
    const state = get();
    set({ phase: 'result', lastResultSuccess: success });
    if (!success || !state.currentEntry) return;

    const existing = state.collection[state.currentEntry.id];
    if (state.usingBackend && state.attemptId) {
      try {
        const res = await api.castResolve({ attempt_id: state.attemptId, success: true });
        set({
          isNewSpecies: res.is_new_species,
          catchCount: res.catch_count,
          // サーバー側の抽選結果を正とする（天体の最終確定は常にresolve側）
          currentEntry: res.entry ?? state.currentEntry,
        });
        return;
      } catch {
        // フォールバックへ
      }
    }
    set({ isNewSpecies: !existing, catchCount: (existing?.catch_count ?? 0) + 1 });
  },

  keepGyotaku: () => {
    const state = get();
    if (!state.currentEntry) return;
    const now = new Date().toISOString();
    const existing = state.collection[state.currentEntry.id];
    set({
      phase: 'gyotaku',
      collection: {
        ...state.collection,
        [state.currentEntry.id]: existing ?? {
          species_id: state.currentEntry.id,
          first_caught_at: now,
          catch_count: state.catchCount || 1,
        },
      },
    });
  },

  releaseCatch: () => {
    set({ phase: 'idle', currentEntry: null, attemptId: null });
  },

  returnToIdle: () => {
    set({ phase: 'idle', currentEntry: null, attemptId: null });
  },

  openZukan: () => set({ phase: 'zukan' }),
  closeZukan: () => set({ phase: 'idle' }),
}));
