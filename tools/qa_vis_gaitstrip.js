// Side-view gait strips (pedtest page): node tools/qa_vis_gaitstrip.js [state] [speed] [frames] [out-prefix]   -> scratchpad/<prefix>_NN.png and <prefix>_strip.png
const puppeteer = require('puppeteer-core'); const { execSync } = require('child_process');
const S = '/tmp/claude-1001/-home-tamasmagyar-Work-testgame/2244238a-7010-4c23-9327-bbc7bc4690bf/scratchpad/';
const [state = 'walk', speed = '1.3', nf = '8', pre = 'gait'] = process.argv.slice(2);
(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage(); await page.setViewport({ width: 420, height: 420 });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto(`http://localhost:8080/tools/pedtest.html?solo=0&cam=side&ui=0&live=0&state=${state}&speed=${speed}&dist=3.2&ty=0.85&t=2`);
  await new Promise(r => setTimeout(r, 2500));
  const files = []; const period = +(process.env.PERIOD || 1.1);
  for (let i = 0; i < +nf; i++) {
    await page.evaluate((dt, sp) => { const n = Math.round(dt / (1 / 60)); for (const r of window.rigs()) for (let k = 0; k < n; k++) r.update(1 / 60, { speed: sp }); window.renderOnce(); }, period / +nf, +speed);
    const f = `${S}${pre}_${String(i).padStart(2, '0')}.png`; await page.screenshot({ path: f }); files.push(f);
  }
  await browser.close();
  execSync(`python3 /home/tamasmagyar/Work/testgame/tools/qa_vis_sheet.py ${pre}_strip.png 4 420 ${files.join(' ')}`, { stdio: 'inherit' });
})();
