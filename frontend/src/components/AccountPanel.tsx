import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AuthError } from '@supabase/supabase-js';
import { finishLogin, logout, useAccount, type AccountMode } from '../auth/account';
import { supabase } from '../auth/supabase';
import './AccountPanel.css';

const TITLES: Record<AccountMode, string> = {
  signin: 'ログイン',
  signup: 'アカウントを作る',
  reset: 'パスワードの再設定',
  newPassword: '新しいパスワード',
};

function messageOf(error: AuthError): string {
  switch (error.code) {
    case 'invalid_credentials': return 'メールアドレスかパスワードが違います。';
    case 'email_not_confirmed': return '確認メールのリンクを開いてから、もう一度ログインしてください。';
    case 'user_already_exists': return 'このメールアドレスは登録済みです。ログインしてください。';
    case 'weak_password': return 'パスワードが短すぎるか、推測されやすいものです。';
    case 'same_password': return '今と違うパスワードを入力してください。';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit': return '操作が続いたため、少し時間をおいてからお試しください。';
    default: return '処理できませんでした。時間をおいてもう一度お試しください。';
  }
}

export function AccountPanel() {
  const { open, mode, closePanel } = useAccount();
  const dialogRef = useRef<HTMLDialogElement>(null);
  // メールアドレスは、ログイン・登録・再設定を行き来しても入れ直さなくてよいよう残す
  const [email, setEmail] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  if (!supabase) return null;

  return (
    <dialog
      ref={dialogRef}
      className="account-panel"
      aria-labelledby="account-panel-title"
      onClose={closePanel}
      onClick={(e) => {
        // 枠の外（背景）をクリックしたら閉じる
        if (e.target === e.currentTarget) closePanel();
      }}
    >
      {/* 開き直したり画面を切り替えたりしたら、入力途中のパスワードやメッセージを消す */}
      <AccountBody key={`${mode}:${open}`} email={email} setEmail={setEmail} />
    </dialog>
  );
}

function AccountBody({ email, setEmail }: { email: string; setEmail: (email: string) => void }) {
  const { mode, email: signedInEmail, openPanel, closePanel } = useAccount();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (!supabase) return null;
  const auth = supabase.auth;

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'signin') {
        const { error: err } = await auth.signInWithPassword({ email, password });
        if (err) throw err;
        await finishLogin();
        return;
      }
      if (mode === 'signup') {
        const { data, error: err } = await auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
        if (err) throw err;
        if (data.session) {
          await finishLogin();
          return;
        }
        setNotice('確認メールを送りました。メールのリンクを開くとログインできます。');
      } else if (mode === 'reset') {
        const { error: err } = await auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
        if (err) throw err;
        setNotice('再設定用のメールを送りました。メールのリンクから新しいパスワードを設定してください。');
      } else {
        const { error: err } = await auth.updateUser({ password });
        if (err) throw err;
        setNotice('パスワードを変更しました。');
        setPassword('');
      }
    } catch (err) {
      setError(err && typeof err === 'object' && 'code' in err ? messageOf(err as AuthError) : '通信できませんでした。接続を確認してください。');
    } finally {
      setBusy(false);
    }
  }

  const signedIn = signedInEmail !== null && mode !== 'newPassword';

  return signedIn ? (
    <>
      <h2 id="account-panel-title">アカウント</h2>
      <p className="account-lead">ログイン中：<span className="account-email">{signedInEmail}</span></p>
      <p className="account-note">図鑑・ポイント・アイテムと、最後にいた場所はアカウントに保存されます。別の端末でも同じアカウントでログインすれば続きから遊べます。</p>
      <div className="account-actions">
        <button type="button" className="account-secondary" disabled={busy} onClick={() => { setBusy(true); void logout().finally(() => setBusy(false)); }}>ログアウト</button>
        <button type="button" className="account-primary" onClick={closePanel}>閉じる</button>
      </div>
    </>
  ) : (
    <form onSubmit={submit}>
      <h2 id="account-panel-title">{TITLES[mode]}</h2>
      {mode === 'signin' && <p className="account-note">ログインすると、別の端末やブラウザでも続きから遊べます。この端末で遊んだ記録は、初めてログインしたアカウントに引き継がれます。</p>}
      {mode === 'signup' && <p className="account-note">この端末で遊んだ図鑑・ポイント・アイテムは、作ったアカウントに引き継がれます。</p>}

      {mode !== 'newPassword' && (
        <label className="account-field">
          <span>メールアドレス</span>
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
      )}
      {mode !== 'reset' && (
        <label className="account-field">
          <span>{mode === 'newPassword' ? '新しいパスワード（6文字以上）' : mode === 'signup' ? 'パスワード（6文字以上）' : 'パスワード'}</span>
          <input
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            required
            minLength={mode === 'signin' ? undefined : 6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
      )}

      {error && <p className="account-error" role="alert">{error}</p>}
      {notice && <p className="account-notice" role="status">{notice}</p>}

      <div className="account-actions">
        <button type="button" className="account-secondary" onClick={closePanel}>閉じる</button>
        <button type="submit" className="account-primary" disabled={busy}>
          {busy ? '送信中…' : mode === 'signin' ? 'ログイン' : mode === 'signup' ? '登録する' : mode === 'reset' ? 'メールを送る' : '変更する'}
        </button>
      </div>

      <div className="account-links">
        {mode === 'signin' && (
          <>
            <button type="button" onClick={() => openPanel('signup')}>アカウントを作る</button>
            <button type="button" onClick={() => openPanel('reset')}>パスワードを忘れた</button>
          </>
        )}
        {(mode === 'signup' || mode === 'reset') && <button type="button" onClick={() => openPanel('signin')}>ログインに戻る</button>}
      </div>
    </form>
  );
}
