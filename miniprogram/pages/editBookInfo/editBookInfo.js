import { db, withOpenIdFilter } from '../../utils/db.js';
import { debounce } from '../../utils/util.js';
import { updateBookInfo } from '../../services/bookService.js';
import { findOrCreateAuthor, searchAuthors } from '../../services/authorService.js';

Page({
  data: {
    isDark: false,
    bookId: '',
    bookName: '',
    authorQuery: '',
    authorSuggestions: [],
    selectedAuthor: null
  },

  async onLoad(options) {
    this.setData({ isDark: getApp()?.globalData?.isDark || false });
    const bookId = options.id || '';
    this.setData({ bookId });
    if (!bookId) return;

    wx.showLoading({ title: '加载中' });
    try {
      const res = await db.collection('books').where(withOpenIdFilter({ _id: bookId })).limit(1).get();
      const book = (res.data || [])[0] || {};
      this.setData({
        bookName: book.bookName || '',
        authorQuery: book.authorName || '',
        selectedAuthor: book.authorId
          ? { _id: book.authorId, name: book.authorName || '', nameNorm: book.authorNameNorm || '' }
          : null
      });
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  onBookNameInput(e) {
    this.setData({ bookName: e.detail.value });
  },

  onAuthorInput(e) {
    const authorQuery = e.detail.value;
    this.setData({ authorQuery, selectedAuthor: null });
    this.queryAuthorsDebounced();
  },

  clearAuthor() {
    this.setData({ authorQuery: '', selectedAuthor: null, authorSuggestions: [] });
  },

  queryAuthorsDebounced: debounce(async function () {
    const q = (this.data.authorQuery || '').trim();
    if (!q) {
      this.setData({ authorSuggestions: [] });
      return;
    }
    try {
      const openid = getApp()?.globalData?.openid || '';
      const results = await searchAuthors(openid, q, 10);
      this.setData({ authorSuggestions: results });
    } catch (e) {
      this.setData({ authorSuggestions: [] });
    }
  }, 250),

  selectAuthor(e) {
    const author = e.currentTarget?.dataset?.author;
    if (!author?._id) return;
    this.setData({
      selectedAuthor: { _id: author._id, name: author.name, nameNorm: author.nameNorm },
      authorQuery: author.name,
      authorSuggestions: []
    });
  },

  clearSelectedAuthor() {
    this.setData({ selectedAuthor: null, authorQuery: '', authorSuggestions: [] });
  },

  async submit() {
    const bookId = this.data.bookId;
    const bookName = (this.data.bookName || '').trim();
    const authorInput = (this.data.authorQuery || '').trim();
    if (!bookId) return;
    if (!bookName) {
      wx.showToast({ title: '请先填写书名', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '保存中', mask: true });
    try {
      let authorId = '';
      let authorName = '';
      let authorNameNorm = '';

      if (authorInput) {
        const openid = getApp()?.globalData?.openid || '';
        let author = this.data.selectedAuthor;
        if (!author?._id) {
          author = await findOrCreateAuthor(openid, authorInput);
        }
        authorId = author._id;
        authorName = author.name;
        authorNameNorm = author.nameNorm;
      }

      await updateBookInfo(bookId, {
        bookName,
        authorId,
        authorName,
        authorNameNorm
      });

      wx.hideLoading();
      wx.showToast({ title: '已保存', icon: 'success', duration: 700 });
      wx.navigateBack();
    } catch (e) {
      wx.hideLoading();
      wx.showModal({
        title: '保存失败',
        content: e?.errMsg || e?.message || JSON.stringify(e),
        showCancel: false
      });
    }
  },

  cancel() {
    wx.navigateBack();
  }
});

