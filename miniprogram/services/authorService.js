/**
 * authorService.js
 * 作者相关业务逻辑。
 *
 * 约定：
 * - 读操作（searchAuthors）：直接读 DB，openid 过滤由 withOpenIdFilter + 云端安全规则保护
 * - 写操作（findOrCreateAuthor）：走云函数 bookOperations
 */
import { db, withRetry, withOpenIdFilter, callCloudFunctionWithRetry, assertCloudCallResult } from '../utils/db.js';
import { normalizeAuthorName } from '../utils/author.js';

/**
 * 根据输入文字查找作者（前缀匹配 + 模糊包含）
 * @param {string} openid
 * @param {string} query - 原始输入
 * @param {number} limit
 * @returns {Promise<Array>} 匹配到的作者列表
 */
export async function searchAuthors(openid, query, limit = 10) {
  const q = (query || '').trim();
  if (!q) return [];

  const qNorm = normalizeAuthorName(q);
  if (!qNorm) return [];

  const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regPrefix = db.RegExp({ regexp: `^${escapeRegExp(qNorm)}`, options: '' });
  const regContain = db.RegExp({ regexp: escapeRegExp(q), options: 'i' });

  const [byNorm, byName] = await Promise.all([
    db
      .collection('authors')
      .where(withOpenIdFilter({ nameNorm: regPrefix }))
      .limit(limit)
      .get(),
    db
      .collection('authors')
      .where(withOpenIdFilter({ name: regContain }))
      .limit(limit)
      .get()
  ]);

  const merged = [];
  const seen = new Set();
  for (const it of [...(byNorm.data || []), ...(byName.data || [])]) {
    if (!it?._id || seen.has(it._id)) continue;
    seen.add(it._id);
    merged.push(it);
    if (merged.length >= limit) break;
  }
  return merged;
}

/**
 * 根据输入查找或创建作者，返回 { _id, name, nameNorm }
 * @param {string} openid - 用户 openid（用于数据隔离）
 * @param {string} authorInput - 用户输入的作者名
 * @returns {Promise<{ _id: string, name: string, nameNorm: string }>}
 */
export async function findOrCreateAuthor(openid, authorInput) {
  const res = await callCloudFunctionWithRetry('bookOperations', {
    action: 'findOrCreateAuthor', authorInput
  });
  return assertCloudCallResult(res);
}
