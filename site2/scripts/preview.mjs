import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const port = Number(process.argv[2] || 4174);
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

http.createServer(async (request, response) => {
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
      'X-Content-Type-Options': 'nosniff'
    });
    response.end(request.method === 'HEAD' ? undefined : contents);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('페이지를 찾을 수 없습니다.');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Dealmate design 02: http://127.0.0.1:${port}/`);
});
