import {
  getPersonalizeSettings,
  savePersonalizeSettings
} from '../../utils/personalize';

const STORAGE_KEY = 'personalize_profile_v1';

function safeGetStorage(key) {
  try {
    return wx.getStorageSync(key);
  } catch (e) {
    return null;
  }
}

function safeSetStorage(key, value) {
  try {
    wx.setStorageSync(key, value);
  } catch (e) {}
}

function safeRemoveStorage(key) {
  try {
    wx.removeStorageSync(key);
  } catch (e) {}
}

Page({
  data: {
    enabled: false,
    profile: {},
    settings: getPersonalizeSettings(),
    defaultAvatar:
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#f3f4f6"/><circle cx="64" cy="52" r="22" fill="#cbd5e1"/><path d="M24 118c10-22 28-34 40-34s30 12 40 34" fill="#cbd5e1"/></svg>`
      ),
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const saved = safeGetStorage(STORAGE_KEY);
    const enabled = !!saved?.enabled;
    this.setData({
      enabled,
      profile: saved?.profile || {},
      settings: getPersonalizeSettings()
    });
  },

  updateSettings(patch) {
    const settings = savePersonalizeSettings(patch);
    this.setData({ settings });
    wx.showToast({ title: '已更新', icon: 'success', duration: 600 });
  },

  setHomeViewMode(e) {
    const mode = e?.currentTarget?.dataset?.mode;
    if (mode !== 'grid' && mode !== 'list') return;
    if (this.data.settings.homeViewMode === mode) return;
    this.updateSettings({ homeViewMode: mode });
  },

  setNoteTimeMode(e) {
    const mode = e?.currentTarget?.dataset?.mode;
    if (mode !== 'both' && mode !== 'relative' && mode !== 'absolute') return;
    if (this.data.settings.noteTimeMode === mode) return;
    this.updateSettings({ noteTimeMode: mode });
  },

  setSaveInputMode(e) {
    const mode = e?.currentTarget?.dataset?.mode;
    if (mode !== 'clear' && mode !== 'keep') return;
    if (this.data.settings.saveInputMode === mode) return;
    this.updateSettings({ saveInputMode: mode });
  },

  async enable() {
    try {
      const res = await wx.getUserProfile({
        desc: '用于在小程序内展示头像与昵称',
      });
      const profile = res?.userInfo || {};
      safeSetStorage(STORAGE_KEY, { enabled: true, profile, updatedAt: Date.now() });
      this.refresh();
      wx.showToast({ title: '已开启', icon: 'success', duration: 800 });
    } catch (e) {
      // 用户取消或接口不可用
      wx.showToast({ title: '未开启', icon: 'none', duration: 800 });
    }
  },

  async disable() {
    const { confirm } = await wx.showModal({
      title: '关闭头像与昵称？',
      content: '将清除本机保存的头像与昵称，不影响你的阅读数据。',
      confirmText: '关闭',
    });
    if (!confirm) return;
    safeRemoveStorage(STORAGE_KEY);
    this.refresh();
    wx.showToast({ title: '已关闭', icon: 'success', duration: 800 });
  },
});

