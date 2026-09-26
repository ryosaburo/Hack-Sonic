import { useEffect, useMemo, useState } from 'react';
import type { CatalogEntry } from '../types';
import { RARITY_LABEL, RARITY_SYMBOL } from '../types';
import './GyotakuReveal.css';

const TOTAL_DURATION_MS: Record<string, number> = {
  common: 1200,
  rare: 1800,
  super_rare: 2500,
  legendary: 3500,
};

const PARTICLE_COUNT = 12;

interface GyotakuRevealProps {
  entry: CatalogEntry;
  doneLabel: string;
  onDone: () => void;
  registeredNote?: string;
}

export function GyotakuReveal({ entry, doneLabel, onDone, registeredNote }: GyotakuRevealProps) {
  const [step, setStep] = useState(0); // 0:引き上げ 1:スタンプ 2:実写反転 3:情報表示
  const [skipped, setSkipped] = useState(false);

  const rarity = entry.rarity;
  const total = TOTAL_DURATION_MS[rarity];

  // 呼び出し側がentry.idをkeyに渡して天体ごとに再マウントする前提なので、
  // ここでは初回タイマーのセットだけを行う(stateのリセットはしない)。
  useEffect(() => {
    const t1 = window.setTimeout(() => setStep(1), total * 0.25);
    const t2 = window.setTimeout(() => setStep(2), total * 0.5);
    const t3 = window.setTimeout(() => setStep(3), total * 0.85);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [total]);

  const particles = useMemo(
    () =>
      Array.from({ length: PARTICLE_COUNT }).map((_, i) => ({
        left: `${(i * 37) % 100}%`,
        top: `${(i * 53) % 100}%`,
        delay: `${(i % 5) * 0.12}s`,
      })),
    [],
  );

  function handleSkip() {
    setSkipped(true);
    setStep(3);
  }

  return (
    <div className="overlay-backdrop gyotaku-backdrop" onClick={step < 3 ? handleSkip : undefined}>
      <div className={`gyotaku-card rarity-${rarity} step-${step} ${skipped ? 'skipped' : ''}`}>
        {rarity !== 'common' &&
          particles.map((p, i) => (
            <span
              key={i}
              className="particle"
              style={{ left: p.left, top: p.top, animationDelay: p.delay }}
            />
          ))}

        <div className="gyotaku-image-frame">
          <img src={entry.image_url} alt={entry.body_name} className="gyotaku-image" />
          <div className="stamp-frame" />
        </div>

        {step >= 3 && (
          <div className="gyotaku-info" onClick={(e) => e.stopPropagation()}>
            <p className="credit-text">{entry.credit_text}</p>
            <p className="rarity-badge">
              <span className="zk-symbol" aria-hidden="true">
                {RARITY_SYMBOL[entry.rarity]}
              </span>
              {RARITY_LABEL[entry.rarity]}
            </p>
            <p className="body-name">{entry.body_name}</p>
            <dl className="gyotaku-specs">
              <dt>探査機</dt>
              <dd className="mission-name">{entry.mission_name}</dd>
              <dt>撮影日</dt>
              <dd className="capture-date zk-num">{entry.capture_date}</dd>
            </dl>
            {registeredNote && <p className="registered-note">{registeredNote}</p>}
            <button type="button" className="primary-btn" onClick={onDone}>
              {doneLabel}
            </button>
          </div>
        )}

        {step < 3 && <p className="skip-hint">タップでスキップ</p>}
      </div>
    </div>
  );
}
