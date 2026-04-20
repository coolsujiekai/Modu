import { debounce } from '../../utils/util.js';
import { createBook } from '../../services/bookService.js';
import { findOrCreateAuthor, searchAuthors } from '../../services/authorService.js';

Page({
  data: {
    bookName: '',
    authorQuery: '',
    authorSuggestions: [],
    selectedAuthor: null
  },

  onBookNameInput(e) {
    this.setData({ bookName: e.detail.value });
  },

  onAuthorInput(e) {
    const authorQuery = e.detail.value;
    this.setData({ authorQuery, selectedAuthor: null });
    this.queryAuthorsDebounced();
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
    const bookName = (this.data.bookName || '').trim();
    const authorInput = (this.data.authorQuery || '').trim();
    if (!bookName) {
      wx.showToast({ title: '请先填写书名', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '创建中', mask: true });
    try {
      const openid = getApp()?.globalData?.openid || '';
      let author = this.data.selectedAuthor;
      if (authorInput) {
        if (!author?._id) {
          author = await findOrCreateAuthor(openid, authorInput);
        }
      }
      const bookId = await createBook({
        bookName,
        authorId: author?._id || '',
        authorName: author?.name || (authorInput || ''),
        authorNameNorm: author?.nameNorm || ''
      });

      wx.hideLoading();
      wx.showToast({ title: '开读！', icon: 'success', duration: 700 });
      wx.redirectTo({ url: `/pages/book/book?id=${bookId}` });
    } catch (e) {
      wx.hideLoading();
      wx.showModal({
        title: '创建失败',
        content: e?.errMsg || e?.message || JSON.stringify(e),
        showCancel: false
      });
    }
  },

  cancel() {
    wx.navigateBack();
  }
});

