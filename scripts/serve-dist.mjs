import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';

const root = path.resolve('dist');
const port = Number(process.argv[2] ?? 4175);
const compressible = /\.(?:html|css|js|json|svg|txt)$/i;
const encodedCache = new Map();
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function responseBody(filePath, source, encoding) {
  if (!compressible.test(filePath)) return source;
  const key = `${filePath}:${encoding}`;
  const cached = encodedCache.get(key);
  if (cached) return cached;
  const body =
    encoding === 'br'
      ? brotliCompressSync(source)
      : encoding === 'gzip'
        ? gzipSync(source)
        : source;
  if (encoding) encodedCache.set(key, body);
  return body;
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    let filePath = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    try {
      const info = await stat(filePath);
      if (info.isDirectory()) filePath = path.join(filePath, 'index.html');
    } catch {
      filePath = path.join(root, 'index.html');
    }

    const source = await readFile(filePath);
    const accepts = request.headers['accept-encoding'] ?? '';
    const encoding = accepts.includes('br')
      ? 'br'
      : accepts.includes('gzip')
        ? 'gzip'
        : '';
    const body = responseBody(filePath, source, encoding);
    const immutable = filePath.includes(`${path.sep}assets${path.sep}`);
    response.setHeader('Content-Type', mimeTypes[path.extname(filePath)] ?? 'application/octet-stream');
    response.setHeader(
      'Cache-Control',
      immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    );
    if (encoding) {
      response.setHeader('Content-Encoding', encoding);
      response.setHeader('Vary', 'Accept-Encoding');
    }
    response.setHeader('Content-Length', body.byteLength);
    response.writeHead(200).end(body);
  } catch (error) {
    response.writeHead(500).end(error instanceof Error ? error.message : 'Server error');
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`Production preview: http://0.0.0.0:${port}/`);
});
