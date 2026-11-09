// 使用独立本地浏览器截图，不读取或操作生产数据。
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const results = {};
    for (const name of ['capture-layout', 'capture-rules']) {
      const capture = eval('(' + fs.readFileSync(path.join(__dirname, name + '.cjs'), 'utf8') + ')');
      results[name] = await capture(page);
    }
    const heading = await page.getByRole('heading', { name: "Meet This Year's Nominees", exact: true }).textContent();
    results.mainHeading = heading;
    fs.writeFileSync(path.join(__dirname, 'validation.json'), JSON.stringify(results, null, 2) + '\n');
    console.log('PASS: title, exact Individual/Team rules, switching, numbered white rules, three viewport sizes, full-page screenshots');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
