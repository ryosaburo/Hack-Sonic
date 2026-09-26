import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import { RARITY_LABEL, RARITY_SYMBOL } from '../types';
import { Reticle } from './Reticle';
import './ResultOverlay.css';

export function ResultOverlay() {
  const phase = useGameStore((s) => s.phase);
  const success = useGameStore((s) => s.lastResultSuccess);
  const entry = useGameStore((s) => s.currentEntry);
  const earnedPoints = useGameStore((s) => s.earnedPoints);
  const balance = useGameStore((s) => s.economy.balance);
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
        <div className="result-card fail" role="dialog" aria-modal="true" aria-labelledby="result-heading">
          <Reticle className="result-reticle lost" />
          <p className="result-heading" id="result-heading">逃げられた…</p>
          <p className="result-note">観測対象は照準の外へ流れていった</p>
          <button type="button" className="primary-btn" onClick={returnToIdle}>
            もう一度キャストする
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay-backdrop">
      <div
        className={`result-card success rarity-${entry.rarity}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="result-body-name"
      >
        <p className="rarity-badge">
          <span className="zk-symbol" aria-hidden="true">
            {RARITY_SYMBOL[entry.rarity]}
          </span>
          {RARITY_LABEL[entry.rarity]}
        </p>
        {isNew ? (
          <Reticle className="result-reticle silhouette" />
        ) : (
          // 図鑑に記録済みの天体は正体がわかっているので、画像をそのまま見せる
          <figure className="result-figure">
            <span className="result-plate">
              <img src={entry.image_url} alt={entry.body_name} className="result-image" />
            </span>
            <figcaption className="result-credit">{entry.credit_text}</figcaption>
          </figure>
        )}
        <p className="body-name" id="result-body-name">
          {entry.body_name}
        </p>

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
          <p className="known-note">
            図鑑に記録済み <span className="zk-num known-points">+{earnedPoints} pt</span>
            <span className="known-balance">
              所持 <span className="zk-num">{balance} pt</span>
            </span>
            自動的に逃がします
          </p>
        )}
      </div>
    </div>
  );
}
