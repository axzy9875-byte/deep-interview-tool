// 豆包录音文件极速版：浏览器录音统一转换成 16 kHz 单声道 PCM WAV。
export function encodeWav(samples, rate = 16000) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset, text) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); write(8, 'WAVE');
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => { const value = Math.max(-1, Math.min(1, sample)); view.setInt16(44 + i * 2, value * (value < 0 ? 32768 : 32767), true); });
  return new Uint8Array(buffer);
}
export async function audioToWav(blob) {
  if (blob.size > 20 * 1024 * 1024) throw new Error('请使用小于 20 MB 的短录音');
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (decoded.duration > 600) throw new Error('每次录音请控制在 10 分钟内，长回答可以分段录入');
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
    const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
    const rendered = await offline.startRendering();
    return encodeWav(rendered.getChannelData(0));
  } finally { await context.close(); }
}
export function speechHeaders(config, requestId) {
  const auth = config.authMode === 'legacy'
    ? { 'X-Api-App-Key': config.appId, 'X-Api-Access-Key': config.apiKey }
    : { 'X-Api-Key': config.apiKey };
  return { ...auth, 'Content-Type': 'application/json', 'X-Api-Resource-Id': 'volc.bigasr.auc_turbo', 'X-Api-Request-Id': requestId, 'X-Api-Sequence': '-1' };
}
export async function transcribeDoubao(blob, config) {
  if (!config.apiKey?.trim() || (config.authMode === 'legacy' && !config.appId?.trim())) throw new Error('请完整填写豆包语音凭据');
  const bytes = await audioToWav(blob);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  const response = await fetch('/api/doubao-speech', {
    method: 'POST', headers: speechHeaders(config, crypto.randomUUID()),
    body: JSON.stringify({ user: { uid: 'personal-interview' }, audio: { data: btoa(binary) }, request: { model_name: 'bigmodel', enable_itn: true, enable_punc: true } }),
    signal: AbortSignal.timeout(180000)
  });
  const code = response.headers.get('X-Api-Status-Code');
  if (!response.ok || code !== '20000000') throw new Error(`豆包语音识别失败（${code || response.status}）：${response.headers.get('X-Api-Message') || '请检查密钥、服务开通状态及额度'}`);
  const result = await response.json();
  return { text: result.result?.text || '' };
}
