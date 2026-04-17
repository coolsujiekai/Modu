import { normalizeAuthorName } from '../../utils/author';

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
    query: '',
    loading: false,
    results: []
  },

  onInput(e) {
    const query = e.detail.value;
    this.setData({ query });
    this.searchDebounced();
  },

  clear() {
    this.setData({ query: '', results: [] });
  },

  searchDebounced: debounce(async function () {
    const q = (this.data.query || '').trim();
    if (!q) {
      this.setData({ results: [], loading: false });
      return;
    }
    const qNorm = normalizeAuthorName(q);
    if (!qNorm) {
      this.setData({ results: [], loading: false });
      return;
    }

    this.setData({ loading: true });
    try {
      const regPrefix = db.RegExp({ regexp: `^${escapeRegExp(qNorm)}`, options: '' });
      const regContain = db.RegExp({ regexp: escapeRegExp(q), options: 'i' });
      const [byNorm, byName] = await Promise.all([
        db.collection('authors').where({ nameNorm: regPrefix }).limit(20).get(),
        db.collection('authors').where({ name: regContain }).limit(20).get()
      ]);

      const seen = new Set();
      const merged = [];
      for (const it of [...(byNorm.data || []), ...(byName.data || [])]) {
        if (!it || !it._id) continue;
        if (seen.has(it._id)) continue;
        seen.add(it._id);
        merged.push(it);
        if (merged.length >= 20) break;
      }
      this.setData({ results: merged, loading: false });
    } catch (err) {
      this.setData({ results: [], loading: false });
    }
  }, 250),

  openAuthor(e) {
    const id = e.currentTarget?.dataset?.id;
    const name = e.currentTarget?.dataset?.name || '';
    if (!id) return;
    wx.navigateTo({ url: `/pages/author/author?id=${id}&name=${encodeURIComponent(name)}` });
  }
});

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

