// Renders the trailer soundtrack offline with the game's own synth engine: node tools/trailer_audio.js out.wav
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const OUT = process.argv[2] || 'trailer.wav';
(async () => {
  const browser = await puppeteer.launch({ protocolTimeout: 1800000, executablePath: '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 200)); });
  await page.goto('http://localhost:8080/tools/audiotest.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.AT && window.AT.render, { timeout: 60000 });
  const b64 = await page.evaluate(async () => {
    const SR = 44100, TOTAL = 66;
    const L = new Float32Array(SR * TOTAL), R = new Float32Array(SR * TOTAL);
    const mix = (buf, t0, gain = 1, dur = null) => {
      const l = buf.getChannelData(0), r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l; const o = Math.round(t0 * SR);
      const n = Math.min(l.length, dur ? Math.round(dur * SR) : l.length);
      for (let i = 0; i < n && o + i < L.length; i++) { let g = gain; if (dur) { const f = Math.min(i, n - 1 - i) / (0.15 * SR); if (f < 1) g *= Math.max(0, f); } L[o + i] += l[i] * g; R[o + i] += r[i] * g; }
    };
    const rms = (arr) => { let s = 0; for (let i = 0; i < arr.length; i++) s += arr[i] * arr[i]; return Math.sqrt(s / arr.length); };
    // ---- music (synthwave station), normalised to a fixed loudness
    const music = await AT.render(TOTAL + 2, (a) => { a.radio._offlineRender(1, TOTAL + 2, { seed: 4242 }); });
    const mL = music.buf.getChannelData(0); const target = 0.13; const mg = target / Math.max(1e-6, rms(mL.subarray(SR * 4)));
    mix(music.buf, 0, Math.min(mg, 12));
    // fades on the music handled at the end
    // ---- sfx
    const shotsAt = (name, times, gain, extra = {}) => AT.render(Math.max(...times) + 2, (a) => { for (const t of times) a.play(name, { delay: t, ...extra }); });
    // S2 (6..11): footsteps
    { const ts = []; for (let t = 0.6; t < 3.6; t += 0.36) ts.push(t); for (let t = 3.6; t < 5; t += 0.26) ts.push(t); const r = await shotsAt('footstep_concrete', ts); mix(r.buf, 6, 1.8); }
    // S3 (11..19): engine + drift screech
    { const r = await AT.render(8, (a) => { const e = a.engine('sport'); e.update(0.55, 1, null); e.setVolume(1); }); mix(r.buf, 11, 0.7);
      const s = await AT.render(3, (a) => { a.play('screech', { delay: 0.1 }); }); mix(s.buf, 11 + 4.6, 0.9);
      const h = await AT.render(2, (a) => { a.play('horn', { delay: 0.1, len: 0.3 }); a.play('horn', { delay: 0.6, len: 0.4, pitch: 0.9 }); }); mix(h.buf, 11 + 2.4, 0.6); }
    // S4 (19..27): gunfight
    { const ak = [], pi = []; for (let k = 2; k < 9; k++) { const s = k / 2.2; for (let j = 0; j < 5; j++) ak.push(s + j * 0.1); }
      for (let i = 0; i < 26; i++) pi.push(0.9 + Math.random() * 6.8);
      const a1 = await shotsAt('shot_ak', ak.filter(t => t < 7.9)); mix(a1.buf, 19, 1.0);
      const a2 = await shotsAt('shot_pistol', pi); mix(a2.buf, 19, 0.6);
      const a3 = await shotsAt('hit_flesh', pi.slice(0, 12)); mix(a3.buf, 19, 0.7); }
    // S5 (27..35): siren, engine, heli
    { const r = await AT.render(8, (a) => { a.loop('siren_police', { volume: 0.8 }); }); mix(r.buf, 27, 0.5);
      const e = await AT.render(8, (a) => { const en = a.engine('sport'); en.update(0.75, 1, null); }); mix(e.buf, 27, 0.7);
      const h = await AT.render(8, (a) => { a.loop('heli_rotor', { volume: 1 }); }); mix(h.buf, 27 + 2, 0.5, 6); }
    // S6 (35..41): explosion at 0.9 s plus debris
    { const r = await AT.render(6, (a) => { a.play('explosion', { delay: 0.9 }); a.play('explosion_small', { delay: 1.4 }); a.play('glass_break', { delay: 1.2 }); a.play('car_hit_heavy', { delay: 2.0, volume: 0.5 }); }); mix(r.buf, 35, 1.0); }
    // S7 (41..48): rain + engine
    { const r = await AT.render(7, (a) => { a.loop('rain', { volume: 1 }); }); mix(r.buf, 41, 0.8);
      const e = await AT.render(7, (a) => { const en = a.engine('car'); en.update(0.4, 0.5, null); }); mix(e.buf, 41, 0.6); }
    // S8 (48..54.5): subtle phone ring? keep music only
    // ---- music fades + master limiter
    for (let i = 0; i < L.length; i++) { const t = i / SR; let f = Math.min(1, t / 1.2, (TOTAL - 0.2 - t) / 3.0); if (f < 0) f = 0; L[i] *= f; R[i] *= f; }
    let peak = 0; for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    const g = peak > 0.92 ? 0.92 / peak : 1; const out = new Int16Array(L.length * 2);
    for (let i = 0; i < L.length; i++) { out[2 * i] = Math.max(-32768, Math.min(32767, Math.tanh(L[i] * g * 1.1) * 32000)); out[2 * i + 1] = Math.max(-32768, Math.min(32767, Math.tanh(R[i] * g * 1.1) * 32000)); }
    console.log('music gain', mg.toFixed(2), 'peak', peak.toFixed(2));
    const bytes = new Uint8Array(out.buffer); let s = ''; const CH = 0x8000; for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  });
  const pcm = Buffer.from(b64, 'base64');
  const hdr = Buffer.alloc(44); hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write('WAVEfmt ', 8); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(2, 22); hdr.writeUInt32LE(44100, 24); hdr.writeUInt32LE(44100 * 4, 28); hdr.writeUInt16LE(4, 32); hdr.writeUInt16LE(16, 34); hdr.write('data', 36); hdr.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(OUT, Buffer.concat([hdr, pcm]));
  console.log('wrote', OUT, pcm.length);
  await browser.close();
})().catch(e => { console.error('AUDIO ERROR', e); process.exit(1); });
