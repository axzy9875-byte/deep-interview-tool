import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ARK_SPEECH_MODEL, ARK_URL, buildArkSpeechRequest, parseArkTranscript } from './arkSpeech.js';

const normalized = value => String(value || '').trim();

export class PublicSpeechConfigStore {
  constructor(filename) {
    this.filename = filename;
    this.writeQueue = Promise.resolve();
  }

  async readFileConfig() {
    try {
      const data = JSON.parse(await readFile(this.filename, 'utf8'));
      return {
        enabled: data.enabled === true,
        apiKey: normalized(data.apiKey),
        baseUrl: ARK_URL,
        model: normalized(data.model) || ARK_SPEECH_MODEL
      };
    } catch (error) {
      if (error.code === 'ENOENT') return { enabled: false, apiKey: '', baseUrl: ARK_URL, model: ARK_SPEECH_MODEL };
      throw error;
    }
  }

  async runtimeConfig() {
    const environmentKey = normalized(process.env.PUBLIC_SPEECH_API_KEY);
    if (environmentKey) return {
      enabled: process.env.PUBLIC_SPEECH_ENABLED !== 'false',
      apiKey: environmentKey,
      baseUrl: ARK_URL,
      model: normalized(process.env.PUBLIC_SPEECH_MODEL) || ARK_SPEECH_MODEL,
      source: 'environment'
    };
    return { ...(await this.readFileConfig()), source: 'server' };
  }

  async publicStatus() {
    const config = await this.runtimeConfig();
    return { enabled: config.enabled && !!config.apiKey, model: config.model, apiKeyConfigured: !!config.apiKey, source: config.source };
  }

  async save(input = {}) {
    if (normalized(process.env.PUBLIC_SPEECH_API_KEY)) {
      const error = new Error('公开语音配置由服务器环境变量管理，请在部署平台修改');
      error.statusCode = 409;
      throw error;
    }
    const operation = this.writeQueue.then(async () => {
      const current = await this.readFileConfig();
      const next = {
        enabled: input.enabled === true,
        apiKey: normalized(input.apiKey) || current.apiKey,
        baseUrl: ARK_URL,
        model: normalized(input.model) || current.model || ARK_SPEECH_MODEL
      };
      if (next.enabled && !next.apiKey) throw new Error('启用公开语音转写前，请填写火山方舟 API Key');
      await mkdir(path.dirname(this.filename), { recursive: true });
      const temporary = `${this.filename}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temporary, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, this.filename);
      return this.publicStatus();
    });
    this.writeQueue = operation.catch(() => {});
    return operation;
  }
}

export function validatePublicWav(value) {
  if (typeof value !== 'string' || !value.length) throw new Error('没有收到录音数据');
  if (value.length > 8 * 1024 * 1024) throw new Error('录音数据过大，每次请控制在 3 分钟内');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length < 1000) throw new Error('录音时间太短，请重新录制');
  if (bytes.subarray(0, 4).toString('ascii') !== 'RIFF' || bytes.subarray(8, 12).toString('ascii') !== 'WAVE') {
    throw new Error('录音格式无效，请使用网页中的录音按钮重新录制');
  }
  if (bytes.length > 44 + 16000 * 2 * 180) throw new Error('每次录音请控制在 3 分钟内，长回答可以分段转写');
  return new Uint8Array(bytes);
}

function usageTokens(data, bytes, text) {
  const reported = Number(data?.usage?.total_tokens);
  if (Number.isFinite(reported) && reported > 0) return Math.floor(reported);
  const prompt = Number(data?.usage?.prompt_tokens) || 0;
  const completion = Number(data?.usage?.completion_tokens) || 0;
  if (prompt + completion > 0) return Math.floor(prompt + completion);
  // Older compatible responses can omit usage. Keep the server quota effective
  // with a conservative estimate based on audio duration and returned text.
  const seconds = Math.max(1, (bytes.length - 44) / 32000);
  return Math.ceil(seconds * 100 + String(text || '').length / 2 + 200);
}

export async function transcribePublicWav(bytes, config, maxTokens = 8192) {
  const body = buildArkSpeechRequest(bytes, config.model, Math.max(1, Math.min(8192, maxTokens)));
  const response = await fetch(`${ARK_URL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000)
  });
  let data;
  try { data = await response.json(); } catch { throw new Error(`方舟返回异常响应（HTTP ${response.status}）`); }
  if (!response.ok || data.error) {
    const code = data.error?.code || response.status;
    throw new Error(`公开语音转写失败（${code}）：${data.error?.message || '请检查服务器语音配置和账号额度'}`);
  }
  const result = parseArkTranscript(data);
  return { ...result, usedTokens: usageTokens(data, bytes, result.text), providerUsage: data.usage || null };
}
