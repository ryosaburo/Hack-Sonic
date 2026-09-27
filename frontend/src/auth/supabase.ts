import { createClient } from '@supabase/supabase-js';

// Supabase Auth でログインする。URLとキーが無い環境（ローカル開発など）ではログイン機能を出さず、端末IDだけで遊べる
//   VITE_SUPABASE_URL      : https://<project-ref>.supabase.co
//   VITE_SUPABASE_ANON_KEY : Project Settings → API の anon（publishable）キー。公開してよいキー
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase = url && anonKey ? createClient(url, anonKey) : null;

// 期限切れのトークンは getSession が自動で更新してから返す
export async function accessToken(): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}
