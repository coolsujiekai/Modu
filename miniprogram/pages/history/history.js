import { db, withRetry, traced, withOpenIdFilter } from '../../utils/db.js';
import { formatDate } from '../../utils/util.js';
import { deleteBook } from '../../services/bookService.js';

Page({
  data: {
    groupedBooks: [],
    readingCount: 0,
    finishedCount: 0,
    totalThoughts: 0,
    totalQuotes: 0,
    openSlideId: null
  },

  onShow() {
    this.loadOverview();
    this.loadFinishedBooks();
    this.loadStats();
  },

  onPullDownRefresh() {
    Promise.all([this.loadOverview(), this.loadFinishedBooks(), this.loadStats()])
      .finally(() => wx.stopPullDownRefresh());
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

  async deleteFinishedBookById(id, name) {
    if (!id) return;

    const { confirm } = await wx.showModal({
      title: '删除这本书？',
      content: name ? `《${name}》将从已读书架删除，记录不可恢复。` : '该书将从已读书架删除，记录不可恢复。',
      confirmText: '删除',
      confirmColor: '#C07D6B'
    });
    if (!confirm) return;

    wx.showLoading({ title: '删除中', mask: true });
    try {
      await deleteBook(id);
      wx.hideLoading();
      this.setData({ openSlideId: null });
      wx.showToast({ title: '已删除', icon: 'success', duration: 800 });
      await Promise.all([this.loadOverview(), this.loadFinishedBooks(), this.loadStats()]);
    } catch (err) {
      wx.hideLoading();
      wx.showModal({
        title: '删除失败',
        content: err?.errMsg || JSON.stringify(err),
        showCancel: false
      });
    }
  },

  async onFinishedSlideButtonTap(e) {
    const data = e?.detail?.data || {};
    await this.deleteFinishedBookById(data.id, data.name);
  },

  async loadOverview() {
    try {
      const [readingRes, finishedRes] = await Promise.all([
        traced('books.reading.count', () => withRetry(() => db.collection('books').where(withOpenIdFilter({ status: 'reading' })).count())),
        traced('books.finished.count', () => withRetry(() => db.collection('books').where(withOpenIdFilter({ status: 'finished' })).count()))
      ]);
      this.setData({
        readingCount: readingRes.total || 0,
        finishedCount: finishedRes.total || 0
      });
    } catch (e) {
      // ignore overview errors
    }
  },

  async loadStats() {
    try {
      const [thoughtRes, quoteRes] = await Promise.all([
        withRetry(() => db.collection('notes').where(withOpenIdFilter({ type: 'thought' })).count()),
        withRetry(() => db.collection('notes').where(withOpenIdFilter({ type: 'quote' })).count())
      ]);
      this.setData({
        totalThoughts: Number(thoughtRes?.total || 0),
        totalQuotes: Number(quoteRes?.total || 0)
      });
    } catch (e) {
      console.warn('Stats load failed', e);
    }
  },

  async loadFinishedBooks() {
    wx.showLoading({ title: '加载中' });
    try {
      const res = await traced('books.finished.list(orderBy endTime)', () =>
        withRetry(() =>
          db
            .collection('books')
            .where(withOpenIdFilter({ status: 'finished' }))
            .orderBy('endTime', 'desc')
            .limit(50)
            .field({ notes: false })
            .get()
        )
      );
      const books = (res.data || []).map(b => ({
        ...b,
        endText: formatDate(b.endTime),
        slideButtons: [
          {
            text: '删除',
            extClass: 'slide-btn-delete',
            data: { id: b._id, name: b.bookName }
          }
        ]
      }));
      const groups = {};
      books.forEach(book => {
        const date = new Date(book.endTime);
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
        if (!groups[yearMonth]) groups[yearMonth] = [];
        groups[yearMonth].push(book);
      });
      const groupedBooks = Object.keys(groups).sort().reverse().map(yearMonth => ({
        yearMonth: yearMonth,
        yearMonthText: `${yearMonth.slice(0, 4)}年${Number(yearMonth.slice(5))}月`,
        books: groups[yearMonth]
      }));
      this.setData({ groupedBooks: groupedBooks });
      wx.hideLoading();
    } catch (err) {
      wx.hideLoading();
      wx.showModal({
        title: '已读加载失败',
        content: err?.errMsg || JSON.stringify(err),
        showCancel: false
      });
    }
  },

  viewBookDetail(e) {
    const book = e.currentTarget.dataset.book;
    if (this.data.openSlideId) {
      this.setData({ openSlideId: null });
      return;
    }
    wx.navigateTo({
      url: `/pages/book/book?id=${book._id}`
    });
  },
});