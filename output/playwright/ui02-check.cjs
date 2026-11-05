async (page) => {
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const user = { id: 'demo-user', name: 'Demo Nominator', email: 'demo@example.com', role: 'participant', skills: [] };
  const award = { id: 'demo-award', title: '2026 Digital Pioneer Award', status: 'running', tags: [], prizes: [] };
  const paged = content => ({ content, totalPages: 1, totalElements: content.length, number: 0, size: 100 });
  const lookups = [];
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    let body = [];
    if (path.endsWith('/auth/refresh')) body = { accessToken: 'local-browser-fixture' };
    else if (path.endsWith('/profiles/me')) body = user;
    else if (path.endsWith('/nomination-eligibility')) body = { canSubmit: true, canReview: false, nominatingHead: 'Demo' };
    else if (path.endsWith('/team-members/search')) {
      lookups.push(url.searchParams.get('q'));
      body = [{ id: '69a080f1-082a-5a63-a9a8-2d58654c2401', name: 'WANG Weimin', orgUnit: 'BD/SLP-CO' }];
    }
    else if (path.endsWith('/hackathons') || path.endsWith('/public/awards')) body = paged([award]);
    else if (path.endsWith('/ideas')) body = paged([]);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const results = [];
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [path, title, after] of [
      ['/overview', '#award-categories-title', '.dp-track-grid'],
      ['/nominate?type=team', '#track-choice-title', '.dp-nomination-tracks'],
      ['/projects?type=team', '.dp-selection-title', '.dp-voting-rules'],
    ]) {
      await page.goto('http://127.0.0.1:4174' + path);
      const heading = page.locator(title), toggle = page.locator('.dp-type-switch');
      await heading.waitFor();
      const a = await heading.boundingBox(), b = await toggle.boundingBox(), c = await page.locator(after).boundingBox();
      const titleSize = await heading.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
      const buttonSize = await toggle.locator('button').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize));
      const buttons = await toggle.locator('button').evaluateAll(els => els.map(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height, textFits: el.scrollWidth <= el.clientWidth + 2 })));
      assert(a && b && c && b.y >= a.y + a.height + 16 && c.y >= b.y + b.height + 16, 'Vertical spacing ' + path + '/' + width);
      assert(Math.abs(b.x - a.x) < 2 && b.width >= Math.min(450, width - 90), 'Left alignment / width');
      assert(buttonSize < titleSize && buttonSize >= 18, 'Title hierarchy ' + path + '/' + width + ': ' + buttonSize + '/' + titleSize);
      assert(buttons.every(button => button.height >= 52 && button.textFits), 'Button clipping');
      assert(Math.abs(buttons[0].width - buttons[1].width) < 2, 'Unequal type widths');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Page overflow');
      results.push({ width, path, titleSize, buttonSize, switchWidth: b.width });
      await toggle.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `output/playwright/ui02-${path.split('?')[0].slice(1)}-${width}.png` });
      if (path.startsWith('/nominate')) {
        await page.getByRole('radio', { name: /Customer Values/ }).click();
        const input = page.getByRole('textbox', { name: 'Core Team Member', exact: true });
        await input.fill('Existing Member;wang weimin');
        await page.getByRole('option', { name: /WANG Weimin.*BD\/SLP-CO/ }).waitFor();
        assert(lookups.includes('wang weimin'), 'Wrong search endpoint/query');
        await page.screenshot({ path: `output/playwright/ui02-members-${width}.png` });
        await page.getByRole('option', { name: /WANG Weimin.*BD\/SLP-CO/ }).click();
        assert(await input.inputValue() === 'Existing Member;WANG Weimin', 'Selection replaced other members');
      }
    }
  }
  return results;
}
