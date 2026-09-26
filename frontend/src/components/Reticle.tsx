// 未観測の天体を示す照準（点線の輪郭＋十字線＋中心の点）。見た目は styles/observatory.css
export function Reticle({ className }: { className: string }) {
  return (
    <span className={`zk-reticle ${className}`} aria-hidden="true">
      <span className="zk-reticle-dot" />
    </span>
  );
}
