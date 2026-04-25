/**
 * bookOperations/index.js
 * 统一处理书籍和笔记的所有写操作，云端强制校验 openid，
 * 数据隔离更安全，不依赖客户端传来的 _openid 字段。
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

let TencentCloudSdk = null;
try {
  // Optional dependency; must be installed in cloudfunction package.json
  TencentCloudSdk = require('tencentcloud-sdk-nodejs');
} catch (e) {
  TencentCloudSdk = null;
}

/**
 * 从云端上下文中安全获取 openid（不可伪造）
 */
function getOpenid(event) {
  return cloud.getWXContext().OPENID;
}

// ─── 阅读打卡联动（写笔记=自动打卡）──────────────────────────────

const CHALLENGES_COLLECTION = 'reading_challenges';
const PARTICIPANTS_COLLECTION = 'challenge_participants';
const CHECKINS_COLLECTION = 'challenge_checkins';
const CONFIG_COLLECTION = 'app_config';
const FEATURE_FLAG_DOC_ID = 'rc_feature';

async function isChallengeFeatureEnabled() {
  // Default enabled when config is missing
  try {
    const res = await db.collection(CONFIG_COLLECTION).doc(FEATURE_FLAG_DOC_ID).get();
    const enabled = res?.data?.enabled;
    return enabled !== false;
  } catch (e) {
    return true;
  }
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDateKey(ts = Date.now()) {
  const d = new Date(Number(ts || 0) || Date.now());
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function getMonthKey(ts = Date.now()) {
  const d = new Date(Number(ts || 0) || Date.now());
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function monthStartEnd(ts = Date.now()) {
  const d = new Date(Number(ts || 0) || Date.now());
  const y = d.getFullYear();
  const m = d.getMonth();
  const start = new Date(y, m, 1, 0, 0, 0, 0).getTime();
  const end = new Date(y, m + 1, 0, 23, 59, 59, 999).getTime();
  return { start, end };
}

async function hasCheckedToday(challengeId, openid, dateKey) {
  const res = await db
    .collection(CHECKINS_COLLECTION)
    .where({ challengeId, _openid: openid, checkinDate: dateKey })
    .limit(1)
    .get();
  return (res.data || []).length > 0;
}

async function computeCheckinDays(challengeId, openid) {
  const res = await db
    .collection(CHECKINS_COLLECTION)
    .where({ challengeId, _openid: openid })
    .field({ checkinDate: true, checkedAt: true, createdAt: true })
    .limit(500)
    .get();
  const list = res.data || [];
  const set = new Set();
  list.forEach((c) => {
    const key = String(c.checkinDate || '').trim() || formatDateKey(c.checkedAt || c.createdAt || 0);
    if (key) set.add(key);
  });
  return set.size;
}

async function getMyParticipant(challengeId, openid) {
  const res = await db
    .collection(PARTICIPANTS_COLLECTION)
    .where({ challengeId, _openid: openid })
    .limit(1)
    .get();
  return (res.data || [])[0] || null;
}

async function ensureParticipant(challengeId, openid) {
  const existing = await getMyParticipant(challengeId, openid);
  if (existing?._id) return existing;
  const now = Date.now();
  const addRes = await db.collection(PARTICIPANTS_COLLECTION).add({
    data: {
      challengeId,
      _openid: openid,
      selectedBookId: '',
      selectedBookName: '',
      checkinDays: 0,
      lastCheckinDate: '',
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    }
  });
  const created = await db.collection(PARTICIPANTS_COLLECTION).doc(addRes._id).get();
  return created?.data || null;
}

async function getOrCreateActiveChallengeDoc() {
  const now = Date.now();
  const monthKey = getMonthKey(now);

  // Prefer current-month monthly activity
  const existing = await db.collection(CHALLENGES_COLLECTION)
    .where({ type: 'rc_monthly', monthKey, status: 'active' })
    .limit(1)
    .get()
    .catch(() => ({ data: [] }));
  const hit = (existing.data || [])[0] || null;
  if (hit) return hit;

  // Any other active activity
  const any = await db.collection(CHALLENGES_COLLECTION)
    .where({ status: 'active' })
    .limit(1)
    .get()
    .catch(() => ({ data: [] }));
  const anyActive = (any.data || [])[0] || null;
  if (anyActive) return anyActive;

  // Auto-create current-month activity (best-effort)
  const { start, end } = monthStartEnd(now);
  try {
    // End any previous rc_monthly active challenges
    const prevActive = await db.collection(CHALLENGES_COLLECTION)
      .where({ type: 'rc_monthly', status: 'active' })
      .limit(20)
      .get()
      .catch(() => ({ data: [] }));
    const prevList = prevActive.data || [];
    for (const it of prevList) {
      if (!it?._id) continue;
      await db.collection(CHALLENGES_COLLECTION).doc(it._id).update({
        data: { status: 'ended', endedAt: now, updatedAt: now }
      });
    }

    const name = `${new Date(now).getMonth() + 1}月每日阅读打卡`;
    const desc = '每天读一点，坚持更容易。写金句或心得，也会自动完成当天打卡。';
    const addRes = await db.collection(CHALLENGES_COLLECTION).add({
      data: {
        type: 'rc_monthly',
        monthKey,
        name,
        desc,
        startDate: start,
        endDate: end,
        status: 'active',
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      }
    });
    const createdId = addRes?._id;
    if (!createdId) return null;
    const created = await db.collection(CHALLENGES_COLLECTION).doc(createdId).get();
    return created?.data || null;
  } catch (e) {
    return null;
  }
}

async function maybeAutoCheckinAfterNote({ openid, bookId, bookName, note }) {
  // Only count quote/thought as checkin
  const t = String(note?.type || '').trim();
  if (t !== 'quote' && t !== 'thought') return { ok: true, skipped: true, reason: 'note type not eligible' };

  const enabled = await isChallengeFeatureEnabled();
  if (!enabled) return { ok: true, skipped: true, reason: 'feature disabled' };

  const challenge = await getOrCreateActiveChallengeDoc();
  if (!challenge?._id) return { ok: true, skipped: true, reason: 'no active challenge' };

  const challengeId = challenge._id;
  const now = Date.now();
  const todayKey = formatDateKey(now);

  const already = await hasCheckedToday(challengeId, openid, todayKey);
  if (already) return { ok: true, alreadyChecked: true };

  await db.collection(CHECKINS_COLLECTION).add({
    data: {
      challengeId,
      _openid: openid,
      bookId,
      bookName: String(bookName || '').trim(),
      checkinDate: todayKey,
      source: 'note',
      noteId: String(note?.timestamp || ''),
      checkedAt: now,
      createdAt: now,
    }
  });

  const participant = await ensureParticipant(challengeId, openid);
  const days = await computeCheckinDays(challengeId, openid);
  await db.collection(PARTICIPANTS_COLLECTION).doc(participant._id).update({
    data: {
      selectedBookId: bookId,
      selectedBookName: String(bookName || '').trim(),
      lastCheckinDate: todayKey,
      checkinDays: days,
      updatedAt: Date.now(),
    }
  });

  return { ok: true, checked: true, challengeId, checkinDays: days };
}

// ─── AI：读书心得生成（客户端流式 + 云端落库/配额）─────────────────────

const AI_PROMPT_VERSION = 'reflection_v1';
const AI_MODEL = 'hunyuan-turbos-latest';
const AI_TARGET_CHARS = 240;
const AI_QUOTE_MAX_CHARS = 50;
const AI_DAILY_LIMIT_PER_BOOK = 3;
const AI_QUOTA_COLLECTION = 'ai_quota';

function pad2(n) {
  return String(n).padStart(2, '0');
}

function dayKeyCN(ts = Date.now()) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return `${y}${m}${day}`;
}

function nextDayStartCN(ts = Date.now()) {
  const d = new Date(ts);
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function clip(s, maxLen) {
  const t = String(s || '').trim();
  if (!t) return '';
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

function normalizeText(s) {
  return String(s || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function softTrimToChars(text, target = AI_TARGET_CHARS, max = 260) {
  const t = normalizeText(text);
  if (!t) return '';
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const last = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'), cut.lastIndexOf('；'));
  if (last > Math.max(40, target - 60)) return cut.slice(0, last + 1);
  return cut.trimEnd();
}

function enforceOneParagraph(text) {
  return normalizeText(text).replace(/\n+/g, ' ');
}

function enforceQuoteLimit(text, maxQuoteChars = AI_QUOTE_MAX_CHARS) {
  let t = String(text || '');
  // Keep at most two quoted segments and cap total quote length.
  const quoteRe = /[“"](.*?)[”"]/g;
  const matches = [];
  let m;
  while ((m = quoteRe.exec(t)) && matches.length < 5) {
    matches.push({ full: m[0], inner: m[1] || '' });
  }
  if (matches.length === 0) return t;

  // Remove extra quoted segments beyond the first two.
  for (let i = 2; i < matches.length; i++) {
    t = t.replace(matches[i].full, '');
  }

  const q1 = String(matches[0]?.inner || '');
  const q2 = String(matches[1]?.inner || '');
  const total = q1.length + q2.length;

  // Cap total quote length.
  if (total > maxQuoteChars) {
    const remain = Math.max(0, maxQuoteChars - q1.length);
    if (matches[1]) {
      if (remain <= 0) {
        t = t.replace(matches[1].full, '');
      } else if (q2.length > remain) {
        t = t.replace(matches[1].full, `“${q2.slice(0, remain)}”`);
      }
    } else if (q1.length > maxQuoteChars) {
      t = t.replace(matches[0].full, `“${q1.slice(0, maxQuoteChars)}”`);
    }
  }

  return t;
}

function buildReflectionSystemPrompt() {
  return [
    '你是一个中文写作者，擅长把零散读书记录揉成一段文艺、自然、精炼的读书心得。',
    '',
    '硬性要求：',
    '1) 只允许基于我提供的材料写作，不要编造书中情节、人物、情境、结局等具体事实；可以做抽象概括与情绪表达。',
    '2) 输出为中文，语气自然克制，避免堆砌形容词与鸡汤套话。尽量保留我的措辞/口吻/反差感短句。',
    `3) 只输出一段话，目标长度约 ${AI_TARGET_CHARS} 个中文字符（允许小幅上下浮动），不要标题、不要分条、不要表情符号。`,
    `4) 允许出现原文引用（来自我提供的金句/片段），引用必须保持原文，不要改写；最多 2 句，且两句合计不超过 ${AI_QUOTE_MAX_CHARS} 个中文字符；超出请减少引用或不引用。`,
    '5) 不要提到AI/模型/提示词/系统等元信息。'
  ].join('\n');
}

function buildReflectionUserPrompt(book, thoughts, quotes) {
  const bookName = (book?.bookName || '未命名').trim();
  const authorName = (book?.authorName || '').trim();
  const thoughtLines = thoughts.map((t) => `- ${t}`).join('\n') || '- （无）';
  const quoteLines = quotes.map((q) => `- ${q}`).join('\n') || '- （无）';
  return [
    `书名：《${bookName}》`,
    authorName ? `作者：${authorName}` : '作者：未知',
    '',
    '我的读书心得（thought）：',
    thoughtLines,
    '',
    '我摘录的金句/原文片段（quote）：',
    quoteLines,
    '',
    `请生成一段约 ${AI_TARGET_CHARS} 字的读书心得，要求文艺自然、精炼克制；可引用原文最多 2 句，且两句合计不超过 ${AI_QUOTE_MAX_CHARS} 字。`
  ].join('\n');
}

function packToMaxChars(lines, maxTotalChars) {
  const out = [];
  let used = 0;
  for (const s of lines) {
    const t = String(s || '').trim();
    if (!t) continue;
    const next = used ? used + 1 + t.length : t.length;
    if (next > maxTotalChars) break;
    out.push(t);
    used = next;
  }
  return out;
}

function buildReflectionMaterial(book) {
  const notes = Array.isArray(book?.notes) ? book.notes : [];
  const sorted = [...notes].sort((a, b) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0));
  // 强制“全部利用”：尽可能包含所有 notes，但为防止 prompt 过长，做总长度上限控制。
  const thoughtAll = sorted
    .filter((n) => n?.type !== 'quote')
    .map((n) => clip(n?.text, 120))
    .filter(Boolean);
  const quoteAll = sorted
    .filter((n) => n?.type === 'quote')
    .map((n) => clip(n?.text, 80))
    .filter(Boolean);

  // Total prompt budget (rough): keep each section within ~6000 chars.
  return {
    thoughts: packToMaxChars(thoughtAll, 30000),
    quotes: packToMaxChars(quoteAll, 6000)
  };
}

async function readQuota(openid, bookId, day) {
  const id = `${openid}_${bookId}_${day}`;
  try {
    const res = await db.collection(AI_QUOTA_COLLECTION).doc(id).get();
    return { id, data: res.data || null };
  } catch (e) {
    return { id, data: null };
  }
}

async function bumpQuota(openid, bookId, day, now) {
  const { id, data } = await readQuota(openid, bookId, day);
  if (!data) {
    await db.collection(AI_QUOTA_COLLECTION).doc(id).set({
      data: { _openid: openid, bookId, day, count: 1, lastAt: now }
    });
    return { count: 1 };
  }
  const next = Number(data.count || 0) + 1;
  await db.collection(AI_QUOTA_COLLECTION).doc(id).update({
    data: { count: _.inc(1), lastAt: now }
  });
  return { count: next };
}

function mapQuota(count, now) {
  const used = Math.max(0, Number(count || 0));
  const remaining = Math.max(0, AI_DAILY_LIMIT_PER_BOOK - used);
  return { used, remaining, resetAt: nextDayStartCN(now) };
}

async function prepareReflection(event) {
  const openid = getOpenid(event);
  const bookId = String(event.bookId || '').trim();
  const force = event.force === true;
  const now = Date.now();
  if (!bookId) throw new Error('bookId is required');

  const bookRes = await db.collection('books').doc(bookId).get();
  const book = bookRes.data;
  if (!book || book._openid !== openid) throw new Error('book not found or not owned');

  // Cache: return existing reflection when not forcing regenerate.
  if (!force && book.aiReflection) {
    const day = dayKeyCN(now);
    const q = await readQuota(openid, bookId, day);
    return {
      ok: true,
      text: String(book.aiReflection || ''),
      fromCache: true,
      quota: mapQuota(Number(q?.data?.count || 0), now),
      meta: {
        model: book.aiReflectionModel || AI_MODEL,
        promptVersion: book.aiReflectionPromptVersion || AI_PROMPT_VERSION,
        createdAt: Number(book.aiReflectionUpdatedAt || now),
        bookId
      }
    };
  }

  const { thoughts, quotes } = buildReflectionMaterial(book);

  if (thoughts.length < 1 && quotes.length < 2) {
    return { ok: false, code: 'INSUFFICIENT_MATERIAL', message: 'not enough notes' };
  }

  const day = dayKeyCN(now);
  const q = await readQuota(openid, bookId, day);
  const used = Number(q?.data?.count || 0);
  if (used >= AI_DAILY_LIMIT_PER_BOOK) {
    return {
      ok: false,
      code: 'QUOTA_EXCEEDED',
      message: 'quota exceeded',
      quota: mapQuota(used, now),
      cachedText: String(book.aiReflection || '')
    };
  }

  return {
    ok: true,
    fromCache: false,
    quota: mapQuota(used, now),
    prompts: {
      provider: 'wx.cloud.extend.AI',
      createModel: 'hunyuan-exp',
      model: AI_MODEL,
      system: buildReflectionSystemPrompt(),
      user: buildReflectionUserPrompt(book, thoughts, quotes)
    },
    meta: { model: AI_MODEL, promptVersion: AI_PROMPT_VERSION, createdAt: now, bookId }
  };
}

async function commitReflection(event) {
  const openid = getOpenid(event);
  const bookId = String(event.bookId || '').trim();
  const force = event.force === true;
  const rawText = String(event.text || '');
  const now = Date.now();
  if (!bookId) throw new Error('bookId is required');

  // Basic guard: require some text
  if (!rawText.trim()) {
    return { ok: false, code: 'MODEL_ERROR', message: 'empty text' };
  }

  // Post-process: one paragraph, length control, quote cap.
  let finalText = enforceOneParagraph(rawText);
  finalText = enforceQuoteLimit(finalText, AI_QUOTE_MAX_CHARS);
  finalText = softTrimToChars(finalText, AI_TARGET_CHARS, 260);

  const day = dayKeyCN(now);

  // Use a transaction to avoid quota races.
  const result = await db.runTransaction(async (transaction) => {
    const bookRef = db.collection('books').doc(bookId);
    const bookSnap = await transaction.collection('books').doc(bookId).get();
    const book = bookSnap?.data;
    if (!book || book._openid !== openid) throw new Error('book not found or not owned');

    // If not forcing and already has reflection, return cached without charging.
    if (!force && book.aiReflection) {
      const q = await readQuota(openid, bookId, day);
      return {
        ok: true,
        text: String(book.aiReflection || ''),
        fromCache: true,
        quota: mapQuota(Number(q?.data?.count || 0), now),
        meta: {
          model: book.aiReflectionModel || AI_MODEL,
          promptVersion: book.aiReflectionPromptVersion || AI_PROMPT_VERSION,
          createdAt: Number(book.aiReflectionUpdatedAt || now),
          bookId
        }
      };
    }

    const quotaId = `${openid}_${bookId}_${day}`;
    const quotaSnap = await transaction.collection(AI_QUOTA_COLLECTION).doc(quotaId).get().catch(() => null);
    let quotaCount = Number(quotaSnap?.data?.count || 0);

    if (quotaCount >= AI_DAILY_LIMIT_PER_BOOK) {
      return {
        ok: false,
        code: 'QUOTA_EXCEEDED',
        message: 'quota exceeded',
        quota: mapQuota(quotaCount, now),
        cachedText: String(book.aiReflection || '')
      };
    }

    // Save reflection to book.
    const material = buildReflectionMaterial(book);
    await transaction.collection('books').doc(bookId).update({
      data: {
        aiReflection: finalText,
        aiReflectionUpdatedAt: now,
        aiReflectionModel: AI_MODEL,
        aiReflectionPromptVersion: AI_PROMPT_VERSION,
        aiReflectionSourceStats: { thoughtCount: material.thoughts.length, quoteCount: material.quotes.length }
      }
    });

    // Charge quota after successful save.
    if (quotaCount <= 0) {
      await transaction.collection(AI_QUOTA_COLLECTION).doc(quotaId).set({
        data: { _openid: openid, bookId, day, count: 1, lastAt: now }
      });
      quotaCount = 1;
    } else {
      await transaction.collection(AI_QUOTA_COLLECTION).doc(quotaId).update({
        data: { count: _.inc(1), lastAt: now }
      });
      quotaCount = quotaCount + 1;
    }

    return {
      ok: true,
      text: finalText,
      fromCache: false,
      quota: mapQuota(quotaCount, now),
      meta: { model: AI_MODEL, promptVersion: AI_PROMPT_VERSION, createdAt: now, bookId }
    };
  });

  return result;
}

// ─── 最近笔记索引（recent_notes）──────────────────────────────

const RECENT_NOTES_COLLECTION = 'recent_notes';
const RECENT_NOTES_KEEP = 200;

function makeNoteId(bookId, timestamp) {
  return `${bookId}_${timestamp}`;
}

function clipText(text, maxLen = 300) {
  const s = String(text || '').trim();
  if (!s) return '';
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

async function upsertRecentNote({ openid, bookId, bookName, note }) {
  const ts = Number(note?.timestamp || 0);
  if (!bookId || !ts) return;
  const noteId = makeNoteId(bookId, ts);
  const payload = {
    _openid: openid,
    noteId,
    bookId,
    bookName: String(bookName || '').trim() || '未命名',
    type: note.type === 'quote' ? 'quote' : 'thought',
    text: clipText(note.text),
    timestamp: ts,
    updatedAt: Date.now()
  };
  // Use set() to be idempotent for retries.
  await db.collection(RECENT_NOTES_COLLECTION).doc(noteId).set({ data: payload });
}

async function removeRecentNote({ bookId, timestamp }) {
  const ts = Number(timestamp || 0);
  if (!bookId || !ts) return;
  const noteId = makeNoteId(bookId, ts);
  await db.collection(RECENT_NOTES_COLLECTION).doc(noteId).remove();
}

async function trimRecentNotes(openid, keep = RECENT_NOTES_KEEP) {
  const keepN = Math.max(0, Number(keep || 0));
  if (!openid) return;

  let offset = keepN;
  const batchSize = 50;
  while (true) {
    const res = await db
      .collection(RECENT_NOTES_COLLECTION)
      .where({ _openid: openid })
      .orderBy('timestamp', 'desc')
      .skip(offset)
      .limit(batchSize)
      .field({ _id: true })
      .get();

    const ids = (res.data || []).map((d) => d._id).filter(Boolean);
    if (ids.length === 0) break;

    await db
      .collection(RECENT_NOTES_COLLECTION)
      .where({ _openid: openid, _id: _.in(ids) })
      .remove();

    // Continue deleting beyond keepN
    offset += ids.length;
  }
}

// ─── 书籍操作 ────────────────────────────────────────────────

/**
 * 创建一本书（设为"在读"）
 * event: { bookName, authorId, authorName, authorNameNorm }
 */
async function addBook(event) {
  const openid = getOpenid(event);
  const { bookName, authorId, authorName, authorNameNorm } = event;
  if (!bookName || !bookName.trim()) throw new Error('bookName is required');

  const startTime = Date.now();
  const res = await db.collection('books').add({
    data: {
      _openid: openid,
      bookName: bookName.trim(),
      authorId: authorId || '',
      authorName: authorName || '',
      authorNameNorm: authorNameNorm || '',
      startTime,
      status: 'reading',
      notes: [],
      notesCount: 0,
      thoughtCount: 0,
      quoteCount: 0,
      durationMin: 0
    }
  });
  return { _id: res._id };
}

/**
 * 更新书籍基本信息（书名、作者）
 * event: { bookId, bookName, authorId, authorName, authorNameNorm }
 */
async function updateBookInfo(event) {
  const openid = getOpenid(event);
  const { bookId, bookName, authorId, authorName, authorNameNorm } = event;

  // 先校验书籍归属
  const book = await db.collection('books').doc(bookId).get();
  if (!book.data || book.data._openid !== openid) throw new Error('book not found or not owned');

  const patch = { updatedAt: Date.now() };
  if (bookName !== undefined) patch.bookName = bookName.trim();
  if (authorId !== undefined) patch.authorId = authorId;
  if (authorName !== undefined) patch.authorName = authorName;
  if (authorNameNorm !== undefined) patch.authorNameNorm = authorNameNorm;

  await db.collection('books').doc(bookId).update({ data: patch });
  return { success: true };
}

/**
 * 标记书籍为已读完
 * event: { bookId, startTime }
 */
async function finishBook(event) {
  const openid = getOpenid(event);
  const { bookId, startTime } = event;

  const book = await db.collection('books').doc(bookId).get();
  if (!book.data || book.data._openid !== openid) throw new Error('book not found or not owned');

  const endTime = Date.now();
  const durationMin = startTime ? Math.floor((endTime - startTime) / 60000) : 0;
  await db.collection('books').doc(bookId).update({
    data: { endTime, durationMin, status: 'finished' }
  });
  return { endTime, durationMin };
}

/**
 * 将书籍恢复为"在读"状态
 * event: { bookId }
 */
async function unfinishBook(event) {
  const openid = getOpenid(event);
  const { bookId } = event;

  const book = await db.collection('books').doc(bookId).get();
  if (!book.data || book.data._openid !== openid) throw new Error('book not found or not owned');

  await db.collection('books').doc(bookId).update({
    data: {
      status: 'reading',
      endTime: _.remove()
    }
  });
  return { success: true };
}

/**
 * 删除一本书
 * event: { bookId }
 */
async function removeBook(event) {
  const openid = getOpenid(event);
  const { bookId } = event;

  const book = await db.collection('books').doc(bookId).get();
  if (!book.data || book.data._openid !== openid) throw new Error('book not found or not owned');

  await db.collection('books').doc(bookId).remove();
  return { success: true };
}

// ─── 笔记操作 ────────────────────────────────────────────────

/**
 * 添加一条笔记
 * event: { bookId, text, type }
 */
async function addNote(event) {
  const openid = getOpenid(event);
  const { bookId, text, type } = event;
  if (!bookId || !text) throw new Error('bookId and text are required');

  const book = await db.collection('books').doc(bookId).get();
  if (!book.data || book.data._openid !== openid) throw new Error('book not found or not owned');

  const note = {
    text: String(text).trim(),
    type: type === 'quote' ? 'quote' : 'thought',
    timestamp: Date.now()
  };
  const notes = Array.isArray(book.data.notes) ? [...book.data.notes, note] : [note];
  const thoughtCount = notes.filter(n => n.type === 'thought').length;
  const quoteCount = notes.filter(n => n.type === 'quote').length;

  await db.collection('books').doc(bookId).update({
    data: {
      notes,
      notesCount: notes.length,
      thoughtCount,
      quoteCount
    }
  });

  // Maintain lightweight recent notes index for 首页展示（强一致写入云端）
  await upsertRecentNote({
    openid,
    bookId,
    bookName: book.data.bookName,
    note
  });
  await trimRecentNotes(openid, RECENT_NOTES_KEEP);

  // Auto check-in: treat note as today's checkin (best-effort; never fail note save).
  let autoCheckin = null;
  try {
    autoCheckin = await maybeAutoCheckinAfterNote({
      openid,
      bookId,
      bookName: book.data.bookName,
      note
    });
    console.log('[autoCheckinAfterNote]', autoCheckin);
  } catch (e) {
    autoCheckin = { ok: false, error: e?.message || String(e) };
    console.error('[autoCheckinAfterNote.error]', e);
  }

  return { thoughtCount, quoteCount, notesCount: notes.length, autoCheckin };
}

/**
 * 编辑一条笔记的文本
 * event: { bookId, timestamp, text }
 */
async function editNote(event) {
  const openid = getOpenid(event);
  const { bookId, timestamp, text } = event;
  if (!bookId || !timestamp || !text) throw new Error('bookId, timestamp, and text are required');

  const book = await db.collection('books').doc(bookId).get();
  if (!book.data || book.data._openid !== openid) throw new Error('book not found or not owned');

  const notes = Array.isArray(book.data.notes) ? book.data.notes : [];
  const idx = notes.findIndex(n => Number(n.timestamp) === Number(timestamp));
  if (idx < 0) throw new Error('note not found');

  notes[idx] = { ...notes[idx], text: String(text).trim() };
  const thoughtCount = notes.filter(n => n.type === 'thought').length;
  const quoteCount = notes.filter(n => n.type === 'quote').length;

  await db.collection('books').doc(bookId).update({
    data: { notes, notesCount: notes.length, thoughtCount, quoteCount }
  });

  // Sync recent notes index if exists (or create if missing)
  await upsertRecentNote({
    openid,
    bookId,
    bookName: book.data.bookName,
    note: notes[idx]
  });

  return { thoughtCount, quoteCount, notesCount: notes.length };
}

/**
 * 删除一条笔记
 * event: { bookId, timestamp }
 */
async function deleteNote(event) {
  const openid = getOpenid(event);
  const { bookId, timestamp } = event;
  if (!bookId || !timestamp) throw new Error('bookId and timestamp are required');

  const book = await db.collection('books').doc(bookId).get();
  if (!book.data || book.data._openid !== openid) throw new Error('book not found or not owned');

  const notes = Array.isArray(book.data.notes) ? book.data.notes : [];
  const idx = notes.findIndex(n => Number(n.timestamp) === Number(timestamp));
  if (idx < 0) throw new Error('note not found');

  notes.splice(idx, 1);
  const thoughtCount = notes.filter(n => n.type === 'thought').length;
  const quoteCount = notes.filter(n => n.type === 'quote').length;

  await db.collection('books').doc(bookId).update({
    data: { notes, notesCount: notes.length, thoughtCount, quoteCount }
  });

  // Remove from recent notes index (ignore if missing)
  try {
    await removeRecentNote({ bookId, timestamp });
  } catch (e) {
    // ignore
  }

  return { thoughtCount, quoteCount, notesCount: notes.length };
}

// ─── OCR（拍照识字） ──────────────────────────────────────────

/**
 * OCR printed text from a cloud fileID
 * event: { fileID }
 */
async function recognizeText(event) {
  const { fileID } = event;
  if (!fileID) throw new Error('fileID is required');

  if (!TencentCloudSdk) {
    throw new Error('TencentCloud SDK is not installed in cloudfunction');
  }

  const secretId = String(process.env.TENCENT_SECRET_ID || '').trim();
  const secretKey = String(process.env.TENCENT_SECRET_KEY || '').trim();
  const region = String(process.env.TENCENT_OCR_REGION || 'ap-guangzhou').trim() || 'ap-guangzhou';
  if (!secretId || !secretKey) {
    throw new Error('missing TencentCloud credentials (TENCENT_SECRET_ID / TENCENT_SECRET_KEY)');
  }

  // Tencent OCR needs an accessible URL; convert cloud fileID to tempFileURL.
  let imgUrl = String(fileID);
  if (imgUrl.startsWith('cloud://')) {
    const tmp = await cloud.getTempFileURL({ fileList: [imgUrl] });
    const url = tmp?.fileList?.[0]?.tempFileURL;
    if (!url) throw new Error('failed to get tempFileURL');
    imgUrl = url;
  }

  const OcrClient = TencentCloudSdk.ocr.v20181119.Client;
  const client = new OcrClient({
    credential: { secretId, secretKey },
    region,
    profile: {
      httpProfile: {
        reqMethod: 'POST',
        reqTimeout: 30
      }
    }
  });

  // GeneralBasicOCR: fast and cost-effective; good for book quotes.
  let resp;
  try {
    resp = await client.GeneralBasicOCR({ ImageUrl: imgUrl });
  } catch (err) {
    const code = err?.code || err?.Code || '';
    const reqId = err?.requestId || err?.RequestId || '';
    const msg = err?.message || err?.Message || String(err);
    throw new Error(`TencentCloud OCR failed${code ? ` (${code})` : ''}${reqId ? ` [${reqId}]` : ''}: ${msg}`);
  }

  const det = Array.isArray(resp?.TextDetections) ? resp.TextDetections : [];
  const lines = det.map((d) => String(d?.DetectedText || '').trim()).filter(Boolean);
  return { text: lines.join('\n') };
}

// ─── 作者操作 ────────────────────────────────────────────────

/**
 * 查找或创建作者
 * event: { authorInput }
 */
async function findOrCreateAuthor(event) {
  const openid = getOpenid(event);
  const { authorInput } = event;
  if (!authorInput || !authorInput.trim()) throw new Error('authorInput is required');

  const nameNorm = normalizeAuthorName(authorInput);
  if (!nameNorm) throw new Error('invalid author name');

  // 精确匹配
  const exact = await db
    .collection('authors')
    .where({ _openid: openid, nameNorm })
    .limit(1)
    .get();
  if (exact.data && exact.data[0]) {
    const a = exact.data[0];
    return { _id: a._id, name: a.name, nameNorm: a.nameNorm };
  }

  // 新建
  const now = Date.now();
  const res = await db.collection('authors').add({
    data: {
      _openid: openid,
      name: authorInput,
      nameNorm,
      tokens: buildAuthorTokens(nameNorm),
      aliases: [],
      createdAt: now,
      updatedAt: now
    }
  });
  return { _id: res._id, name: authorInput, nameNorm };
}

// ─── 工具函数（与客户端 utils/author.js 保持一致）─────────────

function normalizeAuthorName(input) {
  if (!input) return '';
  let s = input.trim();
  // 统一全角转半角
  s = s.replace(/[\u3000\xa0]/g, ' ');
  // 统一中文括号
  s = s.replace(/[（）()【】[\]]/g, '');
  // 移除英文名间的 "."（如 J.K.Rowling → JKRowling）
  s = s.replace(/\.\s*/g, '');
  // 统一中文顿号
  s = s.replace(/、/g, ' ');
  // collapse spaces
  s = s.replace(/\s+/g, ' ').trim();
  // 小写化拉丁字母
  s = s.toLowerCase();
  return s;
}

function buildAuthorTokens(nameNorm) {
  if (!nameNorm) return [];
  const tokens = nameNorm.split(' ').filter(Boolean);
  const seen = new Set(tokens);
  return [...seen];
}

// ─── 云函数入口 ──────────────────────────────────────────────

exports.main = async (event, context) => {
  const action = event.action;
  if (!action) {
    return { error: 'missing action: please redeploy miniprogram to latest version' };
  }
  try {
    switch (action) {
      case 'addBook':          return await addBook(event);
      case 'updateBookInfo':   return await updateBookInfo(event);
      case 'finishBook':       return await finishBook(event);
      case 'unfinishBook':     return await unfinishBook(event);
      case 'removeBook':       return await removeBook(event);
      case 'addNote':          return await addNote(event);
      case 'editNote':         return await editNote(event);
      case 'deleteNote':       return await deleteNote(event);
      case 'reflectionPrepare': return await prepareReflection(event);
      case 'reflectionCommit': return await commitReflection(event);
      case 'recognizeText':    return await recognizeText(event);
      case 'findOrCreateAuthor': return await findOrCreateAuthor(event);
      default:
        return { error: `unknown action: ${action}` };
    }
  } catch (e) {
    return { error: e.message || String(e) };
  }
};
