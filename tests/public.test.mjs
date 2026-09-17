import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { PublicInterviewStore } from '../lib/publicInterviewStore.js';
import { encodeWav } from '../lib/doubaoSpeech.js';

test('public interview store preserves paused, completed and repeated attempts with timestamps', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ainterview-public-'));
  const filename = path.join(directory, 'records.json');
  const store = new PublicInterviewStore(filename);
  try {
    const campaign = await store.createCampaign({ title: '研究访谈', questions: ['第一题？', '第二题？'] });
    const first = await store.createSession(campaign.id, { participantName: '测试者', attemptGroupId: 'same-person' }, 'visitor-one');
    let session = await store.updateSession(first.session.id, first.token, { answers: { question_1: '第一次回答' }, currentQuestionIndex: 1, status: 'paused' });
    assert.equal(session.status, 'paused');
    assert.ok(session.pausedAt);
    session = await store.updateSession(first.session.id, first.token, { status: 'active' });
    const speech = await store.beginSpeechRequest(first.session.id, first.token);
    assert.equal(speech.quota.remaining, 200000);
    assert.equal((await store.finishSpeechRequest(first.session.id, first.token, speech.requestId, 60000)).remaining, 140000);
    session = await store.updateSession(first.session.id, first.token, { answers: { question_2: '第二次回答' }, status: 'completed' });
    assert.equal(session.status, 'completed');
    assert.ok(session.completedAt);
    const second = await store.createSession(campaign.id, { participantName: '测试者', attemptGroupId: 'same-person' }, 'visitor-one');
    assert.equal(second.session.attemptNumber, 2);
    assert.equal(second.session.speechQuota.used, 60000);
    const secondSpeech = await store.beginSpeechRequest(second.session.id, second.token);
    await store.finishSpeechRequest(second.session.id, second.token, secondSpeech.requestId, 140000);
    await assert.rejects(() => store.beginSpeechRequest(second.session.id, second.token), error => error.statusCode === 429 && /200,000/.test(error.message));
    const otherVisitor = await store.createSession(campaign.id, { participantName: '另一位访客' }, 'visitor-two');
    assert.equal(otherVisitor.session.speechQuota.remaining, 200000);
    assert.equal((await store.listSessions(campaign.id)).length, 3);
    assert.equal((await store.listCampaigns())[0].completedCount, 1);
    assert.equal(await store.getSession(first.session.id, 'wrong-token'), null);
    let persisted = JSON.parse(await readFile(filename, 'utf8'));
    assert.equal(persisted.sessions[0].answers.question_1.content, '第一次回答');
    assert.ok(!JSON.stringify(await store.getSession(first.session.id, first.token)).includes('tokenHash'));
    assert.equal((await store.deleteSession(first.session.id)).id, first.session.id);
    assert.equal((await store.listSessions(campaign.id)).length, 2);
    const deletedCampaign = await store.deleteCampaign(campaign.id);
    assert.equal(deletedCampaign.sessionsDeleted, 2);
    assert.equal((await store.listCampaigns()).length, 0);
    assert.equal((await store.listSessions()).length, 0);
    persisted = JSON.parse(await readFile(filename, 'utf8'));
    assert.deepEqual(persisted.campaigns, []);
    assert.deepEqual(persisted.sessions, []);
    assert.deepEqual(persisted.visitors, []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('public HTTP flow exposes only campaign questions and stores each attempt server-side', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ainterview-http-'));
  process.env.INTERVIEW_DATA_FILE = path.join(directory, 'records.json');
  process.env.ADMIN_PASSWORD = 'test-admin-password';
  process.env.ADMIN_COOKIE_SECRET = 'test-cookie-secret';
  process.env.PUBLIC_SPEECH_CONFIG_FILE = path.join(directory, 'public-speech.json');
  const { startServer } = await import(`../server.mjs?public-test=${Date.now()}`);
  const server = startServer(0); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const realFetch = global.fetch;
  let upstreamCalls = 0;
  global.fetch = async (input, options) => {
    if (String(input) === 'https://ark.cn-beijing.volces.com/api/v3/chat/completions') {
      upstreamCalls += 1;
      assert.equal(options.headers.Authorization, 'Bearer public-speech-secret');
      assert.equal(JSON.parse(options.body).model, 'doubao-seed-2-0-lite-260428');
      return new Response(JSON.stringify({
        choices: [{ message: { content: '这是公开语音转写结果。' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 199000, completion_tokens: 1000, total_tokens: 200000 }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(input, options);
  };
  const send = async (pathname, options = {}) => {
    const response = await realFetch(base + pathname, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    return { response, data: await response.json() };
  };
  try {
    const denied = await send('/api/admin/campaigns', { method: 'GET' });
    assert.equal(denied.response.status, 401);
    const login = await send('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: 'test-admin-password' }) });
    assert.equal(login.response.status, 200);
    const cookie = login.response.headers.get('set-cookie').split(';')[0];
    const configured = await send('/api/admin/public-speech', { method: 'PUT', headers: { Cookie: cookie }, body: JSON.stringify({ enabled: true, apiKey: 'public-speech-secret', model: 'doubao-seed-2-0-lite-260428' }) });
    assert.equal(configured.data.config.enabled, true);
    assert.equal(configured.data.tokenLimit, 200000);
    assert.ok(!JSON.stringify(configured.data).includes('public-speech-secret'));
    const created = await send('/api/admin/campaigns', { method: 'POST', headers: { Cookie: cookie }, body: JSON.stringify({ title: '公开访谈', description: '说明', questions: ['问题一？', '问题二？'] }) });
    assert.equal(created.response.status, 201);
    const campaign = created.data.campaign;
    const publicCampaign = await send(`/api/public/campaigns/${campaign.id}`);
    assert.deepEqual(Object.keys(publicCampaign.data.campaign).sort(), ['createdAt', 'description', 'id', 'questions', 'speechEnabled', 'title']);
    assert.equal(publicCampaign.data.campaign.speechEnabled, true);
    const started = await send(`/api/public/campaigns/${campaign.id}/sessions`, { method: 'POST', body: JSON.stringify({ participantName: '匿名测试' }) });
    assert.equal(started.response.status, 201);
    const visitorCookie = started.response.headers.get('set-cookie').split(';')[0];
    const wav = encodeWav(new Float32Array(16000));
    const transcribed = await send(`/api/public/sessions/${started.data.session.id}/transcriptions`, {
      method: 'POST',
      headers: { Cookie: visitorCookie, 'X-Session-Token': started.data.token },
      body: JSON.stringify({ audio: Buffer.from(wav).toString('base64') })
    });
    assert.equal(transcribed.response.status, 200);
    assert.equal(transcribed.data.text, '这是公开语音转写结果。');
    assert.equal(transcribed.data.speechQuota.remaining, 0);
    const blocked = await send(`/api/public/sessions/${started.data.session.id}/transcriptions`, {
      method: 'POST',
      headers: { Cookie: visitorCookie, 'X-Session-Token': started.data.token },
      body: JSON.stringify({ audio: Buffer.from(wav).toString('base64') })
    });
    assert.equal(blocked.response.status, 429);
    assert.equal(upstreamCalls, 1);
    const saved = await send(`/api/public/sessions/${started.data.session.id}`, { method: 'PATCH', headers: { 'X-Session-Token': started.data.token }, body: JSON.stringify({ answers: { question_1: '回答一' }, status: 'paused' }) });
    assert.equal(saved.data.session.status, 'paused');
    const adminSessions = await send(`/api/admin/sessions?campaignId=${campaign.id}`, { headers: { Cookie: cookie } });
    assert.equal(adminSessions.data.sessions[0].answers.question_1.content, '回答一');
    assert.ok(adminSessions.data.sessions[0].startedAt);
    const deletedSession = await send(`/api/admin/sessions/${started.data.session.id}`, { method: 'DELETE', headers: { Cookie: cookie } });
    assert.equal(deletedSession.response.status, 200);
    const missingSession = await send(`/api/public/sessions/${started.data.session.id}?token=${started.data.token}`);
    assert.equal(missingSession.response.status, 404);
    const deletedCampaign = await send(`/api/admin/campaigns/${campaign.id}`, { method: 'DELETE', headers: { Cookie: cookie } });
    assert.equal(deletedCampaign.response.status, 200);
    const missingCampaign = await send(`/api/public/campaigns/${campaign.id}`);
    assert.equal(missingCampaign.response.status, 404);
    const remainingCampaigns = await send('/api/admin/campaigns', { headers: { Cookie: cookie } });
    assert.deepEqual(remainingCampaigns.data.campaigns, []);
  } finally {
    global.fetch = realFetch;
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
    delete process.env.INTERVIEW_DATA_FILE;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_COOKIE_SECRET;
    delete process.env.PUBLIC_SPEECH_CONFIG_FILE;
  }
});
