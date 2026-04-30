import { normalizeAuthorName } from '../../utils/author';
import { db, _, withOpenIdFilter } from '../../utils/db.js';
import { debounce, escapeRegExp, highlightText } from '../../utils/util.js';

Page({
  data: {
    isDark: false,
    searchQuery: '',
    searchLoading: false,
    placeholder: '搜书名 / 作者 / 笔记内容',
    resultsBooks: [],
    resultsNotes: [],
    resultsAuthors: []
  },

  onLoad(e) {
    this.setData({ isDark: getApp()?.globalData?.isDark || false });
    const q = String(e?.q || '').trim();
    if (q) {
      this.setData({ searchQuery: q });
      this.runSearch();
    }
  },

  onSearchInput(e) {
    const v = e?.detail?.value ?? '';
    this.setData({ searchQuery: v });
    this.searchDebounced();
  },

  onSearchConfirm() {
    this.runSearch();
  },

  searchDebounced: debounce(function () {
    this.runSearch();
  }, 250),

  async runSearch() {
    const q = (this.data.searchQuery || '').trim();
    if (!q) {
      this.setData({
        resultsBooks: [],
        resultsNotes: [],
        resultsAuthors: [],
        searchLoading: false
      });
      return;
    }

    this.setData({ searchLoading: true });
    try {
      const regContain = db.RegExp({ regexp: escapeRegExp(q), options: 'i' });
      const qNorm = normalizeAuthorName(q);
      const regPrefix = qNorm ? db.RegExp({ regexp: `^${escapeRegExp(qNorm)}`, options: '' }) : null;

      const [booksRes, notesRes, authorsByNormRes, authorsByNameRes] = await Promise.all([
        db
          .collection('books')
          .where(withOpenIdFilter({ bookName: regContain }))
          .limit(50)
          .field({ notes: false })
          .get(),
        db
          .collection('notes')
          .where(withOpenIdFilter({ text: regContain }))
          .orderBy('timestamp', 'desc')
          .limit(120)
          .field({ bookId: true, text: true, type: true, timestamp: true })
          .get(),
        regPrefix ? db.collection('authors').where(withOpenIdFilter({ nameNorm: regPrefix })).limit(50).get() : Promise.resolve({ data: [] }),
        db.collection('authors').where(withOpenIdFilter({ name: regContain })).limit(50).get()
      ]);

      const books = booksRes?.data || [];
      const notes = notesRes?.data || [];

      // 1) books section (bookName hits)
      const resultsBooks = books.map(b => ({
        _id: b._id,
        bookName: b.bookName,
        authorName: b.authorName,
        highlightedTitle: highlightText(b.bookName || '', q),
        type: 'book'
      }));

      // 2) notes section: group note hits by bookId, then fetch books if needed
      const noteGroups = new Map(); // bookId -> { count, topNotes: [] }
      for (const n of notes) {
        const bookId = String(n?.bookId || '').trim();
        const text = String(n?.text || '').trim();
        if (!bookId || !text) continue;
        const g = noteGroups.get(bookId) || { count: 0, topNotes: [], latestAt: 0 };
        g.count += 1;
        g.latestAt = Math.max(g.latestAt, Number(n?.timestamp || 0));
        if (g.topNotes.length < 2) {
          g.topNotes.push({
            type: n?.type || '',
            timestamp: n?.timestamp || 0,
            highlightedText: highlightText(text, q)
          });
        }
        noteGroups.set(bookId, g);
      }

      const booksById = new Map();
      for (const b of books) {
        if (b && b._id) booksById.set(b._id, b);
      }
      const missingIds = Array.from(noteGroups.keys()).filter((id) => !booksById.has(id));
      if (missingIds.length > 0) {
        const ids = missingIds.slice(0, 50);
        const moreBooksRes = await db
          .collection('books')
          .where(withOpenIdFilter({ _id: _.in(ids) }))
          .limit(50)
          .field({ notes: false })
          .get();
        for (const b of moreBooksRes?.data || []) {
          if (b && b._id) booksById.set(b._id, b);
        }
      }

      const resultsNotes = Array.from(noteGroups.entries())
        .map(([bookId, g]) => {
          const b = booksById.get(bookId);
          if (!b) return null;
          return {
            _id: b._id,
            bookName: b.bookName,
            authorName: b.authorName,
            highlightedTitle: highlightText(b.bookName || '', q),
            noteHitCount: g.count,
            noteHits: g.topNotes,
            latestAt: g.latestAt,
            type: 'book'
          };
        })
        .filter(Boolean)
        .sort((a, b) => Number(b.latestAt || 0) - Number(a.latestAt || 0))
        .slice(0, 50);

      // 3) authors section (dedupe by _id)
      const seenAuthors = new Set();
      const mergedAuthors = [];
      for (const it of [...(authorsByNormRes?.data || []), ...(authorsByNameRes?.data || [])]) {
        if (!it || !it._id) continue;
        if (seenAuthors.has(it._id)) continue;
        seenAuthors.add(it._id);
        mergedAuthors.push(it);
        if (mergedAuthors.length >= 50) break;
      }
      const resultsAuthors = mergedAuthors.map(it => ({
        _id: it._id,
        name: it.name,
        highlightedTitle: highlightText(it.name || '', q),
        type: 'author'
      }));

      this.setData({
        resultsBooks,
        resultsNotes,
        resultsAuthors,
        searchLoading: false
      });
    } catch (e) {
      this.setData({
        resultsBooks: [],
        resultsNotes: [],
        resultsAuthors: [],
        searchLoading: false
      });
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
