import { db, withRetry, traced, withOpenIdFilter } from '../../utils/db.js';
import { formatDate } from '../../utils/util.js';

Page({
  data: {
    loading: true,
    readingBooks: [],
    openSlideId: null
  },

  onShow() {
    this.loadReadingBooks();
  },

  onPageTap() {
    if (!this.data.openSlideId) return;
    this.setData({ openSlideId: null });
  },

  onSlideShow(e) {
    const id = e?.currentTarget?.dataset?.id;
    if (!id) return;
    if (this.data.openSlideId === id) return;
    this.setData({ openSlideId: id });
  },

  onSlideHide(e) {
    const id = e?.currentTarget?.dataset?.id;
    if (!id) return;
    if (this.data.openSlideId !== id) return;
    this.setData({ openSlideId: null });
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
      this.setData({ openSlideId: null });
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

  async onSlideButtonTap(e) {
    const data = e?.detail?.data || {};
    await this.deleteBookById(data.id, data.name);
  },

  async startReading() {
    wx.navigateTo({ url: '/pages/createBook/createBook' });
  },

  openBook(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    if (this.data.openSlideId) {
      this.setData({ openSlideId: null });
      return;
    }
    wx.navigateTo({ url: `/pages/book/book?id=${id}` });
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
      const readingBooks = books.map(b => ({
        ...b,
        notesCount: Number(b.notesCount || 0),
        startText: formatDate(b.startTime),
        slideButtons: [
          {
            text: '删除',
            extClass: 'slide-btn-delete',
            data: { id: b._id, name: b.bookName }
          }
        ]
      }));
      this.setData({ loading: false, readingBooks, openSlideId: null });
    } catch (e) {
      this.setData({ loading: false, readingBooks: [] });
      wx.showModal({
        title: '在读加载失败',
        content: e?.errMsg || JSON.stringify(e),
        showCancel: false
      });
    }
  }
});