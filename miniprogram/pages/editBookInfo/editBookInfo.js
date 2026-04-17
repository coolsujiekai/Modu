import { normalizeAuthorName, buildAuthorTokens } from '../../utils/author';

const db = wx.cloud.database();

function debounce(fn, wait) {
  let t = null;
  return function (...args) {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

Page({
  data: {
    bookId: '',
    bookName: '',
    authorQuery: '',
    authorSuggestions: [],
    selectedAuthor: null
  },

  async onLoad(options) {
    const bookId = options.id || '';
    this.setData({ bookId });
    if (!bookId) return;

    wx.showLoading({ title: '加载中' });
    try {
      const res = await db.collection('books').doc(bookId).get();
      const book = res.data || {};
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

    const qNorm = normalizeAuthorName(q);
    if (!qNorm) {
      this.setData({ authorSuggestions: [] });
      return;
    }

    try {
      const regPrefix = db.RegExp({ regexp: `^${escapeRegExp(qNorm)}`, options: '' });
      const regContain = db.RegExp({ regexp: escapeRegExp(q), options: 'i' });

      const [byNorm, byName] = await Promise.all([
        db.collection('authors').where({ nameNorm: regPrefix }).limit(10).get(),
        db.collection('authors').where({ name: regContain }).limit(10).get()
      ]);

      const merged = [];
      const seen = new Set();
      for (const it of [...(byNorm.data || []), ...(byName.data || [])]) {
        if (!it || !it._id) continue;
        if (seen.has(it._id)) continue;
        seen.add(it._id);
        merged.push(it);
        if (merged.length >= 10) break;
      }
      this.setData({ authorSuggestions: merged });
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
      const data = { bookName };

      if (!authorInput) {
        // author is optional
        data.authorId = '';
        data.authorName = '';
        data.authorNameNorm = '';
      } else {
        let author = this.data.selectedAuthor;
        const authorNorm = normalizeAuthorName(authorInput);
        if (!authorNorm) throw new Error('invalid author');

        const exactRes = await db.collection('authors').where({ nameNorm: authorNorm }).limit(1).get();
        if (exactRes.data && exactRes.data[0]) {
          const a = exactRes.data[0];
          author = { _id: a._id, name: a.name, nameNorm: a.nameNorm };
        } else if (!author?._id) {
          const now = Date.now();
          const addRes = await db.collection('authors').add({
            data: {
              name: authorInput,
              nameNorm: authorNorm,
              tokens: buildAuthorTokens(authorNorm),
              aliases: [],
              createdAt: now,
              updatedAt: now
            }
          });
          author = { _id: addRes._id, name: authorInput, nameNorm: authorNorm };
        }

        data.authorId = author._id;
        data.authorName = author.name;
        data.authorNameNorm = author.nameNorm;
      }

      await db.collection('books').doc(bookId).update({ data });
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

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

