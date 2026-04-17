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

    this.setData({ loading: true });
    try {
      const regContain = db.RegExp({ regexp: escapeRegExp(q), options: 'i' });
      const res = await db
        .collection('books')
        .where({ bookName: regContain })
        .limit(50)
        .field({ notes: false })
        .get();
      this.setData({ results: res.data || [], loading: false });
    } catch (e) {
      this.setData({ results: [], loading: false });
    }
  }, 250),

  openBook(e) {
    const id = e.currentTarget?.dataset?.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/book/book?id=${id}` });
  }
});

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

