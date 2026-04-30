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

async function queryReflectionNotes(bookId) {
  const res = await db.collection('notes').where({ bookId }).limit(500).get();
  return res.data || [];
}

function buildReflectionMaterialFromNotes(notes) {
  const sorted = [...notes].sort((a, b) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0));
  const thoughtAll = sorted
    .filter((n) => n?.type !== 'quote')
    .map((n) => clip(n?.text, 120))
    .filter(Boolean);
  const quoteAll = sorted
    .filter((n) => n?.type === 'quote')
    .map((n) => clip(n?.text, 80))
    .filter(Boolean);

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

  const notes = await queryReflectionNotes(bookId);
  const { thoughts, quotes } = buildReflectionMaterialFromNotes(notes);

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

  // Query notes outside transaction for material stats
  const reflectionNotes = await queryReflectionNotes(bookId);

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
    const material = buildReflectionMaterialFromNotes(reflectionNotes);
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
      updatedAt: startTime,
      status: 'reading',
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
    data: { endTime, durationMin, status: 'finished', updatedAt: endTime }
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
      endTime: _.remove(),
      updatedAt: Date.now()
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

  // Also remove all notes for this book
  try {
    const notesRes = await db.collection('notes').where({ bookId }).field({ _id: true }).get();
    const noteIds = (notesRes.data || []).map((n) => n._id).filter(Boolean);
    if (noteIds.length > 0) {
      // Remove in batches of 50
      while (noteIds.length > 0) {
        const batch = noteIds.splice(0, 50);
        await db.collection('notes').where({ _id: _.in(batch) }).remove();
      }
    }
  } catch (e) {
    // ignore cleanup errors
  }

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

  const timestamp = Date.now();
  const noteId = `${bookId}_${timestamp}`;
  const note = {
    text: String(text).trim(),
    type: type === 'quote' ? 'quote' : 'thought',
    timestamp
  };

  await db.collection('notes').doc(noteId).set({
    data: {
      _openid: openid,
      bookId,
      bookName: (book.data.bookName || '').trim() || '未命名',
      text: note.text,
      type: note.type,
      timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    }
  });

  // Maintain lightweight recent notes index for 首页展示
  await upsertRecentNote({
    openid,
    bookId,
    bookName: book.data.bookName,
    note
  });
  await trimRecentNotes(openid, RECENT_NOTES_KEEP);

  // ── 自动打卡 ─────────────────────────────────
  let autoCheckedIn = false;
  try {
    const now = Date.now();
    const today = `${new Date(now).getFullYear()}-${pad2(new Date(now).getMonth() + 1)}-${pad2(new Date(now).getDate())}`;
    console.log('[autoCheckin] openid:', openid, 'today:', today);
    const existing = await db.collection('checkins')
      .where({ _openid: openid, date: today })
      .limit(1)
      .get();
    console.log('[autoCheckin] existing:', JSON.stringify(existing.data));
    if (!existing.data || existing.data.length === 0) {
      await db.collection('checkins').add({
        data: {
          _openid: openid,
          date: today,
          timestamp: now,
          source: 'auto',
          createdAt: now,
          updatedAt: now
        }
      });
      autoCheckedIn = true;
      console.log('[autoCheckin] 新增打卡成功');
    } else {
      console.log('[autoCheckin] 今日已有打卡记录，跳过');
    }
  } catch (e) {
    console.error('[autoCheckin] 失败:', e.message);
    // 打卡失败不影响笔记保存
  }
  // ── ─────────────────────────────────────────

  return { ok: true, autoCheckedIn };
}

/**
 * 编辑一条笔记的文本
 * event: { bookId, timestamp, text }
 */
async function editNote(event) {
  const openid = getOpenid(event);
  const { bookId, timestamp, text } = event;
  if (!bookId || !timestamp || !text) throw new Error('bookId, timestamp, and text are required');

  const noteId = `${bookId}_${Number(timestamp)}`;
  const existing = await db.collection('notes').doc(noteId).get();
  if (!existing.data || existing.data._openid !== openid) throw new Error('note not found or not owned');

  const newText = String(text).trim();
  await db.collection('notes').doc(noteId).update({
    data: { text: newText, updatedAt: Date.now() }
  });

  // Sync recent notes index
  await upsertRecentNote({
    openid,
    bookId,
    bookName: existing.data.bookName,
    note: { text: newText, type: existing.data.type, timestamp: Number(timestamp) }
  });

  return { ok: true };
}

/**
 * 删除一条笔记
 * event: { bookId, timestamp }
 */
async function deleteNote(event) {
  const openid = getOpenid(event);
  const { bookId, timestamp } = event;
  if (!bookId || !timestamp) throw new Error('bookId and timestamp are required');

  const noteId = `${bookId}_${Number(timestamp)}`;
  const existing = await db.collection('notes').doc(noteId).get();
  if (!existing.data || existing.data._openid !== openid) throw new Error('note not found or not owned');

  await db.collection('notes').doc(noteId).remove();

  // Remove from recent notes index (ignore if missing)
  try {
    await removeRecentNote({ bookId, timestamp });
  } catch (e) {
    // ignore
  }

  return { ok: true };
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

// ─── 客户端错误上报（兜底：写入数据库）───────────────────────────

const CLIENT_ERRORS_COLLECTION = 'client_errors';

function clipTextForLog(s, maxLen) {
  const t = String(s || '').trim();
  if (!t) return '';
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

function safeStringify(obj) {
  try {
    return JSON.stringify(obj);
  } catch (e) {
    return '';
  }
}

async function reportClientError(event) {
  const openid = getOpenid(event);
  const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
  const now = Date.now();

  const error = payload?.error || {};
  const context = payload?.context || {};
  const route = payload?.route || {};
  const device = payload?.device || {};

  const doc = {
    _openid: openid,
    envVersion: clipTextForLog(payload?.envVersion, 32),
    at: Number(payload?.at || now) || now,
    source: clipTextForLog(context?.source, 80),
    message: clipTextForLog(error?.message, 600),
    stack: clipTextForLog(error?.stack, 4000),
    raw: clipTextForLog(error?.raw, 4000),
    route: {
      route: clipTextForLog(route?.route, 200),
      options: clipTextForLog(safeStringify(route?.options || {}), 1200),
    },
    device: {
      brand: clipTextForLog(device?.brand, 40),
      model: clipTextForLog(device?.model, 80),
      system: clipTextForLog(device?.system, 80),
      platform: clipTextForLog(device?.platform, 40),
      version: clipTextForLog(device?.version, 40),
      SDKVersion: clipTextForLog(device?.SDKVersion, 40),
      screenWidth: Number(device?.screenWidth || 0) || 0,
      screenHeight: Number(device?.screenHeight || 0) || 0,
      pixelRatio: Number(device?.pixelRatio || 0) || 0,
      language: clipTextForLog(device?.language, 20),
    },
    extra: clipTextForLog(safeStringify(payload?.extra || {}), 2000),
    createdAt: now,
    updatedAt: now,
  };

  await db.collection(CLIENT_ERRORS_COLLECTION).add({ data: doc });
  return { ok: true };
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
      case 'reportClientError': return await reportClientError(event);
      default:
        return { error: `unknown action: ${action}` };
    }
  } catch (e) {
    return { error: e.message || String(e) };
  }
};
