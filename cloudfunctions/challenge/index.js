/**
 * cloudfunctions/challenge/index.js
 * 打卡云函数：手动打卡、今日状态、当月数据。
 * openid 由云端上下文中获取，不可伪造。
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

function getOpenid(event) {
  return cloud.getWXContext().OPENID;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * 北京时间（UTC+8）的今日日期字符串。
 * 云函数服务器时区不确定，统一用北京时间保证客户端和服务端日期一致。
 */
function todayStr() {
  // 微信云函数服务器时区未知，直接 new Date() 可能是 UTC
  // 转为北京时间：UTC 时间 + 8 小时
  const d = new Date();
  const beijingMs = d.getTime() + 8 * 60 * 60 * 1000;
  const bj = new Date(beijingMs);
  return `${bj.getFullYear()}-${pad2(bj.getMonth() + 1)}-${pad2(bj.getDate())}`;
}

/**
 * 计算连续打卡天数
 */
function calcStreak(dateList, fromDate) {
  const set = new Set(dateList);
  let streak = 0;
  let cursor = new Date(fromDate);
  while (true) {
    const key = `${cursor.getFullYear()}-${pad2(cursor.getMonth() + 1)}-${pad2(cursor.getDate())}`;
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
    const diff = (new Date(sorted[i]) - new Date(sorted[i - 1])) / 86400000;
    if (diff === 1) {
      current++;
      longest = Math.max(longest, current);
    } else {
      current = 1;
    }
  }
  return longest;
}

// ─── Action: checkin ─────────────────────────────────

async function doCheckin(event) {
  const openid = getOpenid(event);
  const today = todayStr();

  // 防重：检查今天是否已打卡
  const existing = await db.collection('checkins')
    .where({ _openid: openid, date: today })
    .limit(1)
    .get();

  if (existing.data && existing.data.length > 0) {
    // 已打卡：仍返回当前状态
    const status = await doGetTodayStatus(event);
    return { ok: true, alreadyCheckedIn: true, checkedIn: status.checkedIn, streak: status.streak };
  }

  const now = Date.now();
  await db.collection('checkins').add({
    data: {
      _openid: openid,
      date: today,
      timestamp: now,
      source: 'manual',
      createdAt: now,
      updatedAt: now
    }
  });

  // 打卡成功后返回今日状态（含 streak）和当月打卡列表，客户端直接用，不查 DB
  const status = await doGetTodayStatus(event);

  // 当月打卡列表：直接查本月数据，不需要传 year/month
  const y = new Date(Date.now() + 8 * 60 * 60 * 1000).getFullYear();
  const m = new Date(Date.now() + 8 * 60 * 60 * 1000).getMonth() + 1;
  const monthStr = `${y}-${pad2(m)}`;
  const lastDay = new Date(y, m, 0).getDate();
  const startDate = `${monthStr}-01`;
  const endDate = `${monthStr}-${pad2(lastDay)}`;
  const monthRes = await db.collection('checkins')
    .where({ _openid: openid, date: _.gte(startDate).and(_.lte(endDate)) })
    .get();
  const monthCheckins = (monthRes.data || []).map(c => c.date);

  console.log('[doCheckin] returning:', JSON.stringify({ streak: status.streak, monthCheckins }));
  return {
    ok: true,
    alreadyCheckedIn: false,
    checkedIn: status.checkedIn,
    streak: status.streak,
    monthCheckins
  };
}

// ─── Action: getTodayStatus ─────────────────────────

async function doGetTodayStatus(event) {
  const openid = getOpenid(event);
  const today = todayStr();

  const res = await db.collection('checkins')
    .where({ _openid: openid })
    .orderBy('date', 'desc')
    .limit(62)
    .get();

  const dateList = (res.data || []).map(c => c.date);
  const checkedIn = dateList.includes(today);
  const streak = calcStreak(dateList, today);

  return { ok: true, checkedIn, streak };
}

// ─── Action: getMonthData ────────────────────────────

async function doGetMonthData(event) {
  const openid = getOpenid(event);
  const { year, month } = event;
  const y = Number(year);
  const m = Number(month);
  if (!y || !m) return { error: 'invalid year or month' };

  const monthStr = `${y}-${pad2(m)}`;
  const lastDay = new Date(y, m, 0).getDate();
  const startDate = `${monthStr}-01`;
  const endDate = `${monthStr}-${pad2(lastDay)}`;
  const monthStart = new Date(y, m - 1, 1).getTime();
  const monthEnd = new Date(y, m, 0, 23, 59, 59, 999).getTime();
  const today = todayStr();

  const [checkinsRes, finishedRes, allRes] = await Promise.all([
    db.collection('checkins')
      .where({ _openid: openid, date: _.gte(startDate).and(_.lte(endDate)) })
      .get(),
    db.collection('books')
      .where({ _openid: openid, status: 'finished', endTime: _.gte(monthStart).and(_.lte(monthEnd)) })
      .count(),
    db.collection('checkins')
      .where({ _openid: openid })
      .orderBy('date', 'desc')
      .limit(365)
      .get()
  ]);

  const allDates = (allRes.data || []).map(c => c.date);
  const thisMonthDates = (checkinsRes.data || []).map(c => c.date);

  return {
    ok: true,
    checkins: thisMonthDates,
    stats: {
      thisMonthDays: thisMonthDates.length,
      totalDays: allDates.length,
      currentStreak: calcStreak(allDates, today),
      longestStreak: calcLongestStreak(allDates),
      finishedThisMonth: finishedRes.total || 0
    }
  };
}

// ─── Action: cancelToday ─────────────────────────────

async function doCancelToday(event) {
  const openid = getOpenid(event);
  const today = todayStr();

  const existing = await db.collection('checkins')
    .where({ _openid: openid, date: today })
    .limit(1)
    .get();

  if (!existing.data || existing.data.length === 0) {
    return { ok: true, cancelled: false };
  }

  const docId = existing.data[0]._id;
  await db.collection('checkins').doc(docId).remove();
  return { ok: true, cancelled: true };
}

// ─── 入口 ────────────────────────────────────────────

exports.main = async (event) => {
  const { action } = event;
  try {
    switch (action) {
      case 'checkin':         return await doCheckin(event);
      case 'cancelToday':     return await doCancelToday(event);
      case 'getTodayStatus': return await doGetTodayStatus(event);
      case 'getMonthData':   return await doGetMonthData(event);
      default:                return { error: `unknown action: ${action}` };
    }
  } catch (e) {
    return { error: e?.message || String(e) };
  }
};
