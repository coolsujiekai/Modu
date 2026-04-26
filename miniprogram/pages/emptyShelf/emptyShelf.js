Page({
  onLoad() {
    this.setData({ isDark: getApp()?.globalData?.isDark || false });
    // Show only once (even if user just browses).
    wx.setStorageSync('_empty_shelf_v1_seen', '1');
  },

  onCreateBook() {
    wx.redirectTo({ url: '/pages/createBook/createBook' });
  },

  onBackToOnboarding() {
    wx.redirectTo({ url: '/pages/onboarding/onboarding' });
  }
});