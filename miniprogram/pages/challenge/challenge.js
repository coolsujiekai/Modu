import {
  getActiveChallenge,
  getMyChallengeStatus,
  selectBook,
  createBookAndCheckin,
  checkinToday
} from '../../services/challengeService.js';
import { db } from '../../utils/db.js';
import { logger } from '../../utils/logger.js';

Page({
  data: {
    loading: true,
    operating: false,

    challenge: null,         // 当前活动
    participant: null,       // 参与记录（自动创建）
    todayChecked: false,
    checkinDays: 0,

    selectedBook: null,      // { _id, bookName, status? }
    readingBooks: [],
    checkins: [],            // 最近打卡

    // 日历
    weekdays: ['日', '一', '二', '三', '四', '五', '六'],
    calYear: 0,
    calMonth: 0,
    calDays: [],
  },

  async onLoad() {
    await this.loadPage();
  },

  async onShow() {
    // keep it simple: refresh status when returning
    if (this.data.challenge) await this.refreshStatus();
  },

  async loadPage() {
    wx.showLoading({ title: '加载中', mask: true });
    try {
      const res = await getActiveChallenge();
      const challenge = res?.challenge || null;
      this.setData({ challenge, loading: false });
      if (!challenge) return;

      await Promise.all([this.refreshStatus(), this.loadReadingBooks()]);
    } catch (e) {
      this.setData({ loading: false });
    } finally {
      wx.hideLoading();
    }
  },

  async refreshStatus() {
    const challenge = this.data.challenge;
    if (!challenge) return;

    try {
      const res = await getMyChallengeStatus(challenge._id);
      const participant = res?.participant || null;
      const todayChecked = !!res?.todayChecked;
      const selectedBook = res?.selectedBook || null;
      const checkins = Array.isArray(res?.checkins) ? res.checkins : [];
      const checkinDays = Number(res?.checkinDays || participant?.checkinDays || 0) || 0;

      this.setData({ participant, todayChecked, selectedBook, checkins, checkinDays });
      this.buildCalendar();
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

  async openBookPicker() {
    const books = this.data.readingBooks || [];
    if (books.length <= 0) {
      wx.showToast({ title: '还没有在读书籍', icon: 'none' });
      return;
    }
    try {
      const res = await wx.showActionSheet({
        itemList: books.map((b) => `《${b.bookName || '未命名'}》`)
      });
      const idx = Number(res?.tapIndex ?? -1);
      const picked = books[idx] || null;
      if (!picked?._id) return;
      await this.selectExistingBook(picked._id);
    } catch (e) {
      // canceled
    }
  },

  async selectExistingBook(bookId) {
    const challenge = this.data.challenge;
    if (!challenge || !bookId) return;
    if (this.data.operating) return;
    this.setData({ operating: true });
    try {
      const res = await selectBook(challenge._id, bookId);
      this.setData({
        participant: res?.participant || this.data.participant,
        selectedBook: res?.selectedBook || this.data.selectedBook,
        todayChecked: !!res?.todayChecked,
        checkins: Array.isArray(res?.checkins) ? res.checkins : this.data.checkins,
        checkinDays: Number(res?.checkinDays || this.data.checkinDays) || 0
      });
      this.buildCalendar();
      wx.showToast({ title: '已选择', icon: 'success', duration: 700 });
    } catch (e) {
      wx.showToast({ title: e?.message || '选择失败', icon: 'none' });
    } finally {
      this.setData({ operating: false });
    }
  },

  async addBookAndCheckin() {
    const challenge = this.data.challenge;
    if (!challenge) return;
    if (this.data.operating) return;
    const modal = await wx.showModal({
      title: '新增一本书',
      editable: true,
      placeholderText: '请输入书名',
      confirmText: '确认',
      cancelText: '取消'
    });
    if (!modal.confirm) return;
    const bookName = String(modal.content || '').trim();
    if (!bookName) return;

    this.setData({ operating: true });
    try {
      const res = await createBookAndCheckin(challenge._id, bookName);
      this.setData({
        participant: res?.participant || null,
        selectedBook: res?.selectedBook || null,
        todayChecked: !!res?.todayChecked,
        checkins: Array.isArray(res?.checkins) ? res.checkins : [],
        checkinDays: Number(res?.checkinDays || 0) || 0
      });
      this.buildCalendar();
      await this.loadReadingBooks();
      wx.showToast({ title: '已加入在读，并完成今日打卡', icon: 'none', duration: 1200 });
    } catch (e) {
      wx.showToast({ title: e?.message || '操作失败', icon: 'none' });
    } finally {
      this.setData({ operating: false });
    }
  },

  async onCheckinToday() {
    const challenge = this.data.challenge;
    const bookId = this.data.selectedBook?._id || '';
    if (!challenge || !bookId) return;
    if (this.data.operating) return;
    this.setData({ operating: true });
    try {
      const res = await checkinToday(challenge._id, bookId);
      this.setData({
        participant: res?.participant || this.data.participant,
        selectedBook: res?.selectedBook || this.data.selectedBook,
        todayChecked: !!res?.todayChecked,
        checkins: Array.isArray(res?.checkins) ? res.checkins : this.data.checkins,
        checkinDays: Number(res?.checkinDays || this.data.checkinDays) || 0
      });
      this.buildCalendar();
      wx.showToast({ title: res?.alreadyChecked ? '今天已经打过卡了' : '今日打卡完成 ✅', icon: 'none', duration: 900 });
    } catch (e) {
      wx.showToast({ title: e?.message || '打卡失败', icon: 'none' });
    } finally {
      this.setData({ operating: false });
    }
  },

  goBookDetail() {
    const id = this.data.selectedBook?._id || '';
    if (!id) return;
    wx.navigateTo({ url: `/pages/book/book?id=${id}&focus=1` });
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

    // 收集打卡日期（兼容旧数据：若无 checkinDate 则用 checkedAt 推导）
    const checkinMap = {};
    for (const c of this.data.checkins) {
      const dateKey = String(c.checkinDate || '').trim();
      if (dateKey) {
        checkinMap[dateKey] = true;
        continue;
      }
      const ts = Number(c.checkedAt || c.createdAt || 0);
      if (!ts) continue;
      const d = new Date(ts);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
});
