import { db, _, withRetry } from '../../utils/db.js';
import { formatDate } from '../../utils/util.js';
import { getPersonalizeSettings } from '../../utils/personalize';
import { formatNoteTime, addNote as addNoteToCloud, deleteNote as deleteNoteFromCloud } from '../../services/noteService.js';
import { loadBook as fetchBook, finishBook, unfinishBook } from '../../services/bookService.js';

Page({
  data: {
    loading: true,
    bookId: '',
    book: null,
    notes: [],
    thoughtNotes: [],
    quoteNotes: [],
    timelineGroups: [],
    noteDraft: '',
    canSaveDraft: false,
    noteFocused: false,
    savedHintType: '',
    startedText: '',
    finishedText: '',
    thoughtCount: 0,
    quoteCount: 0,
    canExport: false,
    exportHint: '还没有可导出的内容',
    noteTimeMode: 'both',
    saveInputMode: 'clear',
    autoFocusNote: false
  },

  onLoad(options) {
    const shouldFocus = options.focus === '1' || options.focus === 1;
    this.setData({
      bookId: options.id || '',
      noteFocused: shouldFocus,
      autoFocusNote: shouldFocus
    });
  },

  onShow() {
    this.applyPersonalizeSettings();
    this.loadBook();
  },

  applyPersonalizeSettings() {
    const settings = getPersonalizeSettings();
    this.setData({
      noteTimeMode: settings.noteTimeMode,
      saveInputMode: settings.saveInputMode
    });
  },

  onPullDownRefresh() {
    this.loadBook().finally(() => wx.stopPullDownRefresh());
  },

  onNoteInput(e) {
    const noteDraft = e.detail.value || '';
    this.setData({
      noteDraft,
      canSaveDraft: Boolean(noteDraft.trim())
    });
  },

  onNoteFocus() {
    this.setData({ noteFocused: true });
  },

  onNoteBlur() {
    this.setData({ noteFocused: false });
  },

  async loadBook() {
    const bookId = this.data.bookId;
    if (!bookId) {
      this.setData({ loading: false, book: null });
      return;
    }

    this.setData({ loading: true });
    try {
      const book = await fetchBook(bookId);
      if (!book) throw new Error('book not found');
      const notes = Array.isArray(book.notes) ? book.notes : [];
      const thoughtNotes = notes.filter(n => n.type === 'thought');
      const quoteNotes = notes.filter(n => n.type === 'quote');
      const thoughtCount = thoughtNotes.length;
      const quoteCount = quoteNotes.length;
      const timelineGroups = this.buildTimelineGroups(notes);
      const exportMeta = this.buildExportMeta(thoughtCount, quoteCount);

      this.setData({
        loading: false,
        book: { ...book, thoughtCount, quoteCount },
        notes: notes,
        thoughtNotes: thoughtNotes,
        quoteNotes: quoteNotes,
        timelineGroups,
        thoughtCount,
        quoteCount,
        canExport: exportMeta.canExport,
        exportHint: exportMeta.exportHint,
        startedText: formatDate(book.startTime),
        finishedText: formatDate(book.endTime)
      });
      wx.setNavigationBarTitle({ title: `翻书随手记 · ${book.bookName}` });

      if (
        notes.length > 0 &&
        (book.thoughtCount !== thoughtCount || book.quoteCount !== quoteCount)
      ) {
        // 非阻塞式修复计数，不影响主流程
        db.collection('books')
          .doc(bookId)
          .update({ data: { thoughtCount, quoteCount } })
          .catch(() => {});
      }
    } catch (e) {
      this.setData({ loading: false, book: null });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  buildExportMeta(thoughtCount, quoteCount) {
    const total = Number(thoughtCount || 0) + Number(quoteCount || 0);
    if (total <= 0) {
      return {
        canExport: false,
        exportHint: '还没有可导出的内容'
      };
    }
    return {
      canExport: true,
      exportHint: `已含 心得 ${thoughtCount} · 金句 ${quoteCount}`
    };
  },

  formatShortTime(ts) {
    if (!ts) return '';
    const d = new Date(Number(ts));
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  },

  getDayStart(ts) {
    const d = new Date(Number(ts));
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  },

  formatDayLabel(dayStartTs) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStart = today.getTime();
    const diffDays = Math.round((todayStart - Number(dayStartTs)) / 86400000);
    if (diffDays === 0) return '今天';
    if (diffDays === 1) return '昨天';
    return formatDate(dayStartTs);
  },

  buildTimelineGroups(list) {
    if (!Array.isArray(list) || list.length === 0) return [];

    const sorted = [...list].sort((a, b) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0));
    const groups = [];
    const indexByKey = new Map();

    for (const n of sorted) {
      const ts = Number(n?.timestamp || 0);
      if (!ts) continue;
      const dayStart = this.getDayStart(ts);
      const key = String(dayStart);
      let group = indexByKey.get(key);
      if (!group) {
        group = {
          key,
          dayStart,
          title: this.formatDayLabel(dayStart),
          items: []
        };
        indexByKey.set(key, group);
        groups.push(group);
      }
      group.items.push({
        ...n,
        timeText: formatNoteTime(ts, this.data.noteTimeMode),
        shortTime: this.formatShortTime(ts),
        typeLabel: n.type === 'quote' ? '金句' : '想法'
      });
    }

    return groups.map((g) => ({ ...g, count: g.items.length }));
  },

  openAuthor(e) {
    const id = e.currentTarget?.dataset?.id;
    const name = e.currentTarget?.dataset?.name || '';
    if (!id) return;
    wx.navigateTo({ url: `/pages/author/author?id=${id}&name=${encodeURIComponent(name)}` });
  },

  editBookInfo() {
    const bookId = this.data.bookId;
    if (!bookId) return;
    wx.navigateTo({ url: `/pages/editBookInfo/editBookInfo?id=${bookId}` });
  },

  async chooseNoteTypeAndSave() {
    const text = (this.data.noteDraft || '').trim();
    if (!text) return;
    try {
      const res = await wx.showActionSheet({
        itemList: ['金句', '想法']
      });
      const type = res.tapIndex === 0 ? 'quote' : 'thought';
      await this.saveDraftAsType(type);
    } catch (e) {
      // user canceled
    }
  },

  async saveDraftAsType(type) {
    const text = (this.data.noteDraft || '').trim();
    if (!text) return;
    if (!this.data.book) return;

    const shouldClear = this.data.saveInputMode !== 'keep';
    const currentDraft = this.data.noteDraft;

    try {
      const { thoughtCount, quoteCount } = await addNoteToCloud(this.data.book._id, { text, type });
      const newNotes = [
        ...this.data.notes,
        { text, type, timestamp: Date.now() }
      ];
      const thoughtList = newNotes.filter(n => n.type === 'thought');
      const quoteList = newNotes.filter(n => n.type === 'quote');
      const timelineGroups = this.buildTimelineGroups(newNotes);
      const exportMeta = this.buildExportMeta(thoughtCount, quoteCount);
      this.setData({
        notes: newNotes,
        book: { ...this.data.book, notes: newNotes, notesCount: newNotes.length, thoughtCount, quoteCount },
        thoughtNotes: thoughtList,
        quoteNotes: quoteList,
        timelineGroups,
        thoughtCount,
        quoteCount,
        canExport: exportMeta.canExport,
        exportHint: exportMeta.exportHint,
        noteDraft: shouldClear ? '' : currentDraft,
        canSaveDraft: shouldClear ? false : Boolean(currentDraft.trim()),
        savedHintType: type
      });
      if (this.savedHintTimer) clearTimeout(this.savedHintTimer);
      this.savedHintTimer = setTimeout(() => {
        this.setData({ savedHintType: '' });
      }, 900);
      wx.showToast({ title: '已保存', icon: 'success', duration: 700 });
    } catch (e) {
      wx.showToast({ title: e?.message ? `保存失败: ${e.message}` : '保存失败', icon: 'none' });
    }
  },

  copyNote(e) {
    const text = e.currentTarget.dataset.text;
    if (!text) return;
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制', duration: 600 })
    });
  },

  async openLatestMore(e) {
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
    } catch (e2) {
      // user canceled
    }
  },

  async editNote(e) {
    const ts = Number(e.currentTarget.dataset.ts);
    if (!ts) return;
    const idx = this.data.notes.findIndex(n => n.timestamp === ts);
    if (idx < 0) return;

    const note = this.data.notes[idx];
    const text = encodeURIComponent(note.text || '');
    wx.navigateTo({
      url: `/pages/editNote/editNote?bookId=${this.data.book._id}&ts=${ts}&type=${note.type}&text=${text}`
    });
  },

  async deleteNote(e) {
    const ts = Number(e.currentTarget.dataset.ts);
    if (!ts) return;
    const idx = this.data.notes.findIndex(n => n.timestamp === ts);
    if (idx < 0) return;

    const confirm = await wx.showModal({
      title: '删除这条记录?',
      content: '删除后不可恢复',
      confirmColor: '#C07D6B',
      confirmText: '删除'
    });
    if (!confirm.confirm) return;

    try {
      const { thoughtCount, quoteCount } = await deleteNoteFromCloud(this.data.book._id, ts);
      const newNotes = this.data.notes.filter(n => Number(n.timestamp) !== Number(ts));
      const thoughtList = newNotes.filter(n => n.type === 'thought');
      const quoteList = newNotes.filter(n => n.type === 'quote');
      const timelineGroups = this.buildTimelineGroups(newNotes);
      const exportMeta = this.buildExportMeta(thoughtCount, quoteCount);
      this.setData({
        notes: newNotes,
        book: { ...this.data.book, notes: newNotes, notesCount: newNotes.length, thoughtCount, quoteCount },
        thoughtNotes: thoughtList,
        quoteNotes: quoteList,
        timelineGroups,
        thoughtCount,
        quoteCount,
        canExport: exportMeta.canExport,
        exportHint: exportMeta.exportHint
      });
      wx.showToast({ title: '已删除', icon: 'none', duration: 700 });
    } catch (e) {
      wx.showToast({ title: '删除失败', icon: 'none' });
    }
  },

  openNoteList(e) {
    const type = e?.currentTarget?.dataset?.type;
    if (!this.data.bookId) return;
    wx.navigateTo({
      url: `/pages/bookNotes/bookNotes?bookId=${this.data.bookId}&type=${type === 'quote' ? 'quote' : 'thought'}`
    });
  },

  formatExportItems(notes) {
    const cleanNotes = (notes || [])
      .map(n => String(n?.text || '').trim())
      .filter(Boolean);
    if (cleanNotes.length === 0) {
      return ['(暂无)'];
    }
    return cleanNotes.map((text, idx) => `${idx + 1}. ${text}`);
  },

  copyAllForBook() {
    const book = this.data.book;
    if (!book) return;
    if (!this.data.canExport) {
      wx.showToast({ title: '还没有可导出内容', icon: 'none' });
      return;
    }
    const author = (book.authorName || '未知作者').trim() || '未知作者';
    const bookName = (book.bookName || '').trim() || '未命名';
    const statusText = book.status === 'finished' ? '已读完' : '在读';

    const thoughtNotes = this.data.thoughtNotes || [];
    const quoteNotes = this.data.quoteNotes || [];

    const lines = [];
    lines.push(`《${bookName}》阅读记录`);
    lines.push(`作者:${author}`);
    lines.push(`状态:${statusText}`);

    const started = this.data.startedText || formatDate(book.startTime);
    const finished = this.data.finishedText || formatDate(book.endTime);
    if (started) lines.push(`开始:${started}`);
    if (book.status === 'finished' && finished) lines.push(`读完:${finished}`);
    lines.push(`统计:心得 ${thoughtNotes.length} 条 · 金句 ${quoteNotes.length} 条`);

    lines.push('');
    lines.push('-- 心得 --');
    lines.push(...this.formatExportItems(thoughtNotes));
    lines.push('');
    lines.push('-- 金句 --');
    lines.push(...this.formatExportItems(quoteNotes));

    const text = lines.join('\n').trim();

    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制整理版', icon: 'success', duration: 900 })
    });
  },

  onUnload() {
    if (this.savedHintTimer) clearTimeout(this.savedHintTimer);
  },

  async finishReading() {
    const book = this.data.book;
    if (!book) return;
    if (book.status === 'finished') return;

    const confirm = await wx.showModal({
      title: '我读完了',
      content: '这本书读完啦?',
      confirmText: '完成'
    });
    if (!confirm.confirm) return;

    try {
      const { endTime, durationMin } = await finishBook(book._id, book.startTime);
      const updatedBook = { ...book, endTime, durationMin, status: 'finished' };
      this.setData({
        book: updatedBook,
        finishedText: formatDate(endTime)
      });
      wx.showToast({ title: '已标记已读', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  async markUnfinished() {
    const book = this.data.book;
    if (!book) return;
    if (book.status !== 'finished') return;

    const confirm = await wx.showModal({
      title: '恢复在读',
      content: '将这本书回到"在读"书架？',
      confirmText: '恢复'
    });
    if (!confirm.confirm) return;

    wx.showLoading({ title: '保存中', mask: true });
    try {
      await unfinishBook(book._id);
      wx.hideLoading();
      wx.showToast({ title: '已恢复在读', icon: 'success', duration: 800 });
      this.loadBook();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  continueReadingLater() {
    // Book is already in "reading" status; this is a navigation shortcut back to shelf.
    wx.switchTab({ url: '/pages/index/index' });
  },


  generateShareCard() {
    const book = this.data.book;
    if (!book || book.status !== 'finished') return;
    const quoteNotes = this.data.quoteNotes || [];
    if (quoteNotes.length === 0) {
      wx.showToast({ title: '这本书还没有金句', icon: 'none' });
      return;
    }
    const payload = {
      bookName: book.bookName || '',
      authorName: book.authorName || '',
      endTime: book.endTime != null ? String(book.endTime) : '',
      quotes: quoteNotes
    };
    const key = `_share_${book._id}`;
    wx.setStorage({ key, data: payload });
    wx.navigateTo({
      url: `/pages/shareCard/shareCard?bookId=${book._id}`
    });
  }
});

