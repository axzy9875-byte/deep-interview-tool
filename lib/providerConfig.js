export function clientBaseUrl(baseUrl) {
  const normalized = baseUrl.replace(/\/+$/, '');
  const paths = {
    'https://api.deepseek.com/v1': '/api/deepseek',
    'https://ark.cn-beijing.volces.com/api/v3': '/api/ark',
    'https://api.siliconflow.cn/v1': '/api/siliconflow',
    'https://api.openai.com/v1': '/api/openai'
  };
  return typeof window !== 'undefined' && paths[normalized]
    ? window.location.origin + paths[normalized] : normalized;
}
export function completionOptions(config) {
  return config.baseUrl.replace(/\/+$/, '') === 'https://ark.cn-beijing.volces.com/api/v3'
    ? { thinking: { type: 'disabled' } } : {};
}
