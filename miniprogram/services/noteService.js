/**
 * noteService.js
 * 笔记相关业务逻辑，集中管理所有笔记操作。
 *
 * 约定：
 * - 读操作（notes 直接在 book.js / bookNotes.js 里已读取，不在此层）
 * - 写操作（addNote / editNote / deleteNote / recalcNoteCounts）：走云函数 bookOperations
 */
import { db, withRetry, callCloudFunctionWithRetry } from '../utils/db.js';
import { formatDate } from '../utils/util.js';

function assertCloudCallResult(res) {
  const errMsg = String(res?.errMsg || '');
  if (errMsg && !errMsg.toLowerCase().includes(':ok')) {
    throw new Error(errMsg);
  }
  if (res?.result?.error) throw new Error(res.result.error);
  return res?.result;
}

/**
 * 格式化笔记时间（支持相对/绝对/两者混合模式）
 * @param {number} timestamp - 毫秒时间戳
 * @param {string} noteTimeMode - 'relative' | 'absolute' | 'both'
 */
export function formatNoteTime(timestamp, noteTimeMode = 'both') {
  const ts = Number(timestamp || 0);
  if (!ts) return '';
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60 * 1000) {
    const relative = '刚刚';
    return noteTimeMode === 'relative' ? relative
      : noteTimeMode === 'absolute' ? formatDate(ts)
      : `${relative} · ${formatDate(ts)}`;
  }
  if (diff < 60 * 60 * 1000) {
    const relative = `${Math.floor(diff / 60000)}分钟前`;
    return noteTimeMode === 'relative' ? relative
      : noteTimeMode === 'absolute' ? formatDate(ts)
      : `${relative} · ${formatDate(ts)}`;
  }
  if (diff < 24 * 60 * 60 * 1000) {
    const relative = `${Math.floor(diff / 3600000)}小时前`;
    return noteTimeMode === 'relative' ? relative
      : noteTimeMode === 'absolute' ? formatDate(ts)
      : `${relative} · ${formatDate(ts)}`;
  }
  return formatDate(ts);
}

/**
 * 向指定书籍追加一条笔记（写操作，走云函数）
 * @param {string} bookId
 * @param {{ text: string, type: 'thought'|'quote', bookName?: string }} noteData
 * @returns {Promise<{ thoughtCount: number, quoteCount: number, notesCount: number }>}
 */
export async function addNote(bookId, noteData) {
  const { text, type, bookName } = noteData || {};
  if (!text || !bookId) throw new Error('text and bookId are required');

  const res = await callCloudFunctionWithRetry('bookOperations', {
    action: 'addNote', bookId, text, type
  });
  const result = assertCloudCallResult(res);

  // Best-effort: also write a global "notes" record for 首页「全局最近」。
  // 不影响主流程（写失败也不阻塞保存）
  try {
    await withRetry(() =>
      db.collection('notes').add({
        data: {
          bookId,
          bookName: (bookName || '').trim(),
          text: String(text),
          type: type === 'thought' ? 'thought' : 'quote',
          timestamp: Date.now()
        }
      })
    );
  } catch (e) {
    // ignore
  }

  return result;
}

/**
 * 编辑指定书籍中某条笔记的文本（写操作，走云函数）
 * @param {string} bookId
 * @param {number} timestamp - 笔记时间戳（唯一标识）
 * @param {string} newText
 * @returns {Promise<{ thoughtCount: number, quoteCount: number, notesCount: number }>}
 */
export async function editNote(bookId, timestamp, newText) {
  const res = await callCloudFunctionWithRetry('bookOperations', {
    action: 'editNote', bookId, timestamp, text: newText
  });
  return assertCloudCallResult(res);
}

/**
 * 删除指定书籍中某条笔记（写操作，走云函数）
 * @param {string} bookId
 * @param {number} timestamp - 笔记时间戳（唯一标识）
 * @returns {Promise<{ thoughtCount: number, quoteCount: number, notesCount: number }>}
 */
export async function deleteNote(bookId, timestamp) {
  const res = await callCloudFunctionWithRetry('bookOperations', {
    action: 'deleteNote', bookId, timestamp
  });
  return assertCloudCallResult(res);
}

/**
 * OCR：从云存储 fileID 识别印刷体文字（走云函数）
 * @param {string} fileID
 * @returns {Promise<{ text: string }>}
 */
export async function recognizePrintedText(fileID) {
  if (!fileID) throw new Error('fileID is required');
  const res = await callCloudFunctionWithRetry('bookOperations', {
    action: 'recognizeText',
    fileID
  }, { retries: 1, baseDelayMs: 600 });
  return assertCloudCallResult(res);
}

/**
 * 重新计算并同步书籍的笔记计数（写操作，走云函数）
 * @param {string} bookId
 */
export async function recalcNoteCounts(bookId) {
  const bookRes = await withRetry(() => db.collection('books').doc(bookId).get());
  const book = bookRes.data;
  if (!book) return null;
  const notes = Array.isArray(book.notes) ? book.notes : [];
  const thoughtCount = notes.filter(n => n.type === 'thought').length;
  const quoteCount = notes.filter(n => n.type === 'quote').length;
  if (notes.length > 0 && (book.thoughtCount !== thoughtCount || book.quoteCount !== quoteCount)) {
    await db.collection('books').doc(bookId).update({
      data: { thoughtCount, quoteCount }
    });
  }
  return { thoughtCount, quoteCount, notesCount: notes.length };
}
