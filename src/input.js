// Keyboard / mouse / gamepad input abstraction.
import { G } from './state.js';
import { clamp } from './util.js';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set(); this.pressed = new Set(); this.released = new Set();
    this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0;
    this.buttons = new Set(); this.btnPressed = new Set();
    this.locked = false;
    this.enabled = true;
    this.gp = null; this.gpPrev = {};
    this.lookX = 0; this.lookY = 0;
    window.addEventListener('keydown', e => {
      if (!this.enabled) return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'F1' || e.code === 'F2' || e.code === 'F3' || e.code === 'F4' || e.code === 'F5' || e.code === 'F7' || e.code === 'F8') e.preventDefault();
      if (!e.repeat) { this.pressed.add(e.code); }
      this.down.add(e.code);
    });
    window.addEventListener('keyup', e => { this.down.delete(e.code); this.released.add(e.code); });
    window.addEventListener('blur', () => { this.down.clear(); this.buttons.clear(); });
    canvas.addEventListener('mousedown', e => { if (!this.enabled) return; this.buttons.add(e.button); this.btnPressed.add(e.button); e.preventDefault(); });
    window.addEventListener('mouseup', e => { this.buttons.delete(e.button); });
    window.addEventListener('mousemove', e => { if (this.locked) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; } });
    window.addEventListener('wheel', e => { if (this.enabled) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked && G.game && G.game.running && !G.paused && !G.game.suppressPause) G.game.pause(true);
    });
  }
  lock() { if (!this.locked && this.canvas.requestPointerLock) { try { const r = this.canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { } } }
  unlock() { if (document.exitPointerLock) document.exitPointerLock(); }
  isDown(c) { return this.down.has(c); }
  wasPressed(c) { return this.pressed.has(c) || this.pressed.has('GP_' + c); }
  btn(b) { return this.buttons.has(b); }
  btnDown(b) { return this.btnPressed.has(b); }
  any(...codes) { for (const c of codes) if (this.down.has(c)) return true; return false; }
  anyPressed(...codes) { for (const c of codes) if (this.pressed.has(c) || this.pressed.has('GP_' + c)) return true; return false; }

  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null; for (const p of pads) if (p && p.connected) { gp = p; break; }
    this.gp = gp; if (!gp) { this.gpAx = null; return; }
    const dz = v => (Math.abs(v) < 0.18 ? 0 : v);
    this.gpAx = { lx: dz(gp.axes[0]), ly: dz(gp.axes[1]), rx: dz(gp.axes[2]), ry: dz(gp.axes[3]), lt: gp.buttons[6]?.value || 0, rt: gp.buttons[7]?.value || 0 };
    const b = i => !!(gp.buttons[i] && gp.buttons[i].pressed);
    const map = { 0: 'Space', 2: 'KeyF', 1: 'KeyC', 3: 'Tab', 4: 'KeyQ', 5: 'KeyE', 9: 'Escape', 8: 'KeyM', 12: 'ArrowUp', 13: 'ArrowDown', 14: 'ArrowLeft', 15: 'ArrowRight' };
    for (const i in map) { const now = b(+i), prev = !!this.gpPrev[i]; if (now && !prev) this.pressed.add('GP_' + map[i]); this.gpPrev[i] = now; }
    this.gpBtn = { a: b(0), x: b(2), b: b(1), y: b(3), lb: b(4), rb: b(5), l3: b(10), r3: b(11) };
  }

  // per-frame abstracted axes
  get moveX() { let v = (this.isDown('KeyD') || this.isDown('ArrowRight') ? 1 : 0) - (this.isDown('KeyA') || this.isDown('ArrowLeft') ? 1 : 0); if (this.gpAx) v += this.gpAx.lx; return clamp(v, -1, 1); }
  get moveY() { let v = (this.isDown('KeyW') || this.isDown('ArrowUp') ? 1 : 0) - (this.isDown('KeyS') || this.isDown('ArrowDown') ? 1 : 0); if (this.gpAx) v -= this.gpAx.ly; return clamp(v, -1, 1); }
  get fireHeld() { return this.btn(0) || (this.gpAx && this.gpAx.rt > 0.5); }
  get aimHeld() { return this.btn(2) || (this.gpAx && this.gpAx.lt > 0.5); }

  consumeMouse() {
    const s = 0.0022 * (G.settings.sens || 1);
    let dx = this.mouseDX * s, dy = this.mouseDY * s;
    if (this.gpAx) { dx += this.gpAx.rx * 0.045 * (G.settings.sens || 1); dy += this.gpAx.ry * 0.03 * (G.settings.sens || 1); }
    this.mouseDX = this.mouseDY = 0; return [dx, dy];
  }
  endFrame() { this.pressed.clear(); this.released.clear(); this.btnPressed.clear(); this.wheel = 0; }
}
