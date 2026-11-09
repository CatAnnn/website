// 使用独立无头浏览器验收本机页面，不占用其他浏览器会话。
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const capture = eval('(' + fs.readFileSync(path.join(__dirname, 'capture.cjs'), 'utf8') + ')');
    const result = await capture(page);
    fs.writeFileSync(path.join(__dirname, 'validation.json'), JSON.stringify(result, null, 2) + '\n');
    console.log('PASS: exact Team/Individual rules, switching, numbering, white text, three widths, six full-page screenshots');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
