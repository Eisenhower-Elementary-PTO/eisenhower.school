// Bingo feedback for the card checker: a buzzer you can feel and hear.
//
// Browsers give a page no direct line to the phone's buzzer, so this layers
// three best-effort routes and never throws:
//   1. `navigator.vibrate` (Android Chrome/Firefox; iOS Safari has no such API).
//   2. A Web Audio buzzer tone, which works everywhere once the page has had a
//      user gesture (so the context is unlocked by the first tap, see `arm`).
//   3. On iOS 17.4+, toggling a hidden `<input type="checkbox" switch>` makes
//      Safari fire a haptic tick. A hack Apple could change, and it may need a
//      gesture, so it is a bonus only.

const PATTERN_MS = [250, 90, 250, 90, 450];

let ctx: AudioContext | null = null;
let armed = false;
let hapticInput: HTMLInputElement | null = null;

function audioContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Unlock audio (and the iOS haptic input) on the first touch. Call once at
 *  startup. Browsers refuse to make sound before a user gesture. */
export function armBuzzer(): void {
  if (armed) return;
  armed = true;
  const unlock = (): void => {
    const c = audioContext();
    if (c && c.state === "suspended") void c.resume().catch(() => {});
    if (!hapticInput) {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.setAttribute("switch", "");
      input.setAttribute("aria-hidden", "true");
      input.tabIndex = -1;
      input.style.cssText = "position:fixed;left:-100px;top:-100px;opacity:0;pointer-events:none";
      document.body.appendChild(input);
      hapticInput = input;
    }
  };
  for (const ev of ["pointerdown", "touchend", "keydown"] as const) {
    document.addEventListener(ev, unlock, { once: false, passive: true });
  }
}

function playTone(): void {
  const c = audioContext();
  if (!c) return;
  if (c.state === "suspended") void c.resume().catch(() => {});
  let at = c.currentTime;
  for (let i = 0; i < PATTERN_MS.length; i += 2) {
    const len = (PATTERN_MS[i] ?? 0) / 1000;
    const gap = (PATTERN_MS[i + 1] ?? 0) / 1000;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = 180; // a low, game-show buzzer
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.6, at + 0.02);
    gain.gain.setValueAtTime(0.6, at + len - 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + len);
    osc.connect(gain).connect(c.destination);
    osc.start(at);
    osc.stop(at + len + 0.02);
    at += len + gap;
  }
}

function iosHaptic(): void {
  if (!hapticInput) return;
  let n = 0;
  const id = window.setInterval(() => {
    hapticInput?.click();
    if (++n >= 4) clearInterval(id);
  }, 120);
}

/** Fire the bingo buzz. Safe to call anywhere: every route is optional. */
export function buzzBingo(): void {
  try {
    navigator.vibrate?.(PATTERN_MS);
  } catch {
    // Vibration refused (no gesture yet, or unsupported).
  }
  try {
    playTone();
  } catch {
    // Audio unavailable.
  }
  try {
    iosHaptic();
  } catch {
    // Haptic hack unavailable.
  }
}
