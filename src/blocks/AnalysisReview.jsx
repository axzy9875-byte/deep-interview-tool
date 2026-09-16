import { Alert, Button, Card, Group, Stack, Text, Title } from '@mantine/core';
export function AnalysisReview({ analysis, analyzing, hasSources, onAnalyze }) {
  const labels = { summary: '内容摘要', keyTopics: '关键主题', suggestedQuestions: '建议的问题方向', rawContent: '完整分析原文', researchPurpose: '研究目的', interviewee: '受访者', interviewPurpose: '访谈目的' };
  const entries = typeof analysis === 'string' ? [['rawContent', analysis]] : Object.entries(analysis || {});
  return <Card withBorder padding="md" style={{ backgroundColor: '#f8f9fa' }}>
    <Stack spacing="md">
      <Group position="apart"><Title order={3}>内容分析详情 · 请审核</Title><Button variant="light" loading={analyzing} disabled={!hasSources} onClick={onAnalyze}>{analysis ? '重新分析材料' : '分析材料'}</Button></Group>
      {!entries.length && <Alert color="yellow">当前没有可供审核的分析结果。点击“分析材料”重新获取；这不会清除提纲原题或访谈回答。</Alert>}
      {entries.map(([key, value]) => <div key={key}>
        <Text weight={600} mb="xs">{labels[key] || key}</Text>
        {Array.isArray(value) ? (value.length ? value.map((item, i) => <Text key={i} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{i + 1}. {typeof item === 'string' ? item : JSON.stringify(item, null, 2)}</Text>) : <Text color="dimmed">未提供</Text>) : <Text style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</Text>}
      </div>)}
      <Text size="sm" color="dimmed">以上展示已保存的完整分析字段。分析用于你审核材料；“展示提纲原题”直接读取提纲，不根据摘要改写问题。</Text>
    </Stack>
  </Card>;
}
