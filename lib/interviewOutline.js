// Deterministic import only. Users review the list before it becomes the interview.
export function parseOutline(text) {
  const input = text.trim();
  if (!input) return [];
  if (/^[\[{]/.test(input)) {
    try {
      const parsed = JSON.parse(input);
      const items = Array.isArray(parsed) ? parsed : parsed.questions;
      if (Array.isArray(items)) return items.map(q => typeof q === 'string' ? q : q.question || q.content || '').filter(q => q.trim());
    } catch { /* Treat non-JSON as text. */ }
  }
  const lines = input.split(/\r?\n/);
  const numberedPattern = /^(?:(?:问题\s*|Q\s*)?\d+[.、．)）:：]\s*|[（(]\d+[）)]\s*)(.+)$/i;
  const hasNumberedQuestions = lines.some(raw => numberedPattern.test(raw.trim()));
  const blocks = []; let current = '';
  const flush = () => { if (current.trim()) blocks.push(current.trim()); current = ''; };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^#{1,6}\s/.test(line) || /^[-*_]{3,}$/.test(line)) { flush(); continue; }
    const numbered = line.match(numberedPattern);
    if (numbered) { flush(); current = numbered[1].trim(); continue; }

    // A numbered outline is authoritative: headings and explanatory paragraphs
    // after a completed numbered question must not become extra questions.
    if (hasNumberedQuestions) {
      const looksLikeSubquestion = /[?？]$/.test(line) || /^(请|能否|是否|为什么|如何|怎样|哪些|什么|何时|哪里|谁|您|你)/.test(line);
      if (current && !/^[^?？]{1,30}[：:]$/.test(line) &&
          (!/[?？。！!]$/.test(current) || looksLikeSubquestion)) {
        current += `\n${line}`;
      }
      continue;
    }

    const bullet = line.match(/^[-*+]\s+(.+)$/);
    const candidate = (bullet?.[1] || line).trim();
    if (/^[^?？]{1,30}[：:]$/.test(candidate)) { flush(); continue; }
    if (/[?？]$/.test(candidate)) { flush(); blocks.push(candidate); }
  }
  flush(); return blocks;
}
export function strictQuestionList(questions) {
  if (!Array.isArray(questions) || !questions.length || questions.some(q => typeof q !== 'string' || !q.trim())) throw new Error('请先整理提纲问题，不能包含空问题');
  return questions.map((content, index) => ({ id: `outline_${index}`, content, category: '提纲原题', isFromOutline: true, timestamp: new Date().toISOString() }));
}
export function sourceContext(sources = []) {
  return sources.map((source, i) => `【材料 ${i + 1}：${source.title || '未命名'}】\n${source.content}`).join('\n\n');
}

// Detect only the complete, exact fallback shipped by the original app.
export function isLegacyFallback(questions = []) {
  const legacy = [
    '能先简单介绍一下您的创作背景吗？',
    '是什么让您开始这个创作项目的？',
    '在创作过程中，您的工作流程是怎样的？',
    '创作过程中遇到过什么挑战吗？',
    '对于想要开始类似创作的人，您有什么建议？'
  ];
  return questions.length === legacy.length && questions.every((q, i) => q.question === legacy[i]);
}
