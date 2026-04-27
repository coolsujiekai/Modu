/**
 * chatService.js
 * AI 阅读助手调用层。
 *
 * 架构预留三个口子：
 * 1. getUserContext()  — 可配置是否注入用户数据（未来多用户隐私开关）
 * 2. getSystemPrompt()  — 可扩展不同角色
 * 3. AI 模型选择       — 可切换混元 / 其他模型
 */
import { db, withRetry, withOpenIdFilter } from '../utils/db.js';
import { getTodayStatus } from './checkinService.js';

// ─── 口子一：用户上下文 ───────────────────────────────

/**
 * 获取用户上下文，塞进 system prompt。
 * 当前默认开启，未来可通过开关关闭（多用户隐私）。
 * @returns {Promise<string>} 上下文字符串，无数据时返回空字符串
 */
async function getUserContext() {
  try {
    const [openid, todayStatus, readingBooks, recentNotes] = await Promise.all([
      waitForOpenId(),
      getTodayStatus(true),
      fetchReadingBooks(),
      fetchRecentNotes()
    ]);

    const parts = [];

    // 在读书架
    if (readingBooks.length > 0) {
      const names = readingBooks.map(b => `《${b.bookName}》`).join('、');
      parts.push(`正在读：${names}`);
    }

    // 最近笔记
    if (recentNotes.length > 0) {
      const noteLines = recentNotes.slice(0, 5).map(n => {
        if (n.type === 'quote') return `金句："${n.text.slice(0, 60)}${n.text.length > 60 ? '…' : ''}"`;
        return `心得："${n.text.slice(0, 60)}${n.text.length > 60 ? '…' : ''}"`;
      });
      parts.push(`最近笔记：\n${noteLines.join('\n')}`);
    }

    // 打卡状态
    if (todayStatus.checkedIn) {
      parts.push(`已连续打卡 ${todayStatus.streak} 天`);
    }

    return parts.length > 0 ? parts.join('\n') : '';
  } catch (e) {
    return '';
  }
}

function waitForOpenId(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const app = getApp();
    const openid = app?.globalData?.openid;
    if (openid) { resolve(openid); return; }
    const cb = (id) => { resolve(id); };
    if (Array.isArray(app._openidReadyCbs)) {
      app._openidReadyCbs.push(cb);
    }
    setTimeout(() => {
      const id = app?.globalData?.openid;
      if (id) { resolve(id); }
      else { reject(new Error('openid 加载超时')); }
    }, timeoutMs);
  });
}

async function fetchReadingBooks() {
  try {
    const res = await withRetry(() =>
      db.collection('books')
        .where(withOpenIdFilter({ status: 'reading' }))
        .field({ bookName: true })
        .limit(10)
        .get()
    );
    return res.data || [];
  } catch (e) {
    return [];
  }
}

async function fetchRecentNotes() {
  try {
    const res = await withRetry(() =>
      db.collection('notes')
        .where(withOpenIdFilter({}))
        .orderBy('timestamp', 'desc')
        .limit(5)
        .field({ text: true, type: true })
        .get()
    );
    return res.data || [];
  } catch (e) {
    return [];
  }
}

// ─── 口子二：System Prompt ─────────────────────────────

/**
 * 组装 system prompt。
 * @param {string} userContext — 用户上下文（可为空）
 */
function buildSystemPrompt(userContext) {
  const contextPart = userContext
    ? `\n【用户状态】\n${userContext}`
    : '';

  return `你是我的阅读伴侣，不是搜索引擎。

你读过很多书，理解深刻，说话克制有留白。
一句话能说清的，不说三句。
不确定的，直接说"我没读到过这段"，不瞎猜。
推荐图书一次只说一本，说清楚为什么打动你。
不堆砌信息，不列清单，不说"根据研究表明"。
遇到不认识的字、成语、古文词，可直接查询。
对话过程中，会反问对方，引导话题继续下去。${contextPart}`;
}

// ─── AI 调用 ─────────────────────────────────────────

/**
 * 发送消息，返回 AI 回复。
 * @param {string} userMessage — 用户消息
 * @param {Array}  conversationHistory — [{role, content}, ...] 双方对话历史
 * @returns {Promise<string>} AI 回复文本
 */
export async function sendMessage(userMessage, conversationHistory = []) {
  const userContext = await getUserContext();
  const systemContent = buildSystemPrompt(userContext);

  const messages = [
    { role: 'system', content: systemContent },
    ...conversationHistory,
    { role: 'user', content: userMessage }
  ];

  const ai = wx?.cloud?.extend?.AI;
  if (!ai || typeof ai.createModel !== 'function') {
    throw new Error('wx.cloud.extend.AI 不可用，请升级微信基础库');
  }

  const model = ai.createModel('hunyuan-exp');
  const streamRes = await model.streamText({
    data: {
      model: 'hunyuan-turbos-latest',
      messages
    }
  });

  let reply = '';
  for await (const event of streamRes.eventStream) {
    if (event.data === '[DONE]') break;
    try {
      const data = JSON.parse(event.data);
      const delta = data?.choices?.[0]?.delta || {};
      const text = String(delta.content || '');
      if (text) reply += text;
    } catch (e) {
      // ignore malformed chunk
    }
  }

  if (!reply) throw new Error('AI 未返回有效内容');
  return reply;
}
