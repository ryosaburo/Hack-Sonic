import { create } from 'zustand';
import { fetchMe, resetDeviceId, type ServerResume } from '../api/client';
import { clearResume, saveResume } from '../engine/resume';
import { supabase } from './supabase';

export type AccountMode = 'signin' | 'signup' | 'reset' | 'newPassword';

interface AccountState {
  open: boolean;
  mode: AccountMode;
  // ログイン中のメールアドレス。未ログインは null
  email: string | null;
  openPanel: (mode?: AccountMode) => void;
  closePanel: () => void;
}

export const useAccount = create<AccountState>((set) => ({
  open: false,
  mode: 'signin',
  email: null,
  openPanel: (mode = 'signin') => set({ open: true, mode }),
  closePanel: () => set({ open: false }),
}));

// サーバーに保存された続き（位置・季節）を端末の再開データに写す。ログイン中はサーバーの値を正とする
export async function pullServerResume(timeoutMs?: number): Promise<ServerResume | null> {
  const me = await fetchMe(timeoutMs);
  if (me.resume) saveResume({ panX: me.resume.pan_x, panY: me.resume.pan_y, season: me.resume.season });
  return me.resume;
}

// ログインしたら、アカウントの進行データで遊び直すために読み込み直す
export async function finishLogin() {
  try { await pullServerResume(); } catch { /* 取れなければ端末の続きから始める */ }
  window.location.reload();
}

export async function logout() {
  // 後始末は SIGNED_OUT の通知で行う（別タブでのログアウトやトークン失効も同じ扱いにする）
  await supabase?.auth.signOut({ scope: 'local' });
}

export function watchAuth(): () => void {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    useAccount.setState({ email: session?.user.email ?? null });
    if (event === 'SIGNED_OUT') {
      // 引き継いだ進行データを端末IDで触らないよう、新しい端末IDでタイトルからやり直す
      resetDeviceId();
      clearResume();
      window.location.reload();
    } else if (event === 'PASSWORD_RECOVERY') {
      useAccount.setState({ open: true, mode: 'newPassword' });
    }
  });
  return () => data.subscription.unsubscribe();
}
