import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import { RARITY_LABEL } from '../types';
import './ResultOverlay.css';

export function ResultOverlay() {
  const phase = useGameStore((s) => s.phase);
  const success = useGameStore((s) => s.lastResultSuccess);
  const entry = useGameStore((s) => s.currentEntry);
  const isNew = useGameStore((s) => s.isNewSpecies);
  const keepGyotaku = useGameStore((s) => s.keepGyotaku);
  const releaseCatch = useGameStore((s) => s.releaseCatch);
  const returnToIdle = useGameStore((s) => s.returnToIdle);

  const showKnownAutoRelease = phase === 'result' && success && entry && !isNew;

  useEffect(() => {
    if (!showKnownAutoRelease) return;
    // 既知の天体は選択肢を出さず、少し見せてから自動的に逃がす。
    const timer = window.setTimeout(() => releaseCatch(), 1800);
    return () => window.clearTimeout(timer);
  }, [showKnownAutoRelease, releaseCatch]);

  if (phase !== 'result' || !entry) return null;

  if (!success) {
    return (
      <div className="overlay-backdrop">
        <div className="result-card fail">
          <p className="result-heading">逃げられた…</p>
          <button type="button" className="primary-btn" onClick={returnToIdle}>
            もう一度キャストする
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay-backdrop">
      <div className={`result-card success rarity-${entry.rarity}`}>
        <p className="rarity-badge">{RARITY_LABEL[entry.rarity]}</p>
        <div className="silhouette" />
        <p className="body-name">{entry.body_name}</p>

        {isNew ? (
          <div className="choice-row">
            <button type="button" className="primary-btn" onClick={keepGyotaku}>
              魚拓を取る
            </button>
            <button type="button" className="secondary-btn" onClick={releaseCatch}>
              逃がす
            </button>
          </div>
        ) : (
          <p className="known-note">図鑑に記録済み。少量の報酬を得た（自動的に逃がします）</p>
        )}
      </div>
    </div>
  );
}
