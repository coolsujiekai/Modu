import {
  getPersonalizeSettings,
  savePersonalizeSettings
} from '../../utils/personalize';

Page({
  data: {
    settings: getPersonalizeSettings(),
  },

  onShow() {
    this.setData({ settings: getPersonalizeSettings() });
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
});
