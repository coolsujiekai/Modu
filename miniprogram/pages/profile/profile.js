import { normalizeAuthorName } from '../../utils/author';
import { db, withOpenIdFilter } from '../../utils/db.js';
import { debounce, escapeRegExp, highlightText } from '../../utils/util.js';
import { adminMe } from '../../services/adminService.js';

Page({
  data: {
    searchVisible: false,
    searchType: 'book',
    searchTitle: '',
    searchPlaceholder: '',
    searchQuery: '',
    searchLoading: false,
    searchResults: [],
    isAdmin: false
  },

  onShow() {
    this.checkAdmin();
  },

  async checkAdmin() {
    try {
      const res = await adminMe();
      this.setData({ isAdmin: !!res?.isAdmin });
    } catch (e) {
      this.setData({ isAdmin: false });
    }
  },

  goWishlist() {
    wx.navigateTo({ url: '/pages/wishlist/wishlist' });
  },

  openShelfSearch() {
    this.openSearch('book');
  },

  openSearch(type) {
    const isBook = type === 'book';
    this.setData({
      searchVisible: true,
      searchType: isBook ? 'book' : 'author',
      searchTitle: '书架搜索',
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

  switchSearchType(e) {
    const type = e?.detail?.type || e?.currentTarget?.dataset?.type;
    if (type !== 'book' && type !== 'author') return;
    if (type === this.data.searchType) return;
    this.setData({
      searchType: type,
      searchPlaceholder: type === 'book' ? '输入书名关键字' : '输入作者名',
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
    const dataset = e?.currentTarget?.dataset || e?.detail || {};
    const id = dataset.id;
    if (!id) return;
    const type = dataset.type;
    if (type === 'book') {
      this.closeSearch();
      wx.navigateTo({ url: `/pages/book/book?id=${id}` });
      return;
    }
    const name = dataset.name || '';
    this.closeSearch();
    wx.navigateTo({ url: `/pages/author/author?id=${id}&name=${encodeURIComponent(name)}` });
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  goPersonalize() {
    wx.navigateTo({ url: '/pages/personalize/personalize' });
  },

  goUserProfile() {
    wx.navigateTo({ url: '/pages/userProfile/userProfile' });
  },

  goAdmin() {
    wx.navigateTo({ url: '/pages/admin/admin' });
  },

  goFeedback() {
    wx.navigateTo({ url: '/pages/feedback/feedback' });
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
      confirmColor: '#C07D6B',
      confirmText: '确认清空'
    });
    if (!confirm.confirm) return;

    wx.showLoading({ title: '清空中', mask: true });
    try {
      // 分页删除（每次最多20条），使用 openid 过滤确保仅清理当前用户数据
      while (true) {
        const res = await db.collection('wishlist').where(withOpenIdFilter({})).limit(20).get();
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
      confirmColor: '#C07D6B',
      confirmText: '继续'
    });
    if (!confirm1.confirm) return;

    const confirm2 = await wx.showModal({
      title: '最后确认',
      content: '真的要清空所有数据吗？建议先截图/复制重要内容备份。',
      confirmColor: '#C07D6B',
      confirmText: '确认清空'
    });
    if (!confirm2.confirm) return;

    wx.showLoading({ title: '清空中', mask: true });
    try {
      // 清空 books
      while (true) {
        const res = await db.collection('books').where(withOpenIdFilter({})).limit(20).get();
        const items = res.data || [];
        if (items.length === 0) break;
        await Promise.all(items.map(it => db.collection('books').doc(it._id).remove()));
      }
      // 清空 wishlist
      while (true) {
        const res = await db.collection('wishlist').where(withOpenIdFilter({})).limit(20).get();
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