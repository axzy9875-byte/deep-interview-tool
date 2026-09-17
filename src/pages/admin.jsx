import React, { useEffect, useState } from 'react';
import { Alert, Button, Container, Group, Loader, PasswordInput, Stack, Tabs, Text, Title } from '@mantine/core';
import { IconLock, IconLogout, IconSettings, IconUsers } from '@tabler/icons-react';
import InterviewPage from './interview.jsx';
import { PublicInterviewAdmin } from '../blocks/PublicInterviewAdmin.jsx';

export default function AdminPage() {
  const [auth, setAuth] = useState(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const check = async () => {
    try { const response = await fetch('/api/admin/me', { credentials: 'same-origin' }); setAuth(await response.json()); }
    catch { setError('无法连接管理服务'); setAuth({ authenticated: false }); }
  };
  useEffect(() => { check(); }, []);

  const login = async () => {
    setError('');
    const response = await fetch('/api/admin/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setError(data.error || '登录失败'); return; }
    setAuth(data);
  };

  if (!auth) return <Container py="xl"><Loader /></Container>;
  if (!auth.authenticated) return <Container size="xs" py={80}><Stack>
    <IconLock size={42} />
    <Title order={2}>管理员登录</Title>
    <Text color="dimmed">API 配置、内容准备、测试工具和全部受访记录仅管理员可见。</Text>
    {error && <Alert color="red">{error}</Alert>}
    <PasswordInput label="管理员密码" value={password} onChange={event => setPassword(event.currentTarget.value)} onKeyDown={event => event.key === 'Enter' && login()} />
    <Button onClick={login}>登录管理端</Button>
  </Stack></Container>;

  return <>
    <Container size="xl" pt="md">
      <Group position="apart">
        <Text size="sm" color="dimmed">管理员模式</Text>
        {auth.passwordConfigured && <Button size="xs" variant="subtle" leftIcon={<IconLogout size={14} />} onClick={async () => { await fetch('/api/admin/logout', { method: 'POST' }); setAuth({ authenticated: false, passwordConfigured: true }); }}>退出登录</Button>}
      </Group>
      <Tabs defaultValue="workspace" mt="sm">
        <Tabs.List>
          <Tabs.Tab value="workspace" icon={<IconSettings size={16} />}>访谈配置</Tabs.Tab>
          <Tabs.Tab value="public" icon={<IconUsers size={16} />}>公开访谈管理</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="workspace"><InterviewPage /></Tabs.Panel>
        <Tabs.Panel value="public" pt="xl"><PublicInterviewAdmin /></Tabs.Panel>
      </Tabs>
    </Container>
  </>;
}
