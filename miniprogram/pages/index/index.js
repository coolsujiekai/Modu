import { db, withRetry, traced, withOpenIdFilter } from '../../utils/db.js';
import { getPersonalizeSettings } from '../../utils/personalize';
import { deleteBook, finishBook } from '../../services/bookService.js';
import { formatNoteTime, deleteNote } from '../../services/noteService.js';
import { cacheGet, cacheSet, cacheRemove, CacheKeys, CacheTTL } from '../../utils/cache.js';
import { getTodayStatus } from '../../services/checkinService.js';

Page({
  data: {
    loading: true,
    readingBooks: [],
    readingCount: 0,
    primaryBook: null,
    heroSub: '从一本书开始今天的阅读',
    homeViewMode: 'grid',
    recentNotes: [],
    dailyQuote: '读一本好书，就是和许多高尚的人谈话。',
    // Reading activity banner summary
    activity: {
      streak: 7,
      todayMinutes: 45,
      totalNotes: 23
    },
    recommendTop3: [],

    // 打卡状态
    checkin: { checkedIn: false, streak: 0 },
  },
  onShareAppMessage() {
    return {
      title: '翻书随手记',
      path: '/pages/index/index'
    };
  },
  onShareTimeline() {
    return {
      title: '翻书随手记'
    };
  },
  onLoad() {
    // runtime-only fields; avoid putting complex values on Page() definition
    this._recentTap = { key: '', at: 0, timer: null };
    this._shelfTipTimer = null;
    this._homeLoadedAt = 0;

    // Avoid double-loading on cold start; onShow already loads data.
  },

  async onShow() {
    const now = Date.now();
    if (this._homeLoadedAt && now - this._homeLoadedAt < 800) {
      return;
    }
    this._homeLoadedAt = now;
    this.applyPersonalizeSettings();
    await this.loadReadingBooks();

    this.loadRecentNotes();
    this.refreshHomeActivity();
    this.loadRecommendTop3();
    this.loadCheckinStatus();
  },

  applyPersonalizeSettings() {
    const settings = getPersonalizeSettings();
    this.setData({
      homeViewMode: settings.homeViewMode
    });
  },

  goHistory() {
    wx.switchTab({ url: '/pages/history/history' });
  },

  goProfile() {
    wx.switchTab({ url: '/pages/profile/profile' });
  },

  refreshHomeActivity() {
    // Keep lightweight for now: cache for activity page
    try {
      wx.setStorageSync('_activity_summary_v1', this.data.activity);
    } catch (e) {}
  },

  goChallenge() {
    wx.navigateTo({ url: '/pages/challenge/challenge' });
  },

  async loadCheckinStatus() {
    try {
      const status = await getTodayStatus();
      this.setData({ checkin: status });
    } catch (e) {
      // ignore
    }
  },

  async loadRecommendTop3() {
    try {
      const res = await withRetry(() =>
        db.collection('public_rankings').doc('today_pool').get()
      );
      const pool = Array.isArray(res?.data?.items) ? res.data.items : [];
      const cleaned = pool.map((t) => String(t?.title || t || '').trim()).filter(Boolean);
      const top3 = this.pickDailyStable(cleaned, 3);
      this.setData({ recommendTop3: top3.map((t) => ({ title: t })) });
    } catch (e) {
      this.setData({ recommendTop3: [] });
    }
  },

  // Stable daily pick: same for all users on same day.
  pickDailyStable(items, k = 3) {
    const list = Array.isArray(items) ? items : [];
    const n = list.length;
    if (n <= 0) return [];
    if (n <= k) return list.slice(0, k);

    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const seedStr = `${y}-${m}-${day}`;
    let seed = 2166136261;
    for (let i = 0; i < seedStr.length; i++) {
      seed ^= seedStr.charCodeAt(i);
      seed = Math.imul(seed, 16777619);
    }
    // LCG
    let x = seed >>> 0;
    const picked = [];
    const used = new Set();
    while (picked.length < k && used.size < n) {
      x = (Math.imul(1664525, x) + 1013904223) >>> 0;
      const idx = x % n;
      if (used.has(idx)) continue;
      used.add(idx);
      picked.push(list[idx]);
    }
    return picked;
  },

  async deleteBookById(id, name) {
    if (!id) return;

    const { confirm } = await wx.showModal({
      title: '删除这本书？',
      content: name ? `《${name}》将从书架删除，记录不可恢复。` : '该书将从书架删除，记录不可恢复。',
      confirmText: '删除',
      confirmColor: '#C07D6B'
    });
    if (!confirm) return;

    wx.showLoading({ title: '删除中', mask: true });
    try {
      await deleteBook(id);
      cacheRemove(CacheKeys.READING_BOOKS);
      cacheRemove(CacheKeys.RECENT_NOTES);
      wx.hideLoading();
      wx.showToast({ title: '已删除', icon: 'success', duration: 800 });
      await this.loadReadingBooks();
    } catch (err) {
      wx.hideLoading();
      wx.showModal({
        title: '删除失败',
        content: err?.errMsg || JSON.stringify(err),
        showCancel: false
      });
    }
  },

  async startReading() {
    wx.navigateTo({ url: '/pages/createBook/createBook' });
  },

  openBook(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/book/book?id=${id}` });
  },

  openBookFromNote(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/book/book?id=${id}` });
  },

  onRecentNoteTap(e) {
    const bookId = e?.currentTarget?.dataset?.bookid;
    const text = e?.currentTarget?.dataset?.text || '';
    const key = e?.currentTarget?.dataset?.key || '';
    if (!bookId) return;

    const now = Date.now();
    const isDouble = key && this._recentTap.key === key && now - this._recentTap.at < 260;

    if (this._recentTap.timer) {
      clearTimeout(this._recentTap.timer);
      this._recentTap.timer = null;
    }

    if (isDouble) {
      this._recentTap = { key: '', at: 0, timer: null };
      if (!text) return;
      wx.setClipboardData({
        data: text,
        success: () => wx.showToast({ title: '已复制', duration: 600 })
      });
      return;
    }

    this._recentTap.key = key;
    this._recentTap.at = now;
    this._recentTap.timer = setTimeout(() => {
      this._recentTap.timer = null;
      this.openBookFromNote({ currentTarget: { dataset: { id: bookId } } });
    }, 260);
  },

  openPrimaryBook() {
    const id = this.data.primaryBook?._id;
    if (!id) {
      this.startReading();
      return;
    }
    wx.navigateTo({ url: `/pages/book/book?id=${id}` });
  },

  onQuickRecordTap() {
    wx.navigateTo({ url: '/pages/quickNote/quickNote' });
  },


  async loadRecentNotes() {
    const cached = cacheGet(CacheKeys.RECENT_NOTES);
    if (cached) {
      this.setData({ recentNotes: cached });
      return;
    }
    try {
      const res = await withRetry(() =>
        db
          .collection('notes')
          .where(withOpenIdFilter({}))
          .orderBy('timestamp', 'desc')
          .limit(3)
          .get()
      );
      const recentNotes = (res.data || [])
        .map((n) => ({
          _id: n._id,
          key: n._id || `${n.bookId || ''}_${Number(n.timestamp || 0)}`,
          bookId: n.bookId,
          bookName: n.bookName || '未命名',
          text: (n.text || '').trim(),
          type: n.type || 'thought',
          timestamp: Number(n.timestamp || 0),
          timeText: formatNoteTime(Number(n.timestamp || 0), 'relative'),
          slideButtons: [{
            text: '删除',
            extClass: 'slide-btn-delete',
            data: { ts: Number(n.timestamp || 0), bookId: n.bookId }
          }]
        }))
        .filter((n) => n.bookId && n.timestamp && n.text);

      this.setData({ recentNotes });
      cacheSet(CacheKeys.RECENT_NOTES, recentNotes, CacheTTL.RECENT_NOTES);
    } catch (e) {
      this.setData({ recentNotes: [] });
    }
  },

  // ─── 最近笔记滑动删除 ──────────────────────

  onRecentNoteSlideButtonTap(e) {
    const { ts, bookid } = e.detail?.data || {};
    if (!ts || !bookid) return;
    this.deleteRecentNote(bookid, ts);
  },

  async deleteRecentNote(bookId, timestamp) {
    const confirm = await wx.showModal({
      title: '删除这条记录？',
      content: '删除后不可恢复。',
      confirmColor: '#C07D6B',
      confirmText: '删除'
    });
    if (!confirm.confirm) return;
    try {
      await deleteNote(bookId, Number(timestamp));
      const updated = this.data.recentNotes.filter(n => Number(n.timestamp) !== Number(timestamp));
      this.setData({ recentNotes: updated });
      wx.showToast({ title: '已删除', icon: 'none', duration: 700 });
    } catch (e) {
      wx.showToast({ title: '删除失败', icon: 'none' });
    }
  },

  async onBookLongPress(e) {
    const id = e?.currentTarget?.dataset?.id;
    const name = e?.currentTarget?.dataset?.name || '';
    if (!id) return;

    const book = (this.data.readingBooks || []).find(b => b?._id === id) || null;
    const startTime = Number(book?.startTime || 0);
    try {
      const res = await wx.showActionSheet({
        itemList: ['编辑书籍信息', '标记读完', '删除这本书'],
        itemColor: '#2E2721'
      });
      if (res.tapIndex === 0) {
        wx.navigateTo({ url: `/pages/editBookInfo/editBookInfo?id=${id}` });
        return;
      }
      if (res.tapIndex === 1) {
        if (!startTime) {
          wx.showToast({ title: '缺少开始时间，无法标记读完', icon: 'none' });
          return;
        }
        const confirm = await wx.showModal({
          title: '标记为已读？',
          content: name ? `《${name}》将移动到「已读回顾」。` : '这本书将移动到「已读回顾」。',
          confirmText: '标记已读',
          confirmColor: '#6F8A63'
        });
        if (!confirm.confirm) return;
        wx.showLoading({ title: '保存中', mask: true });
        try {
          await finishBook(id, startTime);
          cacheRemove(CacheKeys.READING_BOOKS);
          cacheRemove(CacheKeys.RECENT_NOTES);
          wx.hideLoading();
          wx.showToast({ title: '已标记已读', icon: 'success', duration: 800 });
          await this.loadReadingBooks();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: '保存失败', icon: 'none' });
        }
        return;
      }
      if (res.tapIndex === 2) {
        await this.deleteBookById(id, name);
      }
    } catch (err) {
      // user canceled
    }
  },

  coverToneClassById(id = '') {
    const tones = ['cover-tone-1', 'cover-tone-2', 'cover-tone-3', 'cover-tone-4', 'cover-tone-5'];
    let sum = 0;
    const text = String(id);
    for (let i = 0; i < text.length; i++) sum += text.charCodeAt(i);
    return tones[sum % tones.length];
  },

  onPullDownRefresh() {
    this.loadReadingBooks().finally(() => wx.stopPullDownRefresh());
  },

  async loadReadingBooks() {
    // 尝试从缓存读取
    const cached = cacheGet(CacheKeys.READING_BOOKS);
    if (cached) {
      this.setData({
        loading: false,
        readingBooks: cached.books,
        readingCount: cached.books.length,
        primaryBook: cached.books[0] || null,
        heroSub: cached.heroSub
      });
      // 后台静默刷新（非阻塞）
      this._refreshReadingBooksSilently();
      return;
    }

    this.setData({ loading: true });
    try {
      const books = await this._fetchReadingBooksFromDb();
      const readingCount = books.length;
      const primaryBook = books[0] || null;
      let heroSub = '今天想读哪一本？';
      if (readingCount === 1) {
        heroSub = '1 本在读，打开它继续读';
      } else if (readingCount > 1) {
        heroSub = `${readingCount} 本在读，先从最想读的那本开始`;
      }
      this.setData({
        loading: false,
        readingBooks: books,
        readingCount,
        primaryBook,
        heroSub
      });

      // 写入缓存
      cacheSet(CacheKeys.READING_BOOKS, { books, heroSub }, CacheTTL.READING_BOOKS);

      // One-time lightweight shelf tip (WeChat-like).
      this.maybeShowShelfTip(readingCount);
    } catch (e) {
      this.setData({
        loading: false,
        readingBooks: [],
        readingCount: 0,
        primaryBook: null,
        heroSub: '今天想读哪一本？'
      });
      wx.showModal({
        title: '在读加载失败',
        content: e?.errMsg || JSON.stringify(e),
        showCancel: false
      });
    }
  },

  async _fetchReadingBooksFromDb() {
    let res;
    try {
      res = await traced('books.reading.list(orderBy startTime)', () =>
        withRetry(() =>
          db
            .collection('books')
            .where(withOpenIdFilter({ status: 'reading' }))
            .orderBy('startTime', 'desc')
            .limit(50)
            .field({ notes: false })
            .get()
        )
      );
    } catch (e) {
      const msg = e?.errMsg || '';
      if (msg.includes('timeout') || msg.includes('index')) {
        wx.showToast({ title: '排序暂不可用，请先建索引', icon: 'none', duration: 2000 });
      }
      res = await traced('books.reading.list(no orderBy)', () =>
        withRetry(() =>
          db
            .collection('books')
            .where(withOpenIdFilter({ status: 'reading' }))
            .limit(50)
            .field({ notes: false })
            .get()
        )
      );
    }
    const books = res.data || [];
    const seen = new Set();
    const normalizedBooks = [];
    for (const b of books) {
      const id = b._id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const authorName = (b.authorName || '').trim();
      normalizedBooks.push({
        ...b,
        coverToneClass: this.coverToneClassById(b._id),
        authorName: authorName || ''
      });
    }
    normalizedBooks.sort((a, b) => Number(b.startTime || 0) - Number(a.startTime || 0));
    return normalizedBooks;
  },

  async _refreshReadingBooksSilently() {
    try {
      const books = await this._fetchReadingBooksFromDb();
      const readingCount = books.length;
      let heroSub = '今天想读哪一本？';
      if (readingCount === 1) {
        heroSub = '1 本在读，打开它继续读';
      } else if (readingCount > 1) {
        heroSub = `${readingCount} 本在读，先从最想读的那本开始`;
      }
      cacheSet(CacheKeys.READING_BOOKS, { books, heroSub }, CacheTTL.READING_BOOKS);
      // 仅在数据有变化时更新 UI
      const prev = this.data.readingBooks;
      if (prev.length !== books.length || JSON.stringify(prev) !== JSON.stringify(books)) {
        this.setData({ readingBooks: books, readingCount, primaryBook: books[0] || null, heroSub });
      }
    } catch (e) {
      // 静默失败，不打扰用户
    }
  },

  maybeShowShelfTip(readingCount) {
    if (readingCount <= 0) return;
    try {
      const seen = wx.getStorageSync('_shelf_tip_v1_seen') === '1';
      if (seen) return;
      wx.setStorageSync('_shelf_tip_v1_seen', '1');

      if (this._shelfTipTimer) clearTimeout(this._shelfTipTimer);
      this._shelfTipTimer = setTimeout(() => {
        wx.showToast({
          title: '提示：长按书籍可编辑/标记读完/删除',
          icon: 'none',
          duration: 1800
        });
      }, 600);
    } catch (err) {
      // ignore storage failures
    }
  }
});