export interface Settings { sound: boolean; reduced: boolean; fourColor: boolean; cardFace: number }
export interface Profile { name: string; avatar: number; back: number }

function load<T>(key: string, d: T): T {
  try { return { ...d, ...JSON.parse(localStorage.getItem(key) ?? '{}') }; } catch { return d; }
}
export function store(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ }
}

const prefersReduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const settings: Settings = load('pp.settings', { sound: true, reduced: prefersReduced, fourColor: false, cardFace: 0 });
export const saveSettings = () => store('pp.settings', settings);

export const profile: Profile = load('pp.profile', { name: '', avatar: Math.floor(Math.random() * 8), back: Math.floor(Math.random() * 12) });
export const saveProfile = () => store('pp.profile', profile);
