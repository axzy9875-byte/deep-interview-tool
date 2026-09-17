import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, CopyButton, Group, Loader, Modal, PasswordInput, Stack, Switch, Table, Text, TextInput, Textarea, Title } from '@mantine/core';
import { IconCheck, IconCopy, IconDownload, IconEye, IconRefresh, IconSend, IconTrash } from '@tabler/icons-react';
import { useInterviewStore } from '../hooks/useInterviewStore.jsx';
import { APIConfigManager } from '../../lib/apiConfig.js';
import { ARK_SPEECH_MODEL, ARK_URL } from '../../lib/arkSpeech.js';

const request = async (url, options) => {
  const response = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
};

export function PublicInterviewAdmin() {
  const { contentState, sessionState } = useInterviewStore();
  const preparedQuestions = useMemo(() => {
    if (contentState.questionMode === 'outline' && contentState.outlineConfirmed && contentState.outlineQuestions?.length) {
      return contentState.outlineQuestions.map((content, index) => ({ id: `outline_${index}`, content }));
    }
    if (contentState.questionMode === 'ai' && contentState.previewQuestions?.length) {
      return contentState.previewQuestions.map((question, index) => ({ id: `preview_${index}`, content: question.question, category: question.category }));
    }
    return sessionState.questions || [];
  }, [contentState, sessionState]);
  const [title, setTitle] = useState(contentState.sources?.[0]?.title || '深度访谈');
  const [description, setDescription] = useState(contentState.interviewInstructions?.trim() || contentState.analysisResult?.summary || '感谢您接受本次访谈。您的回答会被安全保存，您可以随时暂停并稍后继续。');
  const [campaigns, setCampaigns] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [savingSpeech, setSavingSpeech] = useState(false);
  const [tokenLimit, setTokenLimit] = useState(200000);
  const [publicSpeech, setPublicSpeech] = useState({ enabled: false, model: ARK_SPEECH_MODEL, apiKey: '', apiKeyConfigured: false, source: 'server' });
  const [error, setError] = useState('');
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = async () => {
    setLoading(true); setError('');
    try {
      const [campaignData, sessionData, speechData] = await Promise.all([request('/api/admin/campaigns'), request('/api/admin/sessions'), request('/api/admin/public-speech')]);
      setCampaigns(campaignData.campaigns || []);
      setSessions(sessionData.sessions || []);
      setPublicSpeech(previous => ({ ...previous, ...speechData.config, apiKey: '' }));
      setTokenLimit(speechData.tokenLimit || 200000);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const savePublicSpeech = async () => {
    setSavingSpeech(true); setError('');
    try {
      const data = await request('/api/admin/public-speech', {
        method: 'PUT',
        body: JSON.stringify({ enabled: publicSpeech.enabled, model: publicSpeech.model, apiKey: publicSpeech.apiKey })
      });
      setPublicSpeech(previous => ({ ...previous, ...data.config, apiKey: '' }));
      setTokenLimit(data.tokenLimit || 200000);
    } catch (err) { setError(err.message); }
    finally { setSavingSpeech(false); }
  };

  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    if (contentState.interviewInstructions?.trim()) setDescription(contentState.interviewInstructions.trim());
  }, [contentState.interviewInstructions]);

  const publish = async () => {
    setPublishing(true); setError('');
    try {
      const data = await request('/api/admin/campaigns', {
        method: 'POST',
        body: JSON.stringify({ title, description, questions: preparedQuestions })
      });
      await refresh();
      window.history.replaceState({}, '', `/admin?published=${data.campaign.id}`);
    } catch (err) { setError(err.message); }
    finally { setPublishing(false); }
  };

  const downloadRecord = record => {
    const campaign = campaigns.find(item => item.id === record.campaignId);
    let content = `# ${campaign?.title || '深度访谈'}\n\n`;
    content += `- 受访者：${record.participantName}\n- 第 ${record.attemptNumber} 次访谈\n- 状态：${record.status}\n- 开始时间：${new Date(record.startedAt).toLocaleString()}\n- 最后保存：${new Date(record.updatedAt).toLocaleString()}\n\n`;
    (campaign?.questions || []).forEach((question, index) => {
      content += `## 第 ${index + 1} 问\n\n**问题：** ${question.content}\n\n**回答：** ${record.answers?.[question.id]?.content || '（未回答）'}\n\n`;
    });
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${campaign?.title || '访谈'}_${record.participantName}_第${record.attemptNumber}次.md`;
    link.click(); URL.revokeObjectURL(url);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true); setError('');
    try {
      const endpoint = deleteTarget.type === 'campaign'
        ? `/api/admin/campaigns/${encodeURIComponent(deleteTarget.campaign.id)}`
        : `/api/admin/sessions/${encodeURIComponent(deleteTarget.record.id)}`;
      await request(endpoint, { method: 'DELETE' });
      if (deleteTarget.type === 'session' && selectedRecord?.id === deleteTarget.record.id) setSelectedRecord(null);
      setDeleteTarget(null);
      await refresh();
    } catch (err) { setError(err.message); }
    finally { setDeleting(false); }
  };

  return <Stack spacing="lg">
    <Group position="apart">
      <div>
        <Title order={2}>公开访谈管理</Title>
        <Text color="dimmed">发布受访链接，并按时间查看每一次访谈记录。</Text>
      </div>
      <Button variant="light" leftIcon={<IconRefresh size={16} />} onClick={refresh}>刷新记录</Button>
    </Group>

    {error && <Alert color="red">{error}</Alert>}

    <Card withBorder>
      <Stack>
        <Group position="apart">
          <div>
            <Title order={4}>公开访谈语音转写</Title>
            <Text size="sm" color="dimmed">公开访客使用服务器保存的 Seed-2.0-lite 配置，API 密钥不会发送给访客。</Text>
          </div>
          <Badge color={publicSpeech.enabled && publicSpeech.apiKeyConfigured ? 'green' : 'gray'}>{publicSpeech.enabled && publicSpeech.apiKeyConfigured ? '已启用' : '未启用'}</Badge>
        </Group>
        <Alert color="blue">服务器会按匿名访客累计用量；每位访客最多 {tokenLimit.toLocaleString()} tokens，多次访谈共用同一额度。达到限额后语音按钮将停止调用 API，文字回答仍可继续。</Alert>
        {publicSpeech.source === 'environment' ? <Alert color="yellow">当前配置由部署平台的环境变量管理，网页中不能修改。</Alert> : <>
          <Switch label="允许公开访客使用语音转写" checked={publicSpeech.enabled} onChange={event => setPublicSpeech(previous => ({ ...previous, enabled: event.currentTarget.checked }))} />
          <TextInput label="语音模型 / Endpoint ID" value={publicSpeech.model} onChange={event => setPublicSpeech(previous => ({ ...previous, model: event.currentTarget.value }))} />
          <PasswordInput label="火山方舟 API Key" value={publicSpeech.apiKey} placeholder={publicSpeech.apiKeyConfigured ? '服务器已有密钥；留空可继续使用' : '请输入供公开访谈使用的密钥'} onChange={event => setPublicSpeech(previous => ({ ...previous, apiKey: event.currentTarget.value }))} />
          <Group>
            <Button variant="light" onClick={() => {
              const saved = APIConfigManager.loadSpeechConfig();
              const ark = APIConfigManager.loadProviderConfig(ARK_URL);
              const apiKey = saved?.baseUrl === ARK_URL && saved.apiKey || ark?.apiKey || '';
              if (!apiKey) { setError('当前浏览器里没有已保存的火山方舟语音密钥'); return; }
              setPublicSpeech(previous => ({ ...previous, apiKey, model: saved?.model || ARK_SPEECH_MODEL, enabled: true }));
            }}>填入本机已配置的方舟密钥</Button>
            <Button loading={savingSpeech} onClick={savePublicSpeech}>保存公开语音配置</Button>
          </Group>
        </>}
      </Stack>
    </Card>

    <Card withBorder>
      <Stack>
        <Title order={4}>发布当前访谈</Title>
        <Text size="sm" color="dimmed">将当前已确认或已使用的问题发布给受访者。受访者看不到API配置、内容准备和访谈稿功能。</Text>
        <TextInput label="访谈名称" value={title} onChange={event => setTitle(event.currentTarget.value)} />
        <Textarea label="受访说明" value={description} minRows={3} onChange={event => setDescription(event.currentTarget.value)} />
        <Group position="apart">
          <Text size="sm">准备发布：<strong>{preparedQuestions.length}</strong> 道问题</Text>
          <Button leftIcon={<IconSend size={16} />} loading={publishing} disabled={!preparedQuestions.length || !title.trim()} onClick={publish}>生成受访链接</Button>
        </Group>
      </Stack>
    </Card>

    {loading ? <Loader /> : campaigns.map(campaign => {
      const link = `${window.location.origin}/join/${campaign.id}`;
      const records = sessions.filter(session => session.campaignId === campaign.id);
      return <Card key={campaign.id} withBorder>
        <Stack spacing="sm">
          <Group position="apart">
            <div>
              <Title order={4}>{campaign.title}</Title>
              <Text size="xs" color="dimmed">发布于 {new Date(campaign.createdAt).toLocaleString()} · {campaign.questions.length} 题</Text>
            </div>
            <Group>
              <Badge color="blue">{campaign.sessionCount} 次访谈</Badge>
              <Badge color="green">{campaign.completedCount} 次完成</Badge>
              <Button compact color="red" variant="subtle" leftIcon={<IconTrash size={14} />} onClick={() => setDeleteTarget({ type: 'campaign', campaign })}>删除链接及全部数据</Button>
            </Group>
          </Group>
          <Group noWrap>
            <TextInput style={{ flex: 1 }} value={link} readOnly />
            <CopyButton value={link}>{({ copied, copy }) => <Button color={copied ? 'green' : 'blue'} leftIcon={copied ? <IconCheck size={16} /> : <IconCopy size={16} />} onClick={copy}>{copied ? '已复制' : '复制链接'}</Button>}</CopyButton>
          </Group>
          {records.length > 0 && <Table striped highlightOnHover>
            <thead><tr><th>受访者</th><th>次数</th><th>状态</th><th>回答</th><th>语音用量</th><th>开始时间</th><th>最后保存</th><th>操作</th></tr></thead>
            <tbody>{records.map(record => <tr key={record.id}>
              <td>{record.participantName}</td><td>第 {record.attemptNumber} 次</td>
              <td><Badge color={record.status === 'completed' ? 'green' : record.status === 'paused' ? 'yellow' : 'blue'}>{record.status === 'completed' ? '已完成' : record.status === 'paused' ? '已暂停' : '进行中'}</Badge></td>
              <td>{Object.keys(record.answers || {}).length}/{campaign.questions.length}</td>
              <td>{(record.speechQuota?.used || 0).toLocaleString()} / {(record.speechQuota?.limit || tokenLimit).toLocaleString()}</td>
              <td>{new Date(record.startedAt).toLocaleString()}</td><td>{new Date(record.updatedAt).toLocaleString()}</td>
              <td><Group spacing={4} noWrap>
                <Button compact variant="subtle" leftIcon={<IconEye size={14} />} onClick={() => setSelectedRecord(record)}>查看回答</Button>
                <Button compact color="red" variant="subtle" leftIcon={<IconTrash size={14} />} onClick={() => setDeleteTarget({ type: 'session', record, campaign })}>删除记录</Button>
              </Group></td>
            </tr>)}</tbody>
          </Table>}
          {!records.length && <Text size="sm" color="dimmed">暂时没有受访记录。</Text>}
        </Stack>
      </Card>;
    })}

    <Modal opened={!!selectedRecord} onClose={() => setSelectedRecord(null)} title="访谈记录" size="lg">
      {selectedRecord && (() => {
        const campaign = campaigns.find(item => item.id === selectedRecord.campaignId);
        return <Stack>
          <div><Title order={4}>{campaign?.title}</Title><Text size="sm" color="dimmed">{selectedRecord.participantName} · 第 {selectedRecord.attemptNumber} 次 · {new Date(selectedRecord.startedAt).toLocaleString()}</Text></div>
          {(campaign?.questions || []).map((question, index) => <Card key={question.id} withBorder padding="sm">
            <Text weight={600}>第 {index + 1} 问：{question.content}</Text>
            <Text mt="xs" style={{ whiteSpace: 'pre-wrap' }}>{selectedRecord.answers?.[question.id]?.content || '（未回答）'}</Text>
          </Card>)}
          <Button leftIcon={<IconDownload size={16} />} onClick={() => downloadRecord(selectedRecord)}>导出这次访谈</Button>
        </Stack>;
      })()}
    </Modal>

    <Modal opened={!!deleteTarget} onClose={() => !deleting && setDeleteTarget(null)} title={deleteTarget?.type === 'campaign' ? '删除访谈链接及全部数据' : '删除访谈记录'} size="sm" closeOnClickOutside={!deleting} closeOnEscape={!deleting}>
      <Stack>
        {deleteTarget?.type === 'campaign' ? <>
          <Alert color="red">将永久删除“{deleteTarget.campaign.title}”的公开链接、全部访谈次数和所有回答数据，共 {deleteTarget.campaign.sessionCount} 条记录。删除后原链接将立即失效。</Alert>
        </> : <Alert color="red">将永久删除“{deleteTarget?.record?.participantName}”的第 {deleteTarget?.record?.attemptNumber} 次访谈及其全部回答。</Alert>}
        <Text size="sm" color="dimmed">此操作用于释放服务器磁盘空间，删除后无法恢复。</Text>
        <Group position="right">
          <Button variant="outline" disabled={deleting} onClick={() => setDeleteTarget(null)}>取消</Button>
          <Button color="red" loading={deleting} onClick={confirmDelete}>确认永久删除</Button>
        </Group>
      </Stack>
    </Modal>
  </Stack>;
}
