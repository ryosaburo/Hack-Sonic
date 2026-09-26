import { initAudio } from './audio';

/** A quiet engine rumble that falls away on arrival. Owns and cleans up only its nodes. */
export function createLaunchAudio() {
  const ctx = initAudio();
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buffer; noise.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass'; filter.frequency.value = 220;
  const volume = ctx.createGain(); volume.gain.value = 0;
  noise.connect(filter); filter.connect(volume); volume.connect(ctx.destination);
  noise.start();
  let stopped = false;
  return {
    update(time: number, audible: boolean) {
      if (stopped) return;
      const ignition = Math.min(1, time / 0.8);
      const cutoff = Math.max(0, 1 - Math.max(0, time - 4.8) / 1.4);
      const cabin = time >= 3.4 ? 0.5 : 1;
      volume.gain.setTargetAtTime(audible ? ignition * cutoff * cabin * 0.32 : 0, ctx.currentTime, 0.08);
      filter.frequency.setTargetAtTime(time < 3.4 ? 240 : 110, ctx.currentTime, 0.12);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      noise.stop(); noise.disconnect(); filter.disconnect(); volume.disconnect();
    },
  };
}
