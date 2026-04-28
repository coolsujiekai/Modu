/**
 * 离线数据兜底包装器。
 * 在线时正常查询并缓存；离线时返回过期缓存。
 */

import { isOnline } from './network.js';
import { cacheSet, cacheGet, cacheGetIgnoreTTL } from './cache.js';

/**
 * 包装一个 DB 读取函数，自动处理离线兜底。
 *
 * @param {string} cacheKey   - Storage 缓存键
 * @param {number} ttlMs      - 缓存有效期（毫秒）
 * @param {Function} fetchFn  - 在线时的查询函数，返回 Promise<data>
 * @returns {Promise<{ data: *, offline: boolean }>}
 */
export async function withOfflineFallback(cacheKey, ttlMs, fetchFn) {
  // 在线：正常查询
  if (isOnline()) {
    try {
      const data = await fetchFn();
      if (data != null) {
        cacheSet(cacheKey, data, ttlMs);
      }
      return { data, offline: false };
    } catch (e) {
      // 在线但网络失败 → 尝试缓存兜底
      const stale = cacheGetIgnoreTTL(cacheKey);
      if (stale != null) {
        return { data: stale, offline: true };
      }
      throw e;
    }
  }

  // 离线：优先返回有效缓存，其次过期缓存
  const fresh = cacheGet(cacheKey);
  if (fresh != null) return { data: fresh, offline: false };

  const stale = cacheGetIgnoreTTL(cacheKey);
  if (stale != null) return { data: stale, offline: true };

  return { data: null, offline: true };
}
