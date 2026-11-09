async (page) => {
  // 先运行 capture-layout.cjs 建立本地演示路由；本脚本不连接生产服务。
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const origin = 'http://127.0.0.1:4176';
  let uploads = 0, submits = 0;
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && path.includes('/storage/upload/')) {
      uploads++;
      return route.fulfill({ json: { key: `review-upload-${uploads}`, url: '/storage/review-photo.svg' } });
    }
    if (request.method() === 'POST' && path.endsWith('/ideas')) {
      submits++;
      return route.fulfill({ json: { ...request.postDataJSON(), id: `review-submitted-${submits}`, createdBy: 'review-user', approvalStatus: 'pending', approvalHeadName: 'Demo HoD', approvalVersion: 1, createdAt: '2026-11-09T08:00:00Z' } });
    }
    return route.fallback();
  });
  await page.setViewportSize({ width: 1440, height: 1800 });
  await page.goto(origin + '/nominate?type=team');
  await page.evaluate(async () => {
    const { NominationDraftStore: store, nominationDraftKey } = await import('/src/services/nominationDraftStore.ts');
    for (const nominationType of ['team', 'individual']) await store.remove(nominationDraftKey({ userId: 'review-user', hackathonId: 'review-award', nominationType }));
  });
  await page.reload();
  const photoBase64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 450;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#164874'; ctx.fillRect(0, 0, 600, 450);
    ctx.fillStyle = '#a5d9f7'; ctx.beginPath(); ctx.arc(300, 160, 72, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(180, 260, 240, 160);
    ctx.fillStyle = 'white'; ctx.font = '24px sans-serif'; ctx.fillText('Review Demo Photo', 190, 440);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const photo = { name: 'review-photo.png', mimeType: 'image/png', buffer: Buffer.from(photoBase64, 'base64') };
  const pdf = { name: 'review-evidence.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 300]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF') };
  const summary = 'Improved customer response time by twenty percent through coordinated digital workflows.';
  const impact = 'The team reduced waiting time, improved service quality and shared the solution with partner teams in 2026.';
  const culture = 'We listened to customers, shared ownership and worked across functions to deliver measurable value.';
  const screenshot = name => page.screenshot({ path: `review/${name}.png`, fullPage: true, animations: 'disabled' });
  const checkPreview = async (dialog, imageName, textHeading) => {
    assert(await dialog.locator('iframe').count() === 0, 'PDF must default to file entry');
    const image = await dialog.getByRole('img', { name: imageName }).boundingBox();
    const heading = await dialog.getByRole('heading', { name: textHeading, exact: true }).boundingBox();
    assert(image && heading && image.y + image.height <= heading.y + 1, 'Photo overlaps text');
    await dialog.getByRole('button', { name: 'Preview Attachment', exact: true }).click();
    await dialog.locator('iframe').waitFor();
    await dialog.getByRole('button', { name: 'Hide Attachment', exact: true }).click();
    assert(await dialog.locator('iframe').count() === 0, 'PDF hide did not close preview');
  };
  await page.getByRole('radio', { name: /Customer Values/ }).click();
  await page.getByLabel('Project Name', { exact: false }).fill('Customer Service Improvement Team');
  await page.getByLabel('Core Team Member', { exact: false }).fill('Member One;Member Two');
  await page.getByLabel(/Achievement Summary/).fill(summary);
  await page.getByLabel(/Details of Your Team Achievement/i).fill(impact);
  await page.getByLabel(/How You Demonstrate BD China Culture/i).fill(culture);
  await page.locator('input[type=file]').nth(0).setInputFiles(photo);
  await page.locator('input[type=file]').nth(1).setInputFiles(pdf);
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
  await page.getByText(/^Draft saved (in|on) this browser/).waitFor();
  await page.reload();
  await page.getByRole('button', { name: 'Open Saved Team Draft', exact: true }).click();
  await page.getByRole('button', { name: 'Restore Draft', exact: true }).click();
  assert(await page.getByLabel(/Project Name/).inputValue() === 'Customer Service Improvement Team', 'Team draft fields lost');
  await page.getByRole('img', { name: 'Team photo preview', exact: true }).waitFor();
  assert(await page.getByText('review-evidence.pdf', { exact: true }).count() > 0, 'Team PDF not restored');
  assert(await page.getByText('Draft restored. Review your information before submitting.', { exact: true }).evaluate(el => getComputedStyle(el).color) === 'rgb(255, 255, 255)', 'Team draft notice must be white');
  await screenshot('team-draft-restored');
  await page.getByRole('button', { name: 'Submit nomination', exact: true }).click();
  const teamDialog = page.getByRole('dialog', { name: 'Review Team Nomination' });
  await teamDialog.waitFor();
  assert(uploads === 0 && submits === 0, 'First team submit performed network writes');
  await checkPreview(teamDialog, 'Team nomination photo', 'Core Team Member');
  await screenshot('team-submit-preview');
  await teamDialog.screenshot({ path: 'review/team-submit-preview-dialog.png', animations: 'disabled' });
  await teamDialog.getByRole('button', { name: 'Back To Edit' }).click();
  assert(await page.getByLabel(/Achievement Summary/).inputValue() === summary, 'Back To Edit lost text');
  await page.getByRole('button', { name: 'Submit nomination', exact: true }).click();
  await teamDialog.getByRole('button', { name: 'Confirm And Submit' }).click();
  await page.getByRole('heading', { name: 'Nomination Submitted Successfully' }).waitFor();
  assert(uploads === 2 && submits === 1, 'Team confirmation did not upload and submit once');
  await screenshot('team-submit-success');
  await page.goto(origin + '/nominate?type=individual');
  await page.getByRole('radio', { name: /Customer Values/ }).click();
  await page.getByLabel(/Executive Summary/).fill(summary);
  await page.getByLabel(/Details Of Your Core Achievement/i).fill(impact);
  await page.getByLabel(/How You Demonstrate BD China Culture/i).fill(culture);
  await page.locator('input[type=file]').nth(0).setInputFiles(photo);
  await page.getByRole('button', { name: 'Confirm crop', exact: true }).click();
  await page.locator('input[type=file]').nth(1).setInputFiles(pdf);
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
  await page.getByText(/^Draft saved (in|on) this browser/).waitFor();
  await page.reload();
  await page.getByRole('button', { name: 'Restore Draft', exact: true }).click();
  assert(await page.getByLabel(/Executive Summary/).inputValue() === summary, 'Individual draft text lost');
  await page.getByRole('img', { name: 'Personal photo preview', exact: true }).waitFor();
  assert(await page.getByText('review-evidence.pdf', { exact: true }).count() > 0, 'Individual PDF not restored');
  await screenshot('individual-draft-restored');
  await page.getByRole('button', { name: 'Submit nomination', exact: true }).click();
  const individualDialog = page.getByRole('dialog', { name: 'Review Individual Nomination' });
  await individualDialog.waitFor();
  assert(uploads === 2 && submits === 1, 'First individual submit performed network writes');
  await checkPreview(individualDialog, 'Nomination Review Photo', 'Executive Summary (The Elevator Pitch)');
  await screenshot('individual-submit-preview');
  await individualDialog.screenshot({ path: 'review/individual-submit-preview-dialog.png', animations: 'disabled' });
  await individualDialog.getByRole('button', { name: 'Confirm And Submit' }).click();
  await page.getByRole('heading', { name: 'Nomination Submitted Successfully' }).waitFor();
  assert(uploads === 4 && submits === 2, 'Individual confirmation did not upload and submit once');
  await screenshot('individual-submit-success');
  const cleared = await page.evaluate(async () => {
    const { NominationDraftStore: store, nominationDraftKey } = await import('/src/services/nominationDraftStore.ts');
    return Promise.all(['team', 'individual'].map(nominationType => store.load(nominationDraftKey({ userId: 'review-user', hackathonId: 'review-award', nominationType }))));
  });
  assert(cleared.every(value => value === null), 'Submitted drafts were not removed');
  return { passed: true, uploads, submits, draftFilesRestored: true, draftCleanup: true, previewOnlyBeforeConfirmation: true };
}
