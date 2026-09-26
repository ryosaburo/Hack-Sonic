import { create } from 'zustand';
import type { CatalogEntry, CollectionRecord, GamePhase, ReelPhaseMode } from '../types';
import { RARITY_CONFIG } from '../types';
import * as api from '../api/client';
import catalogMock from '../data/catalog.mock.json';
import { seasonOf, type Season } from '../engine/seasons';
import { AREA_INFO_PRICES, areaInfoKey, drawMock, EMPTY_ECONOMY, MOCK_PRODUCTS, mockAreas, mockEconomy, type CatchArea, type Economy, type Product } from '../engine/economy';

const MOCK_KEY = 'space-fishing:mock-progress:v1';
const PENDING_KEY = 'space-fishing:pending:v1';
const configuredMockTestPoints = Number(import.meta.env.VITE_TEST_POINTS ?? 0);
const mockTestPoints = Number.isInteger(configuredMockTestPoints) && configuredMockTestPoints >= 0 && configuredMockTestPoints <= 1_000_000
  ? configuredMockTestPoints : 0;
const mockCatalog = catalogMock.map(entry => ({ ...entry, point: (entry as Partial<CatalogEntry>).point ?? 0 })) as CatalogEntry[];
function readSaved<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null; } catch { return null; }
}
function save(key: string, value: unknown) { localStorage.setItem(key, JSON.stringify(value)); }
function randomBetween(min: number, max: number) { return min + Math.random() * (max - min); }
type Context = { currentEntry: CatalogEntry | null; isNewSpecies: boolean; catchCount: number; earnedPoints: number };
type PendingAction = (
  | { kind: 'start'; body: api.CastStartBody }
  | { kind: 'resolve'; body: api.CastResolveRequest }
  | { kind: 'decision'; body: { attempt_id: string; decision: 'keep' | 'release' } }
  | { kind: 'exchange'; body: { request_id: string; product_id: string } }
  | { kind: 'equipment'; body: { product_id: 'time_extension' | 'power_reel'; equipped: boolean } }
  | { kind: 'reveal'; body: { request_id: string; species_id: string } }
) & { context: Context };

interface GameState extends Context {
  phase: GamePhase; usingBackend: boolean; ready: boolean; loading: boolean; busy: boolean; error: string | null;
  catalog: CatalogEntry[]; collection: Record<string, CollectionRecord>; season: Season;
  economy: Economy; products: Product[]; useLure: boolean; pending: PendingAction | null;
  // ポイントで開示した天体ごとの「釣れやすい場所」（画面の座標表示の単位）
  areas: Record<string, CatchArea>;
  attemptId: string | null; gauge: number; timeLeft: number; timeLimit: number; damageMultiplier: number;
  reelPhaseMode: ReelPhaseMode; phaseTimer: number; phaseTelegraph: boolean; isHolding: boolean; tapPulse: number;
  lastResultSuccess: boolean | null;
  loadCatalog: () => Promise<void>; setSeason: (season: Season) => void;
  startCast: (x?: number, y?: number) => Promise<void>;
  triggerBite: () => void; pressStart: () => void; pressEnd: () => void; tickReel: (dt: number) => void;
  keepGyotaku: () => void; releaseCatch: () => void; returnToIdle: () => void;
  openZukan: () => void; closeZukan: () => void; openShop: () => void; closeShop: () => void;
  setUseLure: (use: boolean) => void; buy: (id: string) => Promise<void>;
  setEquipment: (id: 'time_extension' | 'power_reel', equipped: boolean) => Promise<void>;
  revealArea: (speciesId: string) => Promise<void>;
  retryPending: () => Promise<void>; dismissError: () => void;
  _run: (pending: PendingAction) => Promise<void>;
  _resolve: (success: boolean) => Promise<void>;
  _begin: (entry: CatalogEntry, timeLimit: number, damage: number, attemptId: string | null) => void;
}

const contextOf = (s: Context): Context => ({ currentEntry: s.currentEntry, isNewSpecies: s.isNewSpecies, catchCount: s.catchCount, earnedPoints: s.earnedPoints });
export const useGameStore = create<GameState>((set, get) => ({
  phase: 'idle', usingBackend: false, ready: false, loading: false, busy: false, error: null,
  catalog: mockCatalog, collection: {}, season: seasonOf(new Date()),
  economy: EMPTY_ECONOMY, products: MOCK_PRODUCTS, useLure: false, pending: null, areas: {},
  attemptId: null, currentEntry: null, gauge: 100, timeLeft: 0, timeLimit: 0, damageMultiplier: 1,
  reelPhaseMode: 'tap', phaseTimer: 0, phaseTelegraph: false, isHolding: false, tapPulse: 0,
  lastResultSuccess: null, isNewSpecies: false, catchCount: 0, earnedPoints: 0,

  loadCatalog: async () => {
    // StrictModeなどで初期化が重なっても、遅い応答で購入後の状態を上書きしない。
    if (get().ready || get().loading) return;
    set({ loading: true });
    const pending = readSaved<PendingAction>(PENDING_KEY);
    try {
      const [catalog, records, economy, products, areas] = await Promise.all([api.fetchCatalog(), api.fetchCollection(), api.fetchEconomy(), api.fetchProducts(), api.fetchAreas()]);
      set({ catalog, collection: Object.fromEntries(records.map(c => [c.species_id, c])), economy, products, areas, usingBackend: true, ready: true });
    } catch {
      if (!pending) {
        const saved = readSaved<{ economy: Economy; collection: Record<string, CollectionRecord>; testGrantApplied?: boolean }>(MOCK_KEY);
        const collection = saved?.collection ?? {};
        const previousEconomy = saved?.economy ?? EMPTY_ECONOMY;
        let economy = mockEconomy(previousEconomy.balance, previousEconomy.inventory, previousEconomy.equipped ?? {});
        if (mockTestPoints > 0 && !saved?.testGrantApplied) {
          economy = mockEconomy(economy.balance + mockTestPoints, economy.inventory, economy.equipped);
          save(MOCK_KEY, { economy, collection, testGrantApplied: true });
        }
        set({ usingBackend: false, ready: true, economy, collection, catalog: mockCatalog, products: MOCK_PRODUCTS, areas: mockAreas(mockCatalog, economy.inventory) });
      }
    }
    if (pending) set({ ...pending.context, pending, phase: 'pending', usingBackend: true, ready: true, error: '未確認の操作があります。同じ操作の結果を確認してください。' });
    set({ loading: false });
  },
  setSeason: season => { if (get().phase === 'idle' && !get().busy) set({ season }); },
  setUseLure: useLure => { if (get().phase === 'idle' && !get().busy) set({ useLure }); },

  _begin: (entry, timeLimit, damageMultiplier, attemptId) => {
    const config = RARITY_CONFIG[entry.rarity];
    set({ phase: 'cast', currentEntry: entry, attemptId, gauge: 100, timeLeft: timeLimit, timeLimit, damageMultiplier,
      reelPhaseMode: 'tap', phaseTelegraph: false, isHolding: false, lastResultSuccess: null,
      isNewSpecies: false, earnedPoints: 0, useLure: false, phaseTimer: randomBetween(config.phaseSwitchMin, config.phaseSwitchMax) });
    window.setTimeout(() => {
      if (get().phase !== 'cast') return;
      set({ phase: 'waiting_bite' });
      window.setTimeout(() => { if (get().phase === 'waiting_bite') get().triggerBite(); }, randomBetween(800, 2200));
    }, 600);
  },
  startCast: async (x = 0, y = 0) => {
    const s = get();
    if (!s.ready || s.busy || s.phase !== 'idle') return;
    if (s.useLure && !s.economy.inventory.lure) { set({ error: '誘引ルアーを交換してください。' }); return; }
    if (s.usingBackend) {
      await get()._run({ kind: 'start', body: { request_id: crypto.randomUUID(), season: s.season, x, y, use_lure: s.useLure }, context: contextOf(s) });
    } else {
      const entry = drawMock(s.catalog, s.season, x, y, s.useLure);
      const inventory = { ...s.economy.inventory };
      if (s.useLure) inventory.lure--;
      set({ economy: mockEconomy(s.economy.balance, inventory, s.economy.equipped), error: null });
      get()._begin(entry, RARITY_CONFIG[entry.rarity].timeLimit + (inventory.time_extension && s.economy.equipped.time_extension ? MOCK_PRODUCTS.find(p => p.id === 'time_extension')!.extra_seconds! : 0), inventory.power_reel && s.economy.equipped.power_reel ? MOCK_PRODUCTS.find(p => p.id === 'power_reel')!.damage_multiplier! : 1, null);
    }
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
      set((s) => ({ gauge: Math.max(0, s.gauge - config.tapDecrease * state.damageMultiplier), tapPulse: s.tapPulse + 1 }));
    }
  },

  pressEnd: () => {
    set({ isHolding: false });
  },

  tickReel: (dt: number) => {
    const state = get();
    if (state.phase !== 'reeling' || !state.currentEntry) return;
    // 連打で0になった直後に自然回復させず、成功を確定する。
    if (state.gauge <= 0) { void get()._resolve(true); return; }
    const rarity = state.currentEntry.rarity;
    const config = RARITY_CONFIG[rarity];

    let gauge = state.gauge;
    if (state.reelPhaseMode === 'hold' && state.isHolding) {
      gauge -= config.holdDecreasePerSec * state.damageMultiplier * dt;
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

  _resolve: async success => {
    const s = get();
    if (s.phase !== 'reeling' || !s.currentEntry) return;
    if (s.usingBackend && s.attemptId) {
      await get()._run({ kind: 'resolve', body: { attempt_id: s.attemptId, success }, context: contextOf(s) });
      return;
    }
    const existing = s.collection[s.currentEntry.id];
    const points = success && existing ? s.currentEntry.point : 0;
    set({ phase: 'result', lastResultSuccess: success, isNewSpecies: success && !existing,
      catchCount: success ? (existing?.catch_count ?? 0) + 1 : 0, earnedPoints: points,
      economy: mockEconomy(s.economy.balance + points, s.economy.inventory, s.economy.equipped),
      collection: success && existing ? { ...s.collection, [s.currentEntry.id]: { ...existing, catch_count: existing.catch_count + 1 } } : s.collection });
  },
  keepGyotaku: () => {
    const s = get();
    if (s.phase !== 'result' || s.busy || !s.isNewSpecies || !s.currentEntry) return;
    if (s.usingBackend && s.attemptId) {
      void get()._run({ kind: 'decision', body: { attempt_id: s.attemptId, decision: 'keep' }, context: contextOf(s) });
    } else {
      set({ phase: 'gyotaku', collection: { ...s.collection, [s.currentEntry.id]: { species_id: s.currentEntry.id, first_caught_at: new Date().toISOString(), catch_count: 1 } } });
    }
  },
  releaseCatch: () => {
    const s = get();
    if (s.phase !== 'result' || s.busy) return;
    if (s.usingBackend && s.attemptId && s.isNewSpecies) {
      void get()._run({ kind: 'decision', body: { attempt_id: s.attemptId, decision: 'release' }, context: contextOf(s) });
    } else get().returnToIdle();
  },
  returnToIdle: () => { if (!get().pending) set({ phase: 'idle', currentEntry: null, attemptId: null, error: null }); },
  openZukan: () => { if (get().phase === 'idle' && !get().busy) set({ phase: 'zukan' }); },
  closeZukan: () => set({ phase: 'idle' }),
  openShop: () => { if (get().phase === 'idle' && get().ready && !get().busy) set({ phase: 'shop', error: null }); },
  closeShop: () => { if (!get().busy && !get().pending) set({ phase: 'idle', error: null }); },
  dismissError: () => { if (!get().pending) set({ error: null }); },
  buy: async id => {
    const s = get();
    if (s.phase !== 'shop' || s.busy || s.pending) return;
    if (s.usingBackend) {
      await get()._run({ kind: 'exchange', body: { request_id: crypto.randomUUID(), product_id: id }, context: contextOf(s) });
      return;
    }
    const product = s.products.find(p => p.id === id);
    if (!product || s.economy.balance < product.price || (product.kind !== 'consumable' && s.economy.inventory[id])) return;
    set({ economy: mockEconomy(s.economy.balance - product.price, { ...s.economy.inventory, [id]: (s.economy.inventory[id] ?? 0) + 1 }, s.economy.equipped) });
  },
  setEquipment: async (id, equipped) => {
    const s = get();
    if (s.phase !== 'idle' || s.busy || s.pending || !s.economy.inventory[id]) return;
    if (s.usingBackend) {
      await get()._run({ kind: 'equipment', body: { product_id: id, equipped }, context: contextOf(s) });
    } else {
      set({ economy: mockEconomy(s.economy.balance, s.economy.inventory, { ...s.economy.equipped, [id]: equipped }) });
    }
  },
  // 図鑑から、天体ごとの「釣れやすい場所」をポイントで開示する（rare以上のみ）
  revealArea: async speciesId => {
    const s = get();
    if (s.phase !== 'zukan' || s.busy || s.pending || s.areas[speciesId]) return;
    if (s.usingBackend) {
      await get()._run({ kind: 'reveal', body: { request_id: crypto.randomUUID(), species_id: speciesId }, context: contextOf(s) });
      return;
    }
    const entry = s.catalog.find(c => c.id === speciesId);
    const price = entry && AREA_INFO_PRICES[entry.rarity];
    const area = entry?.catch_bonus?.area;
    if (!price || !area || s.economy.balance < price) return;
    set({ economy: mockEconomy(s.economy.balance - price, { ...s.economy.inventory, [areaInfoKey(speciesId)]: 1 }, s.economy.equipped), areas: { ...s.areas, [speciesId]: area } });
  },
  retryPending: async () => { const s = get(); if (s.pending && !s.busy) await get()._run(s.pending); },
  _run: async pending => {
    if (get().busy) return;
    // リクエストIDを送信前に保存し、再読込後も同じ操作を再送する。
    save(PENDING_KEY, pending);
    set({ pending, busy: true, error: null, phase: 'pending' });
    try {
      if (pending.kind === 'start') {
        const res = await api.castStart(pending.body);
        const economy = await api.fetchEconomy();
        const entry = get().catalog.find(c => c.rarity === res.rarity);
        if (!entry) throw new Error('カタログを再読込してください。');
        set({ economy });
        get()._begin(entry, res.time_limit, res.damage_multiplier, res.attempt_id);
      } else if (pending.kind === 'resolve') {
        const res = await api.castResolve(pending.body);
        const [records, economy] = await Promise.all([api.fetchCollection(), api.fetchEconomy()]);
        set({ phase: 'result', attemptId: pending.body.attempt_id, currentEntry: res.entry ?? pending.context.currentEntry,
          lastResultSuccess: res.success, isNewSpecies: res.is_new_species, catchCount: res.catch_count,
          earnedPoints: res.earned_points, economy, collection: Object.fromEntries(records.map(c => [c.species_id, c])) });
      } else if (pending.kind === 'decision') {
        await api.castDecision(pending.body);
        const records = await api.fetchCollection();
        set({ ...pending.context, phase: pending.body.decision === 'keep' ? 'gyotaku' : 'idle', collection: Object.fromEntries(records.map(c => [c.species_id, c])) });
      } else if (pending.kind === 'reveal') {
        const res = await api.revealArea(pending.body);
        set({ economy: res.economy, areas: res.areas, phase: 'zukan' });
      } else if (pending.kind === 'equipment') {
        await api.setEquipment(pending.body);
        set({ economy: await api.fetchEconomy(), phase: 'idle' });
      } else {
        await api.exchange(pending.body);
        set({ economy: await api.fetchEconomy(), phase: 'shop' });
      }
      save(PENDING_KEY, null);
      set({ pending: null, busy: false });
    } catch (error) {
      // 明確に拒否された操作は終了。通信断・5xxでは結果が不明なので同じIDで再確認する。
      if (error instanceof api.ApiError && error.status >= 400 && error.status < 500) {
        save(PENDING_KEY, null);
        set({ pending: null, busy: false, phase: pending.kind === 'exchange' ? 'shop' : pending.kind === 'reveal' ? 'zukan' : 'idle', error: '操作を受け付けられませんでした。残高・所持品・試行の有効期限を確認してください。' });
        try { set({ economy: await api.fetchEconomy() }); } catch { /* 次回操作時に再確認する */ }
      } else set({ busy: false, error: '通信結果を確認できません。同じ操作の結果を再確認してください。' });
    }
  },
}));

useGameStore.subscribe((s, before) => {
  if (s.ready && !s.usingBackend && (s.economy !== before.economy || s.collection !== before.collection)) {
    const previous = readSaved<{ testGrantApplied?: boolean }>(MOCK_KEY);
    save(MOCK_KEY, { economy: s.economy, collection: s.collection, testGrantApplied: previous?.testGrantApplied ?? false });
  }
});
