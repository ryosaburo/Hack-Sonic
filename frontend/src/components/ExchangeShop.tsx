import { useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import './ExchangeShop.css';

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
        <div><h2 id="shop-title">星の交換所</h2><p>所持ポイント <strong>{economy.balance} pt</strong></p></div>
        <button className="secondary-btn" onClick={closeShop} aria-label="交換所を閉じる">閉じる</button>
      </header>
      <p className="shop-intro">記録済みの天体を釣ってポイントを集め、次の釣りに備えよう。</p>
      {error && <p role="alert">{error} <button onClick={dismissError}>閉じる</button></p>}
      <div className="shop-products">
        {products.map(product => {
          const owned = economy.inventory[product.id] ?? 0;
          const permanentOwned = product.kind !== 'consumable' && owned > 0;
          const insufficient = economy.balance < product.price;
          return <article className="shop-product" key={product.id}>
            <span className="shop-kind">{product.kind === 'consumable' ? '消耗品・1投分' : product.kind === 'permanent' ? '永久装備・自動装備' : '釣り場情報・永続'}</span>
            <h3>{product.name}</h3><p>{product.description}</p>
            <div className="shop-purchase"><span>{product.price} pt</span>
              <button className="primary-btn" disabled={permanentOwned || insufficient} onClick={() => void buy(product.id)}>
                {permanentOwned ? '購入済み' : insufficient ? 'ポイント不足' : '交換する'}
              </button>
            </div>
            {product.kind === 'consumable' && <small>所持数：{owned}</small>}
          </article>;
        })}
      </div>
      {economy.spots.map(spot => <section className="shop-spot" key={spot.id}>
        <h3>{spot.name}の情報</h3>
        <p>投入点の座標：X {spot.x_min / 10}〜{spot.x_max / 10} ／ Y {-spot.y_max / 10}〜{-spot.y_min / 10}</p>
        <p>全季節で高レアリティの出現率がアップ。海に戻ると範囲が表示されます。</p>
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
      装備中：{[s.economy.inventory.time_extension && '星時計', s.economy.inventory.power_reel && '強化リール'].filter(Boolean).join('・')}
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
