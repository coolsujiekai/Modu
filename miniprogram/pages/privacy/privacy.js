Page({
  onLoad() {
    this.setData({ isDark: getApp()?.globalData?.isDark || false });
  },

  data: {
    isDark: false,},
});

