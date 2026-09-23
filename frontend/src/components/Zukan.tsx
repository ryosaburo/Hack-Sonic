import { useMemo, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { RARITY_LABEL, RARITY_ORDER, type Rarity } from '../types';
import { GyotakuReveal } from './GyotakuReveal';
import './Zukan.css';

type FilterValue = 'all' | Rarity;

export function Zukan() {
  const phase = useGameStore((s) => s.phase);
  const catalog = useGameStore((s) => s.catalog);
  const collection = useGameStore((s) => s.collection);
  const closeZukan = useGameStore((s) => s.closeZukan);

  const [filter, setFilter] = useState<FilterValue>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hintId, setHintId] = useState<string | null>(null);
  const [replayId, setReplayId] = useState<string | null>(null);

  const filtered = useMemo(
    () => (filter === 'all' ? catalog : catalog.filter((c) => c.rarity === filter)),
    [catalog, filter],
  );

  const collectedCount = Object.keys(collection).length;

  if (phase !== 'zukan') return null;

  const selectedEntry = selectedId ? catalog.find((c) => c.id === selectedId) ?? null : null;
  const hintEntry = hintId ? catalog.find((c) => c.id === hintId) ?? null : null;
  const replayEntry = replayId ? catalog.find((c) => c.id === replayId) ?? null : null;
  const starsForRarity: Record<Rarity, number> = { common: 1, rare: 2, super_rare: 3, legendary: 4 };

  return (
    <div className="zukan-screen">
      <header className="zukan-header">
        <h2>図鑑</h2>
        <button type="button" className="close-btn" onClick={closeZukan}>
          閉じる
        </button>
      </header>

      <div className="zukan-progress">
        <div className="zukan-progress-bar">
          <div
            className="zukan-progress-fill"
            style={{ width: `${(collectedCount / (catalog.length || 1)) * 100}%` }}
          />
        </div>
        <span className="zukan-progress-label">
          {collectedCount} / {catalog.length} 収録
        </span>
      </div>

      <div className="zukan-filters">
        <button
          type="button"
          className={`filter-chip ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
        >
          すべて
        </button>
        {RARITY_ORDER.map((r) => (
          <button
            key={r}
            type="button"
            className={`filter-chip rarity-${r} ${filter === r ? 'active' : ''}`}
            onClick={() => setFilter(r)}
          >
            {RARITY_LABEL[r]}
          </button>
        ))}
      </div>

      <div className="zukan-grid">
        {filtered.map((entry) => {
          const isCollected = Boolean(collection[entry.id]);
          const no = String(catalog.indexOf(entry) + 1).padStart(3, '0');
          return (
            <button
              key={entry.id}
              type="button"
              className={`zukan-card ${isCollected ? `collected rarity-${entry.rarity}` : 'unknown'}`}
              onClick={() => (isCollected ? setSelectedId(entry.id) : setHintId(entry.id))}
            >
              <span className="zukan-no">No.{no}</span>
              {isCollected ? (
                <>
                  <img src={entry.image_url} alt={entry.body_name} className="zukan-thumb" />
                  <span className="zukan-name">{entry.body_name}</span>
                  <span className="zukan-mission">{entry.mission_name}</span>
                  <span className="zukan-badge">{RARITY_LABEL[entry.rarity]}</span>
                </>
              ) : (
                <>
                  <div className="zukan-thumb silhouette-thumb" />
                  <span className="zukan-name">???</span>
                </>
              )}
            </button>
          );
        })}
      </div>

      {hintEntry && !collection[hintEntry.id] && (
        <div className="overlay-backdrop" onClick={() => setHintId(null)}>
          <div className="hint-card" onClick={(e) => e.stopPropagation()}>
            <p className="hint-title">未収録の天体</p>
            <p className="hint-stars">{'★'.repeat(starsForRarity[hintEntry.rarity])}</p>
            <p className="hint-desc">釣り上げて正体を確かめよう</p>
            <button type="button" className="primary-btn" onClick={() => setHintId(null)}>
              閉じる
            </button>
          </div>
        </div>
      )}

      {selectedEntry && collection[selectedEntry.id] && (
        <div className="overlay-backdrop" onClick={() => setSelectedId(null)}>
          <div className={`detail-card rarity-${selectedEntry.rarity}`} onClick={(e) => e.stopPropagation()}>
            <div className="detail-header">
              <span className="zukan-badge">{RARITY_LABEL[selectedEntry.rarity]}</span>
              <button type="button" className="close-btn" onClick={() => setSelectedId(null)}>
                閉じる
              </button>
            </div>
            <img src={selectedEntry.image_url} alt={selectedEntry.body_name} className="detail-image" />
            <p className="body-name">{selectedEntry.body_name}</p>
            <p className="mission-name">{selectedEntry.mission_name}</p>
            <p className="detail-dates">
              撮影日: {selectedEntry.capture_date} ／ 初収集日:{' '}
              {new Date(collection[selectedEntry.id].first_caught_at).toLocaleDateString('ja-JP')}
            </p>
            <p className="detail-dates">累計釣獲数: {collection[selectedEntry.id].catch_count}</p>
            <p className="flavor-text">{selectedEntry.flavor_text}</p>
            <p className="credit-text">{selectedEntry.credit_text}</p>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => {
                setReplayId(selectedEntry.id);
                setSelectedId(null);
              }}
            >
              魚拓演出をもう一度見る
            </button>
          </div>
        </div>
      )}

      {replayEntry && (
        <GyotakuReveal
          entry={replayEntry}
          doneLabel="閉じる"
          onDone={() => setReplayId(null)}
        />
      )}
    </div>
  );
}
