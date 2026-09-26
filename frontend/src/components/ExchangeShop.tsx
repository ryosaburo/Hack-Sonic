import { useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { purchaseLimit } from '../engine/economy';
import '../styles/observatory.css';
import './ExchangeShop.css';

const KIND_LABEL: Record<string, string> = {
  consumable: '消耗品・1投分',
  permanent: '永久装備・釣り画面で切替',
  information: '釣り場情報・永続',
};

export function ExchangeShop() {
  const phase = useGameStore(s => s.phase);
  const economy = useGameStore(s => s.economy);
  const products = useGameStore(s => s.products);
  const buy = useGameStore(s => s.buy);
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
            const limit = purchaseLimit(product);
            const soldOut = owned >= limit;
            const insufficient = economy.balance < product.price;
            return <li className={`shop-product ${soldOut ? 'owned' : ''}`} key={product.id}>
              <div className="shop-index">
                <span className="shop-no zk-num">No.{String(i + 1).padStart(2, '0')}</span>
                {product.image_url && <span className="shop-plate"><img src={product.image_url} alt="" className="shop-image" /></span>}
              </div>
              <div className="shop-body">
                <h4 className="shop-name">{product.name}</h4>
                <span className="shop-kind">{KIND_LABEL[product.kind] ?? product.kind}</span>
                <p className="shop-desc">{product.description}</p>
                {product.kind === 'consumable' && <small className="shop-owned">所持数 <span className="zk-num">{owned}</span></small>}
                {limit > 1 && Number.isFinite(limit) && <small className="shop-owned">開示済み <span className="zk-num">{owned} / {limit}</span></small>}
              </div>
              <div className="shop-purchase">
                <span className="shop-price zk-num">{product.price} pt</span>
                <button className="primary-btn" disabled={soldOut || insufficient} onClick={() => void buy(product.id)}>
                  {soldOut ? (limit > 1 ? 'すべて開示済み' : '購入済み') : insufficient ? 'ポイント不足' : '交換する'}
                </button>
              </div>
            </li>;
          })}
        </ol>
      </section>
      {economy.spots.length > 0 && <section className="shop-section shop-spot" aria-labelledby="shop-spots-title">
        <h3 id="shop-spots-title" className="shop-section-title">釣り場情報<span className="shop-section-count zk-num">{economy.spots.length} か所</span></h3>
        <table className="shop-spot-table">
          <thead><tr><th scope="col">釣り場</th><th scope="col">投入点 X</th><th scope="col">投入点 Y</th></tr></thead>
          <tbody>
            {economy.spots.map(spot => <tr key={spot.id}>
              <th scope="row">{spot.name}</th>
              <td className="zk-num">{spot.x_min / 10} — {spot.x_max / 10}</td>
              <td className="zk-num">{-spot.y_max / 10} — {-spot.y_min / 10}</td>
            </tr>)}
          </tbody>
        </table>
        <p className="shop-spot-note">全季節で高レアリティの出現率がアップ。海に戻ると範囲が表示されます。</p>
      </section>}
    </dialog>
  );
}

export function EconomyHud() {
  const s = useGameStore();
  if (s.phase !== 'idle') return null;
  return <div className="economy-hud">
    <button className="secondary-btn" disabled={!s.ready || s.busy} onClick={s.openShop}>交換所 <span className="zk-num">{s.economy.balance} pt</span></button>
    <label><input type="checkbox" checked={s.useLure} disabled={!s.ready || s.busy || !s.economy.inventory.lure} onChange={e => s.setUseLure(e.target.checked)} />
      誘引ルアーを使う（{s.economy.inventory.lure ?? 0}個）</label>
    <label><input type="checkbox" checked={Boolean(s.economy.equipped?.time_extension)} disabled={!s.ready || s.busy || !s.economy.inventory.time_extension} onChange={e => void s.setEquipment('time_extension', e.target.checked)} />
      星時計を装備{!s.economy.inventory.time_extension && '（未所持）'}</label>
    <label><input type="checkbox" checked={Boolean(s.economy.equipped?.power_reel)} disabled={!s.ready || s.busy || !s.economy.inventory.power_reel} onChange={e => void s.setEquipment('power_reel', e.target.checked)} />
      強化リールを装備{!s.economy.inventory.power_reel && '（未所持）'}</label>
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
