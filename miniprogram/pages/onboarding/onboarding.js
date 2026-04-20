const ONBOARDING_DISMISSED_KEY = '_onboarding_v1_dismissed';

Page({
  onStart() {
    wx.setStorageSync(ONBOARDING_DISMISSED_KEY, '1');
    wx.redirectTo({ url: '/pages/createBook/createBook' });
  },

  onSkip() {
    // Do not mark dismissed; user still has no books.
    wx.redirectTo({ url: '/pages/emptyShelf/emptyShelf' });
  }
});

