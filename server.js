// server.js — Krestianstvo SDK 4
// Minimal HTTP static file server + WebSocket reflector.
// No express, no frameworks. Only Node built-ins + ws + renkon-core.
//
// Usage:
//   npm install ws renkon-core
//   node server.js
//   node server.js --port 8888
//   node server.js --port 8888 --root ./public
//
// Layout expected:
//   server.js          ← this file
//   reflector.js      ← WebSocket reflector (must be in same directory)
//   public/            ← static files served over HTTP (default)
//     index.html
//     krestianstvo-vm.js
//     ...

import http               from 'http';
import fs                 from 'fs';
import path               from 'path';
import { WebSocketServer } from 'ws';
import { attachReflector } from './reflector.js';

// ── Config ─────────────────────────────────────────────────────────────────

const args   = process.argv.slice(2);
const PORT   = Number(args[args.indexOf('--port')  + 1] || process.env.PORT || 3000);
const ROOT   = path.resolve(args[args.indexOf('--root')  + 1] || './public');

// ── MIME types ─────────────────────────────────────────────────────────────

const MIME = {
    '.html':  'text/html; charset=utf-8',
    '.js':    'application/javascript; charset=utf-8',
    '.mjs':   'application/javascript; charset=utf-8',
    '.css':   'text/css; charset=utf-8',
    '.json':  'application/json; charset=utf-8',
    '.png':   'image/png',
    '.jpg':   'image/jpeg',
    '.jpeg':  'image/jpeg',
    '.svg':   'image/svg+xml',
    '.ico':   'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff':  'font/woff',
    '.ttf':   'font/ttf',
    '.txt':   'text/plain; charset=utf-8',
    '.md':    'text/markdown; charset=utf-8',
    '.wasm':  'application/wasm',
};

// ── CORS headers ───────────────────────────────────────────────────────────

const CORS_HEADERS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    "Access-Control-Max-Age": "0" 
};

// ── HTTP static file handler ───────────────────────────────────────────────

function serveStatic(req, res) {
    // CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        return res.end();
    }

    // Only GET/HEAD
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { ...CORS_HEADERS, 'Content-Type': 'text/plain' });
        return res.end('Method Not Allowed');
    }

    // Sanitise path — prevent directory traversal
    const urlPath = new URL(req.url, 'http://x').pathname;
    let filePath  = path.join(ROOT, decodeURIComponent(urlPath));

    // Normalise: /  → index.html
    if (filePath.endsWith(path.sep) || fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
    }

    // Guard: must stay inside ROOT
    if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
        res.writeHead(403, { ...CORS_HEADERS, 'Content-Type': 'text/plain' });
        return res.end('Forbidden');
    }

    fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
            // SPA fallback — serve index.html for unknown paths so client-side
            // history routing (e.g. /room/abc, /app/settings) works on reload.
            const indexPath = path.join(ROOT, 'index.html');
            fs.stat(indexPath, (err2, stat2) => {
                if (err2 || !stat2.isFile()) {
                    res.writeHead(404, { ...CORS_HEADERS, 'Content-Type': 'text/plain' });
                    return res.end(`Not Found: ${urlPath}`);
                }
                const headers = {
                    ...CORS_HEADERS,
                    'Content-Type':   'text/html; charset=utf-8',
                    'Content-Length': stat2.size,
                    'Cache-Control':  'no-cache',
                };
                res.writeHead(200, headers);
                if (req.method === 'HEAD') return res.end();
                fs.createReadStream(indexPath).pipe(res);
            });
            return;
        }

        const ext     = path.extname(filePath).toLowerCase();
        const mime    = MIME[ext] || 'application/octet-stream';
        const headers = {
            ...CORS_HEADERS,
            'Content-Type':   mime,
            'Content-Length': stat.size,
            'Cache-Control':  'no-cache',
        };

        res.writeHead(200, headers);
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(filePath).pipe(res);
    });
}

// ── HTTP server ────────────────────────────────────────────────────────────

const server = http.createServer(serveStatic);

// ── WebSocket server + reflector ───────────────────────────────────────────

const wss = new WebSocketServer({ server });
attachReflector(wss);

// ── Start ──────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
    console.log(`HTTP  → http://localhost:${PORT}  (serving ${ROOT})`);
    console.log(`WS    → ws://localhost:${PORT}`);
    console.log(`Ready.`);
});
