import { useEffect } from 'react';
import { useGameStore } from './store/gameStore';
import { FishingScene } from './components/FishingScene';
import { ResultOverlay } from './components/ResultOverlay';
import { GyotakuReveal } from './components/GyotakuReveal';
import { Zukan } from './components/Zukan';
import './App.css';

function App() {
  const phase = useGameStore((s) => s.phase);
  const currentEntry = useGameStore((s) => s.currentEntry);
  const isNewSpecies = useGameStore((s) => s.isNewSpecies);
  const returnToIdle = useGameStore((s) => s.returnToIdle);
  const loadCatalog = useGameStore((s) => s.loadCatalog);
  const openZukan = useGameStore((s) => s.openZukan);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  return (
    <div className="app-root">
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

      {phase === 'idle' && (
        <button type="button" className="zukan-fab" onClick={openZukan}>
          図鑑
        </button>
      )}
    </div>
  );
}

export default App;
