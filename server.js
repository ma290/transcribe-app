const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 5000;
const TARGET_BASE = 'https://slimy-melisa-ashutosh0879-af2acd0b.koyeb.app';
const ROOT = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.txt': 'text/plain; charset=utf-8'
};

function sendFile(res, filePath, statusCode = 200) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(statusCode, { 'Content-Type': contentType });
    res.end(data);
  });
}

function proxyToTranscribe(req, res) {
  const targetUrl = new URL(TARGET_BASE + req.url.replace(/^\/api/, ''));

  const proxyHeaders = { ...req.headers };
  delete proxyHeaders.host;
  delete proxyHeaders.origin;

  const options = {
    hostname: targetUrl.hostname,
    port: 443,
    path: `${targetUrl.pathname}${targetUrl.search}`,
    method: req.method,
    headers: {
      ...proxyHeaders,
      host: targetUrl.host,
      origin: TARGET_BASE,
      referer: `${TARGET_BASE}/mp3-to-text`
    }
  };

  const proxyReq = https.request(options, (proxyRes) => {
    const responseHeaders = {
      ...(proxyRes.headers || {}),
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'Content-Type, Authorization, Accept',
      'access-control-expose-headers': 'Content-Type, Authorization'
    };
    delete responseHeaders['transfer-encoding'];

    res.writeHead(proxyRes.statusCode || 500, responseHeaders);
    proxyRes.pipe(res);

    proxyRes.on('error', (err) => {
      console.error('Proxy response error:', err);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Proxy response failed.' }));
      } else {
        res.end();
      }
    });

    res.on('close', () => proxyReq.destroy());
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'Proxy request failed.' }));
    }
  });

  req.on('error', () => proxyReq.destroy());
  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept'
    });
    res.end();
    return;
  }

  if (req.url.startsWith('/api/transcribe')) {
    proxyToTranscribe(req, res);
    return;
  }

  const requestPath = req.url === '/' ? '/index.html' : req.url;
  const filePath = path.join(ROOT, requestPath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    sendFile(res, filePath);
    return;
  }

  sendFile(res, path.join(ROOT, 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Frontend server running at http://localhost:${PORT}`);
});
