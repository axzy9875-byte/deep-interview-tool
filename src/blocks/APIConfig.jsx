import { useState } from 'react';
import { TextInput, Button, Card, Select, Alert, Stack, Title, Text, Group, PasswordInput, Switch, Divider } from '@mantine/core';
import { APIConfigManager } from '../../lib/apiConfig.js';
import { AIAPIClient } from '../../lib/aiClient.js';
import { ARK_URL, ARK_SPEECH_MODEL } from '../../lib/arkSpeech.js';
import { SpeechVerification } from './SpeechVerification.jsx';
import { useInterviewStore } from '../hooks/useInterviewStore.jsx';

const providers = [
  { label: '火山方舟 · 豆包', value: 'https://ark.cn-beijing.volces.com/api/v3', models: ['doubao-seed-2-0-lite-260428', 'doubao-seed-2-0-lite-260215'] },
  { label: 'SiliconFlow', value: 'https://api.siliconflow.cn/v1', models: ['qwen/Qwen2.5-7B-Instruct', 'qwen/Qwen2.5-14B-Instruct', 'qwen/Qwen2.5-32B-Instruct', 'qwen/Qwen2.5-72B-Instruct', 'deepseek-ai/DeepSeek-V2.5', 'meta-llama/Meta-Llama-3.1-8B-Instruct', 'meta-llama/Meta-Llama-3.1-70B-Instruct', 'microsoft/WizardLM-2-8x22B'] },
  { label: 'DeepSeek', value: 'https://api.deepseek.com/v1', models: ['deepseek-chat'] },
  { label: 'OpenAI', value: 'https://api.openai.com/v1', models: ['gpt-3.5-turbo', 'gpt-4', 'gpt-4-turbo-preview', 'gpt-4o'] },
  { label: 'Azure OpenAI（需兼容接口）', value: 'https://your-resource.openai.azure.com', models: ['gpt-35-turbo', 'gpt-4', 'gpt-4-32k'] },
  { label: '自定义兼容接口', value: 'custom', models: [] }
];
const speechProviders = [
  { label: '火山方舟 · Seed-2.0-lite 260428 转写', value: ARK_URL, models: [ARK_SPEECH_MODEL] },
  { label: '豆包语音 · 录音文件极速版', value: 'https://openspeech.bytedance.com', models: ['bigmodel'] },
  { label: 'SiliconFlow', value: 'https://api.siliconflow.cn/v1', models: ['FunAudioLLM/SenseVoiceSmall'] },
  { label: 'OpenAI', value: 'https://api.openai.com/v1', models: ['whisper-1'] },
  { label: '自定义语音接口', value: 'custom', models: [] }
];
const defaultForm = { apiKey: '', baseUrl: providers[0].value, model: providers[0].models[0] };
const defaultSpeech = { enabled: false, provider: 'ark', authMode: 'apiKey', appId: '', resourceId: 'volc.bigasr.auc_turbo', apiKey: '', baseUrl: speechProviders[0].value, model: speechProviders[0].models[0] };
function initialSpeech() {
  const saved = APIConfigManager.loadSpeechConfig();
  if (saved && saved.baseUrl !== 'https://openspeech.bytedance.com') return saved;
  // 旧专用语音凭据不可猜测为方舟密钥，使用已保存的方舟配置或等待用户填写。
  const ark = APIConfigManager.loadProviderConfig(ARK_URL);
  const active = APIConfigManager.loadConfig();
  return { ...defaultSpeech, enabled: saved?.enabled || false, apiKey: ark?.apiKey || (active?.baseUrl === ARK_URL ? active.apiKey : '') };
}
const providerFor = (items, url) => items.find(p => p.value === url)?.value || 'custom';

export function APIConfig() {
  const { updateApiState, updateInterviewState } = useInterviewStore();
  const [form, setForm] = useState(() => APIConfigManager.loadConfig() || defaultForm);
  const [speech, setSpeech] = useState(initialSpeech);
  const [provider, setProvider] = useState(() => providerFor(providers, form.baseUrl));
  const [speechProvider, setSpeechProvider] = useState(() => providerFor(speechProviders, speech.baseUrl));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const change = (field, value) => { setForm(prev => ({ ...prev, [field]: value, isValid: false })); setNotice(null); };
  const changeSpeech = (field, value) => { setSpeech(prev => ({ ...prev, [field]: value })); setNotice(null); };
  const choose = (items, value, setter, setChoice) => {
    setChoice(value);
    const selected = items.find(p => p.value === value);
    setter(prev => items === providers && APIConfigManager.loadProviderConfig(value) || ({ ...prev, apiKey: '', baseUrl: value === 'custom' ? '' : value, model: selected?.models[0] || '', isValid: false }));
    setNotice(null);
  };
  const normalize = value => ({ ...value, apiKey: value.apiKey.trim(), baseUrl: value.baseUrl.trim().replace(/\/+$/, ''), model: value.model.trim() });
  const check = (value, label) => {
    if (!value.apiKey || !value.model) throw new Error(`请填写${label}密钥和模型名称`);
    const url = new URL(value.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`请填写有效的${label}服务地址`);
  };
  const saveSpeech = () => {
    const value = normalize(speech);
    if (value.enabled) { check(value, '语音 API'); if (value.baseUrl === 'https://openspeech.bytedance.com' && value.authMode === 'legacy' && !value.appId?.trim()) throw new Error('旧版鉴权需要填写 App ID'); }
    APIConfigManager.saveSpeechConfig(value);
    return value;
  };
  const run = async (action) => {
    setNotice(null); setBusy(true);
    try { await action(); } catch (error) { setNotice({ color: 'red', text: error.message }); }
    finally { setBusy(false); }
  };
  const save = async (next = false) => {
    const value = normalize(form); check(value, '文本 API'); saveSpeech();
    APIConfigManager.saveConfig(value);
    updateApiState({ ...value, isConfigured: true, error: null });
    setNotice({ color: 'green', text: '配置已保存。真实接口是否可用，请点击验证 API。' });
    if (next) updateInterviewState({ currentStep: 'content-input' });
  };
  const verify = async () => {
    const value = normalize(form); check(value, '文本 API');
    const result = await AIAPIClient.testConnection(value);
    if (!result.success) throw new Error(result.error || '连接失败');
    const verified = { ...value, isValid: true, lastValidated: new Date().toISOString() };
    APIConfigManager.saveConfig(verified); setForm(verified);
    updateApiState({ ...verified, isConfigured: true, error: null });
    setNotice({ color: 'green', text: '文本 API 已实际调用成功。语音配置请单独保存和测试。' });
  };
  const models = providers.find(p => p.value === provider)?.models || [];
  return <Card shadow="sm" padding="xl" radius="md" withBorder>
    <Stack spacing="lg">
      <Title order={2}>我的 AI 访谈 · 配置</Title>
      <Text color="dimmed" size="sm">文本生成与语音转文字分别配置。密钥仅保存在当前浏览器，不随网站发布。</Text>
      {notice && <Alert color={notice.color} role="status">{notice.text}</Alert>}
      <Select label="API 服务商" value={provider} data={providers.map(({ label, value }) => ({ label, value }))} onChange={value => choose(providers, value, setForm, setProvider)} />
      <Text size="sm" color="dimmed">访谈和写稿使用当前选中的文本模型，可随时返回设置切换 DeepSeek 或豆包。</Text>
      <TextInput label="API 基础 URL" value={form.baseUrl} readOnly={provider !== 'custom'} onChange={e => change('baseUrl', e.currentTarget.value)} />
      <PasswordInput label="API 密钥" value={form.apiKey} onChange={e => change('apiKey', e.currentTarget.value)} required />
      <Select label="预设 AI 模型" value={models.includes(form.model) ? form.model : 'custom'} data={[...models.map(value => ({ value, label: value })), { value: 'custom', label: '自定义模型 / Endpoint ID' }]} onChange={value => change('model', value === 'custom' ? '' : value)} />
      <TextInput label="模型名称 / Endpoint ID" value={form.model} onChange={e => change('model', e.currentTarget.value)} required description={provider === providers[0].value ? '默认 Doubao-Seed-2.0-lite；也可填写火山方舟控制台的完整模型 ID 或 ep- 开头的接入点 ID。' : '可直接填写服务商提供的完整模型名称。'} />
      <Group><Button loading={busy} onClick={() => run(verify)}>验证 API</Button><Button variant="outline" disabled={busy} onClick={() => run(() => save())}>保存全部配置</Button></Group>
      <Divider />
      <Title order={3}>语音识别配置（可选）</Title>
      <Switch label="启用语音识别 API" checked={speech.enabled} onChange={e => changeSpeech('enabled', e.currentTarget.checked)} />
      {speech.enabled && <>
        <Text size="sm" color="dimmed">默认使用已开通的 Seed-2.0-lite 260428 转写，填写火山方舟 API Key。语音配置独立保存，切换访谈和写稿模型不会改变它。</Text>
        <Select label="语音 API 服务商" value={speechProvider} data={speechProviders.map(({ label, value }) => ({ label, value }))} onChange={value => choose(speechProviders, value, setSpeech, setSpeechProvider)} />
        {speechProvider === ARK_URL && <>
          <Button variant="light" onClick={() => {
            const saved = APIConfigManager.loadProviderConfig(ARK_URL);
            const current = APIConfigManager.loadConfig();
            const source = form.baseUrl === ARK_URL && form.apiKey.trim() ? form : saved || (current?.baseUrl === ARK_URL ? current : null);
            if (!source?.apiKey) { setNotice({ color: 'red', text: '尚未保存方舟密钥，请在下方填写火山方舟 API Key。' }); return; }
            setSpeech(prev => ({ ...prev, apiKey: source.apiKey, baseUrl: ARK_URL, model: ARK_SPEECH_MODEL }));
            setNotice({ color: 'blue', text: '已填入方舟密钥，请点击“验证语音 API”。' });
          }}>填入已配置的方舟密钥</Button>
          <Text size="sm">模型使用 doubao-seed-2-0-lite-260428，也可填写对应的 ep- 推理接入点 ID。每次录音不超过 3 分钟，转写后请核对原话。</Text>
        </>}
        {speechProvider === 'https://openspeech.bytedance.com' && <Alert color="yellow">这是另行开通的专用豆包语音服务，不使用 Seed 模型的方舟密钥。使用现有 Seed 模型请选择上方的“火山方舟”选项。</Alert>}
        <TextInput label="语音 API 基础 URL" value={speech.baseUrl} readOnly={speechProvider !== 'custom'} onChange={e => changeSpeech('baseUrl', e.currentTarget.value)} />
        {speechProvider === 'https://openspeech.bytedance.com' && <>
          <Select label="豆包语音鉴权方式" value={speech.authMode || 'apiKey'} data={[{ value: 'apiKey', label: '新版控制台：API Key' }, { value: 'legacy', label: '旧版控制台：App ID + Access Token' }]} onChange={value => changeSpeech('authMode', value)} />
          {speech.authMode === 'legacy' && <TextInput label="豆包语音 App ID" value={speech.appId || ''} onChange={e => changeSpeech('appId', e.currentTarget.value)} required />}
          <TextInput label="豆包语音 Resource ID" value="volc.bigasr.auc_turbo" readOnly />
        </>}
        <PasswordInput label={speechProvider === 'https://openspeech.bytedance.com' && speech.authMode === 'legacy' ? '豆包语音 Access Token' : speechProvider === ARK_URL ? '火山方舟 API Key（语音转写）' : '语音 API 密钥'} value={speech.apiKey} onChange={e => changeSpeech('apiKey', e.currentTarget.value)} required />
        <TextInput label="语音模型 / Endpoint ID" value={speech.model} onChange={e => changeSpeech('model', e.currentTarget.value)} required />
        <Text size="sm">保存后可在访谈中点击麦克风，录完再点击停止。浏览器需允许麦克风；本机 localhost 可以录音，上线时需 HTTPS。</Text>
        <SpeechVerification config={speech} />
      </>}
      <Group><Button variant="outline" disabled={busy} onClick={() => run(() => { saveSpeech(); setNotice({ color: 'green', text: speech.enabled ? '语音配置已保存。请用录音测试实际识别。' : '语音识别已关闭并保存。' }); })}>保存语音配置</Button></Group>
      <Divider />
      <Button disabled={busy} onClick={() => run(() => save(true))}>下一步：准备访谈内容</Button>
    </Stack>
  </Card>;
}
