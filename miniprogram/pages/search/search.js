import { normalizeAuthorName } from '../../utils/author';
import { db, withOpenIdFilter } from '../../utils/db.js';
import { debounce, escapeRegExp, highlightText } from '../../utils/util.js';

Page({
  data: {
    isDark: false,
    searchType: 'book',
    searchQuery: '',
    searchLoading: false,
    searchResults: []
  },

  onLoad(e) {
    const type = e?.type || 'book';
    const isBook = type === 'book';
    this.setData({
      searchType: isBook ? 'book' : 'author',
      placeholder: isBook ? '输入书名关键字' : '输入作者名'
    });
  },

  onSearchInput(e) {
    const v = e?.detail?.value ?? '';
    this.setData({ searchQuery: v });
    this.searchDebounced();
  },

  onSearchConfirm() {
    this.runSearch();
  },

  switchSearchType(e) {
    const type = e?.currentTarget?.dataset?.type;
    if (type !== 'book' && type !== 'author') return;
    if (type === this.data.searchType) return;
    this.setData({
      searchType: type,
      placeholder: type === 'book' ? '输入书名关键字' : '输入作者名',
      searchResults: [],
      searchLoading: false
    });
    this.searchDebounced();
  },

  searchDebounced: debounce(function () {
    this.runSearch();
  }, 250),

  async runSearch() {
    const q = (this.data.searchQuery || '').trim();
    if (!q) {
      this.setData({ searchResults: [], searchLoading: false });
      return;
    }

    this.setData({ searchLoading: true });
    try {
      if (this.data.searchType === 'book') {
        const regContain = db.RegExp({ regexp: escapeRegExp(q), options: 'i' });
        const res = await db
          .collection('books')
          .where(withOpenIdFilter({ bookName: regContain }))
          .limit(50)
          .field({ notes: false })
          .get();
        const results = (res.data || []).map(b => ({
          ...b,
          highlightedTitle: highlightText(b.bookName || '', q)
        }));
        this.setData({ searchResults: results, searchLoading: false });
        return;
      }

      const qNorm = normalizeAuthorName(q);
      if (!qNorm) {
        this.setData({ searchResults: [], searchLoading: false });
        return;
      }
      const regPrefix = db.RegExp({ regexp: `^${escapeRegExp(qNorm)}`, options: '' });
      const regContain = db.RegExp({ regexp: escapeRegExp(q), options: 'i' });
      const [byNorm, byName] = await Promise.all([
        db.collection('authors').where(withOpenIdFilter({ nameNorm: regPrefix })).limit(50).get(),
        db.collection('authors').where(withOpenIdFilter({ name: regContain })).limit(50).get()
      ]);

      const seen = new Set();
      const merged = [];
      for (const it of [...(byNorm.data || []), ...(byName.data || [])]) {
        if (!it || !it._id) continue;
        if (seen.has(it._id)) continue;
        seen.add(it._id);
        merged.push(it);
        if (merged.length >= 50) break;
      }
      const results = merged.map(it => ({
        ...it,
        highlightedTitle: highlightText(it.name || '', q)
      }));
      this.setData({ searchResults: results, searchLoading: false });
    } catch (e) {
      this.setData({ searchResults: [], searchLoading: false });
    }
  },

  onPickResult(e) {
    const dataset = e?.currentTarget?.dataset || {};
    const id = dataset.id;
    if (!id) return;
    const type = dataset.type;
    if (type === 'book') {
      wx.navigateTo({ url: `/pages/book/book?id=${id}` });
      return;
    }
    const name = dataset.name || '';
    wx.navigateTo({ url: `/pages/author/author?id=${id}&name=${encodeURIComponent(name)}` });
  }
});
