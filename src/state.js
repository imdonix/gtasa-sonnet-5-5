// Global game state registry. Modules attach themselves here (G.world, G.player, ...).
export const G = {
  time: 0,           // game-time seconds since start (unpaused)
  paused: false,
  settings: { volume: 0.8, music: 0.7, sfx: 0.9, sens: 1.0, shadows: true, viewDist: 4, invertY: false, lockOn: true, hudScale: 1, fov: 70, quality: 'high' },
};
