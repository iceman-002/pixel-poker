// WebAudio 8-bit sounds: square/triangle blips and filtered noise, no audio files.
import { settings } from './settings';

export type Sfx = 'deal' | 'flip' | 'chip' | 'check' | 'fold' | 'win' | 'allin' | 'tap' | 'turn' | 'click';
let ac: AudioContext | null = null, master: GainNode | null = null, noise: AudioBuffer | null = null;
const last: Partial<Record<Sfx, number>> = {};

export function unlockAudio() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!ac) {
      ac = new AC();
      master = ac.createGain();
      master.gain.value = 0.22;
      master.connect(ac.destination);
      noise = ac.createBuffer(1, ac.sampleRate * 0.3, ac.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ac.state === 'suspended') void ac.resume();
    // iOS needs a sound started inside the gesture to unlock output.
    const b = ac.createBufferSource();
    b.buffer = ac.createBuffer(1, 1, 22050);
    b.connect(ac.destination);
    b.start();
  } catch { /* no audio */ }
}
addEventListener('pointerdown', unlockAudio);
document.addEventListener('visibilitychange', () => { if (!document.hidden && ac?.state === 'suspended') void ac.resume(); });

function tone(t: number, f0: number, f1: number, dur: number, type: OscillatorType = 'square', vol = 0.5) {
  const o = ac!.createOscillator(), g = ac!.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master!);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function hiss(t: number, dur: number, freq: number, vol = 0.5, q = 1) {
  const s = ac!.createBufferSource(), f = ac!.createBiquadFilter(), g = ac!.createGain();
  s.buffer = noise;
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f).connect(g).connect(master!);
  s.start(t);
  s.stop(t + dur + 0.02);
}

const notes = (t: number, fs: number[], step: number, dur: number, type: OscillatorType = 'square', vol = 0.4) =>
  fs.forEach((f, i) => tone(t + i * step, f, f, dur, type, vol));

export function sfx(name: Sfx, delay = 0) {
  if (!settings.sound || !ac || !master || ac.state !== 'running') return;
  const now = ac.currentTime;
  if ((last[name] ?? 0) > now - 0.03) return; // avoid stacking identical sounds in one frame
  last[name] = now;
  const t = now + delay, r = 1 + (Math.random() - 0.5) * 0.08;
  switch (name) {
    case 'deal': hiss(t, 0.07, 3200 * r, 0.6, 2); break;
    case 'flip': hiss(t, 0.05, 2000 * r, 0.5, 3); tone(t, 900 * r, 1400, 0.04, 'triangle', 0.25); break;
    case 'chip': tone(t, 2400 * r, 1800, 0.04, 'square', 0.18); tone(t + 0.035, 2900 * r, 2100, 0.05, 'square', 0.14); break;
    case 'check': tone(t, 220, 180, 0.05, 'triangle', 0.6); tone(t + 0.08, 220, 180, 0.05, 'triangle', 0.6); break;
    case 'fold': hiss(t, 0.18, 900, 0.4, 0.7); tone(t, 330, 110, 0.15, 'triangle', 0.3); break;
    case 'tap': tone(t, 1200 * r, 1200, 0.03, 'square', 0.15); break;
    case 'click': tone(t, 700, 500, 0.05, 'square', 0.2); break;
    case 'turn': notes(t, [660, 880], 0.08, 0.09, 'triangle', 0.5); break;
    case 'allin': tone(t, 110, 55, 0.4, 'sawtooth', 0.35); hiss(t, 0.35, 300, 0.6, 0.5); notes(t + 0.1, [220, 277, 330, 440], 0.06, 0.1); break;
    case 'win': notes(t, [523, 659, 784, 1047, 784, 1047], 0.09, 0.12, 'square', 0.3); break;
  }
}
