import { useCallback, useEffect, useState } from 'react';
import { useGameStore } from './store/gameStore';
import { FishingScene } from './components/FishingScene';
import { ResultOverlay } from './components/ResultOverlay';
import { GyotakuReveal } from './components/GyotakuReveal';
import { Zukan } from './components/Zukan';
import { ExchangeShop, EconomyHud, TransactionStatus } from './components/ExchangeShop';
import { LaunchIntro } from './components/LaunchIntro';
import { setBgmDucked, setBgmSeason, startBgm } from './engine/bgm';
import './styles/observatory.css';
import './App.css';

function App() {
  const [arrived, setArrived] = useState(false);
  const enterFishing = useCallback(() => {
    // スキップのクリック中にも呼ばれるので、その操作でAudioContextを解禁してBGMを始められる
    try { startBgm(useGameStore.getState().season); } catch { /* 音が出せなくても釣りは続けられる */ }
    setArrived(true);
  }, []);
  const phase = useGameStore((s) => s.phase);
  const season = useGameStore((s) => s.season);
  const currentEntry = useGameStore((s) => s.currentEntry);
  const isNewSpecies = useGameStore((s) => s.isNewSpecies);
  const returnToIdle = useGameStore((s) => s.returnToIdle);
  const loadCatalog = useGameStore((s) => s.loadCatalog);
  const openZukan = useGameStore((s) => s.openZukan);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  // BGMは季節に合わせて移ろい、巻き上げ・結果・魚拓演出の間は効果音を聞かせるため控えめにする
  useEffect(() => {
    setBgmSeason(season);
  }, [season]);
  useEffect(() => {
    setBgmDucked(phase === 'reeling' || phase === 'result' || phase === 'gyotaku');
  }, [phase]);

  if (!arrived) {
    return <div className="app-root"><LaunchIntro onComplete={enterFishing} /></div>;
  }

  return (
    <div className="app-root fishing-arrival">
      <FishingScene />
      <ResultOverlay />

      {phase === 'gyotaku' && currentEntry && (
        <GyotakuReveal
          key={currentEntry.id}
          entry={currentEntry}
          doneLabel="海に戻る"
          registeredNote={isNewSpecies ? '図鑑に登録されました' : undefined}
          onDone={returnToIdle}
        />
      )}

      <Zukan />
      <ExchangeShop />
      <EconomyHud />
      <TransactionStatus />

      {phase === 'idle' && (
        <button type="button" className="zukan-fab" onClick={openZukan}>
          図鑑
        </button>
      )}
    </div>
  );
}

export default App;
