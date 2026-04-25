import { db, withOpenIdFilter } from '../../utils/db.js';
import { adminMe } from '../../services/adminService.js';

Page({
  data: {
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
    wx.navigateTo({ url: '/pages/search/search?type=book' });
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
      // 清空 recent_notes（否则首页会残留“最近记录”）
      while (true) {
        const res = await db.collection('recent_notes').where(withOpenIdFilter({})).limit(50).get();
        const items = res.data || [];
        if (items.length === 0) break;
        await Promise.all(items.map(it => db.collection('recent_notes').doc(it._id).remove()));
      }

      wx.hideLoading();
      wx.showToast({ title: '已清空', icon: 'success', duration: 900 });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '清空失败', icon: 'none' });
    }
  }
});