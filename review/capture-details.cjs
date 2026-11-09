async (page) => {
  // 复用本地演示路由，检查投票详情的照片、正文、附件布局。
  const results = [];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1200 : 1000 });
    for (const type of ['team', 'individual']) {
      await page.goto('http://127.0.0.1:4176/projects?type=' + type);
      await page.getByRole('button', { name: 'View details', exact: true }).first().click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      await dialog.getByRole('img').first().waitFor();
      if (await dialog.locator('iframe').count()) throw Error('PDF opened by default');
      if (type === 'team' && await dialog.getByRole('heading', { name: 'Tags', exact: true }).count()) throw Error('Team tags still visible');
      const bounds = await dialog.evaluate(el => {
        const image = el.querySelector('.dp-candidate-detail-photo').getBoundingClientRect();
        const text = el.querySelector('.dp-candidate-detail-sections').getBoundingClientRect();
        return { image: { x: image.x, y: image.y, right: image.right, bottom: image.bottom }, text: { x: text.x, y: text.y, right: text.right, bottom: text.bottom } };
      });
      const { image, text } = bounds;
      if (!(image.right <= text.x + 1 || text.right <= image.x + 1 || image.bottom <= text.y + 1 || text.bottom <= image.y + 1)) throw Error('Photo overlaps nomination text');
      const colors = await dialog.locator('.dp-attachment').evaluate(el => Array.from(el.querySelectorAll('p,button,span')).filter(item => item.textContent.trim()).map(item => ({ text: item.textContent.trim(), color: getComputedStyle(item).color })));
      if (colors.some(item => item.color === 'rgb(0, 0, 0)')) throw Error('New attachment text is black');
      await page.screenshot({ path: `review/voting-${type}-detail-${width}.png`, fullPage: true, animations: 'disabled' });
      results.push({ width, type, noOverlap: true, pdfClosed: true, attachmentTextWhite: true });
    }
  }
  return { passed: true, results };
}
