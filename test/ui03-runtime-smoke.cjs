// 仅使用仓库测试密钥验证本机隔离容器，不连接生产或打印令牌。
const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const keySource = fs.readFileSync('app/hackhub-api/src/test/resources/application-integrationtest.yml', 'utf8');
const key = keySource.match(/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/)[0]
  .split('\n').map(line => line.trim()).join('\n');
const base64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const content = base64({ alg: 'RS256', typ: 'JWT' }) + '.' + base64({
  sub: '11111111-1111-4111-8111-111111111111', role: 'participant', iat: now, exp: now + 900,
});
const token = content + '.' + crypto.sign('RSA-SHA256', Buffer.from(content), key).toString('base64url');
// 从源名册独立计算候选，防止真实接口返回无关人员却通过非空检查。
const roster = JSON.parse(fs.readFileSync('app/hackhub-api/src/main/resources/team-member-directory.json', 'utf8'));
const normalize = value => value.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const uuidParts = value => [value.replaceAll('-', '').slice(0, 16), value.replaceAll('-', '').slice(16)]
  .map(part => BigInt.asIntN(64, BigInt('0x' + part)));
const compareIds = (left, right) => {
  const a = uuidParts(left); const b = uuidParts(right);
  return compare(a[0], b[0]) || compare(a[1], b[1]);
};
function expectedMatches(query) {
  const normalized = normalize(query);
  const tokens = normalized.split(' ');
  return roster.filter(member => tokens.every(part => normalize(member.fullName).includes(part)
    || normalize(member.name).replaceAll(' ', '').includes(part)))
    .sort((a, b) => Number(normalize(a.name) !== normalized) - Number(normalize(b.name) !== normalized)
      || compare(normalize(a.name), normalize(b.name)) || compareIds(a.id, b.id))
    .slice(0, 20).map(({ id, name, orgUnit }) => ({ id, name, orgUnit }));
}
async function check() {
  const base = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:4175';
  assert.equal((await fetch(base + '/health')).status, 200);
  assert.equal((await fetch(base + '/')).status, 200);
  const endpoint = base + '/api/v1/team-members/search?q=';
  for (const query of ['wang weimin', 'weimin wang', '王卫民', '@WANG Weimin', 'wangweimin', '@王卫民', '＠王卫民', '＠WANG Weimin', '@卫民', '@weimin']) {
    const response = await fetch(endpoint + encodeURIComponent(query), { headers: { Authorization: 'Bearer ' + token } });
    assert.equal(response.status, 200);
    const matches = await response.json();
    assert.equal(matches.length, 1);
    assert.equal(matches[0].name, 'WANG Weimin');
    assert.equal(matches[0].orgUnit, 'BD/SLP-CO');
    assert.deepEqual(Object.keys(matches[0]).sort(), ['id', 'name', 'orgUnit']);
    assert.deepEqual(matches, expectedMatches(query), query);
  }
  for (const query of ['@王', '＠王', '@wang', '＠wang']) {
    const response = await fetch(endpoint + encodeURIComponent(query), { headers: { Authorization: 'Bearer ' + token } });
    assert.equal(response.status, 200);
    const matches = await response.json();
    assert.ok(matches.length > 0 && matches.length <= 20);
    assert.deepEqual(matches, expectedMatches(query), query);
    for (const match of matches) {
      assert.deepEqual(Object.keys(match).sort(), ['id', 'name', 'orgUnit']);
    }
  }
  const short = await fetch(endpoint + 'a', { headers: { Authorization: 'Bearer ' + token } });
  assert.equal(short.status, 200);
  assert.deepEqual(await short.json(), []);
  assert.equal((await fetch(endpoint + 'wang')).status, 401);
  const broad = await fetch(endpoint + 'wang', { headers: { Authorization: 'Bearer ' + token } });
  const broadMatches = await broad.json();
  assert.equal(broadMatches.length, 20);
  assert.deepEqual(broadMatches, expectedMatches('wang'));
  assert.equal((await fetch(endpoint + 'a'.repeat(201), { headers: { Authorization: 'Bearer ' + token } })).status, 400);
  assert.equal((await fetch(base + '/api/v1/public/awards')).status, 200);
  console.log('PASS: final images, nginx -> api, ten unique roster queries, four keyword queries, expected roster identities/order/limit, single-Han and fullwidth-at support, private field boundary, 401/400, health/home/public API');
}
check().catch(error => { console.error(error.message); process.exitCode = 1; });
