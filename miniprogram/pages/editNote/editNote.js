import { editNote } from '../../services/noteService.js';

Page({
  data: {
    isDark: false,
    bookId: '',
    ts: 0,
    type: '',
    typeText: '编辑',
    text: '',
    saving: false
  },

  onLoad(options) {
    this.setData({ isDark: getApp()?.globalData?.isDark || false });
    const bookId = options.bookId || '';
    const ts = Number(options.ts || 0);
    const type = options.type || '';
    const text = decodeURIComponent(options.text || '');
    const typeText = type === 'quote' ? '金句' : '心得';

    this.setData({ bookId, ts, type, typeText, text });
  },

  onInput(e) {
    this.setData({ text: e.detail.value });
  },

  async save() {
    const { bookId, ts } = this.data;
    const text = (this.data.text || '').trim();
    if (!bookId || !ts) return;
    if (!text) {
      wx.showToast({ title: '内容不能为空', icon: 'none' });
      return;
    }
    if (this.data.saving) return;
    this.setData({ saving: true });

    try {
      await editNote(bookId, ts, text);
      wx.showToast({ title: '已保存', icon: 'success', duration: 700 });
      wx.navigateBack();
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  }
});

