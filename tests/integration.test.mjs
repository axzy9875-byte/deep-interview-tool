import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { APIConfigManager } from '../lib/apiConfig.js';
import { AIAPIClient } from '../lib/aiClient.js';
import { encodeWav, speechHeaders } from '../lib/doubaoSpeech.js';
import { completionOptions } from '../lib/providerConfig.js';
import { startServer, targets } from '../server.mjs';
const stored = new Map();
globalThis.localStorage = { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) };

test('switch providers without losing model/key; preserve verification', () => {
  for (const [baseUrl, model, apiKey] of [['https://api.deepseek.com/v1', 'deepseek-chat', 'test-deepseek'], ['https://ark.cn-beijing.volces.com/api/v3', 'ep-custom', 'test-ark']]) {
    APIConfigManager.saveConfig({ baseUrl, model, apiKey, isValid: true });
    assert.equal(APIConfigManager.loadProviderConfig(baseUrl).model, model);
    assert.equal(APIConfigManager.loadProviderConfig(baseUrl).apiKey, apiKey);
  }
  assert.equal(APIConfigManager.loadConfig().isValid, true);
  assert.equal(APIConfigManager.loadProviderConfig('https://api.deepseek.com/v1').apiKey, 'test-deepseek');
});
test('speech credentials survive disable, save and reload', () => {
  APIConfigManager.saveSpeechConfig({ enabled: false, apiKey: 'test-speech', baseUrl: 'https://openspeech.bytedance.com', model: 'bigmodel', appId: '123', authMode: 'legacy' });
  const value = APIConfigManager.loadSpeechConfig();
  assert.equal(value.apiKey, 'test-speech'); assert.equal(value.appId, '123'); assert.equal(value.enabled, false);
  assert.equal(speechHeaders(value, 'test-id')['X-Api-Access-Key'], 'test-speech');
  assert.equal(speechHeaders({ ...value, authMode: 'apiKey' }, 'test-id')['X-Api-Key'], 'test-speech');
});
test('WAV encoder creates valid mono PCM16 and clips samples', () => {
  const bytes = encodeWav(new Float32Array([-2, 0, 2])); const view = new DataView(bytes.buffer);
  assert.equal(new TextDecoder().decode(bytes.slice(0,4)), 'RIFF');
  assert.equal(view.getUint32(24,true),16000); assert.equal(view.getUint16(22,true),1);
  assert.equal(view.getInt16(44,true),-32768); assert.equal(view.getInt16(48,true),32767);
});
test('Doubao compatibility parameters do not affect DeepSeek', () => {
  assert.deepEqual(completionOptions({ baseUrl: 'https://api.deepseek.com/v1' }), {});
  assert.deepEqual(completionOptions({ baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/' }), { thinking: { type: 'disabled' } });
});
test('SDK sends Doubao model and non-thinking option; parses response', async () => {
  const original = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (url, options) => { requestBody = JSON.parse(options.body); return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { headers: { 'Content-Type': 'application/json' } }); };
  try {
    const result = await AIAPIClient.testConnection({ baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', apiKey: 'test-key', model: 'doubao-seed-2-0-lite-260215' });
    assert.equal(result.success,true); assert.equal(requestBody.thinking.type,'disabled'); assert.equal(requestBody.model,'doubao-seed-2-0-lite-260215');
  } finally { globalThis.fetch = original; }
});

test('interview script generation uses a completed Ark response and rejects empty drafts', async () => {
  const client = new AIAPIClient({ baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', apiKey: 'test-key', model: 'doubao-seed-2-0-lite-260215' });
  let request;
  client.client.chat.completions.create = async options => {
    request = options;
    return { choices: [{ message: { content: [{ type: 'text', text: '## 访谈稿\n\n有效正文' }] } }] };
  };
  const script = await client.generateScriptStreamWithStyle({ context: {}, questions: [], answers: {} }, 'default');
  assert.equal(request.stream, undefined);
  assert.equal(request.thinking.type, 'disabled');
  assert.match(script.content, /有效正文/);
  assert.ok(script.wordCount > 0);
  assert.throws(() => client.parseScriptResponse({ choices: [{ message: { content: '' } }] }), /空访谈稿/);
});

test('QA interview script always includes every original question and answer without a model call', async () => {
  const client = new AIAPIClient({ baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', apiKey: 'test-key', model: 'doubao-seed-2-0-lite-260215' });
  client.client.chat.completions.create = async () => { throw new Error('QA style must not call the model'); };
  const questions = Array.from({ length: 12 }, (_, index) => ({ id: `q${index + 1}`, content: `原题${index + 1}？` }));
  const answers = Object.fromEntries(questions.map((question, index) => [question.id, { content: `原回答${index + 1}` }]));
  const script = await client.generateScriptStreamWithStyle({ context: {}, questions, answers }, 'qa');
  assert.equal(script.completeQa, true);
  assert.equal(script.sourceQuestionCount, 12);
  assert.equal((script.content.match(/^## 第 \d+ 问$/gm) || []).length, 12);
  for (let index = 1; index <= 12; index += 1) {
    assert.match(script.content, new RegExp(`原题${index}\\？`));
    assert.match(script.content, new RegExp(`原回答${index}`));
  }
});

test('empty streaming script falls back to a completed response', async () => {
  const client = new AIAPIClient({ baseUrl: 'https://api.deepseek.com/v1', apiKey: 'test-key', model: 'deepseek-chat' });
  const requests = [];
  client.client.chat.completions.create = async options => {
    requests.push(options);
    if (options.stream) return { async *[Symbol.asyncIterator]() { yield { choices: [{ delta: {} }] }; } };
    return { choices: [{ message: { content: '回退生成的访谈稿' } }] };
  };
  const script = await client.generateScriptStreamWithStyle({ context: {}, questions: [], answers: {} }, 'default');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].stream, true);
  assert.equal(requests[1].stream, undefined);
  assert.equal(script.content, '回退生成的访谈稿');
});
test('local proxy forwards speech headers/body, preserves business errors, rejects foreign origins', async () => {
  const original = globalThis.fetch; const server = startServer(0); await once(server,'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith(base)) return original(url, options);
    assert.equal(url,targets['/api/doubao-speech']); assert.equal(options.headers['x-api-key'],'test-only');
    assert.equal(JSON.parse(options.body).audio.data,'test-audio');
    return new Response(JSON.stringify({ result: { text: '测试识别' } }), { headers: { 'X-Api-Status-Code': '20000000', 'Content-Type': 'application/json' } });
  };
  try {
    const health = await fetch(base + '/api/health'); assert.equal(health.status, 200); assert.equal((await health.json()).status, 'ok');
    const response = await fetch(base+'/api/doubao-speech', { method: 'POST', headers: { 'X-Api-Key':'test-only','Content-Type':'application/json' }, body: JSON.stringify({ audio: { data:'test-audio' } }) });
    assert.equal(response.headers.get('X-Api-Status-Code'),'20000000'); assert.equal((await response.json()).result.text,'测试识别');
    const bad = await fetch(base+'/api/doubao-speech', { method:'POST', headers: { Origin:'https://other.example' } }); assert.equal(bad.status,403);
    const unknown = await fetch(base+'/api/anything',{method:'POST'}); assert.equal(unknown.status,404);
    const page = await fetch(base+'/interview'); assert.equal(page.status,200);
  } finally { globalThis.fetch = original; server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('Seed audio request uses WAV input and keeps transcription independent of text provider', async () => {
  const { buildArkSpeechRequest, parseArkTranscript, ARK_SPEECH_MODEL } = await import('../lib/arkSpeech.js');
  const request = buildArkSpeechRequest(encodeWav(new Float32Array(160)), ARK_SPEECH_MODEL);
  assert.equal(request.model, 'doubao-seed-2-0-lite-260428');
  assert.equal(request.messages[0].content[1].type, 'input_audio');
  assert.equal(request.messages[0].content[1].input_audio.format, 'wav');
  assert.equal(Buffer.from(request.messages[0].content[1].input_audio.data, 'base64').toString('ascii', 0, 4), 'RIFF');
  assert.equal(buildArkSpeechRequest(new Uint8Array(4), 'ep-my-endpoint').model, 'ep-my-endpoint');
  APIConfigManager.saveSpeechConfig({ enabled: true, apiKey: 'test-ark', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: ARK_SPEECH_MODEL });
  APIConfigManager.saveConfig({ apiKey: 'test-deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' });
  assert.equal(APIConfigManager.loadSpeechConfig().model, ARK_SPEECH_MODEL);
  assert.deepEqual(parseArkTranscript({ choices: [{ message: { content: '逐字转写。' }, finish_reason: 'stop' }] }), { text: '逐字转写。' });
  assert.throws(() => parseArkTranscript({ choices: [{ finish_reason: 'length' }] }), /缩短录音/);
  assert.deepEqual(parseArkTranscript({ choices: [{ message: { content: '[未识别到人声]' } }] }), { text: '' });
});

test('speech client routes Seed audio to Ark with Bearer auth and reports authentication errors', async () => {
  const { SpeechAPIClient } = await import('../lib/speechClient.js');
  const saved = { fetch: globalThis.fetch, window: globalThis.window, offline: globalThis.OfflineAudioContext };
  globalThis.window = { location: { origin: 'http://localhost:5173' }, AudioContext: class {
    async decodeAudioData() { return { duration: 0.01 }; } async close() {}
  } };
  globalThis.OfflineAudioContext = class {
    createBufferSource() { return { connect() {}, start() {} }; }
    async startRendering() { return { getChannelData: () => new Float32Array(160) }; }
  };
  let fail = false;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'http://localhost:5173/api/ark/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer test-ark');
    assert.equal(options.headers['X-Api-Key'], undefined);
    assert.equal(JSON.parse(options.body).model, 'ep-my-endpoint');
    return new Response(JSON.stringify(fail ? { error: { code: 'InvalidApiKey', message: 'Invalid key' } } : { choices: [{ message: { content: '测试录音' }, finish_reason: 'stop' }] }), { status: fail ? 401 : 200 });
  };
  try {
    const client = new SpeechAPIClient({ baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', apiKey: 'test-ark', model: 'ep-my-endpoint' });
    assert.equal((await client.transcribe(new Blob(['test']))).text, '测试录音');
    fail = true;
    const oldError = console.error; console.error = () => {};
    try { const result = await client.testConnection(new Blob(['test'])); assert.equal(result.success, false); assert.match(result.error, /InvalidApiKey/); }
    finally { console.error = oldError; }
  } finally { globalThis.fetch = saved.fetch; if (saved.window === undefined) delete globalThis.window; else globalThis.window = saved.window; if (saved.offline === undefined) delete globalThis.OfflineAudioContext; else globalThis.OfflineAudioContext = saved.offline; }
});
