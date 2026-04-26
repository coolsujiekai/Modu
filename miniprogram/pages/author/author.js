import { db, withOpenIdFilter } from '../../utils/db.js';
import { formatDate } from '../../utils/util.js';
import { deleteBook } from '../../services/bookService.js';

Page({
  data: {
    isDark: false,
    loading: true,
    authorId: '',
    authorName: '',
    readingBooks: [],
    finishedBooks: [],
    openSlideId: null
  },

  onLoad(options) {
    this.setData({
      authorId: options.id || '',
      authorName: options.name ? decodeURIComponent(options.name) : ''
    });
  },

  onShow() {
    this.setData({ isDark: getApp()?.globalData?.isDark || false });
    this.loadData();
  },

  onPullDownRefresh() {
    this.loadData().finally(() => wx.stopPullDownRefresh());
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

  async onSlideButtonTap(e) {
    const data = e?.detail?.data || {};
    const id = data.id;
    const name = data.name || '';
    if (!id) return;

    const { confirm } = await wx.showModal({
      title: '删除这本书？',
      content: name ? `《${name}》将被删除，记录不可恢复。` : '该书将被删除，记录不可恢复。',
      confirmText: '删除',
      confirmColor: '#C07D6B'
    });
    if (!confirm) return;

    wx.showLoading({ title: '删除中', mask: true });
    try {
      await deleteBook(id);
      wx.hideLoading();
      wx.showToast({ title: '已删除', icon: 'success', duration: 800 });
      this.setData({ openSlideId: null });
      this.loadData();
    } catch (err) {
      wx.hideLoading();
      wx.showModal({
        title: '删除失败',
        content: err?.errMsg || JSON.stringify(err),
        showCancel: false
      });
    }
  },

  openBook(e) {
    const id = e.currentTarget?.dataset?.id;
    if (!id) return;
    if (this.data.openSlideId) {
      this.setData({ openSlideId: null });
      return;
    }
    wx.navigateTo({ url: `/pages/book/book?id=${id}` });
  },

  async loadData() {
    const authorId = this.data.authorId;
    if (!authorId) {
      this.setData({ loading: false });
      return;
    }

    this.setData({ loading: true });
    try {
      // fill author name if missing
      if (!this.data.authorName) {
        const aRes = await db.collection('authors').doc(authorId).get();
        const authorName = aRes?.data?.name || '';
        this.setData({ authorName });
      }
      wx.setNavigationBarTitle({ title: this.data.authorName ? `作者 · ${this.data.authorName}` : '作者' });

      const [readingRes, finishedRes] = await Promise.all([
        db
          .collection('books')
          .where(withOpenIdFilter({ authorId, status: 'reading' }))
          .orderBy('startTime', 'desc')
          .limit(50)
          .field({ notes: false })
          .get(),
        db
          .collection('books')
          .where(withOpenIdFilter({ authorId, status: 'finished' }))
          .orderBy('endTime', 'desc')
          .limit(50)
          .field({ notes: false })
          .get()
      ]);

      const readingBooks = (readingRes.data || []).map(b => ({
        ...b,
        startText: formatDate(b.startTime),
        slideButtons: [
          { text: '删除', extClass: 'slide-btn-delete', data: { id: b._id, name: b.bookName } }
        ]
      }));
      const finishedBooks = (finishedRes.data || []).map(b => ({
        ...b,
        endText: formatDate(b.endTime),
        slideButtons: [
          { text: '删除', extClass: 'slide-btn-delete', data: { id: b._id, name: b.bookName } }
        ]
      }));

      this.setData({ loading: false, readingBooks, finishedBooks, openSlideId: null });
    } catch (err) {
      this.setData({ loading: false, readingBooks: [], finishedBooks: [], openSlideId: null });
      wx.showModal({
        title: '加载失败',
        content: err?.errMsg || JSON.stringify(err),
        showCancel: false
      });
    }
  }
});

