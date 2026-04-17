const db = wx.cloud.database();

const MOTTO = '以书为伴，不慌不忙，做个有态度的阅读者✨';

Page({
  data: {
    version: '0.1.0',
    motto: MOTTO
  },

  onShow() {
    // 这里先固定版本号，后续如果你希望自动读取 package.json 再做
  },

  goWishlist() {
    wx.navigateTo({ url: '/pages/wishlist/wishlist' });
  },

  goAuthorSearch() {
    wx.navigateTo({ url: '/pages/authorSearch/authorSearch' });
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