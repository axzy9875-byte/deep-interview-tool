import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { parseOutline, strictQuestionList } from '../lib/interviewOutline.js';
import { AIAPIClient } from '../lib/aiClient.js';

const saved = new Map();
globalThis.localStorage = { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
mkdirSync(new URL('../work/', import.meta.url), { recursive: true });
buildSync({ entryPoints: [new URL('../src/hooks/useInterviewStore.jsx', import.meta.url).pathname], outfile: new URL('../work/outline-test-store.mjs', import.meta.url).pathname, bundle: true, platform: 'node', format: 'esm', packages: 'external' });
const { useInterviewStore: store } = await import('../work/outline-test-store.mjs');

test('outline import preserves question wording, multiline subprompts, order and duplicates', () => {
  const text = '# 员工创新访谈\n1. 您何时开始使用 AI？\n2. 请描述一次失败的尝试。\n请说明当时的背景。\n3. 您何时开始使用 AI？\n\n个人信息：';
  assert.deepEqual(parseOutline(text), ['您何时开始使用 AI？', '请描述一次失败的尝试。\n请说明当时的背景。', '您何时开始使用 AI？']);
  assert.deepEqual(parseOutline('{"questions":[{"question":"原题？"},"第二题？"]}'), ['原题？', '第二题？']);
  assert.throws(() => strictQuestionList(['']), /空问题/);
});

test('strict interview is exact, idempotent, makes no network requests, resumes and ends at last question', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Strict mode must not call an API'); };
  try {
    store.setState({ contentState: { ...store.getState().contentState, questionMode: 'outline', outlineQuestions: ['请讲一个 AI 使用实例。', '这对创新有什么影响？'], outlineConfirmed: false }, sessionState: { ...store.getState().sessionState, questions: [], answers: {} } });
    assert.throws(() => store.getState().startOutlineInterview(), /确认/);
    store.getState().updateContentState({ outlineConfirmed: true });
    store.getState().startOutlineInterview();
    assert.equal(store.getState().sessionState.questions.length, 2);
    assert.equal((await store.getState().generateQuestionStream()).content, '请讲一个 AI 使用实例。');
    assert.equal((await store.getState().generateQuestion()).content, '请讲一个 AI 使用实例。');
    assert.equal(store.getState().sessionState.questions.length, 2);
    store.getState().saveAnswer('outline_0', '测试回答');
    store.getState().nextQuestion();
    assert.equal(store.getState().sessionState.currentQuestionIndex, 1);
    assert.equal(store.getState().sessionState.isComplete, false);
    store.getState().saveSessionData();
    store.getState().loadSessionData();
    assert.equal(store.getState().sessionState.questionMode, 'outline');
    assert.equal((await store.getState().generateQuestionStream()).content, '这对创新有什么影响？');
    store.getState().saveAnswer('outline_1', '（跳过）');
    store.getState().nextQuestion();
    assert.equal(store.getState().sessionState.isComplete, true);
    assert.equal(store.getState().interviewState.currentStep, 'completed');
    assert.equal(await store.getState().generateQuestionStream(), null);
    assert.equal(store.getState().sessionState.questions.length, 2);
    await assert.rejects(store.getState().generateQuestionListPreview(), /严格模式/);
  } finally { globalThis.fetch = originalFetch; }
});

test('AI mode prompts use original material beyond summary and never silently return creator defaults', () => {
  const client = new AIAPIClient({ apiKey: 'test', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' });
  const context = { sources: [{ title: '研究提纲', content: '研究员工创新行为，特别关注反例 unique-source-detail。' }], analysisResult: { summary: '摘要没有具体细节', keyTopics: ['创新'] } };
  assert.match(client.buildQuestionListPrompt(context), /unique-source-detail/);
  assert.match(client.buildQuestionPrompt(context, { questions: [], answers: {} }), /unique-source-detail/);
  const warn = console.warn; console.warn = () => {};
  try { assert.throws(() => client.parseQuestionListResponse({ choices: [{ message: { content: 'not json' } }] }), /不会使用默认问题/); }
  finally { console.warn = warn; }
});

test('AI preview parser accepts fenced objects, arrays and numbered model output', () => {
  const client = new AIAPIClient({ apiKey: 'test', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' });
  const response = content => ({ choices: [{ message: { content } }] });
  assert.equal(client.parseQuestionListResponse(response('```json\n{"questions":[{"question":"岗位发生了什么变化？"}]}\n```'))[0].question, '岗位发生了什么变化？');
  assert.equal(client.parseQuestionListResponse(response('["您如何判断 AI 结果？"]'))[0].question, '您如何判断 AI 结果？');
  assert.deepEqual(client.parseQuestionListResponse(response('1. 您最常在哪个环节使用 AI？\n2、您如何验证结果？')).map(item => item.question), ['您最常在哪个环节使用 AI？', '您如何验证结果？']);
  assert.deepEqual(client.parseQuestionListResponse(response('{"questions":[\n{"question":"第一题？"}\n{"question":"第二题？"}')).map(item => item.question), ['第一题？', '第二题？']);
});

test('preview mode selection retains analysis and immediately shows outline in original order without AI', () => {
  const analysis = { summary: 'AI时代员工角色身份转变与创新工作行为', keyTopics: ['员工创新'] };
  store.setState({ sessionState: { ...store.getState().sessionState, questions: [], questionMode: null }, contentState: { ...store.getState().contentState, sources: [{ id: 'outline-src', title: '访谈提纲', content: '1. 您的岗位是什么？\n2. 您如何判断AI的结果？' }], analysisResult: analysis, outlineQuestions: [], previewQuestions: [{ question: '旧预览' }], questionMode: 'ai' } });
  store.getState().setQuestionMode('outline');
  assert.equal(store.getState().contentState.analysisResult, analysis);
  assert.deepEqual(store.getState().contentState.outlineQuestions, ['您的岗位是什么？', '您如何判断AI的结果？']);
  assert.equal(store.getState().contentState.previewQuestions.length, 0);
  store.getState().setQuestionMode('ai');
  assert.equal(store.getState().contentState.analysisResult, analysis);
  assert.equal(store.getState().contentState.questionMode, 'ai');
});

test('saved legacy fallback is archived and hidden while analysis and interview answers remain intact', () => {
  const legacy = ['能先简单介绍一下您的创作背景吗？', '是什么让您开始这个创作项目的？', '在创作过程中，您的工作流程是怎样的？', '创作过程中遇到过什么挑战吗？', '对于想要开始类似创作的人，您有什么建议？'].map(question => ({ question }));
  const state = store.getState();
  localStorage.setItem('interview_session_data', JSON.stringify({ contentState: { ...state.contentState, previewQuestions: legacy }, sessionState: { ...state.sessionState, answers: { existing: { content: '保留的回答' } } }, interviewState: state.interviewState, resultState: state.resultState }));
  store.getState().loadSessionData();
  assert.deepEqual(store.getState().contentState.previewQuestions, []);
  assert.equal(store.getState().contentState.legacyPreviewBackup.length, 5);
  assert.match(store.getState().contentState.previewNotice, /固定备用问题/);
  assert.match(store.getState().contentState.analysisResult.summary, /员工/);
  assert.equal(store.getState().sessionState.answers.existing.content, '保留的回答');
});

test('existing interview does not block outline preview and restart retains material and full analysis with backup', () => {
  const questions = [{ id: 'old-1', content: '旧问题' }];
  const analysis = { summary: '可审核的完整摘要', keyTopics: ['岗位变化'], additionalDetail: '不能隐藏的详情' };
  store.setState({ contentState: { ...store.getState().contentState, questionMode: 'ai', analysisResult: analysis, outlineQuestions: [] }, sessionState: { ...store.getState().sessionState, questions, answers: { 'old-1': { content: '旧回答' } }, isGeneratingQuestion: false, questionMode: 'ai' } });
  const sources = store.getState().contentState.sources;
  store.getState().setQuestionMode('outline');
  assert.equal(store.getState().contentState.questionMode, 'outline');
  assert.equal(store.getState().sessionState.questions, questions);
  assert.equal(store.getState().sessionState.questionMode, 'ai');
  assert.equal(store.getState().contentState.analysisResult, analysis);
  store.getState().restartKeepingMaterials();
  assert.equal(store.getState().sessionState.questions.length, 0);
  assert.equal(store.getState().contentState.analysisResult, analysis);
  assert.equal(store.getState().contentState.sources, sources);
  assert.equal(JSON.parse(localStorage.getItem('interview_session_archive')).at(-1).sessionState.answers['old-1'].content, '旧回答');
});

test('confirmed outline replaces an existing interview only after archiving it', () => {
  localStorage.removeItem('interview_session_archive');
  store.setState({
    contentState: { ...store.getState().contentState, questionMode: 'outline', outlineQuestions: ['新提纲第一题？', '新提纲第二题？'], outlineConfirmed: true },
    sessionState: { ...store.getState().sessionState, questions: [{ id: 'old-question', content: '旧访谈问题' }], answers: { 'old-question': { content: '旧回答' } }, isGeneratingQuestion: false }
  });
  store.getState().startOutlineInterview();
  const state = store.getState();
  assert.equal(state.interviewState.currentStep, 'interviewing');
  assert.deepEqual(state.sessionState.questions.map(question => question.content), ['新提纲第一题？', '新提纲第二题？']);
  assert.deepEqual(state.sessionState.answers, {});
  assert.equal(JSON.parse(localStorage.getItem('interview_session_archive')).at(-1).sessionState.answers['old-question'].content, '旧回答');
});

test('backup failure does not reset the existing interview', () => {
  store.setState({ sessionState: { ...store.getState().sessionState, questions: [{ id: 'kept', content: '保留' }] } });
  const setItem = localStorage.setItem;
  localStorage.setItem = (key, value) => { if (key === 'interview_session_archive') throw new Error('storage full'); setItem(key, value); };
  try { assert.throws(() => store.getState().restartKeepingMaterials(), /storage full/); assert.equal(store.getState().sessionState.questions[0].id, 'kept'); }
  finally { localStorage.setItem = setItem; }
});

test('rendered preparation page shows both preview buttons and full analysis even with existing questions', async () => {
  buildSync({ stdin: { contents: "export { ContentInput } from './src/blocks/ContentInput.jsx'; export { useInterviewStore as store } from './src/hooks/useInterviewStore.jsx';", resolveDir: new URL('../', import.meta.url).pathname, loader: 'jsx' }, outfile: new URL('../work/outline-test-ui.mjs', import.meta.url).pathname, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic' });
  const { ContentInput, store: uiStore } = await import('../work/outline-test-ui.mjs');
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  uiStore.setState({ contentState: { ...uiStore.getState().contentState, analysisResult: { summary: '完整摘要审核测试', keyTopics: ['员工角色身份变化'], extraDetail: '额外详情也必须可见' } }, sessionState: { ...uiStore.getState().sessionState, questions: [{ id: 'existing', content: '已有问题' }] } });
  const oldError = console.error; console.error = () => {};
  let html;
  try { html = renderToStaticMarkup(createElement(ContentInput)); } finally { console.error = oldError; }
  assert.match(html, /展示提纲原题（不调用 AI）/);
  assert.match(html, /AI 分析生成问题/);
  assert.match(html, /完整摘要审核测试/);
  assert.match(html, /额外详情也必须可见/);
  assert.match(html, /备份旧记录，保留材料和分析重新设置访谈/);
  const buttons = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(m => m[0]);
  assert.ok(buttons.some(button => button.includes('展示提纲原题') && !button.includes('disabled')));
});

test('outline preview edit controls remain enabled when an older interview exists', async () => {
  buildSync({ stdin: { contents: "export { OutlineSetup } from './src/blocks/OutlineSetup.jsx'; export { useInterviewStore as store } from './src/hooks/useInterviewStore.jsx';", resolveDir: new URL('../', import.meta.url).pathname, loader: 'jsx' }, outfile: new URL('../work/outline-edit-ui.mjs', import.meta.url).pathname, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic' });
  const { OutlineSetup, store: editStore } = await import('../work/outline-edit-ui.mjs');
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  editStore.setState({ contentState: { ...editStore.getState().contentState, questionMode: 'outline', outlineQuestions: ['第一题？', '个人信息：'], outlineConfirmed: true }, sessionState: { ...editStore.getState().sessionState, questions: [{ id: 'old', content: '旧题' }] } });
  const oldError = console.error; console.error = () => {};
  let html;
  try { html = renderToStaticMarkup(createElement(OutlineSetup)); } finally { console.error = oldError; }
  const deleteButtons = [...html.matchAll(/<button\b[^>]*>(?:(?!<button\b)[\s\S])*?删除此题[\s\S]*?<\/button>/g)].map(match => match[0]);
  assert.equal(deleteButtons.length, 2);
  assert.ok(deleteButtons.every(button => !button.includes('disabled')));
  assert.match(html, /添加一道问题/);
  assert.match(html, /仍可增删、修改和排序/);
  const startButtons = [...html.matchAll(/<button\b[^>]*>(?:(?!<button\b)[\s\S])*?备份旧访谈并按提纲开始[\s\S]*?<\/button>/g)].map(match => match[0]);
  assert.equal(startButtons.length, 1);
  assert.ok(!startButtons[0].includes('disabled'));
});

test('admin test workflow is hidden by default and can be explicitly shown', async () => {
  buildSync({ stdin: { contents: "export { InterviewWorkspace } from './src/blocks/InterviewWorkspace.jsx'; export { useInterviewStore as store } from './src/hooks/useInterviewStore.jsx';", resolveDir: new URL('../', import.meta.url).pathname, loader: 'jsx' }, outfile: new URL('../work/admin-test-tools-ui.mjs', import.meta.url).pathname, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic' });
  const { InterviewWorkspace, store: workspaceStore } = await import('../work/admin-test-tools-ui.mjs');
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  workspaceStore.setState({
    interviewState: { ...workspaceStore.getState().interviewState, currentStep: 'content-input' },
    apiState: { ...workspaceStore.getState().apiState, isConfigured: true }
  });
  localStorage.removeItem('interview_admin_test_tools_visible');
  const oldError = console.error; console.error = () => {};
  let hiddenHtml;
  let visibleHtml;
  try {
    hiddenHtml = renderToStaticMarkup(createElement(InterviewWorkspace));
    localStorage.setItem('interview_admin_test_tools_visible', 'true');
    visibleHtml = renderToStaticMarkup(createElement(InterviewWorkspace));
  } finally {
    console.error = oldError;
    localStorage.removeItem('interview_admin_test_tools_visible');
  }
  assert.match(hiddenHtml, /管理员测试功能（可选）/);
  assert.match(hiddenHtml, /显示测试功能/);
  assert.doesNotMatch(hiddenHtml, /进行访谈（测试）/);
  assert.doesNotMatch(hiddenHtml, /生成访谈稿（测试）/);
  assert.doesNotMatch(hiddenHtml, /开始新访谈（测试）/);
  assert.match(visibleHtml, /进行访谈（测试）/);
  assert.match(visibleHtml, /生成访谈稿（测试）/);
  assert.match(visibleHtml, /开始新访谈（测试）/);
});
