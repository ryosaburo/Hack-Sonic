import { useMemo, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { SEASON_LABEL, SEASON_ORDER, type Season } from '../engine/seasons';
import { AREA_INFO_PRICES } from '../engine/economy';
import { RARITY_LABEL, RARITY_ORDER, type CatalogEntry, type Rarity } from '../types';
import { GyotakuReveal } from './GyotakuReveal';
import '../styles/observatory.css';
import './Zukan.css';

type FilterValue = 'all' | Rarity;
// 季節の指定がない天体は四季を通して釣れるので「通年」にまとめる
type SeasonGroup = Season | 'all_year';

const SEASON_GROUPS: SeasonGroup[] = [...SEASON_ORDER, 'all_year'];

// 星図の観測記号でレア度を表す（色だけに頼らない）
const RARITY_SYMBOL: Record<Rarity, string> = {
  common: '○',
  rare: '◎',
  super_rare: '◈',
  legendary: '✦',
};

// 季節ごとに宵の南中付近に来る赤経の範囲。天球図の目盛りラベルとして添える
const SEASON_RA: Record<SeasonGroup, string> = {
  spring: 'RA 10h — 16h',
  summer: 'RA 16h — 22h',
  autumn: 'RA 22h — 04h',
  winter: 'RA 04h — 10h',
  all_year: 'CIRCUMPOLAR · 周極',
};

function inGroup(entry: CatalogEntry, group: SeasonGroup): boolean {
  if (!entry.seasons?.length) return group === 'all_year';
  return group !== 'all_year' && entry.seasons.includes(group);
}

// 未観測の天体を示す照準（点線の輪郭＋十字線＋中心の点）
function Reticle({ className }: { className: string }) {
  return (
    <span className={`zk-reticle ${className}`} aria-hidden="true">
      <span className="zk-reticle-dot" />
    </span>
  );
}

// 天体ごとの「釣れやすい場所」。rare以上はポイントで座標の範囲を開示できる（座標は釣り画面の表示と同じ単位）
function AreaInfo({ entry }: { entry: CatalogEntry }) {
  const area = useGameStore((s) => s.areas[entry.id]);
  const balance = useGameStore((s) => s.economy.balance);
  const disabled = useGameStore((s) => !s.ready || s.busy);
  const revealArea = useGameStore((s) => s.revealArea);
  const price = AREA_INFO_PRICES[entry.rarity];
  if (!price) return null;

  return (
    <div className="zk-area">
      <span className="flavor-label">釣れやすい場所</span>
      {area ? (
        <p className="zk-area-coord">
          座標 <span className="zk-num">{area.x} / {area.y}</span>
          <span className="zk-area-radius">
            半径 <span className="zk-num">{area.radius}</span>
          </span>
        </p>
      ) : (
        <>
          <p className="zk-area-note">ポイントと交換すると、この天体が釣れやすい座標を記録できる。</p>
          <button
            type="button"
            className="zk-area-btn"
            disabled={disabled || balance < price}
            onClick={() => void revealArea(entry.id)}
          >
            {balance < price ? `ポイント不足（${price} pt）` : `${price} pt で開示する`}
          </button>
          <span className="zk-area-balance">
            所持 <span className="zk-num">{balance} pt</span>
          </span>
        </>
      )}
    </div>
  );
}

export function Zukan() {
  const phase = useGameStore((s) => s.phase);
  const catalog = useGameStore((s) => s.catalog);
  const collection = useGameStore((s) => s.collection);
  const closeZukan = useGameStore((s) => s.closeZukan);
  const currentSeason = useGameStore((s) => s.season);

  const [filter, setFilter] = useState<FilterValue>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hintId, setHintId] = useState<string | null>(null);
  const [replayId, setReplayId] = useState<string | null>(null);

  const sections = useMemo(() => {
    const filtered = filter === 'all' ? catalog : catalog.filter((c) => c.rarity === filter);
    return SEASON_GROUPS.map((group) => ({
      group,
      entries: filtered.filter((c) => inGroup(c, group)),
    })).filter((section) => section.entries.length > 0);
  }, [catalog, filter]);

  const collectedCount = Object.keys(collection).length;

  if (phase !== 'zukan') return null;

  const selectedEntry = selectedId ? catalog.find((c) => c.id === selectedId) ?? null : null;
  const hintEntry = hintId ? catalog.find((c) => c.id === hintId) ?? null : null;
  const replayEntry = replayId ? catalog.find((c) => c.id === replayId) ?? null : null;
  const numberOf = (entry: CatalogEntry) => `No.${String(catalog.indexOf(entry) + 1).padStart(3, '0')}`;
  const progress = (collectedCount / (catalog.length || 1)) * 100;

  return (
    <div className="zukan-screen">
      {/* スクロールは内側だけにして、オーバーレイが常に画面全体を覆うようにする */}
      <div className="zukan-scroll">
        <header className="zukan-header">
          <h2 className="zukan-title">
            図鑑<span className="zukan-subtitle">観測台帳</span>
          </h2>
          <button type="button" className="close-btn" onClick={closeZukan}>
            閉じる
          </button>
        </header>

        <div className="zukan-progress">
          <span className="zukan-progress-label">
            収録 <span className="zk-num">{collectedCount} / {catalog.length}</span>
          </span>
          <div
            className="zukan-progress-bar"
            role="progressbar"
            aria-label="図鑑の収録率"
            aria-valuemin={0}
            aria-valuemax={catalog.length}
            aria-valuenow={collectedCount}
          >
            <div className="zukan-progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="zukan-filters" role="group" aria-label="レア度で絞り込む">
          <button
            type="button"
            className={`filter-chip ${filter === 'all' ? 'active' : ''}`}
            aria-pressed={filter === 'all'}
            onClick={() => setFilter('all')}
          >
            すべて
          </button>
          {RARITY_ORDER.map((r) => (
            <button
              key={r}
              type="button"
              className={`filter-chip rarity-${r} ${filter === r ? 'active' : ''}`}
              aria-pressed={filter === r}
              onClick={() => setFilter(r)}
            >
              <span className="zk-symbol" aria-hidden="true">
                {RARITY_SYMBOL[r]}
              </span>
              {RARITY_LABEL[r]}
            </button>
          ))}
        </div>

        {sections.map(({ group, entries }) => {
          const label = group === 'all_year' ? '通年' : SEASON_LABEL[group];
          const sectionCollected = entries.filter((c) => collection[c.id]).length;
          const headingId = `zukan-season-${group}`;
          return (
            <section key={group} className={`zukan-season zukan-season-${group}`} aria-labelledby={headingId}>
              <h3 className="zukan-season-title" id={headingId}>
                <span className="zukan-season-name">{label}</span>
                {group === currentSeason && <span className="zukan-season-now">いまの季節</span>}
                <span className="zukan-season-ra" aria-hidden="true">
                  {SEASON_RA[group]}
                </span>
                <span className="zukan-season-count zk-num">
                  {sectionCollected} / {entries.length}
                </span>
              </h3>
              <div className="zukan-season-scale" aria-hidden="true" />
              <ol className="zukan-ledger">
                {entries.map((entry) => {
                  const isCollected = Boolean(collection[entry.id]);
                  const rarityLabel = RARITY_LABEL[entry.rarity];
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        className={`zukan-card ${isCollected ? `collected rarity-${entry.rarity}` : 'unknown'}`}
                        onClick={() => (isCollected ? setSelectedId(entry.id) : setHintId(entry.id))}
                      >
                        {isCollected ? (
                          <span className="zukan-plate">
                            <img src={entry.image_url} alt={entry.body_name} className="zukan-thumb" />
                          </span>
                        ) : (
                          <Reticle className="zukan-plate" />
                        )}
                        <span className="zukan-no zk-num">{numberOf(entry)}</span>
                        <span className="zukan-names">
                          <span className="zukan-name">{isCollected ? entry.body_name : '未観測'}</span>
                          {isCollected && <span className="zukan-mission">{entry.mission_name}</span>}
                        </span>
                        <span className={`zukan-rarity zk-rarity-${entry.rarity}`}>
                          <span className="zk-symbol" aria-hidden="true">
                            {RARITY_SYMBOL[entry.rarity]}
                          </span>
                          <span className="zukan-rarity-label">{rarityLabel}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>

      {hintEntry && !collection[hintEntry.id] && (
        <div className="overlay-backdrop" onClick={() => setHintId(null)}>
          <div
            className="zukan-hint hint-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="zukan-hint-title"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="zk-eyebrow zk-num">{numberOf(hintEntry)}</p>
            <Reticle className="hint-reticle" />
            <p className="hint-title" id="zukan-hint-title">
              未観測の天体
            </p>
            <p className={`hint-rarity zk-rarity-${hintEntry.rarity}`}>
              <span className="zk-symbol" aria-hidden="true">
                {RARITY_SYMBOL[hintEntry.rarity]}
              </span>
              {RARITY_LABEL[hintEntry.rarity]}
            </p>
            <p className="hint-desc">釣り上げて正体を確かめよう</p>
            <AreaInfo entry={hintEntry} />
            <button type="button" className="primary-btn" onClick={() => setHintId(null)}>
              閉じる
            </button>
          </div>
        </div>
      )}

      {selectedEntry && collection[selectedEntry.id] && (
        <div className="overlay-backdrop" onClick={() => setSelectedId(null)}>
          <div
            className={`zukan-detail detail-card rarity-${selectedEntry.rarity}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="zukan-detail-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="detail-header">
              <span className={`zukan-rarity zk-rarity-${selectedEntry.rarity}`}>
                <span className="zk-symbol" aria-hidden="true">
                  {RARITY_SYMBOL[selectedEntry.rarity]}
                </span>
                {RARITY_LABEL[selectedEntry.rarity]}
              </span>
              <span className="zk-eyebrow zk-num">{numberOf(selectedEntry)}</span>
              <button type="button" className="close-btn" onClick={() => setSelectedId(null)}>
                閉じる
              </button>
            </div>
            <figure className="detail-figure">
              <span className="detail-plate">
                <img src={selectedEntry.image_url} alt={selectedEntry.body_name} className="detail-image" />
              </span>
              <figcaption className="credit-text">{selectedEntry.credit_text}</figcaption>
            </figure>
            <p className="body-name" id="zukan-detail-title">
              {selectedEntry.body_name}
            </p>
            <dl className="detail-specs">
              <dt>探査機</dt>
              <dd className="mission-name">{selectedEntry.mission_name}</dd>
              <dt>撮影日</dt>
              <dd className="zk-num">{selectedEntry.capture_date}</dd>
              <dt>初収集日</dt>
              <dd className="zk-num">
                {new Date(collection[selectedEntry.id].first_caught_at).toLocaleDateString('ja-JP')}
              </dd>
              <dt>累計釣獲数</dt>
              <dd className="zk-num">{collection[selectedEntry.id].catch_count}</dd>
            </dl>
            <blockquote className="flavor-text">
              <span className="flavor-label">観測メモ</span>
              {selectedEntry.flavor_text}
            </blockquote>
            <AreaInfo entry={selectedEntry} />
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
          key={replayEntry.id}
          entry={replayEntry}
          doneLabel="閉じる"
          onDone={() => setReplayId(null)}
        />
      )}
    </div>
  );
}
