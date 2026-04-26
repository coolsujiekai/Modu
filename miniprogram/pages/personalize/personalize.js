import {
  getPersonalizeSettings,
  savePersonalizeSettings
} from '../../utils/personalize';
import { getThemeMode, setThemeMode } from '../../utils/theme.js';

Page({
  data: {
    isDark: false,
    settings: getPersonalizeSettings(),
    themeMode: getThemeMode(),
  },

  onShow() {
    this.setData({ isDark: getApp()?.globalData?.isDark || false });
    this.setData({
      settings: getPersonalizeSettings(),
      themeMode: getThemeMode(),
    });
  },

  updateSettings(patch) {
    const settings = savePersonalizeSettings(patch);
    this.setData({ settings });
    wx.showToast({ title: '已更新', icon: 'success', duration: 600 });
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

  setShareTemplate(e) {
    const templateId = e?.currentTarget?.dataset?.template;
    if (!['nebula', 'paper', 'sunset'].includes(templateId)) return;
    if (this.data.settings.shareTemplateId === templateId) return;
    this.updateSettings({
      shareTemplateId: templateId,
      shareFirstRunConfigured: true
    });
  },

  setTheme(e) {
    const mode = e?.currentTarget?.dataset?.mode;
    if (mode !== 'auto' && mode !== 'light' && mode !== 'dark') return;
    if (this.data.themeMode === mode) return;
    setThemeMode(mode);
    this.setData({ themeMode: mode });
    wx.showToast({ title: mode === 'dark' ? '已切换深色' : mode === 'light' ? '已切换浅色' : '跟随系统', icon: 'success', duration: 800 });
  },
});
