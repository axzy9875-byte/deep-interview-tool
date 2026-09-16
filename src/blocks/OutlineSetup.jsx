import { useState } from 'react';
import { Alert, Button, Card, Group, Select, Stack, Text, Textarea, Checkbox } from '@mantine/core';
import { useInterviewStore } from '../hooks/useInterviewStore.jsx';
import { parseOutline } from '../../lib/interviewOutline.js';
export function OutlineSetup() {
  const { contentState, sessionState, updateContentState, startOutlineInterview, saveSessionData } = useInterviewStore();
  const [sourceId, setSourceId] = useState(contentState.outlineSourceId || null);
  const [error, setError] = useState(null);
  const questions = contentState.outlineQuestions || [];
  const hasExistingInterview = sessionState.questions.length > 0;
  const update = changes => { updateContentState(changes); saveSessionData(); };
  const edit = next => update({ outlineQuestions: next, outlineConfirmed: false });
  return <Card withBorder><Stack>
    <Text weight={600}>问题预览 · 提纲原题 · 共 {questions.length} 题</Text>
    <Alert color="blue">问题来源：上传的提纲原文，此预览不调用大模型。按下方确认后的原文和顺序提问，不增加追问；最后一题提交或跳过后结束。导入仅按编号、列表和段落拆分，请删去说明文字、核对每一道问题。</Alert>
    {hasExistingInterview && <Alert color="yellow">已有访谈记录，但当前预览仍可增删、修改和排序。点击下方开始按钮时会先自动备份旧问答与稿件，再按当前清单开始新访谈。</Alert>}
    {error && <Alert color="red">{error}</Alert>}
    <Select label="选择已上传或添加的提纲" value={sourceId || contentState.sources[0]?.id || null} data={contentState.sources.map(s => ({ value: s.id, label: s.title }))} onChange={setSourceId} />
    <Button variant="light" disabled={!contentState.sources.length} onClick={() => {
      const source = contentState.sources.find(s => s.id === sourceId) || contentState.sources[0];
      const imported = parseOutline(source.content);
      if (!imported.length) { setError('没有读到问题，请检查提纲内容或手动添加。'); return; }
      update({ outlineQuestions: imported, outlineConfirmed: false, outlineSourceId: source.id }); setError(null);
    }}>按所选提纲原文刷新预览</Button>
    <Text size="xs" color="dimmed">下方为原题顺序预览，可核对修改；刷新预览会用所选提纲替换当前清单。</Text>
    {questions.map((question, index) => <Card key={index} withBorder padding="sm">
      <Textarea label={`第 ${index + 1} 问`} value={question} autosize minRows={2} onChange={e => edit(questions.map((q, i) => i === index ? e.currentTarget.value : q))} />
      <Group mt="xs">
        <Button size="xs" variant="subtle" disabled={index === 0} onClick={() => { const next = [...questions]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; edit(next); }}>上移</Button>
        <Button size="xs" variant="subtle" disabled={index === questions.length - 1} onClick={() => { const next = [...questions]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; edit(next); }}>下移</Button>
        <Button size="xs" color="red" variant="subtle" onClick={() => edit(questions.filter((_, i) => i !== index))}>删除此题</Button>
      </Group>
    </Card>)}
    <Button variant="outline" onClick={() => edit([...questions, ''])}>添加一道问题</Button>
    <Checkbox label="我已核对问题原文及顺序，严格按照此清单提问" checked={!!contentState.outlineConfirmed} disabled={!questions.length || questions.some(q => !q.trim())} onChange={e => update({ outlineConfirmed: e.currentTarget.checked })} />
    <Button disabled={!contentState.outlineConfirmed || !questions.length} onClick={() => { try { startOutlineInterview(); } catch (err) { setError(err.message); } }}>{hasExistingInterview ? '备份旧访谈并按提纲开始' : '按提纲开始访谈'}</Button>
  </Stack></Card>;
}
