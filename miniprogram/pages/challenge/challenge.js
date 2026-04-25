import { getTodayStatus, manualCheckin, cancelTodayCheckin, getMonthData, getTodayNotes, invalidateAllCaches } from '../../services/checkinService.js';
import { listReadingBooks, createBook } from '../../services/bookService.js';
import { formatNoteTime, deleteNote } from '../../services/noteService.js';
import { db, withRetry } from '../../utils/db.js';

Page({
  data: {
    loading: true,

    // 打卡状态
    checkedIn: false,
    streak: 0,

    // 月份切换
    viewYear: 0,
    viewMonth: 0,
    monthLabel: '',

    // 日历
    calendarDays: [],

    // 统计
    stats: {
      thisMonthDays: 0,
      totalDays: 0,
      currentStreak: 0,
      longestStreak: 0,
      finishedThisMonth: 0
    },

    // 在读书架
    readingBooks: [],

    // 今日阅读
    todayNotes: [],

    // 推荐
    recommendTop3: [],

    // 快速建书
    createBookVisible: false,
    createBookName: '',
    createAuthorName: '',
    createBookSaving: false,

    // 打卡动画
    checkinAnimating: false,
    justCheckedIn: false
  },

  onLoad() {
    const now = new Date();
    this.setData({
      viewYear: now.getFullYear(),
      viewMonth: now.getMonth() + 1
    });
  },

  async onShow() {
    await this.loadAll(true);
  },

  async loadAll(bypassCache = false) {
    this.setData({ loading: true });
    try {
      const now = new Date();
      const y = now.getFullYear();
      const m = now.getMonth() + 1;

      const [todayStatus, monthData, books, notes] = await Promise.all([
        getTodayStatus(bypassCache),
        getMonthData(y, m),
        this._loadReadingBooks(),
        getTodayNotes()
      ]);

      const todayNotes = (notes || []).slice(0, 5).map(n => ({
        bookId: n.bookId,
        text: n.text || '',
        type: n.type || 'thought',
        bookName: n.bookName || '未命名',
        timeText: formatNoteTime(n.timestamp, 'relative'),
        timestamp: Number(n.timestamp || 0),
        slideButtons: [{
          text: '删除',
          extClass: 'slide-btn-delete',
          data: { ts: Number(n.timestamp || 0), bookId: n.bookId }
        }]
      }));

      const recommendTop3 = await this.pickDailyTop3();

      this.setData({
        loading: false,
        viewYear: y,
        viewMonth: m,
        monthLabel: this.computeMonthLabel(y, m),
        checkedIn: todayStatus.checkedIn,
        streak: todayStatus.streak,
        calendarDays: this.buildCalendar(y, m, monthData.checkins),
        stats: monthData.stats,
        readingBooks: books,
        todayNotes,
        recommendTop3
      });
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  async _loadReadingBooks() {
    try {
      const res = await listReadingBooks(getApp()?.globalData?.openid || '', 50);
      const books = Array.isArray(res?.data) ? res.data : [];
      return books.map(b => ({
        _id: b._id,
        bookName: b.bookName || '未命名',
        coverToneClass: this.coverToneClassById(b._id)
      }));
    } catch (e) {
      return [];
    }
  },

  coverToneClassById(id = '') {
    const tones = ['cover-tone-1', 'cover-tone-2', 'cover-tone-3', 'cover-tone-4', 'cover-tone-5'];
    let sum = 0;
    for (let i = 0; i < String(id).length; i++) sum += String(id).charCodeAt(i);
    return tones[sum % tones.length];
  },

  // ─── 打卡 ──────────────────────────────────────────

  async onCheckin() {
    if (this.data.checkedIn) return;
    if (this.data.checkinAnimating) return;

    this.setData({ checkinAnimating: true });
    try {
      wx.vibrateShort({ type: 'light' });
    } catch (e) {}

    try {
      await manualCheckin();
      this.setData({ justCheckedIn: true });
      await this.loadAll();
      setTimeout(() => {
        this.setData({ justCheckedIn: false });
      }, 3000);
    } catch (e) {
      wx.showToast({ title: e?.message || '打卡失败', icon: 'none' });
    } finally {
      this.setData({ checkinAnimating: false });
    }
  },

  // ─── 月份切换 ─────────────────────────────────────

  onPrevMonth() {
    let y = this.data.viewYear;
    let m = this.data.viewMonth - 1;
    if (m < 1) { m = 12; y--; }
    this.switchMonth(y, m);
  },

  onNextMonth() {
    let y = this.data.viewYear;
    let m = this.data.viewMonth + 1;
    if (m > 12) { m = 1; y++; }
    this.switchMonth(y, m);
  },

  async switchMonth(y, m) {
    this.setData({ viewYear: y, viewMonth: m, loading: true });
    try {
      const monthData = await getMonthData(y, m);
      this.setData({
        loading: false,
        monthLabel: this.computeMonthLabel(y, m),
        calendarDays: this.buildCalendar(y, m, monthData.checkins),
        stats: monthData.stats
      });
    } catch (e) {
      this.setData({ loading: false });
    }
  },

  // ─── 日历渲染 ─────────────────────────────────────

  buildCalendar(year, month, checkinDates) {
    const set = new Set(checkinDates || []);
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const firstDay = new Date(year, month - 1, 1).getDay(); // 0=周日
    const lastDate = new Date(year, month, 0).getDate();

    const days = [];
    // 空白格子
    for (let i = 0; i < firstDay; i++) {
      days.push({ empty: true });
    }
    // 日期格子
    for (let d = 1; d <= lastDate; d++) {
      const mm = String(month).padStart(2, '0');
      const dd = String(d).padStart(2, '0');
      const dateStr = `${year}-${mm}-${dd}`;
      const isToday = dateStr === todayStr;
      const isFuture = dateStr > todayStr;
      const isChecked = set.has(dateStr);
      days.push({ date: d, dateStr, isToday, isFuture, isChecked });
    }
    return days;
  },

  // ─── 推荐 ─────────────────────────────────────────

  async pickDailyTop3() {
    // 尝试从 public_rankings.today_pool 读取推荐池
    let pool = [];
    try {
      const res = await withRetry(() =>
        db.collection('public_rankings').doc('today_pool').get()
      );
      const items = res?.data?.items;
      if (Array.isArray(items) && items.length > 0) {
        pool = items.map(it => ({
          title: String(it.title || it.name || it || '').trim(),
          author: String(it.author || '').trim()
        })).filter(it => it.title);
      }
    } catch (e) {}

    // 兜底静态推荐池
    if (pool.length === 0) {
      pool = [
        { title: '活着', author: '余华' },
        { title: '平凡的世界', author: '路遥' },
        { title: '小王子', author: '圣·埃克苏佩里' },
        { title: '解忧杂货店', author: '东野圭吾' },
        { title: '人类简史', author: '尤瓦尔·赫拉利' },
        { title: '围城', author: '钱钟书' }
      ];
    }

    return this._dailyPick(pool, 3);
  },

  // 每日稳定随机抽取（seed 基于日期，同一天所有用户结果一致）
  _dailyPick(arr, k) {
    if (!Array.isArray(arr) || arr.length === 0) return [];
    const n = arr.length;
    if (n <= k) return arr.slice(0, k);
    const d = new Date();
    const seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    let x = seed ^ 2166136261;
    x = (Math.imul(x ^ (x >>> 16), 1540483477)) | 0;
    const used = new Set();
    const picked = [];
    while (picked.length < k && used.size < n) {
      x = (Math.imul(1664525, ((x ^ (x >>> 16)) >>> 0)) + 1013904223) >>> 0;
      const idx = x % n;
      if (!used.has(idx)) {
        used.add(idx);
        picked.push(arr[idx]);
      }
    }
    return picked;
  },

  // ─── 快速建书 ─────────────────────────────────────

  openCreateBook() {
    this.setData({ createBookVisible: true, createBookName: '', createAuthorName: '' });
  },

  closeCreateBook() {
    this.setData({ createBookVisible: false, createBookName: '', createAuthorName: '' });
  },

  onCreateBookNameInput(e) {
    this.setData({ createBookName: e.detail.value });
  },

  onCreateAuthorInput(e) {
    this.setData({ createAuthorName: e.detail.value });
  },

  async onConfirmCreateBook() {
    const bookName = (this.data.createBookName || '').trim();
    if (!bookName) {
      wx.showToast({ title: '请填写书名', icon: 'none' });
      return;
    }
    if (this.data.createBookSaving) return;
    this.setData({ createBookSaving: true });

    try {
      const authorInput = (this.data.createAuthorName || '').trim();
      const bookId = await createBook({
        bookName,
        authorId: '',
        authorName: authorInput,
        authorNameNorm: authorInput
      });
      this.setData({ createBookVisible: false, createBookSaving: false });
      wx.showToast({ title: '已添加，开始读吧', icon: 'success', duration: 900 });
      // 刷新书架
      const books = await this._loadReadingBooks();
      this.setData({ readingBooks: books });
    } catch (e) {
      this.setData({ createBookSaving: false });
      wx.showToast({ title: e?.message || '创建失败', icon: 'none' });
    }
  },

  // ─── 跳转 ────────────────────────────────────────

  openBook(e) {
    const id = e.currentTarget?.dataset?.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/book/book?id=${id}` });
  },

  openQuickNote(e) {
    const id = e.currentTarget?.dataset?.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/quickNote/quickNote?bookId=${id}` });
  },

  // ─── 分享 ────────────────────────────────────────

  onShareAppMessage() {
    const { streak, stats } = this.data;
    return {
      title: `阅读打卡 · 连续 ${streak} 天 | 翻书随手记`,
      path: '/pages/challenge/challenge',
      desc: `本月打卡 ${stats.thisMonthDays} 天，累计 ${stats.totalDays} 天`
    };
  },

  onShareTimeline() {
    const { streak } = this.data;
    return { title: `阅读打卡 · 连续 ${streak} 天 | 翻书随手记` };
  },

  // ─── 工具 ────────────────────────────────────────

  computeMonthLabel(y, m) {
    const labels = ['一月', '二月', '三月', '四月', '五月', '六月',
                    '七月', '八月', '九月', '十月', '十一月', '十二月'];
    return `${y} 年 ${labels[m - 1]}`;
  },

  openQuickNoteFromEmpty() {
    const books = this.data.readingBooks;
    if (books && books.length > 0) {
      wx.navigateTo({ url: `/pages/quickNote/quickNote?bookId=${books[0]._id}` });
    } else {
      this.openCreateBook();
    }
  },

  // ─── 今日笔记滑动删除 ────────────────────────

  onTodayNoteSlideButtonTap(e) {
    const { ts, bookid } = e.detail?.data || {};
    if (!ts || !bookid) return;
    this.deleteTodayNote(bookid, ts);
  },

  async deleteTodayNote(bookId, timestamp) {
    const confirm = await wx.showModal({
      title: '删除这条记录？',
      content: '删除后不可恢复。',
      confirmColor: '#C07D6B',
      confirmText: '删除'
    });
    if (!confirm.confirm) return;
    try {
      await deleteNote(bookId, timestamp);
      const updated = this.data.todayNotes.filter(n => Number(n.timestamp) !== Number(timestamp));
      this.setData({ todayNotes: updated });
      wx.showToast({ title: '已删除', icon: 'none', duration: 700 });
    } catch (e) {
      wx.showToast({ title: '删除失败', icon: 'none' });
    }
  },

  // ─── 推荐书籍点击 ───────────────────────────

  onRecommendTap(e) {
    const title = e.currentTarget?.dataset?.title || '';
    const author = e.currentTarget?.dataset?.author || '';
    if (!title) return;
    wx.showModal({
      title: `加入在读`,
      content: `《${title}》${author ? ' - ' + author : ''}`,
      confirmText: '加入',
      confirmColor: '#8B7355',
      cancelText: '算了'
    }).then(res => {
      if (res.confirm) {
        this.setData({
          createBookName: title,
          createAuthorName: author || '',
          createBookVisible: true
        });
      }
    }).catch(() => {});
  },

  // ─── 取消今日打卡 ──────────────────────────

  onCancelCheckin() {
    wx.showModal({
      title: '取消今日打卡？',
      content: '确定要取消今天的打卡记录吗？',
      confirmText: '确定取消',
      confirmColor: '#C07D6B',
      cancelText: '不取消'
    }).then(async res => {
      if (!res.confirm) return;
      wx.showLoading({ title: '处理中', mask: true });
      try {
        await cancelTodayCheckin();
        invalidateAllCaches();
        await this.loadAll();
        wx.showToast({ title: '已取消', icon: 'none', duration: 800 });
      } catch (e) {
        wx.hideLoading();
        wx.showToast({ title: e?.message || '操作失败', icon: 'none' });
      }
    }).catch(() => {});
  }
});
