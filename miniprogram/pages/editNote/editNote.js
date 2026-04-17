import { db, withRetry } from '../../utils/db.js';

Page({
  data: {
    bookId: '',
    ts: 0,
    type: '',
    typeText: '编辑',
    text: '',
    saving: false
  },

  onLoad(options) {
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
      const res = await withRetry(() => db.collection('books').doc(bookId).get());
      const book = res.data;
      const notes = Array.isArray(book.notes) ? book.notes : [];
      const idx = notes.findIndex(n => Number(n.timestamp) === ts);
      if (idx < 0) {
        wx.showToast({ title: '找不到这条记录', icon: 'none' });
        this.setData({ saving: false });
        return;
      }
      notes[idx] = { ...notes[idx], text };
      const thoughtCount = notes.filter(n => n.type === 'thought').length;
      const quoteCount = notes.filter(n => n.type === 'quote').length;

      await db.collection('books').doc(bookId).update({ 
        data: { 
          notes, 
          notesCount: notes.length,
          thoughtCount,
          quoteCount 
        } 
      });
      wx.showToast({ title: '已保存', icon: 'success', duration: 700 });
      wx.navigateBack();
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  }
});

