import { db, _, withRetry } from '../../utils/db.js';
import { formatDate } from '../../utils/util.js';

function normalizeType(type) {
  return type === 'quote' ? 'quote' : 'thought';
}

function typeToText(type) {
  return type === 'quote' ? '金句' : '心得';
}

Page({
  data: {
    loading: true,
    bookId: '',
    type: 'thought',
    typeText: '心得',
    book: null,
    notes: []
  },

  onLoad(options) {
    const bookId = options.bookId || '';
    const type = normalizeType(options.type || '');
    const typeText = typeToText(type);
    this.setData({ bookId, type, typeText });
    wx.setNavigationBarTitle({ title: `翻书随手记 · ${typeText}` });
  },

  onShow() {
    this.loadNotes();
  },

  onPullDownRefresh() {
    this.loadNotes().finally(() => wx.stopPullDownRefresh());
  },

  async loadNotes() {
    const { bookId, type } = this.data;
    if (!bookId) {
      this.setData({ loading: false, book: null, notes: [] });
      return;
    }

    this.setData({ loading: true });
    try {
      const res = await withRetry(() => db.collection('books').doc(bookId).get());
      const book = res.data;
      const all = Array.isArray(book.notes) ? book.notes : [];
      const notes = all
        .filter(n => n && n.type === type)
        .slice()
        .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
        .map(n => ({
          ...n,
          timeText: formatDate(n.timestamp)
        }));
      this.setData({ loading: false, book, notes });
    } catch (e) {
      this.setData({ loading: false, book: null, notes: [] });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  copyNote(e) {
    const text = e.currentTarget?.dataset?.text;
    if (!text) return;
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制', duration: 600 })
    });
  },

  editNote(e) {
    const ts = Number(e.currentTarget?.dataset?.ts);
    if (!ts) return;
    const idx = this.data.notes.findIndex(n => Number(n.timestamp) === ts);
    if (idx < 0) return;
    const note = this.data.notes[idx];
    const text = encodeURIComponent(note.text || '');
    wx.navigateTo({
      url: `/pages/editNote/editNote?bookId=${this.data.bookId}&ts=${ts}&type=${note.type}&text=${text}`
    });
  },

  async openNoteMore(e) {
    const ts = Number(e.currentTarget?.dataset?.ts || 0);
    const text = e.currentTarget?.dataset?.text || '';
    if (!ts) return;
    try {
      const res = await wx.showActionSheet({
        itemList: ['复制', '删除']
      });
      if (res.tapIndex === 0) {
        this.copyNote({ currentTarget: { dataset: { text } } });
        return;
      }
      if (res.tapIndex === 1) {
        this.deleteNote({ currentTarget: { dataset: { ts } } });
      }
    } catch (err) {
      // canceled
    }
  },

  async deleteNote(e) {
    const ts = Number(e.currentTarget?.dataset?.ts);
    if (!ts) return;
    const confirm = await wx.showModal({
      title: '删除这条记录？',
      content: '删除后不可恢复',
      confirmColor: '#C07D6B',
      confirmText: '删除'
    });
    if (!confirm.confirm) return;

    const { bookId } = this.data;
    wx.showLoading({ title: '删除中', mask: true });
    try {
      const res = await withRetry(() => db.collection('books').doc(bookId).get());
      const book = res.data;
      const all = Array.isArray(book.notes) ? book.notes : [];
      const idx = all.findIndex(n => Number(n.timestamp) === ts);
      if (idx < 0) {
        wx.hideLoading();
        wx.showToast({ title: '找不到这条记录', icon: 'none' });
        return;
      }
      const newNotes = all.slice();
      newNotes.splice(idx, 1);
      const thoughtCount = newNotes.filter(n => n.type === 'thought').length;
      const quoteCount = newNotes.filter(n => n.type === 'quote').length;
      await db.collection('books').doc(bookId).update({
        data: {
          notes: newNotes,
          notesCount: newNotes.length,
          thoughtCount,
          quoteCount
        }
      });
      wx.hideLoading();
      wx.showToast({ title: '已删除', icon: 'success', duration: 700 });
      this.loadNotes();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '删除失败', icon: 'none' });
    }
  }
});

