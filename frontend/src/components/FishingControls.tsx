import { useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { SEASON_LABEL, SEASON_ORDER } from '../engine/seasons';
import { EconomyHud, EquipmentControls } from './ExchangeShop';
import './FishingControls.css';

function SeasonPicker({ onChange }: { onChange: () => void }) {
  const season = useGameStore(s => s.season);
  const setSeason = useGameStore(s => s.setSeason);
  const busy = useGameStore(s => s.busy);
  return <div className="season-picker" role="group" aria-label="季節">
    {SEASON_ORDER.map(s => <button
      key={s}
      type="button"
      aria-pressed={s === season}
      disabled={busy}
      className={`season-option season-option-${s} ${s === season ? 'active' : ''}`}
      onClick={() => {
        if (s === season) return;
        setSeason(s);
        onChange();
      }}
    >{SEASON_LABEL[s]}</button>)}
  </div>;
}

// 待機中だけマウントする。モーダルは釣りのCanvasから独立させる。
export function FishingControls({ onSeasonChange }: { onSeasonChange: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const ready = useGameStore(s => s.ready);
  const busy = useGameStore(s => s.busy);
  const balance = useGameStore(s => s.economy.balance);
  const openShop = useGameStore(s => s.openShop);
  const openZukan = useGameStore(s => s.openZukan);

  useEffect(() => {
    const narrow = window.matchMedia('(max-width: 600px)');
    const onResize = () => {
      if (!narrow.matches && dialog.current?.open) {
        dialog.current.close();
      }
    };
    narrow.addEventListener('change', onResize);
    return () => narrow.removeEventListener('change', onResize);
  }, []);

  const closeMenu = () => dialog.current?.close();
  return <>
    <div className="desktop-fishing-controls">
      <EconomyHud />
      <SeasonPicker onChange={onSeasonChange} />
      <button type="button" className="zukan-fab" onClick={openZukan}>図鑑</button>
    </div>
    <button ref={trigger} type="button" className="fishing-menu-trigger" aria-haspopup="dialog"
      aria-controls="fishing-menu" onClick={() => dialog.current?.showModal()}>
      <span aria-hidden="true">☰</span> メニュー
    </button>
    <dialog ref={dialog} id="fishing-menu" className="fishing-menu" aria-labelledby="fishing-menu-title"
      onClose={() => {
        if (window.matchMedia('(max-width: 600px)').matches) trigger.current?.focus();
      }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeMenu();
      }}>
      <header className="fishing-menu-header">
        <h2 id="fishing-menu-title">釣りのメニュー</h2>
        <button type="button" autoFocus onClick={closeMenu} aria-label="メニューを閉じる">閉じる</button>
      </header>
      <nav className="fishing-menu-links" aria-label="釣りの施設">
        <button type="button" disabled={!ready || busy} onClick={() => { closeMenu(); openShop(); }}>
          交換所 <span className="zk-num">{balance} pt</span>
        </button>
        <button type="button" disabled={busy} onClick={() => { closeMenu(); openZukan(); }}>図鑑</button>
      </nav>
      <section className="fishing-menu-equipment" aria-labelledby="fishing-equipment-title">
        <h3 id="fishing-equipment-title">次のキャストの準備</h3>
        <EquipmentControls />
      </section>
      <section className="fishing-menu-season" aria-labelledby="fishing-season-title">
        <h3 id="fishing-season-title">季節</h3>
        <SeasonPicker onChange={onSeasonChange} />
      </section>
      <button type="button" className="fishing-menu-return" onClick={closeMenu}>釣りに戻る</button>
    </dialog>
  </>;
}
