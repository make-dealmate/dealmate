import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify as verifySignature } from 'node:crypto';

const issuer = 'https://kauth.kakao.com';
const random = () => randomBytes(32).toString('base64url');
const validRandom = value => typeof value === 'string' && /^[\w-]{43}$/.test(value);
const same = (left, right) => typeof left === 'string' && typeof right === 'string' &&
  Buffer.byteLength(left) === Buffer.byteLength(right) && timingSafeEqual(Buffer.from(left), Buffer.from(right));
export const KAKAO_CALLBACK = '/api/kakao-callback';

// Credentials are read only from the hosting console's server environment.
export function createKakaoProvider({ clientId = process.env.KAKAO_REST_API_KEY,
  clientSecret = process.env.KAKAO_CLIENT_SECRET, fetcher = fetch, now = () => Date.now() } = {}) {
  const enabled = Boolean(clientId && clientSecret);
  let keys = [];
  let loadedAt = -Infinity;
  let pendingKeys;

  async function getKey(kid) {
    if (pendingKeys) await pendingKeys;
    const cached = keys.find(key => key.kid === kid);
    if (now() - loadedAt >= 3600000 || (!cached && now() - loadedAt >= 60000)) {
      pendingKeys ??= (async () => {
        // Throttle unknown key IDs and share concurrent refreshes.
        loadedAt = now();
        const response = await fetcher(`${issuer}/.well-known/jwks.json`, {
          signal: AbortSignal.timeout(10000), redirect: 'error'
        });
        if (!response.ok) throw new Error('kakao_unavailable');
        const body = await response.json();
        if (!Array.isArray(body.keys) || body.keys.length > 20) throw new Error('kakao_unavailable');
        keys = body.keys.filter(key => key.kty === 'RSA' && key.alg === 'RS256' && key.use === 'sig');
      })();
      try { await pendingKeys; } finally { pendingKeys = undefined; }
    }
    const key = keys.find(item => item.kid === kid);
    if (!key) throw new Error('invalid_credential');
    return createPublicKey({ key, format: 'jwk' });
  }

  async function verify(token) {
    if (!enabled || typeof token !== 'string' || token.length > 3700 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) {
      throw new Error('invalid_credential');
    }
    const [headerText, payloadText, signature] = token.split('.');
    const header = JSON.parse(Buffer.from(headerText, 'base64url').toString('utf8'));
    if (header?.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length > 128 || header.crit) {
      throw new Error('invalid_credential');
    }
    const key = await getKey(header.kid);
    if (!verifySignature('RSA-SHA256', Buffer.from(`${headerText}.${payloadText}`), key, Buffer.from(signature, 'base64url'))) {
      throw new Error('invalid_credential');
    }
    const payload = JSON.parse(Buffer.from(payloadText, 'base64url').toString('utf8'));
    const seconds = Math.floor(now() / 1000);
    if (payload?.iss !== issuer || payload.aud !== clientId || typeof payload.sub !== 'string' || !payload.sub ||
        !Number.isSafeInteger(payload.exp) || !Number.isSafeInteger(payload.iat) ||
        payload.iat > seconds + 60 || payload.exp <= seconds || payload.exp <= payload.iat ||
        payload.iat + 3600 <= seconds) throw new Error('invalid_credential');
    return payload;
  }

  function start(origin) {
    if (!enabled) throw new Error('kakao_not_configured');
    const transaction = { state: random(), nonce: random(), verifier: random(), created: now() };
    const url = new URL(`${issuer}/oauth/authorize`);
    url.search = new URLSearchParams({ response_type: 'code', client_id: clientId,
      redirect_uri: `${origin}${KAKAO_CALLBACK}`, scope: 'openid', state: transaction.state,
      nonce: transaction.nonce, code_challenge: createHash('sha256').update(transaction.verifier).digest('base64url'),
      code_challenge_method: 'S256' }).toString();
    return { url: url.href, transaction: Buffer.from(JSON.stringify(transaction)).toString('base64url') };
  }

  async function finish(url, transactionCookie) {
    if (!enabled || typeof transactionCookie !== 'string' || transactionCookie.length > 1024) throw new Error('login_expired');
    let transaction;
    try { transaction = JSON.parse(Buffer.from(transactionCookie, 'base64url').toString('utf8')); }
    catch { throw new Error('login_expired'); }
    if (!transaction || !validRandom(transaction.state) || !validRandom(transaction.nonce) || !validRandom(transaction.verifier) ||
        !Number.isFinite(transaction.created) || transaction.created > now() || now() - transaction.created >= 600000 ||
        url.searchParams.getAll('state').length !== 1 || !same(transaction.state, url.searchParams.get('state'))) {
      throw new Error('login_expired');
    }
    if (url.searchParams.get('error') === 'access_denied') throw new Error('login_cancelled');
    const code = url.searchParams.get('code');
    if (url.searchParams.has('error') || url.searchParams.getAll('code').length !== 1 || !code || code.length > 2048) {
      throw new Error('invalid_credential');
    }
    const response = await fetcher(`${issuer}/oauth/token`, { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret,
        redirect_uri: `${url.origin}${KAKAO_CALLBACK}`, code, code_verifier: transaction.verifier }),
      signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('kakao_unavailable');
    const tokens = await response.json();
    const payload = await verify(tokens.id_token);
    if (!same(payload.nonce, transaction.nonce)) throw new Error('invalid_credential');
    // Access and refresh tokens are never persisted, returned to JS, or logged.
    return { token: tokens.id_token, expiresAt: Math.min(payload.exp, payload.iat + 3600) * 1000 };
  }
  return { enabled, start, finish, verify };
}
