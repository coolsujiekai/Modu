import { db, _, withRetry } from '../../utils/db.js';
import { formatDate } from '../../utils/util.js';
import { getPersonalizeSettings } from '../../utils/personalize';

Page({
  data: {
    loading: true,
    bookId: '',
    book: null,
    notes: [],
    thoughtNotes: [],
    quoteNotes: [],
    latestThought: null,
    latestQuote: null,
    thoughtText: '',
    quoteText: '',
    canSaveThought: false,
    canSaveQuote: false,
    thoughtFocused: false,
    quoteFocused: false,
    savedHintType: '',
    startedText: '',
    finishedText: '',
    thoughtCount: 0,
    quoteCount: 0,
    canExport: false,
    exportHint: '还没有可导出的内容',
    noteTimeMode: 'both',
    saveInputMode: 'clear'
  },

  onLoad(options) {
    this.setData({ bookId: options.id || '' });
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

  onThoughtInput(e) {
    const thoughtText = e.detail.value || '';
    this.setData({
      thoughtText,
      canSaveThought: Boolean(thoughtText.trim())
    });
  },

  onQuoteInput(e) {
    const quoteText = e.detail.value || '';
    this.setData({
      quoteText,
      canSaveQuote: Boolean(quoteText.trim())
    });
  },

  onThoughtFocus() {
    this.setData({ thoughtFocused: true });
  },

  onThoughtBlur() {
    this.setData({ thoughtFocused: false });
  },

  onQuoteFocus() {
    this.setData({ quoteFocused: true });
  },

  onQuoteBlur() {
    this.setData({ quoteFocused: false });
  },

  async loadBook() {
    const bookId = this.data.bookId;
    if (!bookId) {
      this.setData({ loading: false, book: null });
      return;
    }

    this.setData({ loading: true });
    try {
      const res = await withRetry(() => db.collection('books').doc(bookId).get());
      const book = res.data;
      const notes = Array.isArray(book.notes) ? book.notes : [];
      const thoughtNotes = notes.filter(n => n.type === 'thought');
      const quoteNotes = notes.filter(n => n.type === 'quote');
      const thoughtCount = thoughtNotes.length;
      const quoteCount = quoteNotes.length;
      const latestThought = this.pickLatestNote(thoughtNotes);
      const latestQuote = this.pickLatestNote(quoteNotes);
      const exportMeta = this.buildExportMeta(thoughtCount, quoteCount);

      this.setData({
        loading: false,
        book: { ...book, thoughtCount, quoteCount },
        notes: notes,
        thoughtNotes: thoughtNotes,
        quoteNotes: quoteNotes,
        latestThought,
        latestQuote,
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

  formatRelativeTime(timestamp) {
    const ts = Number(timestamp || 0);
    if (!ts) return '';
    const now = Date.now();
    const diff = now - ts;
    if (diff < 60 * 1000) return '刚刚';
    if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))}分钟前`;
    if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / (60 * 60 * 1000))}小时前`;
    return '';
  },

  formatNoteTime(timestamp) {
    const relative = this.formatRelativeTime(timestamp);
    const absolute = formatDate(timestamp);
    const mode = this.data.noteTimeMode || 'both';
    if (mode === 'relative') return relative || absolute;
    if (mode === 'absolute') return absolute;
    if (!relative || relative === absolute) return absolute;
    return `${relative} · ${absolute}`;
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

  pickLatestNote(list) {
    if (!Array.isArray(list) || list.length === 0) return null;
    let latest = list[0];
    for (let i = 1; i < list.length; i++) {
      const a = Number(latest?.timestamp || 0);
      const b = Number(list[i]?.timestamp || 0);
      if (b > a) latest = list[i];
    }
    if (!latest) return null;
    return {
      ...latest,
      timeText: this.formatNoteTime(latest.timestamp)
    };
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

  async addNote(e) {
    const type = e.currentTarget.dataset.type;
    const text = (type === 'quote' ? this.data.quoteText : this.data.thoughtText).trim();
    if (!text) return;
    if (!this.data.book) return;

    const note = {
      text,
      type,
      timestamp: Date.now()
    };
    const shouldClear = this.data.saveInputMode !== 'keep';
    const currentThoughtText = this.data.thoughtText;
    const currentQuoteText = this.data.quoteText;

    const newNotes = [...this.data.notes, note];
    this.setData({
      notes: newNotes,
      thoughtText: type === 'thought' && shouldClear ? '' : currentThoughtText,
      quoteText: type === 'quote' && shouldClear ? '' : currentQuoteText,
      canSaveThought: type === 'thought'
        ? (shouldClear ? false : Boolean(currentThoughtText.trim()))
        : this.data.canSaveThought,
      canSaveQuote: type === 'quote'
        ? (shouldClear ? false : Boolean(currentQuoteText.trim()))
        : this.data.canSaveQuote
    });

    try {
      const thoughtCount = newNotes.filter(n => n.type === 'thought').length;
      const quoteCount = newNotes.filter(n => n.type === 'quote').length;
      await db.collection('books').doc(this.data.book._id).update({
        data: {
          notes: newNotes,
          notesCount: newNotes.length,
          thoughtCount,
          quoteCount
        }
      });
      const updatedBook = { ...this.data.book, notes: newNotes, notesCount: newNotes.length, thoughtCount, quoteCount };
      const thoughtList = newNotes.filter(n => n.type === 'thought');
      const quoteList = newNotes.filter(n => n.type === 'quote');
      const exportMeta = this.buildExportMeta(thoughtCount, quoteCount);
      this.setData({
        book: updatedBook,
        thoughtNotes: thoughtList,
        quoteNotes: quoteList,
        latestThought: this.pickLatestNote(thoughtList),
        latestQuote: this.pickLatestNote(quoteList),
        thoughtCount,
        quoteCount,
        canExport: exportMeta.canExport,
        exportHint: exportMeta.exportHint,
        savedHintType: type
      });
      if (this.savedHintTimer) clearTimeout(this.savedHintTimer);
      this.savedHintTimer = setTimeout(() => {
        this.setData({ savedHintType: '' });
      }, 900);
      wx.showToast({ title: '已保存', icon: 'success', duration: 700 });
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' });
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
      title: '删除这条记录？',
      content: '删除后不可恢复',
      confirmColor: '#C07D6B',
      confirmText: '删除'
    });
    if (!confirm.confirm) return;

    const newNotes = [...this.data.notes];
    newNotes.splice(idx, 1);
    this.setData({ notes: newNotes });

    try {
      const thoughtCount = newNotes.filter(n => n.type === 'thought').length;
      const quoteCount = newNotes.filter(n => n.type === 'quote').length;
      await db.collection('books').doc(this.data.book._id).update({
        data: {
          notes: newNotes,
          notesCount: newNotes.length,
          thoughtCount,
          quoteCount
        }
      });
      const updatedBook = { ...this.data.book, notes: newNotes, notesCount: newNotes.length, thoughtCount, quoteCount };
      const thoughtList = newNotes.filter(n => n.type === 'thought');
      const quoteList = newNotes.filter(n => n.type === 'quote');
      const exportMeta = this.buildExportMeta(thoughtCount, quoteCount);
      this.setData({
        book: updatedBook,
        thoughtNotes: thoughtList,
        quoteNotes: quoteList,
        latestThought: this.pickLatestNote(thoughtList),
        latestQuote: this.pickLatestNote(quoteList),
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
      return ['（暂无）'];
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
    lines.push(`作者：${author}`);
    lines.push(`状态：${statusText}`);

    const started = this.data.startedText || formatDate(book.startTime);
    const finished = this.data.finishedText || formatDate(book.endTime);
    if (started) lines.push(`开始：${started}`);
    if (book.status === 'finished' && finished) lines.push(`读完：${finished}`);
    lines.push(`统计：心得 ${thoughtNotes.length} 条 · 金句 ${quoteNotes.length} 条`);

    lines.push('');
    lines.push('—— 心得 ——');
    lines.push(...this.formatExportItems(thoughtNotes));
    lines.push('');
    lines.push('—— 金句 ——');
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
      content: '这本书读完啦？',
      confirmText: '完成'
    });
    if (!confirm.confirm) return;

    const endTime = Date.now();
    const durationMin = book.startTime ? Math.floor((endTime - book.startTime) / 60000) : 0;

    try {
      await db.collection('books').doc(book._id).update({
        data: {
          endTime,
          durationMin,
          status: 'finished'
        }
      });

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
      content: '将这本书回到“在读”书架？',
      confirmText: '恢复'
    });
    if (!confirm.confirm) return;

    wx.showLoading({ title: '保存中', mask: true });
    try {
      await db.collection('books').doc(book._id).update({
        data: {
          status: 'reading',
          endTime: _.remove()
        }
      });
      wx.hideLoading();
      wx.showToast({ title: '已恢复在读', icon: 'success', duration: 800 });
      this.loadBook();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  }
});

