import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Group, Stack, Text } from '@mantine/core';
import { AudioRecorder, SpeechAPIClient } from '../../lib/speechClient.js';
import { APIConfigManager } from '../../lib/apiConfig.js';

export function SpeechVerification({ config }) {
  const [file, setFile] = useState(null);
  const [phase, setPhase] = useState('idle');
  const [result, setResult] = useState(null);
  const recorder = useRef(null);
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    recorder.current?.cleanup();
    setPhase('idle'); setResult(null);
    return () => { generation.current += 1; recorder.current?.cleanup(); };
  }, [config.enabled, config.apiKey, config.baseUrl, config.model, config.authMode, config.appId]);

  const validate = () => {
    const value = { ...config, apiKey: config.apiKey.trim(), baseUrl: config.baseUrl.trim().replace(/\/+$/, ''), model: config.model.trim(), appId: config.appId?.trim() || '' };
    if (!value.apiKey || !value.baseUrl || !value.model) throw new Error('请先填写语音 API 密钥、服务地址和模型。');
    if (value.baseUrl === 'https://openspeech.bytedance.com' && value.authMode === 'legacy' && !value.appId) throw new Error('旧版鉴权还需填写 App ID。');
    return value;
  };
  const verify = async (audio, current, value) => {
    setPhase('testing');
    if (!audio?.size) throw new Error('没有录到声音，请重新录制。');
    const response = await new SpeechAPIClient(value).testConnection(audio);
    if (generation.current !== current) return;
    if (!response.success) throw new Error(response.error || '语音 API 验证失败');
    const text = typeof response.data === 'string' ? response.data : response.data?.text || response.data?.transcript || '';
    APIConfigManager.saveSpeechConfig(value);
    setResult({ color: text.trim() ? 'green' : 'yellow', title: text.trim() ? '语音 API 验证成功，配置已保存' : '接口调用成功，配置已保存，但未识别到文字', text: text.trim() ? `识别结果：${text.trim()}` : '请在录音时清晰说一句话，再验证一次以确认转写效果。' });
  };
  const act = async () => {
    const current = generation.current;
    setResult(null);
    try {
      const value = validate();
      if (phase === 'recording') {
        const audio = await recorder.current.stopRecording();
        if (current !== generation.current) return;
        await verify(audio, current, value);
      } else if (file) {
        await verify(file, current, value);
      } else {
        setPhase('requesting');
        const activeRecorder = new AudioRecorder(); recorder.current = activeRecorder;
        await activeRecorder.startRecording();
        if (current !== generation.current) { activeRecorder.cleanup(); return; }
        setPhase('recording'); return;
      }
    } catch (error) {
      if (current === generation.current) setResult({ color: 'red', title: '语音 API 验证未通过', text: error.message });
    }
    if (current === generation.current) setPhase('idle');
  };
  const cancel = () => { generation.current += 1; recorder.current?.cleanup(); setPhase('idle'); setResult(null); };
  return <Stack spacing="sm">
    <Text weight={600}>验证语音 API</Text>
    <Text size="sm" color="dimmed">点击下方按钮录一句话，再点击“停止录音并验证”。也可先选择短音频文件，再点击验证。音频会发送给所选语音服务，可能产生少量费用。</Text>
    <input aria-label="选择验证用的音频文件（可选）" type="file" accept="audio/*" disabled={phase !== 'idle'} onChange={event => { setFile(event.currentTarget.files?.[0] || null); setResult(null); }} />
    <Group>
      <Button onClick={act} loading={phase === 'testing' || phase === 'requesting'} color={phase === 'recording' ? 'red' : 'blue'}>
        {phase === 'recording' ? '停止录音并验证' : phase === 'testing' ? '正在验证语音 API…' : phase === 'requesting' ? '等待麦克风权限…' : '验证语音 API'}
      </Button>
      {(phase === 'recording' || phase === 'requesting') && <Button variant="subtle" onClick={cancel}>取消录音</Button>}
    </Group>
    {phase === 'recording' && <Alert color="blue" role="status">正在录音，请说一句话，例如“你好，这是一段语音识别测试”。说完点击“停止录音并验证”。</Alert>}
    {result && <Alert color={result.color} title={result.title} role="status">{result.text}</Alert>}
  </Stack>;
}
