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
async function check() {
  const base = 'http://127.0.0.1:4175';
  assert.equal((await fetch(base + '/health')).status, 200);
  assert.equal((await fetch(base + '/')).status, 200);
  const endpoint = base + '/api/v1/team-members/search?q=';
  for (const query of ['wang weimin', 'weimin wang', '王卫民', '@WANG Weimin', 'wangweimin']) {
    const response = await fetch(endpoint + encodeURIComponent(query), { headers: { Authorization: 'Bearer ' + token } });
    assert.equal(response.status, 200);
    const matches = await response.json();
    assert.equal(matches.length, 1);
    assert.equal(matches[0].name, 'WANG Weimin');
    assert.equal(matches[0].orgUnit, 'BD/SLP-CO');
    assert.deepEqual(Object.keys(matches[0]).sort(), ['id', 'name', 'orgUnit']);
  }
  assert.equal((await fetch(endpoint + 'wang')).status, 401);
  const broad = await fetch(endpoint + 'wang', { headers: { Authorization: 'Bearer ' + token } });
  assert.equal((await broad.json()).length, 20);
  assert.equal((await fetch(endpoint + 'a'.repeat(201), { headers: { Authorization: 'Bearer ' + token } })).status, 400);
  assert.equal((await fetch(base + '/api/v1/public/awards')).status, 200);
  console.log('PASS: final images, nginx -> api, five real roster queries, private field boundary, result limit, 401/400, health/home/public API');
}
check().catch(error => { console.error(error.message); process.exitCode = 1; });
