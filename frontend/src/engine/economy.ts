import shop from '../data/shop.mock.json';
import type { CatalogEntry, CatchBonus, Rarity } from '../types';
import type { Season } from './seasons';

export interface Spot {
  id: string; name: string;
  x_min: number; x_max: number; y_min: number; y_max: number;
  rarity_multipliers: number[];
}
export interface Product {
  id: string; name: string; kind: string; price: number; description: string;
  rarity_multipliers?: number[]; extra_seconds?: number; damage_multiplier?: number;
}
export interface Economy {
  balance: number;
  inventory: Record<string, number>;
  equipped: Record<string, boolean>;
  spots: Spot[];
}
// TODO: catalog.json の point 確定後、shop.mock.json の価格・効果量をbackendと同期して調整する。
export const MOCK_PRODUCTS: Product[] = shop.products;
export const EMPTY_ECONOMY: Economy = { balance: 0, inventory: {}, equipped: {}, spots: [] };
export const RARITY_WEIGHTS: Record<Rarity, number> = { common: 70, rare: 20, super_rare: 8, legendary: 2 };
export const inSpot = (spot: Spot, x: number, y: number) => x >= spot.x_min && x <= spot.x_max && y >= spot.y_min && y <= spot.y_max;
export function mockEconomy(balance: number, inventory: Record<string, number>, equipped: Record<string, boolean>): Economy {
  return { balance, inventory, equipped, spots: shop.spots.filter(s => inventory[s.id] > 0) };
}
// 天体ごとの「釣れやすい場所」の開示価格（レア度別）。交換所の商品一覧には出さない
export type CatchArea = NonNullable<CatchBonus['area']>;
export const AREA_INFO_PRICES: Partial<Record<Rarity, number>> = shop.area_info_prices;
export const areaInfoKey = (speciesId: string) => `area_info:${speciesId}`;
// モック用：所持品に持っている開示済みの印から、座標範囲を引き直す
export function mockAreas(catalog: CatalogEntry[], inventory: Record<string, number>): Record<string, CatchArea> {
  return Object.fromEntries(catalog.flatMap(e => (inventory[areaInfoKey(e.id)] > 0 && e.catch_bonus?.area ? [[e.id, e.catch_bonus.area]] : [])));
}
export function weightedDraw<T>(values: T[], weights: number[]): T {
  let n = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < values.length; i++) { n -= weights[i]; if (n < 0) return values[i]; }
  return values[values.length - 1];
}
// rare以上だけ、得意な季節・座標で同じレア度の中から選ばれやすくなる。commonはどこでも重みのまま
export function catchWeight(entry: CatalogEntry, season: Season, x: number, y: number): number {
  const bonus = entry.catch_bonus;
  if (!bonus || entry.rarity === 'common') return entry.weight;
  let weight = entry.weight;
  if (bonus.seasons?.includes(season)) weight *= bonus.season_multiplier ?? 1;
  const area = bonus.area;
  // x, y はワールド座標なので、画面の「座標」表示の単位に直して比べる
  if (area && Math.hypot(x / 10 - area.x, -y / 10 - area.y) <= area.radius) weight *= bonus.area_multiplier ?? 1;
  return weight;
}
export function drawMock(catalog: CatalogEntry[], season: Season, x: number, y: number, lure: boolean): CatalogEntry {
  const seasonal = catalog.filter(e => !e.seasons || e.seasons.includes(season));
  const candidates = seasonal.length ? seasonal : catalog;
  let multipliers = [1, 1, 1, 1];
  for (const spot of shop.spots) if (inSpot(spot, x, y)) multipliers = multipliers.map((m, i) => Math.max(m, spot.rarity_multipliers[i]));
  if (lure) multipliers = multipliers.map((m, i) => m * shop.products.find(p => p.id === 'lure')!.rarity_multipliers![i]);
  const rarities = (Object.keys(RARITY_WEIGHTS) as Rarity[]).filter(r => candidates.some(e => e.rarity === r));
  const order = Object.keys(RARITY_WEIGHTS);
  const rarity = weightedDraw(rarities, rarities.map(r => RARITY_WEIGHTS[r] * Math.min(6, multipliers[order.indexOf(r)])));
  const entries = candidates.filter(e => e.rarity === rarity);
  return weightedDraw(entries, entries.map(e => catchWeight(e, season, x, y)));
}
