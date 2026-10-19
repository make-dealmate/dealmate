import { randomBytes, timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { createKakaoProvider, KAKAO_CALLBACK } from './kakao.mjs';

// OAuth client IDs are public identifiers. No client secret is used by this flow.
export const CLIENT_ID = '617699315025-c8i3s8vmltg1n86u88ifeq7ndv3c6vi5.apps.googleusercontent.com';
const googleClient = new OAuth2Client();
const productionOrigin = 'https://thedealmate.com';
// Keep the previous production origin available during the domain transition.
const defaultOrigins = [productionOrigin, 'https://dealmate-blush.vercel.app'];
if (!process.env.VERCEL) defaultOrigins.push('http://localhost:4174', 'http://127.0.0.1:4174');

async function verifyGoogleToken(idToken) {
  const ticket = await googleClient.verifyIdToken({ idToken, audience: CLIENT_ID });
  return ticket.getPayload();
}

function cookies(request) {
  return Object.fromEntries((request.headers.get('cookie') || '').split(';').map(part => {
    const separator = part.indexOf('=');
    return separator < 0 ? ['', ''] : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
  }));
}

function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createAuthHandler({ verify = verifyGoogleToken, origins = defaultOrigins, now = () => Date.now(), kakao = createKakaoProvider() } = {}) {
  return async function handle(request) {
    const url = new URL(request.url);
    const secure = url.protocol === 'https:';
    const prefix = secure ? '__Host-dealmate_' : 'dealmate_';
    const sessionName = `${prefix}session`;
    const nonceName = `${prefix}nonce`;
    const kakaoName = `${prefix}kakao_oauth`;
    const jar = cookies(request);
    const cookie = (name, value, age) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
    const reply = (status, data, setCookies = []) => {
      const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Cookie' });
      for (const value of setCookies) headers.append('Set-Cookie', value);
      return new Response(JSON.stringify(data), { status, headers });
    };
    const clearSession = () => cookie(sessionName, '', 0);
    const validate = async token => {
      if (typeof token !== 'string' || token.length > 3800 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) throw new Error('Invalid credential');
      const payload = await verify(token);
      if (!payload || !payload.sub || payload.aud !== CLIENT_ID ||
          !['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss) ||
          !Number.isFinite(payload.exp) || payload.exp <= Math.floor(now() / 1000) ||
          payload.email_verified !== true || typeof payload.email !== 'string') throw new Error('Invalid identity');
      return payload;
    };
    const publicUser = payload => ({ name: typeof payload.name === 'string' ? payload.name : '', email: payload.email });

    if (!origins.includes(url.origin)) return reply(403, { error: 'origin_not_allowed' });
    if (url.pathname === KAKAO_CALLBACK) {
      if (request.method !== 'GET') return reply(405, { error: 'method_not_allowed' });
      const headers = new Headers({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff', 'Vary': 'Cookie' });
      headers.append('Set-Cookie', cookie(kakaoName, '', 0));
      let result = 'kakao-error';
      try {
        const session = await kakao.finish(url, jar[kakaoName]);
        const age = Math.min(3600, Math.floor((session.expiresAt - now()) / 1000));
        if (age <= 0) throw new Error('invalid_credential');
        headers.append('Set-Cookie', cookie(sessionName, `kakao.${session.token}`, age));
        headers.append('Set-Cookie', cookie(nonceName, '', 0));
        result = 'kakao-success';
      } catch (error) {
        if (error.message === 'login_cancelled') result = 'kakao-cancelled';
      }
      // Fixed destination; never echo authorization codes or provider error text.
      headers.set('Location', `/#auth=${result}`);
      return new Response(null, { status: 303, headers });
    }
    if (request.method === 'GET') {
      if (url.searchParams.get('action') === 'providers') return reply(200, { google: true, kakao: kakao.enabled });
      if (url.searchParams.get('action') === 'challenge') {
        if (request.headers.get('sec-fetch-site') === 'cross-site') return reply(403, { error: 'origin_not_allowed' });
        const nonce = randomBytes(32).toString('base64url');
        return reply(200, { clientId: CLIENT_ID, nonce }, [cookie(nonceName, nonce, 600)]);
      }
      if (!jar[sessionName]) return reply(200, { user: null });
      try {
        if (jar[sessionName].startsWith('kakao.')) {
          const payload = await kakao.verify(jar[sessionName].slice(6));
          return reply(200, { user: { name: '', email: '' }, provider: 'kakao',
            expiresAt: Math.min(payload.exp, payload.iat + 3600) * 1000 });
        }
        const payload = await validate(jar[sessionName]);
        return reply(200, { user: publicUser(payload), expiresAt: payload.exp * 1000 });
      } catch {
        return reply(200, { user: null }, [clearSession()]);
      }
    }

    if (!['POST', 'DELETE'].includes(request.method)) {
      const response = reply(405, { error: 'method_not_allowed' });
      response.headers.set('Allow', 'GET, POST, DELETE');
      return response;
    }
    // Require the same origin plus a custom header; cross-site forms cannot supply these.
    if (request.headers.get('origin') !== url.origin || request.headers.get('x-dealmate-auth') !== '1') {
      return reply(403, { error: 'origin_not_allowed' });
    }
    if (request.method === 'DELETE') {
      return reply(200, { user: null }, [clearSession(), cookie(nonceName, '', 0), cookie(kakaoName, '', 0)]);
    }
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
      return reply(415, { error: 'json_required' });
    }
    if (Number(request.headers.get('content-length') || 0) > 8192) return reply(413, { error: 'request_too_large' });
    let body;
    try {
      // Bound the stream too: Content-Length may be absent or untrusted.
      const reader = request.body?.getReader();
      if (!reader) return reply(400, { error: 'invalid_request' });
      let size = 0;
      const chunks = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8192) { await reader.cancel(); return reply(413, { error: 'request_too_large' }); }
        chunks.push(Buffer.from(value));
      }
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return reply(400, { error: 'invalid_request' });
    }
    if (url.searchParams.get('action') === 'kakao-start') {
      if (!kakao.enabled) return reply(503, { error: 'kakao_not_configured' });
      // The legacy domain is read-only for Kakao; use the canonical site or registered local preview.
      if (url.origin === 'https://dealmate-blush.vercel.app') return reply(403, { error: 'origin_not_allowed' });
      const start = kakao.start(url.origin);
      return reply(200, { redirect: start.url }, [cookie(kakaoName, start.transaction, 600)]);
    }
    if (!body || !/^[A-Za-z0-9_-]{43}$/.test(jar[nonceName] || '')) return reply(401, { error: 'login_expired' });
    try {
      const payload = await validate(body.credential);
      if (!equal(payload.nonce, jar[nonceName])) return reply(401, { error: 'login_expired' });
      const maxAge = Math.min(3600, payload.exp - Math.floor(now() / 1000));
      // A short-lived Google-signed token is the session credential. Never store it in JS storage or logs.
      return reply(200, { user: publicUser(payload), expiresAt: payload.exp * 1000 }, [
        cookie(sessionName, body.credential, maxAge), cookie(nonceName, '', 0)
      ]);
    } catch {
      // Do not echo Google's errors: they may contain credentials or personal data.
      return reply(401, { error: 'invalid_credential' });
    }
  };
}

export const handleAuth = createAuthHandler();
