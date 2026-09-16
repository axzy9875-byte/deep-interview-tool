import http from 'node:http';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Readable } from 'node:stream';
import { PUBLIC_SPEECH_TOKEN_LIMIT, PublicInterviewStore } from './lib/publicInterviewStore.js';
import { PublicSpeechConfigStore, transcribePublicWav, validatePublicWav } from './lib/publicSpeechService.js';

const root = path.resolve(fileURLToPath(new URL('./dist/', import.meta.url)));
const interviewStore = new PublicInterviewStore(process.env.INTERVIEW_DATA_FILE || path.resolve(fileURLToPath(new URL('./server-data/public-interviews.json', import.meta.url))));
const publicSpeechStore = new PublicSpeechConfigStore(process.env.PUBLIC_SPEECH_CONFIG_FILE || path.resolve(fileURLToPath(new URL('./server-data/public-speech.json', import.meta.url))));
export const targets = {
  '/api/ark/chat/completions': 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
  '/api/siliconflow/chat/completions': 'https://api.siliconflow.cn/v1/chat/completions',
  '/api/openai/chat/completions': 'https://api.openai.com/v1/chat/completions',
  '/api/deepseek/chat/completions': 'https://api.deepseek.com/v1/chat/completions',
  '/api/siliconflow/audio/transcriptions': 'https://api.siliconflow.cn/v1/audio/transcriptions',
  '/api/openai/audio/transcriptions': 'https://api.openai.com/v1/audio/transcriptions',
  '/api/doubao-speech': 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash'
};

function json(res, status, value, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(value));
}

async function readJson(req, limit = 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('请求内容过大');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(item => item.trim()).filter(Boolean).map(item => {
    const index = item.indexOf('=');
    return [decodeURIComponent(item.slice(0, index)), decodeURIComponent(item.slice(index + 1))];
  }));
}

function adminSignature(expiry) {
  const secret = process.env.ADMIN_COOKIE_SECRET || process.env.ADMIN_PASSWORD || 'local-development-only';
  return createHmac('sha256', secret).update(`admin:${expiry}`).digest('base64url');
}

function visitorSignature(id) {
  const secret = process.env.ADMIN_COOKIE_SECRET || process.env.ADMIN_PASSWORD || 'local-development-only';
  return createHmac('sha256', secret).update(`visitor:${id}`).digest('base64url');
}

function visitorIdentity(req) {
  const raw = cookies(req).ainterview_visitor || '';
  const [savedId, savedSignature] = raw.split('.');
  if (savedId && savedSignature) {
    const expected = Buffer.from(visitorSignature(savedId));
    const received = Buffer.from(savedSignature);
    if (expected.length === received.length && timingSafeEqual(expected, received)) return savedId;
  }
  return randomBytes(24).toString('base64url');
}

function visitorCookie(id) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `ainterview_visitor=${id}.${visitorSignature(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`;
}

function isLoopback(req) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress);
}

function isAdmin(req) {
  if (!process.env.ADMIN_PASSWORD && isLoopback(req)) return true;
  const value = cookies(req).ainterview_admin || '';
  const [expiry, signature] = value.split('.');
  if (!expiry || Number(expiry) < Date.now()) return false;
  const expected = Buffer.from(adminSignature(expiry));
  const received = Buffer.from(signature || '');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

async function handleInterviewApi(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  if (!pathname.startsWith('/api/admin/') && !pathname.startsWith('/api/public/')) return false;
  try {
    if (pathname === '/api/admin/me' && req.method === 'GET') {
      json(res, 200, { authenticated: isAdmin(req), passwordConfigured: !!process.env.ADMIN_PASSWORD });
      return true;
    }
    if (pathname === '/api/admin/login' && req.method === 'POST') {
      const body = await readJson(req);
      if (!process.env.ADMIN_PASSWORD) {
        if (!isLoopback(req)) { json(res, 503, { error: '公开部署前必须设置 ADMIN_PASSWORD' }); return true; }
      } else {
        const expected = Buffer.from(process.env.ADMIN_PASSWORD);
        const received = Buffer.from(String(body.password || ''));
        if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
          json(res, 401, { error: '管理员密码不正确' }); return true;
        }
      }
      const expiry = Date.now() + 7 * 24 * 60 * 60 * 1000;
      const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
      json(res, 200, { authenticated: true }, { 'Set-Cookie': `ainterview_admin=${expiry}.${adminSignature(expiry)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${secure}` });
      return true;
    }
    if (pathname === '/api/admin/logout' && req.method === 'POST') {
      json(res, 200, { authenticated: false }, { 'Set-Cookie': 'ainterview_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' });
      return true;
    }
    if (pathname.startsWith('/api/admin/') && !isAdmin(req)) {
      json(res, 401, { error: '请先登录管理员页面' }); return true;
    }
    if (pathname === '/api/admin/campaigns' && req.method === 'GET') {
      json(res, 200, { campaigns: await interviewStore.listCampaigns() }); return true;
    }
    if (pathname === '/api/admin/campaigns' && req.method === 'POST') {
      json(res, 201, { campaign: await interviewStore.createCampaign(await readJson(req)) }); return true;
    }
    if (pathname === '/api/admin/sessions' && req.method === 'GET') {
      json(res, 200, { sessions: await interviewStore.listSessions(url.searchParams.get('campaignId')) }); return true;
    }
    if (pathname === '/api/admin/public-speech' && req.method === 'GET') {
      json(res, 200, { config: await publicSpeechStore.publicStatus(), tokenLimit: PUBLIC_SPEECH_TOKEN_LIMIT }); return true;
    }
    if (pathname === '/api/admin/public-speech' && req.method === 'PUT') {
      json(res, 200, { config: await publicSpeechStore.save(await readJson(req)), tokenLimit: PUBLIC_SPEECH_TOKEN_LIMIT }); return true;
    }

    const campaignMatch = pathname.match(/^\/api\/public\/campaigns\/([^/]+)$/);
    if (campaignMatch && req.method === 'GET') {
      const campaign = await interviewStore.getPublicCampaign(decodeURIComponent(campaignMatch[1]));
      const speech = await publicSpeechStore.publicStatus();
      json(res, campaign ? 200 : 404, campaign ? { campaign: { ...campaign, speechEnabled: speech.enabled } } : { error: '访谈不存在或已停止' }); return true;
    }
    const createSessionMatch = pathname.match(/^\/api\/public\/campaigns\/([^/]+)\/sessions$/);
    if (createSessionMatch && req.method === 'POST') {
      const visitorId = visitorIdentity(req);
      const created = await interviewStore.createSession(decodeURIComponent(createSessionMatch[1]), await readJson(req), visitorId);
      json(res, 201, created, { 'Set-Cookie': visitorCookie(visitorId) }); return true;
    }
    const transcriptionMatch = pathname.match(/^\/api\/public\/sessions\/([^/]+)\/transcriptions$/);
    if (transcriptionMatch && req.method === 'POST') {
      const id = decodeURIComponent(transcriptionMatch[1]);
      const token = req.headers['x-session-token'] || '';
      const visitorId = visitorIdentity(req);
      const bound = await interviewStore.bindSessionVisitor(id, token, visitorId);
      if (!bound) { json(res, 404, { error: '访谈记录不存在或恢复凭据无效' }); return true; }
      const config = await publicSpeechStore.runtimeConfig();
      if (!config.enabled || !config.apiKey) { json(res, 503, { error: '访谈发起者尚未启用公开语音转写' }); return true; }
      const body = await readJson(req, 9 * 1024 * 1024);
      const bytes = validatePublicWav(body.audio);
      const reservation = await interviewStore.beginSpeechRequest(id, token);
      if (!reservation) { json(res, 404, { error: '访谈记录不存在或恢复凭据无效' }); return true; }
      try {
        const result = await transcribePublicWav(bytes, config, reservation.quota.remaining);
        const speechQuota = await interviewStore.finishSpeechRequest(id, token, reservation.requestId, result.usedTokens);
        json(res, 200, { text: result.text, speechQuota, usedTokens: result.usedTokens }, { 'Set-Cookie': visitorCookie(visitorId) });
      } catch (error) {
        await interviewStore.cancelSpeechRequest(id, token, reservation.requestId).catch(() => {});
        throw error;
      }
      return true;
    }
    const sessionMatch = pathname.match(/^\/api\/public\/sessions\/([^/]+)$/);
    if (sessionMatch && ['GET', 'PATCH'].includes(req.method)) {
      const token = req.headers['x-session-token'] || url.searchParams.get('token') || '';
      const id = decodeURIComponent(sessionMatch[1]);
      const session = req.method === 'GET'
        ? await interviewStore.getSession(id, token)
        : await interviewStore.updateSession(id, token, await readJson(req));
      json(res, session ? 200 : 404, session ? { session } : { error: '访谈记录不存在或恢复凭据无效' }); return true;
    }
    json(res, 404, { error: '接口不存在' });
    return true;
  } catch (error) {
    json(res, error.statusCode || 400, { error: error.message || '请求处理失败' });
    return true;
  }
}

export async function proxy(req, res, next) {
  if (!req.url.startsWith('/api/')) return next();
  if (req.method === 'GET' && new URL(req.url, 'http://localhost').pathname === '/api/health') {
    json(res, 200, { status: 'ok' });
    return;
  }
  if (await handleInterviewApi(req, res)) return;
  const target = targets[req.url];
  if (!target || req.method !== 'POST') { res.writeHead(404); res.end(); return; }
  // 本地专用：限制 Host / Origin，防止其他网页滥用本机代理。
  const allowed = ['127.0.0.1', 'localhost', '[::1]'];
  if (process.env.PUBLIC_ORIGIN) allowed.push(new URL(process.env.PUBLIC_ORIGIN).hostname);
  if (process.env.RENDER_EXTERNAL_HOSTNAME) allowed.push(process.env.RENDER_EXTERNAL_HOSTNAME);
  try {
    if (!allowed.includes(new URL(`http://${req.headers.host}`).hostname)) throw new Error();
    if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw new Error();
  } catch { res.writeHead(403); res.end('Forbidden'); return; }
  try {
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 30 * 1024 * 1024) { res.writeHead(413); res.end('Audio too large'); return; }
      chunks.push(chunk);
    }
    const headers = {};
    for (const key of ['authorization', 'content-type', 'x-api-key', 'x-api-app-key', 'x-api-access-key', 'x-api-resource-id', 'x-api-request-id', 'x-api-sequence']) {
      if (req.headers[key]) headers[key] = req.headers[key];
    }
    const upstream = await fetch(target, { method: 'POST', headers, body: Buffer.concat(chunks), signal: AbortSignal.timeout(180000) });
    const responseHeaders = { 'Cache-Control': 'no-store' };
    for (const key of ['content-type', 'x-api-status-code', 'x-api-message', 'x-tt-logid']) {
      if (upstream.headers.has(key)) responseHeaders[key] = upstream.headers.get(key);
    }
    res.writeHead(upstream.status, responseHeaders);
    if (upstream.body) Readable.fromWeb(upstream.body).on('error', () => res.destroy()).pipe(res);
    else res.end();
  } catch {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: '连接服务商失败或超时，请检查网络后重试' } }));
  }
}
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
export function startServer(port = 5173) {
  const server = http.createServer((req, res) => proxy(req, res, async () => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      let filename = path.resolve(root, '.' + pathname);
      if (!filename.startsWith(root + path.sep) && filename !== root) { res.writeHead(403); res.end(); return; }
      if (!path.extname(filename)) filename = path.join(root, 'index.html');
      const data = await readFile(filename);
      res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream' }); res.end(data);
    } catch { res.writeHead(404); res.end('Not found'); }
  }));
  const host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => console.log(`我的 AI 访谈：http://localhost:${port}/admin`));
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer(Number(process.env.PORT || 5173));
