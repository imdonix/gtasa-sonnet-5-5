// Foot-slide numeric test: node tools/qa_vis_slide.js   (needs dev server on :8080)
// For each (state,speed) walks a rig along +Z at that speed and measures the world velocity of the lowest (stance) foot.
const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto('http://localhost:8080/tools/test.html');
  const res = await page.evaluate(async () => {
    const THREE = await import('three');
    const { PedRig, randomAppearance } = await import('/src/models_peds.js');
    const out = [];
    const cases = [['walk', 0.6], ['walk', 1.0], ['walk', 1.3], ['walk', 2.0], ['walk', 2.5], ['run', 2.7], ['run', 3.3], ['run', 4.1], ['run', 4.8], ['sprint', 5.0], ['sprint', 6.6], ['sprint', 7.5], ['crouch', 1.0], ['crouch', 1.9]];
    const fw = new THREE.Vector3();
    for (const w of [null, 'pistol', 'ak47']) for (const [st, sp] of cases) {
      const rig = new PedRig(randomAppearance(Math.random, { role: 'civ', gender: 'm' })); if (w) rig.setWeapon(w);
      rig.setState(st); let z = 0; const dt = 1 / 60;
      for (let i = 0; i < 90; i++) { rig.group.position.z = z; rig.update(dt, { speed: sp, aiming: false }); z += sp * dt; }
      let prev = null, vals = [], flight = 0, tot = 0, pen = 0, hov = [];
      for (let i = 0; i < 240; i++) {
        rig.group.position.z = z; rig.update(dt, { speed: sp, aiming: false }); z += sp * dt; rig.group.updateMatrixWorld(true);
        // sole contact: mid-sole point of each foot (mid-stance is what the eye tracks)
        const f = ['lKnee', 'rKnee'].map(k => { let best = null; for (const lz of [0.04]) { rig.p[k].localToWorld(fw.set(0, -0.47, lz)); if (!best || fw.y < best.y) best = { y: fw.y, z: fw.z }; } return best; });
        pen = Math.min(pen, f[0].y, f[1].y);
        if (prev) { tot++; let best = null; for (let k = 0; k < 2; k++) if (f[k].y < 0.035) { const v = Math.abs((f[k].z - prev[k].z) / dt); if (best === null || v < best) best = v; } if (best === null) { flight++; hov.push(Math.min(f[0].y, f[1].y)); } else vals.push(best); }
        prev = f;
      }
      vals.sort((x, y) => x - y); const mean = vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : 0;
      out.push(`${w || 'none'}\t${st}\t${sp}\tplanted-sole world speed mean ${mean.toFixed(2)} p90 ${(vals[Math.floor(vals.length * 0.9)] || 0).toFixed(2)} max ${(vals[vals.length - 1] || 0).toFixed(2)} m/s | flight ${(flight / tot * 100).toFixed(0)}% | min sole y ${pen.toFixed(3)}`);
      rig.dispose();
    }
    return out;
  });
  console.log(res.join('\n'));
  await browser.close();
})();
