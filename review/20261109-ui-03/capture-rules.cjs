async (page) => {
  // 本地验收使用演示数据，不读取生产账号、提名或附件。
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const origin = 'http://127.0.0.1:4176';
  const user = { id: 'review-user', name: 'Review Nominator', email: 'reviewer@example.test', role: 'participant', skills: [] };
  const award = { id: 'review-award', title: '2026 Digital Pioneer Award', status: 'running', tags: [], prizes: [] };
  const paged = content => ({ content, totalPages: 1, totalElements: content.length, number: 0, size: 100 });
  const nomination = type => ({
    id: 'review-' + type, title: type === 'team' ? 'Customer Service Improvement Team' : 'Review Nominator',
    description: 'Executive Summary (The Elevator Pitch)\nDemonstration of measured customer impact.\n\nDetails Of Your Core Achievement In 2026 And Business Impact (Including Financial Figures)\nReduced waiting time by 20 percent through shared digital workflows.\n\nHow You Demonstrate BD China Culture\nWorked across teams and listened to customer feedback.',
    category: 'Customer Values', hackathonId: award.id, createdBy: user.id, teamId: null,
    tags: ['Demo Tag'], votes: 2, userHasVoted: true, status: 'submitted', attachments: [],
    createdAt: '2026-11-09T08:00:00Z', updatedAt: '2026-11-09T08:00:00Z',
    approvalStatus: 'pending', approvalVersion: 1, approvalHeadName: 'Demo HoD',
    projectAttachments: [{ type: 'nomination', nominationType: type, name: type === 'team' ? 'Customer Service Improvement Team' : user.name,
      url: '', employeeEmail: user.email, nomineeOrgCode: 'BD/Review', nomineePosition: 'Engineer', nominatingHead: 'Demo HoD',
      nominatorName: user.name, projectName: 'Customer Service Improvement Team', coreTeamMembers: 'Member One;Member Two',
      achievementSummary: 'Reduced waiting time and improved customer satisfaction.', teamAchievementImpact: 'Delivered a 20 percent improvement in response time.',
      cultureDemonstration: 'Shared ownership across functions and actively incorporated feedback.' },
    { type: 'screenshot', name: 'Review Photo', url: '/storage/review-photo.svg' },
    { type: 'document', name: 'review-evidence.pdf', url: '/storage/review-evidence.pdf' }],
  });
  const ideas = [nomination('individual'), nomination('team')];
  await page.unrouteAll({ behavior: 'wait' });
  await page.route('**/storage/review-photo.svg', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="450"><rect width="600" height="450" fill="#164874"/><circle cx="300" cy="160" r="72" fill="#a5d9f7"/><path d="M150 410v-70a150 110 0 0 1 300 0v70" fill="#a5d9f7"/><text x="300" y="435" text-anchor="middle" font-family="sans-serif" font-size="22" fill="white">Demo Photo</text></svg>' }));
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body = [];
    if (path.endsWith('/auth/refresh')) body = { accessToken: 'local-review-fixture' };
    else if (path.endsWith('/profiles/me')) body = user;
    else if (path.endsWith('/nomination-eligibility')) body = { canSubmit: true, canReview: true, nominatingHead: 'Demo HoD' };
    else if (path.endsWith('/me/nominations')) body = page.url().includes('/nominate') ? [] : ideas;
    else if (path.endsWith('/me/nomination-approvals')) body = ideas;
    else if (path.endsWith('/hackathons') || path.endsWith('/public/awards')) body = paged([award]);
    else if (/\/ideas\/review-(individual|team)$/.test(path)) body = ideas.find(item => path.endsWith(item.id));
    else if (path.endsWith('/ideas')) body = paged(ideas);
    else if (path.endsWith('/team-members/search')) body = [{ id: 'review-member', name: 'Member One', orgUnit: 'BD/Review' }];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const results = [];
  const first = 'Click "Vote" to submit; click "Submitted" again to withdraw your vote.';
  const second = {
    team: 'You may vote for up to 3 nominees per category.',
    individual: 'You may vote for up to 2 nominees within your department and up to 2 nominees in other departments per category. These two quotas are counted separately.',
  };
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(origin + '/projects?type=individual');
    await page.locator('.dp-selection-title').waitFor();
    for (const type of ['team', 'individual']) {
      const label = type === 'team' ? 'Team' : 'Individual';
      await page.locator('.dp-type-switch').getByRole('button', { name: label, exact: true }).click();
      const rules = page.getByRole('region', { name: 'Voting rules', exact: true });
      await rules.getByText(label + ' Awards — Voting Rules', { exact: true }).waitFor();
      const lines = await rules.locator('li').allTextContents();
      assert(JSON.stringify(lines) === JSON.stringify([first, second[type]]), 'Exact rule text: ' + type);
      assert(await rules.locator('ol').count() === 1, 'Numbered rules');
      const colors = await rules.locator('li').evaluateAll(els => els.map(el => getComputedStyle(el).color));
      assert(colors.every(color => color === 'rgb(255, 255, 255)'), 'White rules');
      await page.evaluate(() => document.fonts.ready);
      await page.locator('.dp-project-card').first().waitFor({ timeout: 10000 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow');
      await page.screenshot({ path: `review/20261109-ui-03/browse-vote-${type}-${width}.png`, fullPage: true, animations: 'disabled' });
      results.push({ type, width, text: lines, whiteText: true, numbered: true, noHorizontalOverflow: true });
    }
  }
  return { passed: true, screenshotsUseDemoData: true, results };
}
