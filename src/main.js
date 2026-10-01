import { Game } from './game.js';
const game = new Game();
game.boot().catch(e => {
  console.error('BOOT FAILED', e);
  const t = document.getElementById('loadtxt'); if (t) { t.style.color = '#f66'; t.textContent = 'Failed to start: ' + (e && e.message || e); }
});
window.addEventListener('unhandledrejection', e => { if (e.reason && (e.reason.isAbort || e.reason.isFail)) e.preventDefault(); });
