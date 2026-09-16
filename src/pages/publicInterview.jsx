import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Badge, Button, Card, Checkbox, Container, Group, Loader, Progress, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import { IconCheck, IconMicrophone, IconPlayerPause, IconPlayerPlay, IconPlayerStop, IconRefresh } from '@tabler/icons-react';
import { useParams } from 'react-router-dom';
import { AudioRecorder } from '../../lib/speechClient.js';
import { audioToWav } from '../../lib/doubaoSpeech.js';

const call = async (url, options = {}) => {
  const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
};

const bytesToBase64 = bytes => {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
  return btoa(binary);
};

export default function PublicInterviewPage() {
  const { campaignId } = useParams();
  const storageKey = `public_interview:${campaignId}`;
  const [campaign, setCampaign] = useState(null);
  const [session, setSession] = useState(null);
  const [credential, setCredential] = useState(null);
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState('');
  const recorder = useRef(null);

  const restore = async (saved, loadedCampaign) => {
    const data = await call(`/api/public/sessions/${encodeURIComponent(saved.id)}`, { headers: { 'X-Session-Token': saved.token } });
    setCredential(saved); setSession(data.session); setCampaign({ ...loadedCampaign, ...(data.session.campaign || {}) });
    const question = data.session.campaign?.questions?.[data.session.currentQuestionIndex];
    setAnswer(data.session.answers?.[question?.id]?.content || '');
  };

  useEffect(() => {
    (async () => {
      try {
        const data = await call(`/api/public/campaigns/${encodeURIComponent(campaignId)}`);
        setCampaign(data.campaign);
        const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
        if (saved?.id && saved?.token) await restore(saved, data.campaign);
      } catch (err) { setError(err.message); }
      finally { setLoading(false); }
    })();
  }, [campaignId]);

  useEffect(() => () => recorder.current?.cleanup(), []);

  const start = async (another = false) => {
    setSaving(true); setError('');
    try {
      const participant = JSON.parse(localStorage.getItem(`${storageKey}:participant`) || 'null') || { attemptGroupId: `browser_${crypto.randomUUID()}` };
      localStorage.setItem(`${storageKey}:participant`, JSON.stringify(participant));
      const data = await call(`/api/public/campaigns/${encodeURIComponent(campaignId)}/sessions`, {
        method: 'POST', body: JSON.stringify({ participantName: name || session?.participantName, attemptGroupId: participant.attemptGroupId })
      });
      const saved = { id: data.session.id, token: data.token };
      localStorage.setItem(storageKey, JSON.stringify(saved));
      setCredential(saved); setSession(data.session); setAnswer('');
      if (another) setConsent(true);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const update = async payload => {
    const data = await call(`/api/public/sessions/${encodeURIComponent(session.id)}`, {
      method: 'PATCH', headers: { 'X-Session-Token': credential.token }, body: JSON.stringify(payload)
    });
    setSession(data.session);
    return data.session;
  };

  const saveAndNext = async () => {
    const question = campaign.questions[session.currentQuestionIndex];
    if (!answer.trim()) { setError('请先填写回答，也可以选择暂停后稍后继续'); return; }
    setSaving(true); setError('');
    try {
      const last = session.currentQuestionIndex >= campaign.questions.length - 1;
      const next = await update({
        answers: { [question.id]: { content: answer.trim(), answeredAt: new Date().toISOString() } },
        currentQuestionIndex: last ? session.currentQuestionIndex : session.currentQuestionIndex + 1,
        status: last ? 'completed' : 'active'
      });
      if (!last) {
        const nextQuestion = campaign.questions[next.currentQuestionIndex];
        setAnswer(next.answers?.[nextQuestion.id]?.content || '');
      }
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const pause = async () => {
    setSaving(true); setError('');
    try {
      const question = campaign.questions[session.currentQuestionIndex];
      await update({ answers: answer.trim() ? { [question.id]: { content: answer.trim() } } : {}, currentQuestionIndex: session.currentQuestionIndex, status: 'paused' });
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const resume = async () => {
    setSaving(true); setError('');
    try { await update({ status: 'active' }); }
    catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const startRecording = async () => {
    setError('');
    try {
      if (!AudioRecorder.isSupported()) throw new Error('当前浏览器不支持录音，请使用新版 Chrome、Safari 或 Firefox');
      recorder.current ||= new AudioRecorder();
      await recorder.current.startRecording();
      setRecording(true);
    } catch (err) { setError(err.message); recorder.current?.cleanup(); }
  };

  const stopAndTranscribe = async () => {
    setRecording(false); setTranscribing(true); setError('');
    try {
      const audio = await recorder.current?.stopRecording();
      if (!audio?.size) throw new Error('没有录到声音，请重新录制');
      const wav = await audioToWav(audio);
      const data = await call(`/api/public/sessions/${encodeURIComponent(session.id)}/transcriptions`, {
        method: 'POST',
        headers: { 'X-Session-Token': credential.token },
        body: JSON.stringify({ audio: bytesToBase64(wav) })
      });
      if (!data.text?.trim()) throw new Error('没有识别到清晰的人声，请重新录制');
      setAnswer(previous => [previous.trim(), data.text.trim()].filter(Boolean).join('\n'));
      setSession(previous => ({ ...previous, speechQuota: data.speechQuota }));
    } catch (err) { setError(err.message); recorder.current?.cleanup(); }
    finally { setTranscribing(false); }
  };

  const currentQuestion = useMemo(() => campaign?.questions?.[session?.currentQuestionIndex || 0], [campaign, session]);
  if (loading) return <Container py={80}><Loader /></Container>;
  if (!campaign) return <Container size="sm" py={80}><Alert color="red">{error || '访谈不存在'}</Alert></Container>;

  return <Container size="sm" py="xl"><Stack spacing="lg">
    <div>
      <Text size="xl" weight={700}>🍒 深度访谈</Text>
      <Title order={2} mt="md">{campaign.title}</Title>
      {campaign.description && <Text color="dimmed" mt="xs">{campaign.description}</Text>}
    </div>
    {error && <Alert color="red">{error}</Alert>}

    {!session && <Card withBorder><Stack>
      <Title order={4}>开始访谈</Title>
      <TextInput label="称呼（选填）" placeholder="不填写将记为匿名受访者" value={name} onChange={event => setName(event.currentTarget.value)} />
      <Checkbox checked={consent} onChange={event => setConsent(event.currentTarget.checked)} label="我知道回答将被保存并由访谈发起者查看；我可以随时暂停，之后使用同一浏览器继续。" />
      <Button disabled={!consent} loading={saving} onClick={() => start(false)}>进入访谈</Button>
    </Stack></Card>}

    {session?.status === 'paused' && <Card withBorder><Stack align="center">
      <IconPlayerPause size={42} />
      <Title order={3}>访谈已暂停</Title>
      <Text color="dimmed">进度已经保存。第 {session.attemptNumber} 次访谈，最后保存于 {new Date(session.updatedAt).toLocaleString()}。</Text>
      <Button leftIcon={<IconPlayerPlay size={16} />} loading={saving} onClick={resume}>继续访谈</Button>
    </Stack></Card>}

    {session?.status === 'completed' && <Card withBorder><Stack align="center">
      <IconCheck size={48} color="green" />
      <Title order={3}>本次访谈已完成</Title>
      <Text color="dimmed">第 {session.attemptNumber} 次访谈完成于 {new Date(session.completedAt).toLocaleString()}，记录已经保存。</Text>
      <Button leftIcon={<IconRefresh size={16} />} loading={saving} onClick={() => start(true)}>再进行一次访谈</Button>
    </Stack></Card>}

    {session?.status === 'active' && currentQuestion && <>
      <Card withBorder><Stack>
        <Group position="apart"><Badge>第 {session.currentQuestionIndex + 1} / {campaign.questions.length} 题</Badge><Text size="xs" color="dimmed">第 {session.attemptNumber} 次访谈</Text></Group>
        <Progress value={(session.currentQuestionIndex / campaign.questions.length) * 100} />
        <Title order={3}>{currentQuestion.content}</Title>
        <Textarea label="您的回答" minRows={8} autosize value={answer} onChange={event => setAnswer(event.currentTarget.value)} placeholder="请尽量结合具体经历回答……" />
        {campaign.speechEnabled && <Card withBorder padding="sm"><Stack spacing="xs">
          <Group position="apart">
            <Text size="sm" weight={600}>语音转文字</Text>
            <Badge color={session.speechQuota?.remaining > 0 ? 'blue' : 'red'} variant="light">
              剩余 {(session.speechQuota?.remaining || 0).toLocaleString()} / {(session.speechQuota?.limit || 200000).toLocaleString()} tokens
            </Badge>
          </Group>
          <Text size="xs" color="dimmed">每段录音不超过3分钟。停止后会转成文字并追加到回答框，请核对后再提交。</Text>
          {!recording
            ? <Button variant="light" leftIcon={<IconMicrophone size={16} />} disabled={saving || transcribing || !session.speechQuota?.remaining} loading={transcribing} onClick={startRecording}>{transcribing ? '正在转写录音' : '开始语音回答'}</Button>
            : <Button color="red" leftIcon={<IconPlayerStop size={16} />} onClick={stopAndTranscribe}>停止录音并转写</Button>}
        </Stack></Card>}
        <Group position="apart">
          <Button variant="light" leftIcon={<IconPlayerPause size={16} />} loading={saving} disabled={recording || transcribing} onClick={pause}>暂停并保存</Button>
          <Button loading={saving} disabled={recording || transcribing} onClick={saveAndNext}>{session.currentQuestionIndex === campaign.questions.length - 1 ? '提交并完成' : '保存并进入下一题'}</Button>
        </Group>
      </Stack></Card>
      <Text size="xs" color="dimmed" align="center">每次提交都会保存到服务器。请使用同一浏览器恢复当前访谈。</Text>
    </>}
  </Stack></Container>;
}
