import { adminMe, adminStats, adminListUsers, adminListTestDevices, adminResetTestUser, adminListFeedback } from '../../services/adminService.js';

Page({
  data: {
    stats: {
      registeredUsers: 0,
      booksReading: 0,
      booksFinished: 0,
      quoteTotal: 0,
      thoughtTotal: 0,
      aiGenerations: 0,
      wishlistTotal: 0,
      wishlistTop: []
    },
    users: [],
    offset: 0,
    hasMore: true,
    loadingMore: false,

    testDevices: [],
    testDeviceIndex: 0,
    confirmText: '',
    resetting: false,
    lastResetResult: null,

    testDeviceDisplayText: '',

    feedbackItems: [],
    feedbackOffset: 0,
    feedbackHasMore: true,
    feedbackLoadingMore: false,

    // 功能开关
    checkinEnabled: true,
  },

  async onLoad() {
    await this.guard();
    await this.loadTestDevices();
    await this.refresh();
    await this.loadFeedback(true);
    await this.loadAppConfig();
  },

  async loadAppConfig() {
    try {
      const res = await wx.cloud.callFunction({ name: 'adminPanel', data: { action: 'getAppConfig' } });
      const config = res?.result?.config || {};
      this.setData({ checkinEnabled: config.checkinEnabled !== false });
    } catch (e) {
      // ignore
    }
  },

  async onToggleCheckin(e) {
    const checkinEnabled = !!e.detail.value;
    this.setData({ checkinEnabled });
    try {
      await wx.cloud.callFunction({
        name: 'adminPanel',
        data: { action: 'setAppConfig', checkinEnabled }
      });
      wx.showToast({ title: '已更新', icon: 'success', duration: 600 });
    } catch (e) {
      wx.showToast({ title: '更新失败', icon: 'none' });
      // 回滚
      this.setData({ checkinEnabled: !checkinEnabled });
    }
  },

  goHotWishlist() {
    wx.navigateTo({ url: '/pages/adminWishlist/adminWishlist' });
  },

  formatTs(ts) {
    const n = Number(ts || 0);
    if (!n) return '';
    const d = new Date(n);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  async guard() {
    try {
      const me = await adminMe();
      if (!me?.isAdmin) {
        wx.showModal({
          title: '无权限',
          content: '当前账号不是管理员。',
          showCancel: false
        });
        wx.navigateBack();
      }
    } catch (e) {
      wx.showModal({
        title: '加载失败',
        content: e?.message || e?.errMsg || String(e),
        showCancel: false
      });
      wx.navigateBack();
    }
  },

  async loadTestDevices() {
    try {
      const res = await adminListTestDevices();
      const devices = Array.isArray(res?.devices) ? res.devices : [];
      this.setData({ testDevices: devices, testDeviceIndex: 0 });
      this.updateTestDeviceDisplayText(0, devices);
    } catch (e) {
      this.setData({ testDevices: [] });
    }
  },

  updateTestDeviceDisplayText(index, devices) {
    const list = Array.isArray(devices) ? devices : (this.data.testDevices || []);
    const idx = Math.max(0, Math.min(list.length - 1, Number(index || 0)));
    const d = list[idx] || null;
    const label = String(d?.label || '未命名');
    const openid = String(d?.openid || '');
    const suffix = openid ? openid.slice(-6) : '';
    const text = openid ? `${label}（${suffix}）` : '';
    this.setData({ testDeviceDisplayText: text });
  },

  async refresh() {
    wx.showLoading({ title: '加载中', mask: true });
    try {
      const [s, u] = await Promise.all([
        adminStats(),
        adminListUsers(0, 20)
      ]);
      wx.hideLoading();
      const users = (u.users || []).map((it) => ({
        ...it,
        userNo: it.userNo || '-',
        nickname: it.nickname || '未命名',
      }));
      this.setData({
        stats: s.stats || {
          registeredUsers: 0,
          booksReading: 0,
          booksFinished: 0,
          quoteTotal: 0,
          thoughtTotal: 0,
          aiGenerations: 0,
          wishlistTotal: 0,
          wishlistTop: []
        },
        users,
        offset: u.nextOffset || 0,
        hasMore: users.length >= 20
      });
    } catch (e) {
      wx.hideLoading();
      wx.showModal({
        title: '加载失败',
        content: e?.message || e?.errMsg || String(e),
        showCancel: false
      });
    }
  },

  async loadMore() {
    if (this.data.loadingMore || !this.data.hasMore) return;
    this.setData({ loadingMore: true });
    try {
      const res = await adminListUsers(this.data.offset, 20);
      const more = (res.users || []).map((it) => ({
        ...it,
        userNo: it.userNo || '-',
        nickname: it.nickname || '未命名',
      }));
      const next = [...(this.data.users || []), ...more];
      this.setData({
        users: next,
        offset: res.nextOffset || this.data.offset,
        hasMore: more.length >= 20,
        loadingMore: false
      });
    } catch (e) {
      this.setData({ loadingMore: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  }
  ,

  onPickTestDevice(e) {
    const idx = Number(e?.detail?.value || 0);
    if (!Number.isFinite(idx)) return;
    this.setData({ testDeviceIndex: idx, lastResetResult: null });
    this.updateTestDeviceDisplayText(idx);
  },

  onConfirmInput(e) {
    this.setData({ confirmText: String(e?.detail?.value ?? ''), lastResetResult: null });
  },

  async resetSelectedTestUser() {
    if (this.data.resetting) return;
    const confirmText = String(this.data.confirmText || '').trim();
    if (confirmText !== 'DELETE') {
      wx.showToast({ title: '请输入 DELETE', icon: 'none' });
      return;
    }

    const devices = this.data.testDevices || [];
    const d = devices[this.data.testDeviceIndex] || null;
    const openid = String(d?.openid || '').trim();
    if (!openid) {
      wx.showToast({ title: '请选择测试设备', icon: 'none' });
      return;
    }

    const confirm1 = await wx.showModal({
      title: '重置测试账号？',
      content: `将删除该 openid 的 users/books/wishlist/recent_notes 数据。此操作不可恢复。`,
      confirmText: '确认重置',
      confirmColor: '#C07D6B'
    });
    if (!confirm1.confirm) return;

    this.setData({ resetting: true });
    wx.showLoading({ title: '重置中', mask: true });
    try {
      const res = await adminResetTestUser(openid, 'DELETE');
      wx.hideLoading();
      this.setData({ resetting: false, lastResetResult: res?.counts || null, confirmText: '' });
      wx.showToast({ title: '已重置', icon: 'success' });
      await this.refresh();
    } catch (e) {
      wx.hideLoading();
      this.setData({ resetting: false });
      const msg = e?.message || e?.errMsg || String(e);
      wx.showModal({ title: '重置失败', content: msg, showCancel: false });
    }
  }
  ,

  async loadFeedback(reset = false) {
    if (this.data.feedbackLoadingMore) return;
    if (!reset && !this.data.feedbackHasMore) return;

    const offset = reset ? 0 : Number(this.data.feedbackOffset || 0);
    const limit = 20;
    this.setData({ feedbackLoadingMore: true });
    try {
      const res = await adminListFeedback(offset, limit);
      const items = (res.items || []).map((it) => ({
        ...it,
        content: it.content || '',
        createdText: this.formatTs(it.createdAt)
      }));
      const next = reset ? items : [...(this.data.feedbackItems || []), ...items];
      this.setData({
        feedbackItems: next,
        feedbackOffset: res.nextOffset || (offset + items.length),
        feedbackHasMore: items.length >= limit,
        feedbackLoadingMore: false
      });
    } catch (e) {
      this.setData({ feedbackLoadingMore: false });
      if (reset) this.setData({ feedbackItems: [] });
    }
  },

  loadMoreFeedback() {
    return this.loadFeedback(false);
  },

});

