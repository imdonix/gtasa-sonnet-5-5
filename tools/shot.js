// Headless screenshot / test harness.
// Usage: node tools/shot.js <url> <out.png> [--wait ms] [--w 1280] [--h 720] [--eval "js to run in page before shot"] [--evalwait ms]
// Prints console messages, page errors. Requires the dev server running (node server.js 8080).
const puppeteer = require('puppeteer-core');
const args = process.argv.slice(2);
const url = args[0], out = args[1] || 'shot.png';
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium', headless: 'new',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
           '--autoplay-policy=no-user-gesture-required', '--enable-webgl', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: +opt('w', 1280), height: +opt('h', 720) });
  page.on('console', m => console.log('[console.' + m.type() + ']', m.text()));
  page.on('pageerror', e => console.log('[pageerror]', e.message, (e.stack||'').split('\n').slice(0,4).join(' | ')));
  page.on('requestfailed', r => console.log('[requestfailed]', r.url()));
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await new Promise(r => setTimeout(r, +opt('wait', 3000)));
  const ev = opt('eval', null);
  if (ev) {
    try { const r = await page.evaluate(ev); if (r !== undefined) console.log('[eval result]', JSON.stringify(r)); } catch (e) { console.log('[eval error]', e.message); }
    await new Promise(r => setTimeout(r, +opt('evalwait', 1500)));
  }
  await page.screenshot({ path: out });
  await browser.close();
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
