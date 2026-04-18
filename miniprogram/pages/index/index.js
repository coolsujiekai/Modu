import { db, withRetry, traced, withOpenIdFilter } from '../../utils/db.js';
import { getPersonalizeSettings } from '../../utils/personalize';

Page({
  data: {
    loading: true,
    readingBooks: [],
    readingCount: 0,
    heroSub: '从一本书开始今天的阅读',
    homeViewMode: 'grid'
  },

  onShow() {
    this.applyPersonalizeSettings();
    this.loadReadingBooks();
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
      await traced('books.remove(reading)', () =>
        withRetry(() => db.collection('books').doc(id).remove())
      );
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

  getCoverShortName(bookName = '') {
    const text = String(bookName).replace(/\s+/g, '').trim();
    if (!text) return '未命名';
    return text.slice(0, 8);
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
      const normalizedBooks = books.map(b => ({
        ...b,
        notesCount: Number(b.notesCount || 0),
        coverText: this.getCoverShortName(b.bookName),
        coverToneClass: this.coverToneClassById(b._id)
      }));
      normalizedBooks.sort((a, b) => Number(b.startTime || 0) - Number(a.startTime || 0));
      const readingCount = normalizedBooks.length;
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
        heroSub
      });
    } catch (e) {
      this.setData({
        loading: false,
        readingBooks: [],
        readingCount: 0,
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