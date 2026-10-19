import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { handleAuth } from '../../server/auth.mjs';
import { buildSite } from './build.mjs';

await buildSite();
const publicDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const port = Number(process.argv[2] || 4174);
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8'
};

http.createServer(async (request, response) => {
  if (['/api/auth', '/api/kakao-callback'].includes(request.url.split('?')[0])) {
    response.setHeader('X-Robots-Tag', 'noindex, nofollow');
    try {
      const init = { method: request.method, headers: request.headers };
      if (!['GET', 'HEAD'].includes(request.method)) {
        init.body = Readable.toWeb(request);
        init.duplex = 'half';
      }
      const result = await handleAuth(new Request(`http://${request.headers.host}${request.url}`, init));
      result.headers.forEach((value, key) => { if (key !== 'set-cookie') response.setHeader(key, value); });
      if (result.headers.getSetCookie().length) response.setHeader('Set-Cookie', result.headers.getSetCookie());
      response.writeHead(result.status);
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch {
      response.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end('{"error":"server_error"}');
    }
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(publicDirectory, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(publicDirectory + sep)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const contents = await readFile(file);
    response.writeHead(200, {
      'Content-Type': contentTypes[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups'
    });
    response.end(request.method === 'HEAD' ? undefined : contents);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('페이지를 찾을 수 없습니다.');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Dealmate preview: http://localhost:${port}/`);
});
