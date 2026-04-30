import { db, withRetry, withOpenIdFilter } from '../../utils/db.js';
import { getMonthData } from '../../services/checkinService.js';

function pad2(n) {
  return String(n).padStart(2, '0');
}

function getMonthRange(now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth() + 1; // 1-12
  const start = new Date(y, m - 1, 1, 0, 0, 0, 0).getTime();
  const end = new Date(y, m, 0, 23, 59, 59, 999).getTime();
  return { y, m, start, end };
}

function getYearRange(now = new Date()) {
  const y = now.getFullYear();
  const start = new Date(y, 0, 1, 0, 0, 0, 0).getTime();
  const end = new Date(y, 11, 31, 23, 59, 59, 999).getTime();
  return { y, start, end };
}

function monthDateRangeStrings(y, m) {
  const lastDay = new Date(y, m, 0).getDate();
  const startDate = `${y}-${pad2(m)}-01`;
  const endDate = `${y}-${pad2(m)}-${pad2(lastDay)}`;
  return { startDate, endDate };
}

function yearDateRangeStrings(y) {
  return { startDate: `${y}-01-01`, endDate: `${y}-12-31` };
}

function normalizeAuthorName(s) {
  const t = String(s || '').trim();
  return t || '未知作者';
}

function topNCounts(map, n = 3) {
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

async function countNotesByType(tsStart, tsEnd) {
  const [thoughtRes, quoteRes] = await Promise.all([
    withRetry(() =>
      db.collection('notes').where(withOpenIdFilter({ type: 'thought', timestamp: { $gte: tsStart, $lte: tsEnd } })).count()
    ),
    withRetry(() =>
      db.collection('notes').where(withOpenIdFilter({ type: 'quote', timestamp: { $gte: tsStart, $lte: tsEnd } })).count()
    )
  ]);
  return {
    thoughtCount: Number(thoughtRes?.total || 0),
    quoteCount: Number(quoteRes?.total || 0)
  };
}

async function fetchFinishedBooksInRange(tsStart, tsEnd, limit = 200) {
  // 统计用：只取必要字段，避免拉全量
  const res = await withRetry(() =>
    db.collection('books')
      .where(withOpenIdFilter({ status: 'finished', endTime: { $gte: tsStart, $lte: tsEnd } }))
      .orderBy('endTime', 'desc')
      .limit(Math.min(500, Math.max(1, Number(limit || 200))))
      .field({ authorName: true })
      .get()
  );
  return res?.data || [];
}

async function getReadingDaysByRange(y, startDate, endDate) {
  // checkins 里存的是 date 字符串（YYYY-MM-DD）
  const res = await withRetry(() =>
    db.collection('checkins')
      .where(withOpenIdFilter({ date: { $gte: startDate, $lte: endDate } }))
      .field({ date: true })
      .get()
  );
  const dates = (res?.data || []).map((c) => String(c?.date || '').trim()).filter(Boolean);
  return new Set(dates);
}

Page({
  data: {
    isDark: false,
    loading: true,
    mode: 'month',
    monthStats: null,
    yearStats: null,
    monthTopAuthors: [],
    yearTopAuthors: [],
    viewStats: {
      booksFinished: 0,
      thoughtCount: 0,
      quoteCount: 0,
      readingDays: 0,
      currentStreak: 0,
      longestStreak: 0
    },
    viewTopAuthors: []
  },

  onShow() {
    this.setData({ isDark: getApp()?.globalData?.isDark || false });
    this.loadAll();
  },

  onPullDownRefresh() {
    this.loadAll(true).finally(() => wx.stopPullDownRefresh());
  },

  setMode(e) {
    const mode = e?.currentTarget?.dataset?.mode;
    if (mode !== 'month' && mode !== 'year') return;
    if (mode === this.data.mode) return;
    this.setData({ mode });
    this.refreshView();
  },

  refreshView() {
    const mode = this.data.mode;
    const stats = mode === 'year' ? (this.data.yearStats || null) : (this.data.monthStats || null);
    const top = mode === 'year' ? (this.data.yearTopAuthors || []) : (this.data.monthTopAuthors || []);
    this.setData({
      viewStats: stats || {
        booksFinished: 0,
        thoughtCount: 0,
        quoteCount: 0,
        readingDays: 0,
        currentStreak: 0,
        longestStreak: 0
      },
      viewTopAuthors: top
    });
  },

  async loadAll(bypassCache = false) {
    this.setData({ loading: true });
    const now = new Date();
    const { y: my, m, start: monthStart, end: monthEnd } = getMonthRange(now);
    const { y: yy, start: yearStart, end: yearEnd } = getYearRange(now);

    try {
      // 月：直接复用现有 checkinService（包含 streak/读完本数）
      const monthCheckin = await getMonthData(my, m);
      const monthReadingDaysSet = new Set(monthCheckin?.checkins || []);
      const monthNotes = await countNotesByType(monthStart, monthEnd);
      const monthBooks = await fetchFinishedBooksInRange(monthStart, monthEnd, 500);
      const monthAuthorMap = new Map();
      for (const b of monthBooks) {
        const name = normalizeAuthorName(b?.authorName);
        monthAuthorMap.set(name, (monthAuthorMap.get(name) || 0) + 1);
      }

      const monthStats = {
        booksFinished: Number(monthCheckin?.stats?.finishedThisMonth || 0),
        thoughtCount: monthNotes.thoughtCount,
        quoteCount: monthNotes.quoteCount,
        readingDays: monthReadingDaysSet.size,
        currentStreak: Number(monthCheckin?.stats?.currentStreak || 0),
        longestStreak: Number(monthCheckin?.stats?.longestStreak || 0)
      };

      // 年：自己算年度范围
      const yearNotes = await countNotesByType(yearStart, yearEnd);
      const yearFinishedCountRes = await withRetry(() =>
        db.collection('books').where(withOpenIdFilter({ status: 'finished', endTime: { $gte: yearStart, $lte: yearEnd } })).count()
      );
      const { startDate: yStartDate, endDate: yEndDate } = yearDateRangeStrings(yy);
      const yearDaysSet = await getReadingDaysByRange(yy, yStartDate, yEndDate);

      // streak：沿用“最近 365 天”逻辑（与 checkinService 一致），这里不重复实现，直接读 checkins 再算
      const allCheckinsRes = await withRetry(() =>
        db.collection('checkins')
          .where(withOpenIdFilter({}))
          .orderBy('date', 'desc')
          .limit(365)
          .get()
      );
      const allDates = (allCheckinsRes?.data || []).map((c) => c.date);
      // 复用 checkinService 的 streak 逻辑不方便直接 import 内部函数，这里实现一个等价版本
      const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
      const setAll = new Set(allDates);
      let currentStreak = 0;
      let cursor = new Date(today);
      while (true) {
        const key = `${cursor.getFullYear()}-${pad2(cursor.getMonth() + 1)}-${pad2(cursor.getDate())}`;
        if (setAll.has(key)) {
          currentStreak += 1;
          cursor.setDate(cursor.getDate() - 1);
        } else break;
      }
      let longestStreak = 0;
      if (allDates.length > 0) {
        const sorted = [...new Set(allDates)].sort();
        let longest = 1;
        let cur = 1;
        for (let i = 1; i < sorted.length; i++) {
          const prev = new Date(sorted[i - 1]);
          const curr = new Date(sorted[i]);
          const diff = (curr - prev) / 86400000;
          if (diff === 1) {
            cur++;
            longest = Math.max(longest, cur);
          } else {
            cur = 1;
          }
        }
        longestStreak = longest;
      }

      const yearBooks = await fetchFinishedBooksInRange(yearStart, yearEnd, 500);
      const yearAuthorMap = new Map();
      for (const b of yearBooks) {
        const name = normalizeAuthorName(b?.authorName);
        yearAuthorMap.set(name, (yearAuthorMap.get(name) || 0) + 1);
      }

      const yearStats = {
        booksFinished: Number(yearFinishedCountRes?.total || 0),
        thoughtCount: yearNotes.thoughtCount,
        quoteCount: yearNotes.quoteCount,
        readingDays: yearDaysSet.size,
        currentStreak,
        longestStreak
      };

      this.setData({
        monthStats,
        yearStats,
        monthTopAuthors: topNCounts(monthAuthorMap, 3),
        yearTopAuthors: topNCounts(yearAuthorMap, 3),
        loading: false
      });
      this.refreshView();
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: '统计加载失败', icon: 'none' });
    }
  }
});

