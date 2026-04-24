import { db, withRetry } from '../../utils/db.js';

Page({
  data: {
    content: '',
    saving: false,
  },

  onInput(e) {
    this.setData({ content: String(e?.detail?.value ?? '') });
  },

  async submit() {
    if (this.data.saving) return;
    const content = String(this.data.content || '').trim();
    if (!content) {
      wx.showToast({ title: '请先写点内容', icon: 'none' });
      return;
    }

    this.setData({ saving: true });
    wx.showLoading({ title: '发送中', mask: true });
    try {
      await withRetry(() =>
        db.collection('feedback').add({
          data: {
            content,
            createdAt: Date.now(),
            device: ''
          }
        })
      );
      wx.hideLoading();
      wx.showToast({ title: '已发送', icon: 'success', duration: 800 });
      this.setData({ content: '', saving: false });
      wx.navigateBack();
    } catch (e) {
      wx.hideLoading();
      this.setData({ saving: false });
      wx.showModal({
        title: '发送失败',
        content: e?.message || e?.errMsg || String(e),
        showCancel: false
      });
    }
  }
});

