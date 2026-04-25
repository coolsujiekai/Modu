/**
 * checkinService.js
 * 打卡数据服务层：今日状态、手动打卡、当月数据 + 缓存策略。
 *
 * 约定：
 * - 读操作（getTodayStatus / getMonthData）：直接读 DB，云端安全规则保护
 * - 写操作（manualCheckin）：走云函数 challenge（openid 云端校验）
 */
import { db, withRetry, withOpenIdFilter } from '../utils/db.js';
import { cacheGet, cacheSet, cacheRemove, cacheRemovePrefix } from '../utils/cache.js';

// ─── 缓存键 ───────────────────────────────────────────

const CACHE_KEY_TODAY = '_checkin_today_v1';
const CACHE_KEY_MONTH_TPL = (y, m) => `_checkin_${y}_${m}_v1`;
const CACHE_TTL_TODAY = 5 * 60 * 1000;   // 5 分钟
const CACHE_TTL_MONTH = 10 * 60 * 1000; // 10 分钟

// ─── 日期工具 ─────────────────────────────────────────

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function yearMonthStr(y, m) {
  return `${y}-${String(m).padStart(2, '0')}`;
}

/**
 * 计算连续打卡天数
 * @param {string[]} dateList - 已打卡日期数组 ["2026-04-25", ...]
 * @param {string} fromDate - 起始日期（通常为今天）
 */
function calcStreak(dateList, fromDate) {
  const set = new Set(dateList);
  let streak = 0;
  let cursor = new Date(fromDate);
  while (true) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    const day = String(cursor.getDate()).padStart(2, '0');
    const key = `${y}-${m}-${day}`;
    if (set.has(key)) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

/**
 * 计算最长连续天数
 */
function calcLongestStreak(dateList) {
  if (!dateList.length) return 0;
  const sorted = [...new Set(dateList)].sort();
  let longest = 1;
  let current = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]);
    const curr = new Date(sorted[i]);
    const diff = (curr - prev) / 86400000;
    if (diff === 1) {
      current++;
      longest = Math.max(longest, current);
    } else {
      current = 1;
    }
  }
  return longest;
}

// ─── API ─────────────────────────────────────────────

/**
 * 获取今日打卡状态 + 连续天数
 * @param {boolean} [bypassCache=false] - 是否跳过缓存强制拉新数据
 * @returns {Promise<{ checkedIn: boolean, streak: number }>}
 */
export async function getTodayStatus(bypassCache = false) {
  if (!bypassCache) {
    const cached = cacheGet(CACHE_KEY_TODAY);
    if (cached) return cached;
  }

  try {
    const today = todayStr();
    const openid = getApp()?.globalData?.openid || '';

    // 查询最近 62 天（足够算连续天数）
    const res = await withRetry(() =>
      db.collection('checkins')
        .where(withOpenIdFilter({}))
        .orderBy('date', 'desc')
        .limit(62)
        .get()
    );

    const dateList = (res.data || []).map(c => c.date);
    const checkedIn = dateList.includes(today);
    const streak = calcStreak(dateList, today);

    const result = { checkedIn, streak };
    cacheSet(CACHE_KEY_TODAY, result, CACHE_TTL_TODAY);
    return result;
  } catch (e) {
    return { checkedIn: false, streak: 0 };
  }
}

/**
 * 手动打卡（走云函数，防止并发重复）
 * @returns {Promise<{ ok: boolean, alreadyCheckedIn: boolean }>}
 */
export async function manualCheckin() {
  const res = await wx.cloud.callFunction({
    name: 'challenge',
    data: { action: 'checkin' }
  });
  const errMsg = String(res?.errMsg || '');
  if (errMsg && !errMsg.toLowerCase().includes(':ok')) {
    throw new Error(errMsg);
  }
  const result = res?.result || {};
  if (result.error) throw new Error(result.error);

  // 打卡成功，使缓存失效
  if (result.ok) {
    invalidateAllCaches();
  }
  return result;
}

/**
 * 取消今日打卡（走云函数）
 */
export async function cancelTodayCheckin() {
  const res = await wx.cloud.callFunction({
    name: 'challenge',
    data: { action: 'cancelToday' }
  });
  const errMsg = String(res?.errMsg || '');
  if (errMsg && !errMsg.toLowerCase().includes(':ok')) {
    throw new Error(errMsg);
  }
  const result = res?.result || {};
  if (result.error) throw new Error(result.error);
  invalidateAllCaches();
  return result;
}

/**
 * 获取当月打卡数据 + 统计
 * @param {number} year
 * @param {number} month  1-12
 * @returns {Promise<{ checkins: Array, stats: object }>}
 */
export async function getMonthData(year, month) {
  const cacheKey = CACHE_KEY_MONTH_TPL(year, month);
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const monthStr = yearMonthStr(year, month);
  const lastDay = new Date(year, month, 0).getDate();
  const startDate = `${monthStr}-01`;
  const endDate = `${monthStr}-${String(lastDay).padStart(2, '0')}`;
  const monthStart = new Date(year, month - 1, 1).getTime();
  const monthEnd = new Date(year, month, 0, 23, 59, 59, 999).getTime();
  const today = todayStr();

  try {
    // 并行查询：打卡记录 + 当月已读书数量
    const [checkinsRes, finishedRes] = await Promise.all([
      withRetry(() =>
        db.collection('checkins')
          .where(withOpenIdFilter({ date: { $gte: startDate, $lte: endDate } }))
          .get()
      ),
      withRetry(() =>
        db.collection('books')
          .where(withOpenIdFilter({ status: 'finished', endTime: { $gte: monthStart, $lte: monthEnd } }))
          .count()
      )
    ]);

    // 查询所有历史打卡（计算连续天数）
    const allRes = await withRetry(() =>
      db.collection('checkins')
        .where(withOpenIdFilter({}))
        .orderBy('date', 'desc')
        .limit(365)
        .get()
    );

    const allDates = (allRes.data || []).map(c => c.date);
    const thisMonthDates = (checkinsRes.data || []).map(c => c.date);

    const currentStreak = calcStreak(allDates, today);
    const longestStreak = calcLongestStreak(allDates);

    const result = {
      checkins: thisMonthDates,
      stats: {
        thisMonthDays: thisMonthDates.length,
        totalDays: allDates.length,
        currentStreak,
        longestStreak,
        finishedThisMonth: finishedRes.total || 0
      }
    };

    cacheSet(cacheKey, result, CACHE_TTL_MONTH);
    return result;
  } catch (e) {
    return {
      checkins: [],
      stats: { thisMonthDays: 0, totalDays: 0, currentStreak: 0, longestStreak: 0, finishedThisMonth: 0 }
    };
  }
}

/**
 * 获取今天的阅读笔记（当天所有笔记）
 * @returns {Promise<Array>}
 */
export async function getTodayNotes() {
  const today = todayStr();
  const dayStart = new Date(today);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const tsStart = dayStart.getTime();
  const tsEnd = dayEnd.getTime() - 1;

  try {
    const res = await withRetry(() =>
      db.collection('notes')
        .where(withOpenIdFilter({ timestamp: { $gte: tsStart, $lte: tsEnd } }))
        .orderBy('timestamp', 'desc')
        .limit(20)
        .get()
    );
    return res.data || [];
  } catch (e) {
    return [];
  }
}

// ─── 缓存失效 ─────────────────────────────────────────

export function invalidateAllCaches() {
  cacheRemove(CACHE_KEY_TODAY);
  cacheRemovePrefix('_checkin_');
}
