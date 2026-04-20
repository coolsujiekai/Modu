/**
 * bookService.js
 * 书籍相关业务逻辑，集中管理所有书籍操作。
 *
 * 约定：
 * - 读操作（loadBook / listXxx）：直接读 DB，openid 过滤由 withOpenIdFilter + 云端安全规则双重保护
 * - 写操作（createBook / finishBook / unfinishBook / deleteBook / updateBookInfo）：走云函数 bookOperations
 */
import { db, _, withRetry, withOpenIdFilter, callCloudFunctionWithRetry } from '../utils/db.js';

function assertCloudCallResult(res) {
  const errMsg = String(res?.errMsg || '');
  if (errMsg && !errMsg.toLowerCase().includes(':ok')) {
    throw new Error(errMsg);
  }
  if (res?.result?.error) throw new Error(res.result.error);
  return res?.result;
}

/**
 * 加载单本书籍（读操作，直接 DB）
 * @param {string} bookId
 * @returns {Promise<object|null>}
 */
export async function loadBook(bookId) {
  if (!bookId) return null;
  const res = await withRetry(() => db.collection('books').doc(bookId).get());
  return res.data || null;
}

/**
 * 创建一本书（写操作，走云函数）
 * @param {{ bookName: string, authorId: string, authorName: string, authorNameNorm: string }}
 * @returns {Promise<string>} 新书文档 _id
 */
export async function createBook(bookData) {
  const { bookName, authorId, authorName, authorNameNorm } = bookData;
  const res = await callCloudFunctionWithRetry('bookOperations', {
    action: 'addBook', bookName, authorId, authorName, authorNameNorm
  });
  const result = assertCloudCallResult(res);
  return result?._id;
}

/**
 * 标记书籍为已读完（写操作，走云函数）
 * @param {string} bookId
 * @param {number} startTime
 * @returns {Promise<{ endTime: number, durationMin: number }>}
 */
export async function finishBook(bookId, startTime) {
  const res = await callCloudFunctionWithRetry('bookOperations', {
    action: 'finishBook', bookId, startTime
  });
  return assertCloudCallResult(res);
}

/**
 * 将书籍恢复为"在读"状态（写操作，走云函数）
 * @param {string} bookId
 */
export async function unfinishBook(bookId) {
  const res = await callCloudFunctionWithRetry('bookOperations', {
    action: 'unfinishBook', bookId
  });
  return assertCloudCallResult(res);
}

/**
 * 删除一本书（写操作，走云函数）
 * @param {string} bookId
 */
export async function deleteBook(bookId) {
  const res = await callCloudFunctionWithRetry('bookOperations', {
    action: 'removeBook', bookId
  });
  return assertCloudCallResult(res);
}

/**
 * 更新书籍基本信息（写操作，走云函数）
 * @param {string} bookId
 * @param {{ bookName?: string, authorId?: string, authorName?: string, authorNameNorm?: string }} info
 */
export async function updateBookInfo(bookId, info) {
  const res = await callCloudFunctionWithRetry('bookOperations', {
    action: 'updateBookInfo', bookId, ...info
  });
  return assertCloudCallResult(res);
}

/**
 * 获取"在读"书籍列表（读操作，直接 DB）
 * @param {string} openid
 * @param {number} limit
 */
export async function listReadingBooks(openid, limit = 50) {
  return withRetry(() =>
    db
      .collection('books')
      .where(withOpenIdFilter({ status: 'reading' }))
      .orderBy('startTime', 'desc')
      .limit(limit)
      .field({ notes: false })
      .get()
  );
}

/**
 * 获取"已读"书籍列表（读操作，直接 DB）
 * @param {string} openid
 * @param {number} limit
 */
export async function listFinishedBooks(openid, limit = 50) {
  return withRetry(() =>
    db
      .collection('books')
      .where(withOpenIdFilter({ status: 'finished' }))
      .orderBy('endTime', 'desc')
      .limit(limit)
      .field({ notes: false })
      .get()
  );
}

/**
 * 获取某作者的所有书籍（读操作，直接 DB）
 * @param {string} authorId
 */
export async function listBooksByAuthor(authorId) {
  return withRetry(() =>
    db
      .collection('books')
      .where(withOpenIdFilter({ authorId }))
      .orderBy('startTime', 'desc')
      .get()
  );
}
