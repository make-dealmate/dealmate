import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createKakaoProvider } from '../server/kakao.mjs';
import { createAuthHandler } from '../server/auth.mjs';

const origin = 'https://thedealmate.com';
const clientId = 'test-only-kakao-client';
const clientSecret = 'test-only-not-a-real-secret';
const epoch = 1800000000000;
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
function signedToken(nonce, changes = {}, headerChanges = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid, ...headerChanges })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: 'https://kauth.kakao.com', aud: clientId, sub: 'test-only-member',
    iat: epoch / 1000, exp: epoch / 1000 + 7200, nonce, ...changes })).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}
function setup({ claims = {}, headers = {}, tokenError = false, overrideToken } = {}) {
  let time = epoch;
  const calls = [];
  let nonce;
  const fetcher = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/jwks.json')) return Response.json({ keys: [jwk] });
    assert.equal(url, 'https://kauth.kakao.com/oauth/token');
    if (tokenError) return Response.json({ error_description: 'must-not-leak' }, { status: 400 });
    return Response.json({ id_token: overrideToken ?? signedToken(nonce, claims, headers),
      access_token: 'discard-access-token', refresh_token: 'discard-refresh-token' });
  };
  const provider = createKakaoProvider({ clientId, clientSecret, fetcher, now: () => time });
  const handler = createAuthHandler({ kakao: provider, now: () => time });
  async function start() {
    const response = await handler(new Request(`${origin}/api/auth?action=kakao-start`, { method: 'POST',
      headers: { Origin: origin, 'X-Dealmate-Auth': '1', 'Content-Type': 'application/json' }, body: '{}' }));
    const body = await response.json();
    const url = new URL(body.redirect);
    nonce = url.searchParams.get('nonce');
    return { response, body, url, cookie: response.headers.getSetCookie()[0].split(';')[0] };
  }
  const callback = (start, extra = '') => handler(new Request(`${origin}/api/kakao-callback?code=test-only-code&state=${start.url.searchParams.get('state')}${extra}`, {
    headers: { Cookie: start.cookie }
  }));
  return { provider, handler, calls, start, callback, setTime(value) { time = value; } };
}

test('Kakao stays unavailable until both server credentials are configured', async () => {
  for (const options of [{ clientId: '', clientSecret: '' }, { clientId, clientSecret: '' }]) {
    const kakao = createKakaoProvider(options);
    const handler = createAuthHandler({ kakao });
    assert.deepEqual(await (await handler(new Request(`${origin}/api/auth?action=providers`))).json(), { google: true, kakao: false });
    const response = await handler(new Request(`${origin}/api/auth?action=kakao-start`, { method: 'POST',
      headers: { Origin: origin, 'X-Dealmate-Auth': '1', 'Content-Type': 'application/json' }, body: '{}' }));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('set-cookie'), null);
  }
});

test('start binds state, nonce and PKCE to a secure HttpOnly cookie and requests no personal scopes', async () => {
  const env = setup();
  const start = await env.start();
  assert.equal(start.response.status, 200);
  assert.equal(start.url.origin, 'https://kauth.kakao.com');
  assert.equal(start.url.pathname, '/oauth/authorize');
  assert.equal(start.url.searchParams.get('scope'), 'openid');
  assert.equal(start.url.searchParams.get('redirect_uri'), `${origin}/api/kakao-callback`);
  assert.equal(start.url.searchParams.get('client_secret'), null);
  const cookie = start.response.headers.getSetCookie()[0];
  assert.match(cookie, /^__Host-dealmate_kakao_oauth=/);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=600']) assert.ok(cookie.includes(flag));
  assert.ok(!cookie.includes('Domain='));
  const transaction = JSON.parse(Buffer.from(start.cookie.split('=')[1], 'base64url'));
  assert.equal(transaction.state, start.url.searchParams.get('state'));
  assert.equal(transaction.nonce, start.url.searchParams.get('nonce'));
  assert.equal(createHash('sha256').update(transaction.verifier).digest('base64url'), start.url.searchParams.get('code_challenge'));
  assert.equal(start.url.searchParams.get('code_challenge_method'), 'S256');
  assert.notEqual(start.url.searchParams.get('state'), (await env.start()).url.searchParams.get('state'));
});

test('signed Kakao login works without email or nickname, persists for at most one hour, and never returns provider tokens to JS', async () => {
  const env = setup();
  const start = await env.start();
  const response = await env.callback(start);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/#auth=kakao-success');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), '');
  const session = response.headers.getSetCookie().find(value => value.startsWith('__Host-dealmate_session='));
  assert.match(session, /Max-Age=3600/);
  assert.ok(!session.includes('discard-access-token') && !session.includes('discard-refresh-token'));
  const read = await env.handler(new Request(`${origin}/api/auth`, { headers: { Cookie: session.split(';')[0] } }));
  assert.deepEqual(await read.json(), { user: { name: '', email: '' }, provider: 'kakao', expiresAt: epoch + 3600000 });
  const sent = env.calls.find(call => call.url.endsWith('/oauth/token')).init;
  assert.equal(sent.method, 'POST');
  assert.equal(sent.redirect, 'error');
  assert.equal(sent.body.get('client_secret'), clientSecret);
  assert.equal(sent.body.get('redirect_uri'), `${origin}/api/kakao-callback`);
  env.setTime(epoch + 3600000);
  const expired = await env.handler(new Request(`${origin}/api/auth`, { headers: { Cookie: session.split(';')[0] } }));
  assert.deepEqual(await expired.json(), { user: null });
});

test('missing, mismatched, duplicate, malformed and expired state cannot exchange a code', async () => {
  for (const kind of ['missing', 'wrong', 'duplicate', 'bad-cookie', 'expired']) {
    const env = setup();
    const start = await env.start();
    if (kind === 'expired') env.setTime(epoch + 600000);
    const state = start.url.searchParams.get('state');
    const query = kind === 'missing' ? '' : kind === 'wrong' ? '&state=wrong' : `&state=${state}${kind === 'duplicate' ? `&state=${state}` : ''}`;
    const response = await env.handler(new Request(`${origin}/api/kakao-callback?code=test-only-code${query}`, {
      headers: { Cookie: kind === 'bad-cookie' ? '__Host-dealmate_kakao_oauth=broken' : start.cookie }
    }));
    assert.equal(response.headers.get('location'), '/#auth=kakao-error');
    assert.equal(env.calls.length, 0);
    assert.equal(response.headers.getSetCookie().filter(value => value.startsWith('__Host-dealmate_session=')).length, 0);
    assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  }
});

test('authorization denial is recoverable and never exchanges a code', async () => {
  const env = setup();
  const start = await env.start();
  const response = await env.callback(start, '&error=access_denied&error_description=untrusted-text');
  assert.equal(response.headers.get('location'), '/#auth=kakao-cancelled');
  assert.equal(env.calls.length, 0);
});

for (const [label, claims] of [
  ['wrong audience', { aud: 'another-app' }], ['wrong issuer', { iss: 'https://attacker.invalid' }],
  ['missing subject', { sub: '' }], ['expired token', { exp: epoch / 1000 }],
  ['future issue time', { iat: epoch / 1000 + 1000 }], ['reused nonce', { nonce: 'wrong-nonce' }]
]) {
  test(`rejects Kakao ${label}`, async () => {
    const env = setup({ claims });
    const response = await env.callback(await env.start());
    assert.equal(response.headers.get('location'), '/#auth=kakao-error');
    assert.equal(response.headers.getSetCookie().length, 1);
  });
}

test('rejects altered signatures, unsupported algorithms, and unknown signing keys', async () => {
  const valid = signedToken('test-nonce');
  const [header, body, signature] = valid.split('.');
  const forged = `${header}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), sub: 'forged' })).toString('base64url')}.${signature}`;
  for (const token of [forged, signedToken('n', {}, { alg: 'HS256' }), signedToken('n', {}, { kid: 'unknown' })]) {
    await assert.rejects(setup().provider.verify(token));
  }
});

test('public keys are cached and simultaneous verifications share one request', async () => {
  const env = setup();
  const token = signedToken('n');
  const results = await Promise.all([env.provider.verify(token), env.provider.verify(token), env.provider.verify(token)]);
  assert.equal(results.length, 3);
  assert.equal(env.calls.length, 1);
  await assert.rejects(env.provider.verify(signedToken('n', {}, { kid: 'unknown' })));
  assert.equal(env.calls.length, 1);
});

test('provider failures do not leak codes, secrets, tokens or raw provider error text', async () => {
  const env = setup({ tokenError: true });
  const response = await env.callback(await env.start());
  assert.equal(response.headers.get('location'), '/#auth=kakao-error');
  assert.doesNotMatch(JSON.stringify([...response.headers]) + await response.text(), /must-not-leak|test-only-code|test-only-not-a-real-secret/);
});

test('cross-site start, unexpected origins, old domain starts and POST callbacks are blocked', async () => {
  const { handler } = setup();
  for (const [host, incoming] of [[origin, 'https://attacker.invalid'], ['https://dealmate-blush.vercel.app', 'https://dealmate-blush.vercel.app'],
    ['https://attacker.invalid', 'https://attacker.invalid']]) {
    const response = await handler(new Request(`${host}/api/auth?action=kakao-start`, { method: 'POST',
      headers: { Origin: incoming, 'X-Dealmate-Auth': '1', 'Content-Type': 'application/json' }, body: '{}' }));
    assert.equal(response.status, 403);
  }
  assert.equal((await handler(new Request(`${origin}/api/kakao-callback`, { method: 'POST' }))).status, 405);
});
