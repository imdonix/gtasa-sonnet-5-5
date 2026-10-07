// Context-sensitive "press E to interact" system. Systems register interactables
// (weapon dealers, the safehouse save icon, ...) and the manager shows a prompt and
// dispatches the key press. It is split in two so the prompt is known *before* the
// player processes input (so E near an interactable does not also cycle weapons).
import { G } from './state.js';

export class Interactions {
  constructor() { this.items = []; this.target = null; }
  add(o) { this.items.push(o); return o; }
  remove(o) { const i = this.items.indexOf(o); if (i >= 0) this.items.splice(i, 1); }
  clear() { this.items.length = 0; this.target = null; }
  hasTarget() { return !!this.target; }

  // called at the top of every sim step, before peds/player input
  scan() {
    const pl = G.player; this.target = null;
    if (!pl || pl.dead || G.game.state !== 'play' || G.game.inCutscene || G.paused) { G.interactPrompt = null; return; }
    let best = null, bd = 1e18;
    for (const it of this.items) {
      if (it.enabled === false || it._missing) continue;
      const inVeh = !!pl.vehicle;
      if (it.footOnly && inVeh) continue;
      if (it.vehicleOnly && !inVeh) continue;
      const px = inVeh ? pl.vehicle.x : pl.x, pz = inVeh ? pl.vehicle.z : pl.z;
      const r = it.radius || 2.6;
      const d = (px - it.x) ** 2 + (pz - it.z) ** 2; if (d > r * r) continue;
      if (d < bd) { bd = d; best = it; }
    }
    this.target = best;
    G.interactPrompt = best ? `<kbd>${best.key || 'E'}</kbd> ${best.label}` : null;
  }

  // called after the player has run: dispatch the key if an interactable is targeted
  consume() {
    const it = this.target; if (!it) return;
    const key = it.key || 'KeyE';
    if (G.input.wasPressed(key) || (key === 'KeyE' && G.input.wasPressed('GP_KeyE'))) {
      // consume so the press is not also seen by other systems / repeated sub-steps
      G.input.pressed.delete(key); G.input.pressed.delete('GP_KeyE');
      G.interactPrompt = null; this.target = null;
      try { it.onInteract && it.onInteract(); } catch (e) { console.error('interact', e); }
    }
  }
}
