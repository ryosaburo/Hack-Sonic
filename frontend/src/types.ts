import type { Season } from './engine/seasons';

export type Rarity = 'common' | 'rare' | 'super_rare' | 'legendary';

export interface CatalogEntry {
  id: string;
  body_name: string;
  mission_name: string;
  image_url: string;
  credit_text: string;
  rarity: Rarity;
  weight: number;
  capture_date: string;
  flavor_text: string;
  // 釣れる季節。未指定なら四季を通して釣れる
  seasons?: Season[];
}

export interface CollectionRecord {
  species_id: string;
  first_caught_at: string;
  catch_count: number;
}

export interface RarityConfig {
  tapDecrease: number;
  holdDecreasePerSec: number;
  recoverPerSec: number;
  phaseSwitchMin: number;
  phaseSwitchMax: number;
  timeLimit: number;
  telegraphSeconds: number;
}

export const RARITY_ORDER: Rarity[] = ['common', 'rare', 'super_rare', 'legendary'];

export const RARITY_LABEL: Record<Rarity, string> = {
  common: 'コモン',
  rare: 'レア',
  super_rare: 'スーパーレア',
  legendary: '伝説',
};

export const RARITY_CONFIG: Record<Rarity, RarityConfig> = {
  common: {
    tapDecrease: 4,
    holdDecreasePerSec: 15,
    recoverPerSec: 3,
    phaseSwitchMin: 1.5,
    phaseSwitchMax: 2.5,
    timeLimit: 20,
    telegraphSeconds: 0.8,
  },
  rare: {
    tapDecrease: 3,
    holdDecreasePerSec: 12,
    recoverPerSec: 5,
    phaseSwitchMin: 1.2,
    phaseSwitchMax: 2.0,
    timeLimit: 17,
    telegraphSeconds: 0.6,
  },
  super_rare: {
    tapDecrease: 2.5,
    holdDecreasePerSec: 10,
    recoverPerSec: 7,
    phaseSwitchMin: 1.0,
    phaseSwitchMax: 1.6,
    timeLimit: 14,
    telegraphSeconds: 0.45,
  },
  legendary: {
    tapDecrease: 2,
    holdDecreasePerSec: 8,
    recoverPerSec: 9,
    phaseSwitchMin: 0.7,
    phaseSwitchMax: 1.3,
    timeLimit: 12,
    telegraphSeconds: 0.3,
  },
};

export type ReelPhaseMode = 'tap' | 'hold';

export type GamePhase =
  | 'idle'
  | 'cast'
  | 'waiting_bite'
  | 'reeling'
  | 'result'
  | 'gyotaku'
  | 'zukan';
