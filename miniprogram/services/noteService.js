/**
 * noteService.js
 * 笔记相关业务逻辑，集中管理所有笔记操作。
 *
 * 约定：
 * - 读操作（notes 直接在 book.js / bookNotes.js 里已读取，不在此层）
 * - 写操作（addNote / editNote / deleteNote / recalcNoteCounts）：走云函数 bookOperations
 */
import { db, withRetry, callCloudFunctionWithRetry, assertCloudCallResult } from '../utils/db.js';
import { formatDate } from '../utils/util.js';

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
 * @returns {Promise<{ ok: boolean }>}
 */
export async function addNote(bookId, noteData) {
  const { text, type, bookName } = noteData || {};
  if (!text || !bookId) throw new Error('text and bookId are required');

  const res = await callCloudFunctionWithRetry('bookOperations', {
    action: 'addNote', bookId, text, type
  });
  const result = assertCloudCallResult(res);

  // 自动打卡提示（仅当天首次记笔记时提示）
  if (result?.autoCheckedIn) {
    try {
      wx.showToast({ title: '📖 已自动打卡', icon: 'none', duration: 1500 });
    } catch (e) {}
  }

  return result;
}

/**
 * 编辑指定书籍中某条笔记的文本（写操作，走云函数）
 * @param {string} bookId
 * @param {number} timestamp - 笔记时间戳（唯一标识）
 * @param {string} newText
 * @returns {Promise<{ ok: boolean }>}
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
 * @returns {Promise<{ ok: boolean }>}
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

