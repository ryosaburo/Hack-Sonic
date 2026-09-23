import type { CatalogEntry, CollectionRecord, Rarity } from '../types';

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
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Id': getDeviceId(),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`API ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface CastStartResponse {
  attempt_id: string;
  rarity: Rarity;
  time_limit: number;
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
}

export function fetchCatalog(): Promise<CatalogEntry[]> {
  return request<CatalogEntry[]>('/api/catalog');
}

export function fetchCollection(): Promise<CollectionRecord[]> {
  return request<CollectionRecord[]>('/api/collection');
}

export function castStart(): Promise<CastStartResponse> {
  return request<CastStartResponse>('/api/cast/start', { method: 'POST' });
}

export function castResolve(body: CastResolveRequest): Promise<CastResolveResponse> {
  return request<CastResolveResponse>('/api/cast/resolve', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
