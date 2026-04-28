/**
 * cache.js
 * 本地 Storage 缓存层，支持 TTL 和主动 invalidate。
 */

import { isOnline } from './network.js';

/**
 * 从 Storage 获取缓存，自动检查 TTL。
 * 离线时忽略 TTL，返回过期数据作为兜底。
 * @param {string} key
 * @returns {*} 缓存数据或 null
 */
export function cacheGet(key) {
  try {
    const raw = wx.getStorageSync(key);
    if (!raw) return null;
    if (raw && typeof raw === 'object' && '_cachedAt' in raw) {
      const elapsed = Date.now() - Number(raw._cachedAt || 0);
      if (raw.ttl > 0 && elapsed > raw.ttl) {
        if (isOnline()) {
          wx.removeStorageSync(key);
          return null;
        }
        return raw.data;
      }
      return raw.data;
    }
    return raw;
  } catch (e) {
    return null;
  }
}

/**
 * 无条件读取缓存，忽略 TTL（离线兜底专用）。
 * @param {string} key
 * @returns {*} 缓存数据或 null
 */
export function cacheGetIgnoreTTL(key) {
  try {
    const raw = wx.getStorageSync(key);
    if (!raw) return null;
    if (raw && typeof raw === 'object' && '_cachedAt' in raw) {
      return raw.data;
    }
    return raw;
  } catch (e) {
    return null;
  }
}

/**
 * 写入 Storage 缓存。
 * @param {string} key
 * @param {*} data - 需可 JSON 序列化
 * @param {number} [ttlMs=0] - 有效期（ms），0 表示永不过期
 */
export function cacheSet(key, data, ttlMs = 0) {
  try {
    wx.setStorageSync(key, {
      _cachedAt: Date.now(),
      ttl: Number(ttlMs || 0),
      data
    });
  } catch (e) {}
}

/**
 * 删除指定缓存。
 * @param {string} key
 */
export function cacheRemove(key) {
  try {
    wx.removeStorageSync(key);
  } catch (e) {}
}

/**
 * 批量删除符合前缀的缓存。
 * @param {string} prefix
 */
export function cacheRemovePrefix(prefix) {
  try {
    const info = wx.getStorageInfoSync();
    const keys = info.keys || [];
    for (const k of keys) {
      if (k.startsWith(prefix)) {
        wx.removeStorageSync(k);
      }
    }
  } catch (e) {}
}

// ─── 预定义缓存键 ───────────────────────────────────────────

export const CacheKeys = {
  READING_BOOKS: 'cache_reading_books',
  FINISHED_BOOKS: 'cache_finished_books',
  RECENT_NOTES: 'cache_recent_notes'
};

// ─── 预定义 TTL ────────────────────────────────────────────

export const CacheTTL = {
  READING_BOOKS: 5 * 60 * 1000,    // 5 分钟
  FINISHED_BOOKS: 5 * 60 * 1000,   // 5 分钟
  RECENT_NOTES: 2 * 60 * 1000      // 2 分钟
};
