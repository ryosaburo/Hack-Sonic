import { SEASON_ORDER, type Season } from './seasons';

// 一度釣り場に着いたら、再読込しても出発演出からではなく最後にいた場所・季節から再開する
const RESUME_KEY = 'space-fishing:resume:v1';

export interface ResumeState {
  panX: number;
  panY: number;
  season: Season;
}

export function readResume(): ResumeState | null {
  try {
    const saved = JSON.parse(localStorage.getItem(RESUME_KEY) ?? 'null') as Partial<ResumeState> | null;
    if (!saved || !Number.isFinite(saved.panX) || !Number.isFinite(saved.panY)) return null;
    if (!SEASON_ORDER.includes(saved.season as Season)) return null;
    return saved as ResumeState;
  } catch {
    return null;
  }
}

export function saveResume(state: ResumeState) {
  try {
    localStorage.setItem(RESUME_KEY, JSON.stringify(state));
  } catch { /* 保存できなくても今回の釣りは続けられる */ }
}
