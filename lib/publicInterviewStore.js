import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const PUBLIC_SPEECH_TOKEN_LIMIT = 200000;
const emptyData = () => ({ version: 2, campaigns: [], sessions: [], visitors: [] });
const tokenHash = token => createHash('sha256').update(token).digest('hex');
const safeEqual = (left, right) => {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && timingSafeEqual(a, b);
};

export class PublicInterviewStore {
  constructor(filename) {
    this.filename = filename;
    this.writeQueue = Promise.resolve();
  }

  async read() {
    try {
      const data = JSON.parse(await readFile(this.filename, 'utf8'));
      return { ...emptyData(), ...data, campaigns: data.campaigns || [], sessions: data.sessions || [], visitors: data.visitors || [] };
    } catch (error) {
      if (error.code === 'ENOENT') return emptyData();
      throw error;
    }
  }

  async mutate(change) {
    const operation = this.writeQueue.then(async () => {
      const data = await this.read();
      const result = await change(data);
      await mkdir(path.dirname(this.filename), { recursive: true });
      const temporary = `${this.filename}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temporary, JSON.stringify(data, null, 2), 'utf8');
      await rename(temporary, this.filename);
      return result;
    });
    this.writeQueue = operation.catch(() => {});
    return operation;
  }

  async createCampaign(input) {
    const questions = (input.questions || []).map((question, index) => ({
      id: question.id || `question_${index + 1}`,
      content: String(question.content || question.question || question).trim(),
      category: question.category || '访谈问题'
    })).filter(question => question.content);
    if (!questions.length) throw new Error('发布前至少需要一道问题');
    if (questions.length > 100) throw new Error('单次访谈最多支持100道问题');
    const now = new Date().toISOString();
    const campaign = {
      id: `campaign_${randomUUID()}`,
      title: String(input.title || '深度访谈').trim().slice(0, 120),
      description: String(input.description || '').trim().slice(0, 2000),
      questions,
      active: true,
      createdAt: now,
      updatedAt: now
    };
    return this.mutate(data => { data.campaigns.push(campaign); return campaign; });
  }

  async listCampaigns() {
    const data = await this.read();
    return data.campaigns.map(campaign => ({
      ...campaign,
      sessionCount: data.sessions.filter(session => session.campaignId === campaign.id).length,
      completedCount: data.sessions.filter(session => session.campaignId === campaign.id && session.status === 'completed').length
    })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getPublicCampaign(id) {
    const data = await this.read();
    const campaign = data.campaigns.find(item => item.id === id && item.active);
    if (!campaign) return null;
    return { id: campaign.id, title: campaign.title, description: campaign.description, questions: campaign.questions, createdAt: campaign.createdAt };
  }

  quotaFor(visitor) {
    const used = Math.max(0, Number(visitor?.speechTokensUsed) || 0);
    return {
      limit: PUBLIC_SPEECH_TOKEN_LIMIT,
      used,
      remaining: Math.max(0, PUBLIC_SPEECH_TOKEN_LIMIT - used)
    };
  }

  visitorFor(data, visitorId, create = false) {
    if (!visitorId) return null;
    const idHash = tokenHash(visitorId);
    let visitor = data.visitors.find(item => item.idHash === idHash);
    if (!visitor && create) {
      const now = new Date().toISOString();
      visitor = { idHash, speechTokensUsed: 0, createdAt: now, updatedAt: now, speechRequest: null };
      data.visitors.push(visitor);
    }
    return visitor;
  }

  async createSession(campaignId, input = {}, visitorId = '') {
    const token = randomBytes(32).toString('base64url');
    const now = new Date().toISOString();
    return this.mutate(data => {
      const campaign = data.campaigns.find(item => item.id === campaignId && item.active);
      if (!campaign) throw new Error('访谈不存在或已停止');
      const visitor = this.visitorFor(data, visitorId, true);
      const session = {
        id: `session_${randomUUID()}`,
        campaignId,
        attemptGroupId: String(input.attemptGroupId || `participant_${randomUUID()}`).slice(0, 120),
        attemptNumber: 1,
        participantName: String(input.participantName || '匿名受访者').trim().slice(0, 80) || '匿名受访者',
        tokenHash: tokenHash(token),
        visitorHash: visitor?.idHash || null,
        status: 'active',
        answers: {},
        currentQuestionIndex: 0,
        startedAt: now,
        updatedAt: now,
        pausedAt: null,
        completedAt: null
      };
      const attempts = data.sessions.filter(item => item.campaignId === campaignId && item.attemptGroupId === session.attemptGroupId);
      session.attemptNumber = attempts.length + 1;
      data.sessions.push(session);
      return { session: this.publicSession(session, campaign, visitor), token };
    });
  }

  publicSession(session, campaign, visitor) {
    return {
      id: session.id,
      campaignId: session.campaignId,
      attemptGroupId: session.attemptGroupId,
      attemptNumber: session.attemptNumber,
      participantName: session.participantName,
      status: session.status,
      answers: session.answers,
      currentQuestionIndex: session.currentQuestionIndex,
      startedAt: session.startedAt,
      updatedAt: session.updatedAt,
      pausedAt: session.pausedAt,
      completedAt: session.completedAt,
      speechQuota: this.quotaFor(visitor),
      campaign: campaign ? { id: campaign.id, title: campaign.title, description: campaign.description, questions: campaign.questions } : undefined
    };
  }

  async getSession(id, token) {
    const data = await this.read();
    const session = data.sessions.find(item => item.id === id);
    if (!session || !safeEqual(session.tokenHash, tokenHash(token))) return null;
    const campaign = data.campaigns.find(item => item.id === session.campaignId);
    const visitor = data.visitors.find(item => item.idHash === session.visitorHash);
    return this.publicSession(session, campaign, visitor);
  }

  async updateSession(id, token, input) {
    return this.mutate(data => {
      const session = data.sessions.find(item => item.id === id);
      if (!session || !safeEqual(session.tokenHash, tokenHash(token))) return null;
      const campaign = data.campaigns.find(item => item.id === session.campaignId);
      if (!campaign) throw new Error('访谈配置不存在');
      const allowedIds = new Set(campaign.questions.map(question => question.id));
      if (input.answers && typeof input.answers === 'object') {
        for (const [questionId, answer] of Object.entries(input.answers)) {
          if (!allowedIds.has(questionId)) continue;
          session.answers[questionId] = {
            content: String(answer?.content ?? answer ?? '').slice(0, 50000),
            answeredAt: answer?.answeredAt || new Date().toISOString()
          };
        }
      }
      if (Number.isInteger(input.currentQuestionIndex)) {
        session.currentQuestionIndex = Math.max(0, Math.min(input.currentQuestionIndex, campaign.questions.length - 1));
      }
      const now = new Date().toISOString();
      if (input.status === 'paused') {
        session.status = 'paused';
        session.pausedAt = now;
      } else if (input.status === 'completed') {
        session.status = 'completed';
        session.completedAt = now;
        session.pausedAt = null;
      } else if (input.status === 'active') {
        session.status = 'active';
        session.pausedAt = null;
      }
      session.updatedAt = now;
      const visitor = data.visitors.find(item => item.idHash === session.visitorHash);
      return this.publicSession(session, campaign, visitor);
    });
  }

  async bindSessionVisitor(id, token, visitorId) {
    return this.mutate(data => {
      const session = data.sessions.find(item => item.id === id);
      if (!session || !safeEqual(session.tokenHash, tokenHash(token))) return null;
      let visitor = data.visitors.find(item => item.idHash === session.visitorHash);
      if (!visitor) {
        visitor = this.visitorFor(data, visitorId, true);
        session.visitorHash = visitor.idHash;
      }
      const campaign = data.campaigns.find(item => item.id === session.campaignId);
      return this.publicSession(session, campaign, visitor);
    });
  }

  async beginSpeechRequest(id, token) {
    return this.mutate(data => {
      const session = data.sessions.find(item => item.id === id);
      if (!session || !safeEqual(session.tokenHash, tokenHash(token))) return null;
      if (session.status !== 'active') throw new Error('只有进行中的访谈可以使用语音转写');
      const visitor = data.visitors.find(item => item.idHash === session.visitorHash);
      if (!visitor) throw new Error('访客额度记录不存在，请刷新页面后重试');
      const now = Date.now();
      if (visitor.speechRequest && Date.parse(visitor.speechRequest.expiresAt) > now) {
        const error = new Error('上一段录音仍在转写，请完成后再试');
        error.statusCode = 409;
        throw error;
      }
      const quota = this.quotaFor(visitor);
      if (quota.remaining <= 0) {
        const error = new Error('本访客的语音转写额度已用完（200,000 tokens）');
        error.statusCode = 429;
        throw error;
      }
      const requestId = randomUUID();
      visitor.speechRequest = { id: requestId, sessionId: id, expiresAt: new Date(now + 5 * 60 * 1000).toISOString() };
      visitor.updatedAt = new Date(now).toISOString();
      return { requestId, quota };
    });
  }

  async finishSpeechRequest(id, token, requestId, usedTokens) {
    return this.mutate(data => {
      const session = data.sessions.find(item => item.id === id);
      if (!session || !safeEqual(session.tokenHash, tokenHash(token))) return null;
      const visitor = data.visitors.find(item => item.idHash === session.visitorHash);
      if (!visitor || visitor.speechRequest?.id !== requestId) throw new Error('语音转写额度结算记录无效');
      visitor.speechTokensUsed = Math.max(0, Number(visitor.speechTokensUsed) || 0) + Math.max(1, Math.floor(Number(usedTokens) || 1));
      visitor.speechRequest = null;
      visitor.updatedAt = new Date().toISOString();
      return this.quotaFor(visitor);
    });
  }

  async cancelSpeechRequest(id, token, requestId) {
    return this.mutate(data => {
      const session = data.sessions.find(item => item.id === id);
      if (!session || !safeEqual(session.tokenHash, tokenHash(token))) return false;
      const visitor = data.visitors.find(item => item.idHash === session.visitorHash);
      if (visitor?.speechRequest?.id === requestId) {
        visitor.speechRequest = null;
        visitor.updatedAt = new Date().toISOString();
      }
      return true;
    });
  }

  async listSessions(campaignId) {
    const data = await this.read();
    return data.sessions.filter(session => !campaignId || session.campaignId === campaignId)
      .map(stored => {
        const { tokenHash: ignoredToken, visitorHash: ignoredVisitor, ...session } = stored;
        return { ...session, speechQuota: this.quotaFor(data.visitors.find(visitor => visitor.idHash === stored.visitorHash)) };
      })
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
}
