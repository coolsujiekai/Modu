import { db, withRetry, traced, withOpenIdFilter } from '../../utils/db.js';
import { getPersonalizeSettings } from '../../utils/personalize';
import { deleteBook } from '../../services/bookService.js';
import { formatNoteTime } from '../../services/noteService.js';

Page({
  data: {
    loading: true,
    readingBooks: [],
    readingCount: 0,
    primaryBook: null,
    heroSub: '从一本书开始今天的阅读',
    homeViewMode: 'grid',
    recentNotes: []
  },

  async onShow() {
    this.applyPersonalizeSettings();
    await this.loadReadingBooks();

    this.loadRecentNotes();
  },

  applyPersonalizeSettings() {
    const settings = getPersonalizeSettings();
    this.setData({
      homeViewMode: settings.homeViewMode
    });
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
    try {
      const res = await traced('books.reading.recent(notes)', () =>
        withRetry(() =>
          db
            .collection('books')
            .where(withOpenIdFilter({ status: 'reading' }))
            .orderBy('startTime', 'desc')
            .limit(5)
            .get()
        )
      );
      const pool = [];
      (res.data || []).forEach((book) => {
        const notes = Array.isArray(book.notes) ? book.notes : [];
        notes.forEach((n) => {
          const ts = Number(n.timestamp || 0);
          if (!ts) return;
          pool.push({
            key: `${book._id}_${ts}`,
            bookId: book._id,
            bookName: book.bookName || '未命名',
            text: (n.text || '').trim(),
            type: n.type || 'thought',
            timestamp: ts
          });
        });
      });
      pool.sort((a, b) => b.timestamp - a.timestamp);
      const recentNotes = pool.slice(0, 2).map((n) => ({
        ...n,
        timeText: formatNoteTime(n.timestamp, 'relative')
      }));
      this.setData({ recentNotes });
    } catch (e) {
      this.setData({ recentNotes: [] });
    }
  },

  async onBookLongPress(e) {
    const id = e?.currentTarget?.dataset?.id;
    const name = e?.currentTarget?.dataset?.name || '';
    if (!id) return;
    try {
      const res = await wx.showActionSheet({
        itemList: ['删除这本书'],
        itemColor: '#C07D6B'
      });
      if (res.tapIndex === 0) {
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
    this.setData({ loading: true });
    try {
      let res;
      try {
        // 优先：按开始时间倒序（需要组合索引）
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
        // 兜底：不排序查询（不依赖组合索引），确保页面可用
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
          notesCount: Number(b.notesCount || 0),
          coverToneClass: this.coverToneClassById(b._id),
          authorName: authorName || ''
        });
      }
      normalizedBooks.sort((a, b) => Number(b.startTime || 0) - Number(a.startTime || 0));
      const readingCount = normalizedBooks.length;
      const primaryBook = normalizedBooks[0] || null;
      let heroSub = '今天想读哪一本？';
      if (readingCount === 1) {
        heroSub = '1 本在读，打开它继续读';
      } else if (readingCount > 1) {
        heroSub = `${readingCount} 本在读，先从最想读的那本开始`;
      }
      this.setData({
        loading: false,
        readingBooks: normalizedBooks,
        readingCount,
        primaryBook,
        heroSub
      });
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
  }
});