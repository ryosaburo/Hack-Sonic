import type { CatalogEntry, CollectionRecord, Rarity } from '../types';
import type { CatchArea, Economy, Product } from '../engine/economy';
import type { Season } from '../engine/seasons';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000';
const DEVICE_ID_KEY = 'space-fishing:device-id';

function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(15000),
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Id': getDeviceId(),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    throw new ApiError(res.status);
  }
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number) { super(`通信エラー (${status})`); this.status = status; }
}

export interface CastStartBody { request_id: string; season: Season; x: number; y: number; use_lure: boolean }
export interface CastStartResponse {
  attempt_id: string;
  rarity: Rarity;
  time_limit: number;
  damage_multiplier: number;
  economy: Economy;
}

export interface CastResolveRequest {
  attempt_id: string;
  success: boolean;
}

export interface CastResolveResponse {
  success: boolean;
  entry: CatalogEntry | null;
  is_new_species: boolean;
  catch_count: number;
  earned_points: number;
  economy: Economy;
}

export function fetchCatalog(): Promise<CatalogEntry[]> {
  return request<CatalogEntry[]>('/api/catalog');
}

export function fetchCollection(): Promise<CollectionRecord[]> {
  return request<CollectionRecord[]>('/api/collection');
}

// 季節を渡すと、その季節に釣れる天体の中から抽選される
export function castStart(body: CastStartBody): Promise<CastStartResponse> {
  return request<CastStartResponse>('/api/cast/start', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function castResolve(body: CastResolveRequest): Promise<CastResolveResponse> {
  return request<CastResolveResponse>('/api/cast/resolve', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export const fetchEconomy = () => request<Economy>('/api/economy');
export const fetchProducts = () => request<Product[]>('/api/economy/products');
export const exchange = (body: { request_id: string; product_id: string }) => request<Economy>('/api/economy/exchange', { method: 'POST', body: JSON.stringify(body) });
export const setEquipment = (body: { product_id: 'time_extension' | 'power_reel'; equipped: boolean }) => request<Economy>('/api/economy/equipment', { method: 'PUT', body: JSON.stringify(body) });
export const fetchAreas = () => request<Record<string, CatchArea>>('/api/economy/areas');
export const revealArea = (body: { request_id: string; species_id: string }) => request<{ economy: Economy; areas: Record<string, CatchArea> }>('/api/economy/reveal', { method: 'POST', body: JSON.stringify(body) });
export const castDecision =(body: { attempt_id: string; decision: 'keep' | 'release' }) => request<{ decision: string }>('/api/cast/decision', { method: 'POST', body: JSON.stringify(body) });
