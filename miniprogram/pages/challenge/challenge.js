import {
  getActiveChallenge,
  getEndedChallenge,
  getMyStatus,
  joinChallenge,
  submitCheckin,
  markCompleted,
  getRankings
} from '../../services/challengeService.js';
import { db } from '../../utils/db.js';
import { logger } from '../../utils/logger.js';

Page({
  data: {
    challenge: null,       // 当前活动
    joined: false,         // 是否已报名
    checkins: [],          // 我的打卡记录
    checkinDays: 0,
    checkinBooks: [],
    completed: false,
    activeTab: 'participate',
    rankings: [],
    loading: true,
    joining: false,
    submitting: false,
    markingDone: false,

    // 录入表单
    readingBooks: [],
    bookIndex: -1,
    selectedBookName: '',
    customBookName: '',
    checkinContent: '',
    canSubmit: false,  // computed

    // 日历
    weekdays: ['日', '一', '二', '三', '四', '五', '六'],
    calYear: 0,
    calMonth: 0,
    calDays: [],
  },

  async onLoad() {
    await this.loadData();
  },

  async onShow() {
    if (this.data.challenge) {
      await this.loadMyStatus();
    }
  },

  async loadData() {
    wx.showLoading({ title: '加载中', mask: true });
    try {
      // 优先加载进行中的活动
      let res = await getActiveChallenge();
      const challenge = res?.challenge || null;

      // 如果没有进行中的活动，尝试加载已结束的（显示排行榜入口）
      if (!challenge) {
        res = await getEndedChallenge();
      }

      this.setData({ challenge: res?.challenge || null, loading: false });

      if (this.data.challenge) {
        await this.loadMyStatus();
        await this.loadReadingBooks();
      }
    } catch (e) {
      this.setData({ loading: false });
    } finally {
      wx.hideLoading();
    }
  },

  async loadMyStatus() {
    const challenge = this.data.challenge;
    if (!challenge) return;

    try {
      const res = await getMyStatus(challenge._id);
      const joined = !!res?.participant;
      const checkins = res?.checkins || [];
      const checkinBooks = joined ? (res?.participant?.books || []) : [];
      const completed = !!res?.participant?.completed;

      this.setData({
        joined,
        checkins,
        checkinDays: joined ? (res?.participant?.checkinDays || 0) : 0,
        checkinBooks,
        completed,
      });

      if (joined) {
        this.buildCalendar();
      }
    } catch (e) {
      // ignore
    }
  },

  async loadReadingBooks() {
    try {
      let openid = getApp()?.globalData?.openid || '';

      // openid 未就绪时，短暂等待一次（避免冷启动时偶发空）
      if (!openid) {
        logger.warn('[challenge] openid not ready, retrying...');
        await new Promise((r) => setTimeout(r, 1000));
        openid = getApp()?.globalData?.openid || '';
      }

      if (!openid) {
        logger.warn('[challenge] openid still not ready after retry, skipping book load');
        return;
      }

      const res = await db.collection('books')
        .where({ _openid: openid, status: 'reading' })
        .field({ bookName: true })
        .get();
      
      logger.debug('[challenge] loadReadingBooks count:', (res.data || []).length);
      this.setData({ readingBooks: res.data || [] });
    } catch (e) {
      logger.error('[challenge] loadReadingBooks error:', e);
      this.setData({ readingBooks: [] });
    }
  },

  buildCalendar() {
    const challenge = this.data.challenge;
    if (!challenge) return;

    const start = new Date(challenge.startDate);
    const end = new Date(Math.min(challenge.endDate, Date.now()));
    const today = new Date();

    // 以自然月为基准显示日历
    const calYear = start.getFullYear();
    const calMonth = start.getMonth();

    const firstDay = new Date(calYear, calMonth, 1);
    const lastDay = new Date(calYear, calMonth + 1, 0);
    const startWeekday = firstDay.getDay();

    logger.debug('[challenge] buildCalendar:', { calYear, calMonth, checkinCount: this.data.checkins.length });

    // 收集打卡日期
    const checkinMap = {};
    for (const c of this.data.checkins) {
      const d = new Date(c.checkedAt);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      checkinMap[key] = true;
    }

    const days = [];

    // 空白填充
    for (let i = 0; i < startWeekday; i++) {
      days.push({ day: '', inRange: false, hasCheckin: false });
    }

    // 当月天数
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const date = new Date(calYear, calMonth, d);
      const dateEnd = new Date(calYear, calMonth, d, 23, 59, 59);
      const inRange = date >= start && date <= end && date <= today;
      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      const hasCheckin = !!checkinMap[key];
      days.push({ day: d, inRange, hasCheckin });
    }

    this.setData({ calYear, calMonth, calDays: days });
  },

  formatDate(ts) {
    const n = Number(ts || 0);
    if (!n) return '-';
    const d = new Date(n);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  switchTab(e) {
    const tab = e?.currentTarget?.dataset?.tab;
    if (!tab) return;
    this.setData({ activeTab: tab });
    if (tab === 'rank') {
      this.loadRankings();
    }
  },

  async join() {
    const challenge = this.data.challenge;
    if (!challenge) return;
    if (this.data.joining) return;

    this.setData({ joining: true });
    try {
      await joinChallenge(challenge._id);
      wx.showToast({ title: '报名成功', icon: 'success' });
      await this.loadMyStatus();
    } catch (e) {
      wx.showToast({ title: e?.message || '报名失败', icon: 'none' });
    } finally {
      this.setData({ joining: false });
    }
  },

  onBookChange(e) {
    const idx = Number(e?.detail?.value || -1);
    const books = this.data.readingBooks;
    const book = books[idx];
    this.setData({
      bookIndex: idx,
      selectedBookName: book?.bookName || '',
      customBookName: '',
    });
    this.updateCanSubmit();
  },

  onCustomBookInput(e) {
    this.setData({
      customBookName: e?.detail?.value || '',
      selectedBookName: '',
      bookIndex: -1,
    });
    this.updateCanSubmit();
  },

  onContentInput(e) {
    const val = e?.detail?.value || '';
    this.setData({ checkinContent: val });
    this.updateCanSubmit();
  },

  updateCanSubmit() {
    const { selectedBookName, customBookName, checkinContent } = this.data;
    const hasBook = selectedBookName || customBookName.trim();
    const hasContent = checkinContent.trim();
    const canSubmit = !!(hasBook && hasContent);
    logger.debug('[challenge] updateCanSubmit:', { canSubmit });
    this.setData({ canSubmit });
  },

  async submitCheckin() {
    const challenge = this.data.challenge;
    if (!challenge) return;
    if (this.data.submitting) return;

    const { selectedBookName, customBookName, checkinContent } = this.data;

    const bookName = selectedBookName || customBookName.trim();
    const content = checkinContent.trim();

    if (!bookName || !content) {
      wx.showToast({ title: '请填写书名和内容', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    try {
      await submitCheckin(challenge._id, bookName, content);
      wx.showToast({ title: '打卡成功', icon: 'success' });
      this.setData({ checkinContent: '', selectedBookName: '', customBookName: '', bookIndex: -1 });
      await this.loadMyStatus();
      await this.loadReadingBooks();
    } catch (e) {
      logger.error('[challenge] submitCheckin error:', e);
      wx.showToast({ title: e?.message || '提交失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  async markDone() {
    const challenge = this.data.challenge;
    if (!challenge || this.data.completed) return;

    const confirm = await wx.showModal({
      title: '确认完成？',
      content: '标记为已读完挑战书籍',
      confirmText: '确认',
      confirmColor: '#07C160'
    });
    if (!confirm.confirm) return;

    this.setData({ markingDone: true });
    try {
      await markCompleted(challenge._id);
      this.setData({ completed: true });
      wx.showToast({ title: '已标记完成', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: '操作失败', icon: 'none' });
    } finally {
      this.setData({ markingDone: false });
    }
  },

  async loadRankings() {
    const challenge = this.data.challenge;
    if (!challenge) return;

    // 如果活动已结束，从 rankings 获取；否则显示提示
    if (challenge.status !== 'ended') return;

    try {
      const res = await getRankings(challenge._id);
      const participants = (res?.participants || []).map((p, i) => ({
        ...p,
        rank: i + 1,
      }));
      this.setData({ rankings: participants });
    } catch (e) {
      this.setData({ rankings: [] });
    }
  },
});
