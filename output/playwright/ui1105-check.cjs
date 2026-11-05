async (page) => {
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const user = { id: 'demo-user', name: 'Demo Nominator', email: 'demo@example.com', role: 'participant', skills: [] };
  const award = { id: 'demo-award', title: '2026 Digital Pioneer Award', status: 'running', tags: [], prizes: [] };
  let voted = false, own = false;
  const idea = () => ({ id: 'demo-idea', title: 'Demo Candidate', description: 'Executive Summary\nA measurable result.', hackathonId: award.id,
    createdBy: user.id, teamId: null, category: 'Customer Values', tags: [], attachments: [], votes: voted ? 1 : 0,
    userHasVoted: voted, status: 'submitted', approvalStatus: 'approved', createdAt: '', updatedAt: '',
    projectAttachments: [{ type: 'nomination', nominationType: 'individual', name: 'Demo Candidate', nomineeOrgCode: 'BDCN-IT', url: '' }] });
  const paged = content => ({ content, totalPages: 1, totalElements: content.length, number: 0, size: 100 });
  await page.unroute('**/api/v1/**');
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body = [];
    if (path.endsWith('/auth/refresh')) body = { accessToken: 'local-browser-fixture' };
    else if (path.endsWith('/profiles/me')) body = user;
    else if (path.endsWith('/nomination-eligibility')) body = { canSubmit: true, canReview: false, nominatingHead: 'Demo' };
    else if (path.endsWith('/profiles/search')) body = [{ id: 'demo-member', name: 'Alice Demo', email: 'alice@example.com' }];
    else if (path.endsWith('/me/votes') && route.request().method() === 'POST') voted = true;
    else if (path.endsWith('/me/votes/demo-idea') && route.request().method() === 'DELETE') voted = false;
    else if (path.endsWith('/me/nominations')) body = own ? [idea()] : [];
    else if (path.endsWith('/hackathons') || path.endsWith('/public/awards')) body = paged([award]);
    else if (path.endsWith('/ideas')) body = paged([idea()]);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const checkHeading = async (heading, toggle, cards) => {
    const a = await page.locator(heading).boundingBox();
    const b = await page.locator(toggle).boundingBox();
    const c = await page.locator(cards).boundingBox();
    assert(a && b && c && b.y >= a.y + a.height + 16 && c.y >= b.y + b.height + 16, 'Heading / toggle / cards overlap');
  };
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('http://127.0.0.1:4174/overview');
    await page.getByRole('heading', { name: 'Award categories and criteria', exact: true }).waitFor();
    await checkHeading('#award-categories-title', '.dp-category-heading .mantine-ButtonGroup-group', '.dp-track-grid');
    await page.screenshot({ path: `output/playwright/ui1105-overview-${width}.png`, fullPage: true });
    await page.goto('http://127.0.0.1:4174/nominate?type=team');
    await page.getByRole('radio', { name: /Customer Values/ }).click();
    const members = page.getByRole('textbox', { name: 'Core Team Member', exact: true });
    await members.waitFor();
    await checkHeading('#track-choice-title', '.dp-flow-heading .mantine-ButtonGroup-group', '.dp-nomination-tracks');
    const style = await members.evaluate(el => ({ color: getComputedStyle(el, '::placeholder').color, size: getComputedStyle(el, '::placeholder').fontSize, body: getComputedStyle(el).fontSize, resize: getComputedStyle(el).resize }));
    assert(style.color === 'rgb(183, 191, 204)' && parseFloat(style.size) < parseFloat(style.body) && style.resize === 'vertical', JSON.stringify(style));
    const summary = page.getByRole('textbox', { name: 'Achievement Summary (≤ 200 words)', exact: true });
    await summary.scrollIntoViewIfNeeded();
    const before = await summary.boundingBox();
    await page.mouse.move(before.x + before.width - 4, before.y + before.height - 4);
    await page.mouse.down(); await page.mouse.move(before.x + before.width - 4, before.y + before.height + 70, { steps: 12 }); await page.mouse.up();
    const after = await summary.boundingBox();
    assert(after.height > before.height + 30, `Manual resize failed: ${before.height} -> ${after.height}`);
    assert(await page.getByText('Optional supplementary materials, document size less than 20 MB', { exact: true }).count() === 1, 'Attachment hint missing');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow');
    await page.screenshot({ path: `output/playwright/ui1105-team-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  own = true;
  await page.goto('http://127.0.0.1:4174/nominate?type=individual');
  await page.getByRole('radio', { name: /Customer Values/ }).click();
  await page.getByText('Nomination already submitted', { exact: true }).waitFor();
  assert(await page.locator('.dp-existing-nomination .mantine-Alert-title').evaluate(el => getComputedStyle(el).color) === 'rgb(217, 138, 255)', 'Alert title color');
  assert(await page.locator('.dp-existing-nomination .mantine-Alert-message').evaluate(el => getComputedStyle(el).color) === 'rgb(255, 255, 255)', 'Alert body color');
  await page.screenshot({ path: 'output/playwright/ui1105-submitted.png', fullPage: true });
  await page.goto('http://127.0.0.1:4174/projects?type=individual');
  await page.getByRole('button', { name: 'Vote, 0 votes', exact: true }).click();
  await page.getByRole('button', { name: 'Submitted, 1 votes', exact: true }).waitFor();
  await page.getByRole('button', { name: 'My votes (1)', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Team', exact: true }).click();
  await page.getByPlaceholder(/Search/).fill('no match');
  await page.getByRole('button', { name: 'Locate Demo Candidate', exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.id === 'nominee-card-demo-idea');
  assert(await page.getByRole('button', { name: 'Individual', exact: true }).getAttribute('aria-pressed') === 'true', 'Type not restored');
  assert(await page.getByPlaceholder(/Search/).inputValue() === '', 'Search not cleared');
  await page.screenshot({ path: 'output/playwright/ui1105-voting.png', fullPage: true });
  await page.getByRole('button', { name: 'Submitted, 1 votes', exact: true }).click();
  await page.getByRole('button', { name: 'Vote, 0 votes', exact: true }).waitFor();
  await page.getByRole('button', { name: 'My votes (0)', exact: true }).waitFor();
  console.log(JSON.stringify({ layoutDesktopMobile: 'PASS', placeholder: 'PASS', manualResize: 'PASS', alertColors: 'PASS', voteCancelCart: 'PASS', locateAcrossFilters: 'PASS' }));
}
