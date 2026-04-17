const db = wx.cloud.database();

async function withRetry(fn) {
  try {
    return await fn();
  } catch (e) {
    const msg = e?.errMsg || '';
    if (msg.includes('timeout')) {
      await new Promise(r => setTimeout(r, 500));
      return await fn();
    }
    throw e;
  }
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

Page({
  data: {
    loading: true,
    bookId: '',
    book: null,
    notes: [],
    thoughtNotes: [],
    quoteNotes: [],
    thoughtText: '',
    quoteText: '',
    startedText: '',
    finishedText: ''
  },

  onLoad(options) {
    this.setData({ bookId: options.id || '' });
  },

  onShow() {
    this.loadBook();
  },

  onThoughtInput(e) {
    this.setData({ thoughtText: e.detail.value });
  },

  onQuoteInput(e) {
    this.setData({ quoteText: e.detail.value });
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

      this.setData({
        loading: false,
        book: book,
        notes: notes,
        thoughtNotes: thoughtNotes,
        quoteNotes: quoteNotes,
        startedText: formatDate(book.startTime),
        finishedText: formatDate(book.endTime)
      });
      wx.setNavigationBarTitle({ title: `墨读 · ${book.bookName}` });
    } catch (e) {
      this.setData({ loading: false, book: null });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
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

    const newNotes = [...this.data.notes, note];
    this.setData({
      notes: newNotes,
      thoughtText: type === 'thought' ? '' : this.data.thoughtText,
      quoteText: type === 'quote' ? '' : this.data.quoteText
    });

    try {
      await db.collection('books').doc(this.data.book._id).update({
        data: {
          notes: newNotes,
          notesCount: newNotes.length
        }
      });
      const updatedBook = { ...this.data.book, notes: newNotes, notesCount: newNotes.length };
      this.setData({
        book: updatedBook,
        thoughtNotes: newNotes.filter(n => n.type === 'thought'),
        quoteNotes: newNotes.filter(n => n.type === 'quote')
      });
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
      confirmColor: '#fa5151',
      confirmText: '删除'
    });
    if (!confirm.confirm) return;

    const newNotes = [...this.data.notes];
    newNotes.splice(idx, 1);
    this.setData({ notes: newNotes });

    try {
      await db.collection('books').doc(this.data.book._id).update({
        data: {
          notes: newNotes,
          notesCount: newNotes.length
        }
      });
      const updatedBook = { ...this.data.book, notes: newNotes, notesCount: newNotes.length };
      this.setData({
        book: updatedBook,
        thoughtNotes: newNotes.filter(n => n.type === 'thought'),
        quoteNotes: newNotes.filter(n => n.type === 'quote')
      });
      wx.showToast({ title: '已删除', icon: 'none', duration: 700 });
    } catch (e) {
      wx.showToast({ title: '删除失败', icon: 'none' });
    }
  },

  copyAllForBook() {
    const book = this.data.book;
    if (!book) return;
    const notes = this.data.notes || [];
    const lines = [];
    lines.push(`《${book.bookName}》`);
    if (book.status === 'finished' && book.endTime) lines.push(`完成：${formatDate(book.endTime)}`);
    lines.push('');
    notes.forEach(n => {
      lines.push(`${n.type === 'quote' ? '📖' : '💭'} ${n.text}`);
      lines.push('');
    });
    const text = lines.join('\n').trim();

    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制本书内容', icon: 'success', duration: 900 })
    });
  },

  async finishReading() {
    const book = this.data.book;
    if (!book) return;
    if (book.status === 'finished') return;

    const confirm = await wx.showModal({
      title: '标记已读',
      content: '这本书读完啦？',
      confirmText: '已读'
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
  }
});

