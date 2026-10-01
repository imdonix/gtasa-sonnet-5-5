// numeric: weapon userData.muzzle vs model bbox tip, per weapon.   node tools/qa_vis_weaponcheck.js
const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage(); await page.goto('http://localhost:8080/tools/test.html');
  console.log((await page.evaluate(async () => {
    const THREE = await import('three'); const { createWeaponModel, WEAPON_DEFS } = await import('/src/models_weapons.js'); const out = [];
    for (const id of Object.keys(WEAPON_DEFS)) { if (id === 'fist') continue; const g = createWeaponModel(id); const b = new THREE.Box3().setFromObject(g); const m = g.userData.muzzle;
      out.push(`${id.padEnd(10)} bbox z ${b.min.z.toFixed(2)}..${b.max.z.toFixed(2)} y ${b.min.y.toFixed(2)}..${b.max.y.toFixed(2)} muzzle ${m ? [m.x, m.y, m.z].map(v => v.toFixed(2)).join(',') : '-'} twoHanded ${!!g.userData.twoHanded}`); }
    return out.join('\n'); })));
  await browser.close();
})();
