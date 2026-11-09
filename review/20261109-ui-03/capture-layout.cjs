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
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [name, path, title] of [
      ['overview', '/overview', '#award-categories-title'],
      ['nomination-individual', '/nominate?type=individual', '#track-choice-title'],
      ['nomination-team', '/nominate?type=team', '#track-choice-title'],
      ['voting', '/projects?type=individual', '.dp-selection-title'],
    ]) {
      await page.goto(origin + path);
      await page.locator(title).waitFor();
      await page.evaluate(() => document.fonts.ready);
      const switchGroup = page.locator('.dp-type-switch');
      const buttonHeight = await switchGroup.locator('button').first().evaluate(el => el.getBoundingClientRect().height);
      assert(buttonHeight >= 34 && buttonHeight <= 50, name + ': compact switch height ' + buttonHeight);
      const buttonFont = await switchGroup.locator('button').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize));
      assert(Math.abs(buttonFont - 18.88) < 0.1, name + ': font changed');
      if (name !== 'voting') {
        const lines = await page.locator(name === 'overview' ? '.dp-track-grid > .dp-track' : '.dp-nomination-track').evaluateAll(els => els.map(el => {
          const style = getComputedStyle(el, '::before');
          return { width: parseFloat(style.width), height: parseFloat(style.height), shrink: style.flexShrink };
        }));
        assert(lines.length === 3 && lines.every(line => line.width === 100 && line.height === 4 && line.shrink === '0'), name + ': fixed accent lines');
      }
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ': horizontal overflow');
      await page.screenshot({ path: `review/20261109-ui-03/${name}-${width}.png`, fullPage: true, animations: 'disabled' });
      results.push({ name, width, buttonHeight, buttonFont });
      if (name.startsWith('nomination')) {
        await page.getByRole('radio', { name: /Customer Values/ }).click();
        await page.getByRole('button', { name: 'Save Draft', exact: true }).waitFor();
        await page.screenshot({ path: `review/20261109-ui-03/${name}-form-${width}.png`, fullPage: true, animations: 'disabled' });
      }
    }
    await page.goto(origin + '/profile');
    await page.getByRole('heading', { name: 'Profile', exact: true }).waitFor();
    assert(await page.getByText(user.email, { exact: true }).count() >= 1, 'Full email identity');
    await page.screenshot({ path: `review/20261109-ui-03/profile-${width}.png`, fullPage: true, animations: 'disabled' });
    await page.goto(origin + '/my-nominations?id=review-team');
    await page.getByRole('heading', { name: 'Customer Values', exact: true }).waitFor();
    assert(await page.getByText('Number', { exact: true }).count() === 0, 'Removed number');
    assert(await page.getByText('Requested for', { exact: true }).count() === 0, 'Name label');
    assert(await page.getByText('Demo Tag', { exact: true }).count() === 0, 'Hidden team tags');
    await page.screenshot({ path: `review/20261109-ui-03/my-nomination-detail-${width}.png`, fullPage: true, animations: 'disabled' });
    await page.goto(origin + '/nomination-approvals?id=review-individual');
    await page.getByRole('heading', { name: 'Customer Values', exact: true }).waitFor();
    await page.screenshot({ path: `review/20261109-ui-03/hod-approval-detail-${width}.png`, fullPage: true, animations: 'disabled' });
  }
  return { passed: true, screenshotsUseDemoData: true, results };
}
