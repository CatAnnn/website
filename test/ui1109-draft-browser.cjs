// 在本机 Vite 页面运行，使用独立测试键验证 IndexedDB 文件跨刷新持久化。
async (page) => {
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+\//.test(page.url())) throw Error('Open the local Vite app first');
  const initial = await page.evaluate(async () => {
    const { NominationDraftStore: store, nominationDraftKey: keyOf } = await import('/src/services/nominationDraftStore.ts');
    const scope = { userId: 'review-draft-only', hackathonId: 'review-campaign-only', nominationType: 'team' };
    const teamKey = keyOf(scope), individualKey = keyOf({ ...scope, nominationType: 'individual' });
    await store.remove(teamKey);
    await store.remove(individualKey);
    const team = await store.save(teamKey, {
      projectName: 'Team Draft Review',
      photo: new File([new Uint8Array([137, 80, 78, 71, 13, 10])], 'review-photo.png', { type: 'image/png', lastModified: 1700000000000 }),
      document: new File(['%PDF-1.4\nDraft attachment'], 'review-evidence.pdf', { type: 'application/pdf', lastModified: 1700000000001 }),
    });
    await store.save(individualKey, { name: 'Individual Draft Review', photo: null, document: null });
    return { savedAt: team.savedAt };
  });
  await page.reload();
  const result = await page.evaluate(async (expected) => {
    const { NominationDraftStore: store, nominationDraftKey: keyOf } = await import('/src/services/nominationDraftStore.ts');
    const scope = { userId: 'review-draft-only', hackathonId: 'review-campaign-only', nominationType: 'team' };
    const teamKey = keyOf(scope), individualKey = keyOf({ ...scope, nominationType: 'individual' });
    const assert = (value, message) => { if (!value) throw Error(message); };
    try {
      const team = await store.load(teamKey), individual = await store.load(individualKey);
      assert(team.version === 1 && team.savedAt === expected.savedAt, 'Draft metadata did not survive reload');
      assert(team.data.projectName === 'Team Draft Review' && individual.data.name === 'Individual Draft Review', 'Team/individual drafts mixed');
      const photo = team.data.photo, document = team.data.document;
      assert(photo instanceof File && document instanceof File, 'Draft files did not restore as Files');
      assert(photo.name === 'review-photo.png' && photo.type === 'image/png' && photo.lastModified === 1700000000000, 'Photo metadata mismatch');
      assert(Array.from(new Uint8Array(await photo.arrayBuffer())).join(',') === '137,80,78,71,13,10', 'Photo bytes changed');
      assert(document.name === 'review-evidence.pdf' && document.type === 'application/pdf' && document.lastModified === 1700000000001, 'PDF metadata mismatch');
      assert(await document.text() === '%PDF-1.4\nDraft attachment', 'PDF bytes changed');
      for (const changed of [{ userId: 'other-review-user' }, { hackathonId: 'other-review-campaign' }, { editId: 'review-edit-only' }]) {
        assert(await store.load(keyOf({ ...scope, ...changed })) === null, 'Draft scope leaked');
      }
      await store.remove(teamKey);
      assert(await store.load(teamKey) === null, 'Draft deletion failed');
      assert((await store.load(individualKey)).data.name === 'Individual Draft Review', 'Deleting team draft affected individual draft');
      return 'PASS: real IndexedDB, reload, File names/types/timestamps/bytes, user/campaign/type/edit isolation, independent deletion';
    } finally {
      await store.remove(teamKey);
      await store.remove(individualKey);
    }
  }, initial);
  return result;
}
