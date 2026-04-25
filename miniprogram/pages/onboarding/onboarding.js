const ONBOARDING_DISMISSED_KEY = '_onboarding_v1_dismissed';

Page({
  onLoad() {
    // Show only once (even if user just browses).
    wx.setStorageSync('_onboarding_v1_seen', '1');
  },

  onStart() {
    wx.setStorageSync(ONBOARDING_DISMISSED_KEY, '1');
    wx.redirectTo({ url: '/pages/createBook/createBook' });
  },

  onSkip() {
    wx.redirectTo({ url: '/pages/index/index' });
  }
});

