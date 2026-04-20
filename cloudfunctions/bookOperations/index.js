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
  return { thoughtCount, quoteCount, notesCount: notes.length };
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
      case 'recognizeText':    return await recognizeText(event);
      case 'findOrCreateAuthor': return await findOrCreateAuthor(event);
      default:
        return { error: `unknown action: ${action}` };
    }
  } catch (e) {
    return { error: e.message || String(e) };
  }
};
