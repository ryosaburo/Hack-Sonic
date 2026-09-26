import { useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import '../styles/observatory.css';
import './ExchangeShop.css';

const KIND_LABEL: Record<string, string> = {
  consumable: '消耗品・1投分',
  permanent: '永久装備・手動切替',
  information: '釣り場情報・永続',
};

export function ExchangeShop() {
  const phase = useGameStore(s => s.phase);
  const economy = useGameStore(s => s.economy);
  const products = useGameStore(s => s.products);
  const buy = useGameStore(s => s.buy);
  const setEquipment = useGameStore(s => s.setEquipment);
  const error = useGameStore(s => s.error);
  const dismissError = useGameStore(s => s.dismissError);
  const closeShop = useGameStore(s => s.closeShop);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (phase === 'shop') dialog.current?.showModal();
    else dialog.current?.close();
  }, [phase]);
  return (
    <dialog ref={dialog} className="exchange-shop" aria-labelledby="shop-title" onCancel={closeShop}>
      <header className="shop-header">
        <h2 id="shop-title" className="shop-title">星の交換所<span className="shop-subtitle">観測機材目録</span></h2>
        <button className="close-btn" onClick={closeShop} aria-label="交換所を閉じる">閉じる</button>
      </header>
      <p className="shop-balance">所持ポイント <strong className="zk-num">{economy.balance} pt</strong></p>
      <p className="shop-intro">記録済みの天体を釣ってポイントを集め、次の釣りに備えよう。</p>
      {error && <p className="shop-error" role="alert">{error} <button className="close-btn" onClick={dismissError}>閉じる</button></p>}
      <section className="shop-section" aria-labelledby="shop-products-title">
        <h3 id="shop-products-title" className="shop-section-title">目録<span className="shop-section-count zk-num">{products.length} 品</span></h3>
        <ol className="shop-products">
          {products.map((product, i) => {
            const owned = economy.inventory[product.id] ?? 0;
            const permanentOwned = product.kind !== 'consumable' && owned > 0;
            const insufficient = economy.balance < product.price;
            const gearId = product.id === 'time_extension' || product.id === 'power_reel' ? product.id : null;
            const equipped = gearId ? Boolean(economy.equipped?.[gearId]) : false;
            return <li className={`shop-product ${permanentOwned ? 'owned' : ''}`} key={product.id}>
              <span className="shop-no zk-num">No.{String(i + 1).padStart(2, '0')}</span>
              <div className="shop-body">
                <h4 className="shop-name">{product.name}</h4>
                <span className="shop-kind">{KIND_LABEL[product.kind] ?? product.kind}</span>
                <p className="shop-desc">{product.description}</p>
                {product.kind === 'consumable' && <small className="shop-owned">所持数 <span className="zk-num">{owned}</span></small>}
              </div>
              <div className="shop-purchase">
                <span className="shop-price zk-num">{product.price} pt</span>
                <button className="primary-btn" disabled={permanentOwned || insufficient} onClick={() => void buy(product.id)}>
                  {permanentOwned ? '購入済み' : insufficient ? 'ポイント不足' : '交換する'}
                </button>
                {gearId && owned > 0 && <button
                  className="shop-equip-btn"
                  type="button"
                  aria-label={`${product.name}を${equipped ? '外す' : '装備する'}`}
                  aria-pressed={equipped}
                  onClick={() => void setEquipment(gearId, !equipped)}
                >{equipped ? '装備中 · 外す' : '装備する'}</button>}
              </div>
            </li>;
          })}
        </ol>
      </section>
      {economy.spots.map(spot => <section className="shop-section shop-spot" key={spot.id} aria-labelledby={`shop-spot-${spot.id}`}>
        <h3 id={`shop-spot-${spot.id}`} className="shop-section-title">{spot.name}の情報</h3>
        <dl className="shop-spot-specs">
          <dt>投入点 X</dt><dd className="zk-num">{spot.x_min / 10} — {spot.x_max / 10}</dd>
          <dt>投入点 Y</dt><dd className="zk-num">{-spot.y_max / 10} — {-spot.y_min / 10}</dd>
        </dl>
        <p className="shop-spot-note">全季節で高レアリティの出現率がアップ。海に戻ると範囲が表示されます。</p>
      </section>)}
    </dialog>
  );
}

export function EconomyHud() {
  const s = useGameStore();
  if (s.phase !== 'idle') return null;
  return <div className="economy-hud">
    <button className="secondary-btn" disabled={!s.ready || s.busy} onClick={s.openShop}>交換所 · {s.economy.balance} pt</button>
    <label><input type="checkbox" checked={s.useLure} disabled={!s.ready || s.busy || !s.economy.inventory.lure} onChange={e => s.setUseLure(e.target.checked)} />
      誘引ルアーを使う（{s.economy.inventory.lure ?? 0}個）</label>
    {(s.economy.inventory.time_extension > 0 || s.economy.inventory.power_reel > 0) && <small>
      装備中：{[s.economy.equipped?.time_extension && '星時計', s.economy.equipped?.power_reel && '強化リール'].filter(Boolean).join('・') || 'なし'}（交換所で切替）
    </small>}
  </div>;
}

export function TransactionStatus() {
  const s = useGameStore();
  if (s.phase === 'pending') return <div className="overlay-backdrop transaction-status" role="status">
    <div className="result-card"><p>{s.busy ? '確認しています…' : s.error}</p>
      {!s.busy && <button className="primary-btn" onClick={() => void s.retryPending()}>結果を再確認する</button>}
    </div>
  </div>;
  if (!s.error || s.phase === 'shop') return null;
  return <div className="economy-error" role="alert"><span>{s.error}</span><button onClick={s.dismissError}>閉じる</button></div>;
}
