import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { createAuthHandler, CLIENT_ID } from '../server/auth.mjs';

const origin = 'https://dealmate-blush.vercel.app';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const verifier = new OAuth2Client();
const certificates = { test: publicKey.export({ type: 'spki', format: 'pem' }) };
const verify = async token => (await verifier.verifySignedJwtWithCertsAsync(token, certificates, CLIENT_ID, ['accounts.google.com', 'https://accounts.google.com'])).getPayload();
const handler = createAuthHandler({ verify });
const seconds = () => Math.floor(Date.now() / 1000);
function token(nonce, changes = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'test-only-user', email: 'test@example.invalid', email_verified: true, name: '테스트 메이트', iat: seconds(), exp: seconds() + 3600, nonce, ...changes })).toString('base64url');
  const input = `${header}.${body}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}
function req(method = 'GET', body, cookie = '', headers = {}) {
  return new Request(`${origin}/api/auth`, { method, headers: { Origin: origin, 'X-Dealmate-Auth': '1', 'Content-Type': 'application/json', Cookie: cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function challenge() {
  const response = await handler(new Request(`${origin}/api/auth?action=challenge`));
  return { data: await response.json(), cookie: response.headers.getSetCookie()[0].split(';')[0], response };
}
function sessionCookie(response) {
  return response.headers.getSetCookie().find(value => value.startsWith('__Host-dealmate_session=')).split(';')[0];
}

test('signed-out reads expose no account and are not cacheable', async () => {
  const response = await handler(req());
  assert.deepEqual(await response.json(), { user: null });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('challenge uses a secure host-only HttpOnly nonce and unique randomness', async () => {
  const first = await challenge();
  const second = await challenge();
  assert.equal(first.data.clientId, CLIENT_ID);
  assert.match(first.data.nonce, /^[\w-]{43}$/);
  assert.notEqual(first.data.nonce, second.data.nonce);
  const value = first.response.headers.get('set-cookie');
  assert.match(value, /HttpOnly/); assert.match(value, /Secure/); assert.match(value, /SameSite=Lax/);
  assert.doesNotMatch(value, /Domain=/);
});
test('a valid Google-format signed token supports login and subsequent session reads', async () => {
  const { data, cookie } = await challenge();
  const response = await handler(req('POST', { credential: token(data.nonce) }, cookie));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.user, { name: '테스트 메이트', email: 'test@example.invalid' });
  assert.equal(body.credential, undefined);
  assert.match(response.headers.get('set-cookie'), /__Host-dealmate_nonce=;.*Max-Age=0/);
  const session = await handler(req('GET', undefined, sessionCookie(response)));
  assert.deepEqual((await session.json()).user, body.user);
});
for (const [label, changes] of [
  ['wrong audience', { aud: 'another-client' }],
  ['wrong issuer', { iss: 'https://example.invalid' }],
  ['expired token including the SDK clock-skew window', { exp: seconds() - 10 }],
  ['unverified email', { email_verified: false }],
  ['missing subject', { sub: '' }]
]) {
  test(`rejects ${label}`, async () => {
    const { data, cookie } = await challenge();
    const response = await handler(req('POST', { credential: token(data.nonce, changes) }, cookie));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('set-cookie'), null);
  });
}
test('rejects signature tampering and clears a tampered session', async () => {
  const { data, cookie } = await challenge();
  const valid = token(data.nonce);
  const parts = valid.split('.');
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  claims.email = 'forged@example.invalid';
  parts[1] = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const forged = parts.join('.');
  assert.equal((await handler(req('POST', { credential: forged }, cookie))).status, 401);
  const read = await handler(req('GET', undefined, `__Host-dealmate_session=${forged}`));
  assert.deepEqual(await read.json(), { user: null });
  assert.match(read.headers.get('set-cookie'), /Max-Age=0/);
});
test('a token cannot log in a different browser without the original challenge', async () => {
  const first = await challenge();
  const second = await challenge();
  const credential = token(first.data.nonce);
  assert.equal((await handler(req('POST', { credential }))).status, 401);
  assert.equal((await handler(req('POST', { credential }, second.cookie))).status, 401);
});
test('cross-site login and logout are blocked before verification', async () => {
  for (const method of ['POST', 'DELETE']) {
    assert.equal((await handler(req(method, undefined, '', { Origin: 'https://attacker.example' }))).status, 403);
    assert.equal((await handler(req(method, undefined, '', { 'X-Dealmate-Auth': '' }))).status, 403);
  }
  const request = new Request(`${origin}/api/auth?action=challenge`, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal((await handler(request)).status, 403);
});
test('logout expires both cookies without sending tokens to the browser', async () => {
  const response = await handler(req('DELETE'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { user: null });
  assert.equal(response.headers.getSetCookie().length, 2);
  for (const cookie of response.headers.getSetCookie()) assert.match(cookie, /Max-Age=0/);
});
test('invalid JSON, content types, methods and oversized payloads are rejected', async () => {
  assert.equal((await handler(req('POST', {}, '', { 'Content-Type': 'text/plain' }))).status, 415);
  assert.equal((await handler(req('PUT'))).status, 405);
  assert.equal((await handler(req('POST', { credential: 'a'.repeat(9000) }))).status, 413);
  const request = new Request(`${origin}/api/auth`, { method: 'POST', headers: { Origin: origin, 'X-Dealmate-Auth': '1', 'Content-Type': 'application/json' }, body: '{bad' });
  assert.equal((await handler(request)).status, 400);
});
test('unregistered hostnames cannot create login sessions', async () => {
  assert.equal((await handler(new Request('https://attacker.example/api/auth'))).status, 403);
});
