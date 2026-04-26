import { adminListWishlistHot } from '../../services/adminService.js';

Page({
  data: {
    isDark: false,
    mode: 'top10', // top10 | all
    items: [],
    offset: 0,
    hasMore: false,
    loadingMore: false,
  },

  async onLoad() {
    this.setData({ isDark: getApp()?.globalData?.isDark || false });
    await this.refresh(true);
  },

  setMode(e) {
    const mode = e?.currentTarget?.dataset?.mode;
    if (mode !== 'top10' && mode !== 'all') return;
    if (mode === this.data.mode) return;
    this.setData({ mode });
    this.refresh(true);
  },

  async refresh(reset = false) {
    const mode = this.data.mode;
    const limit = mode === 'top10' ? 10 : 20;
    const offset = reset ? 0 : Number(this.data.offset || 0);
    if (!reset && this.data.loadingMore) return;

    if (reset) wx.showLoading({ title: '加载中', mask: true });
    this.setData({ loadingMore: true });
    try {
      const res = await adminListWishlistHot(offset, limit);
      const items = res.items || [];
      const next = reset ? items : [...(this.data.items || []), ...items];
      this.setData({
        items: next,
        offset: res.nextOffset || (offset + items.length),
        hasMore: mode === 'all' && (items.length >= limit),
        loadingMore: false
      });
      if (reset) wx.hideLoading();
    } catch (e) {
      this.setData({ loadingMore: false });
      if (reset) wx.hideLoading();
      if (reset) wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  loadMore() {
    if (!this.data.hasMore) return;
    return this.refresh(false);
  }
});

