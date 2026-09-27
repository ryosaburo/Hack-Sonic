import { useCallback, useEffect, useState } from 'react';
import { useGameStore } from './store/gameStore';
import { FishingScene } from './components/FishingScene';
import { ResultOverlay } from './components/ResultOverlay';
import { GyotakuReveal } from './components/GyotakuReveal';
import { Zukan } from './components/Zukan';
import { ExchangeShop, EconomyHud, TransactionStatus } from './components/ExchangeShop';
import { LaunchIntro } from './components/LaunchIntro';
import { setBgmDucked, setBgmSeason, startBgm } from './engine/bgm';
import { readResume } from './engine/resume';
import { initAudio } from './engine/audio';
import { AccountPanel } from './components/AccountPanel';
import { pullServerResume, useAccount, watchAuth } from './auth/account';
import { accessToken, supabase } from './auth/supabase';
import './styles/observatory.css';
import './App.css';

function playBgm() {
  try { startBgm(useGameStore.getState().season); } catch { /* 音が出せなくても釣りは続けられる */ }
}

function App() {
  // 一度釣り場に着いていれば、再読込しても出発演出を挟まず釣り場から再開する
  const [resumed, setResumed] = useState(() => readResume() !== null);
  const [arrived, setArrived] = useState(resumed);
  // ログイン中は、別の端末で進めた続きをサーバーから受け取るまで画面を出さない
  const [booting, setBooting] = useState(() => supabase !== null);
  const enterFishing = useCallback(() => {
    // スキップのクリック中にも呼ばれるので、その操作でAudioContextを解禁してBGMを始められる
    playBgm();
    setArrived(true);
  }, []);
  const phase = useGameStore((s) => s.phase);
  const season = useGameStore((s) => s.season);
  const currentEntry = useGameStore((s) => s.currentEntry);
  const isNewSpecies = useGameStore((s) => s.isNewSpecies);
  const returnToIdle = useGameStore((s) => s.returnToIdle);
  const loadCatalog = useGameStore((s) => s.loadCatalog);
  const openZukan = useGameStore((s) => s.openZukan);
  const signedIn = useAccount((s) => s.email !== null);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  useEffect(() => watchAuth(), []);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    void (async () => {
      try {
        // サーバーが起動中などで遅いときは待たずに、端末に残っている続きから始める
        const resume = (await accessToken()) ? await pullServerResume(2500) : null;
        if (resume && !cancelled) {
          useGameStore.setState({ season: resume.season });
          setResumed(true);
          setArrived(true);
        }
      } catch { /* 端末の続きから始める */ }
      if (!cancelled) setBooting(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // 再開時は自動再生の制限があるので、操作を待ってからBGMを始める。
  // スマホのタッチ開始など音を解禁できない操作もあるため、実際に鳴り始めるまで操作のたびに試す
  useEffect(() => {
    if (!resumed) return;
    const events = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const;
    const stop = () => events.forEach((type) => window.removeEventListener(type, start, true));
    function start() {
      playBgm();
      let audio: AudioContext;
      try { audio = initAudio(); } catch { stop(); return; }
      if (audio.state === 'running') stop();
      else void audio.resume().then(() => { if (audio.state === 'running') stop(); }, () => {});
    }
    events.forEach((type) => window.addEventListener(type, start, true));
    return stop;
  }, [resumed]);

  // BGMは季節に合わせて移ろい、巻き上げ・結果・魚拓演出の間は効果音を聞かせるため控えめにする
  useEffect(() => {
    setBgmSeason(season);
  }, [season]);
  useEffect(() => {
    setBgmDucked(phase === 'reeling' || phase === 'result' || phase === 'gyotaku');
  }, [phase]);

  if (booting) return <div className="app-root" />;

  if (!arrived) {
    return <div className="app-root"><LaunchIntro onComplete={enterFishing} /><AccountPanel /></div>;
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
      {phase === 'idle' && supabase && (
        <button type="button" className="account-fab" onClick={() => useAccount.getState().openPanel()}>
          {signedIn ? 'アカウント' : 'ログイン'}
        </button>
      )}
      <AccountPanel />
    </div>
  );
}

export default App;
