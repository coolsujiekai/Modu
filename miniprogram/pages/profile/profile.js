import { normalizeAuthorName } from '../../utils/author';

const db = wx.cloud.database();

const MOTTO = '以书为伴，不慌不忙，做个有态度的阅读者✨';

function debounce(fn, wait) {
  let t = null;
  return function (...args) {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

function escapeRegExp(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

Page({
  data: {
    version: '0.1.0',
    motto: MOTTO,

    searchVisible: false,
    searchType: 'book',
    searchTitle: '',
    searchPlaceholder: '',
    searchQuery: '',
    searchLoading: false,
    searchResults: []
  },

  onShow() {
    // 这里先固定版本号，后续如果你希望自动读取 package.json 再做
  },

  goWishlist() {
    wx.navigateTo({ url: '/pages/wishlist/wishlist' });
  },

  openBookSearch() {
    this.openSearch('book');
  },

  openAuthorSearch() {
    this.openSearch('author');
  },

  openSearch(type) {
    const isBook = type === 'book';
    this.setData({
      searchVisible: true,
      searchType: isBook ? 'book' : 'author',
      searchTitle: isBook ? '书名搜索' : '作家搜索',
      searchPlaceholder: isBook ? '输入书名关键字' : '输入作者名',
      searchQuery: '',
      searchLoading: false,
      searchResults: []
    });
  },

  closeSearch() {
    this.setData({
      searchVisible: false,
      searchQuery: '',
      searchLoading: false,
      searchResults: []
    });
  },

  clearSearch() {
    this.setData({ searchQuery: '', searchResults: [], searchLoading: false });
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
      this.setData({ searchResults: [], searchLoading: false });
      return;
    }

    this.setData({ searchLoading: true });
    try {
      if (this.data.searchType === 'book') {
        const regContain = db.RegExp({ regexp: escapeRegExp(q), options: 'i' });
        const res = await db
          .collection('books')
          .where({ bookName: regContain })
          .limit(50)
          .field({ notes: false })
          .get();
        this.setData({ searchResults: res.data || [], searchLoading: false });
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
        db.collection('authors').where({ nameNorm: regPrefix }).limit(50).get(),
        db.collection('authors').where({ name: regContain }).limit(50).get()
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
      this.setData({ searchResults: merged, searchLoading: false });
    } catch (e) {
      this.setData({ searchResults: [], searchLoading: false });
    }
  },

  onPickResult(e) {
    const id = e?.currentTarget?.dataset?.id;
    if (!id) return;
    const type = e?.currentTarget?.dataset?.type;
    if (type === 'book') {
      this.closeSearch();
      wx.navigateTo({ url: `/pages/book/book?id=${id}` });
      return;
    }
    const name = e?.currentTarget?.dataset?.name || '';
    this.closeSearch();
    wx.navigateTo({ url: `/pages/author/author?id=${id}&name=${encodeURIComponent(name)}` });
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  goPersonalize() {
    wx.navigateTo({ url: '/pages/personalize/personalize' });
  },

  async openDangerZone() {
    try {
      const res = await wx.showActionSheet({
        itemList: ['清空书单', '清空所有数据'],
        alertText: '危险操作不可恢复，请谨慎。'
      });
      if (res.tapIndex === 0) {
        this.clearWishlist();
      } else if (res.tapIndex === 1) {
        this.clearAllData();
      }
    } catch (e) {
      // 用户取消
    }
  },

  async clearWishlist() {
    const confirm = await wx.showModal({
      title: '清空书单？',
      content: '将删除你“书单”里的所有条目，此操作不可恢复。',
      confirmColor: '#fa5151',
      confirmText: '确认清空'
    });
    if (!confirm.confirm) return;

    wx.showLoading({ title: '清空中', mask: true });
    try {
      // 分页删除（每次最多20条）
      while (true) {
        const res = await db.collection('wishlist').limit(20).get();
        const items = res.data || [];
        if (items.length === 0) break;
        await Promise.all(items.map(it => db.collection('wishlist').doc(it._id).remove()));
      }
      wx.hideLoading();
      wx.showToast({ title: '书单已清空', icon: 'success', duration: 900 });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '清空失败', icon: 'none' });
    }
  },

  async clearAllData() {
    const confirm1 = await wx.showModal({
      title: '⚠️ 清空所有数据',
      content: '将删除：在读、已读、书单、以及每本书的所有记录。不可恢复。',
      confirmColor: '#fa5151',
      confirmText: '继续'
    });
    if (!confirm1.confirm) return;

    const confirm2 = await wx.showModal({
      title: '最后确认',
      content: '真的要清空所有数据吗？建议先截图/复制重要内容备份。',
      confirmColor: '#fa5151',
      confirmText: '确认清空'
    });
    if (!confirm2.confirm) return;

    wx.showLoading({ title: '清空中', mask: true });
    try {
      // 清空 books
      while (true) {
        const res = await db.collection('books').limit(20).get();
        const items = res.data || [];
        if (items.length === 0) break;
        await Promise.all(items.map(it => db.collection('books').doc(it._id).remove()));
      }
      // 清空 wishlist
      while (true) {
        const res = await db.collection('wishlist').limit(20).get();
        const items = res.data || [];
        if (items.length === 0) break;
        await Promise.all(items.map(it => db.collection('wishlist').doc(it._id).remove()));
      }

      wx.hideLoading();
      wx.showToast({ title: '已清空', icon: 'success', duration: 900 });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '清空失败', icon: 'none' });
    }
  }
});