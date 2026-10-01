// Tiny event bus.
export class Events {
  constructor() { this.h = new Map(); }
  on(name, fn) { let a = this.h.get(name); if (!a) this.h.set(name, a = []); a.push(fn); return () => this.off(name, fn); }
  off(name, fn) { const a = this.h.get(name); if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } }
  emit(name, ...args) { const a = this.h.get(name); if (a) for (const fn of a.slice()) { try { fn(...args); } catch (e) { console.error('event handler error', name, e); } } }
}
