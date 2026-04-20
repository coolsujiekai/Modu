import { db, withRetry, traced, withOpenIdFilter } from '../../utils/db.js';
import { addNote as addNoteToCloud } from '../../services/noteService.js';

const DRAFT_KEY = '_quickNote_draft';

Page({
  data: {
    draft: '',
    draftLength: 0,
    autoFocus: false,
    saving: false,
    type: 'quote',
    readingBooks: [],
    currentBookId: '',
    currentBookName: '',
    hasMultipleBooks: false,
    barBottom: 0,
    canSave: false
  },

  onLoad() {
    const stored = this.readDraft();
    this.setData({
      draft: stored,
      draftLength: stored.length,
      canSave: false
    });
    this.loadBooks();

    setTimeout(() => {
      this.setData({ autoFocus: true });
    }, 80);
  },

  onUnload() {
    this.persistDraft();
  },

  onHide() {
    this.persistDraft();
  },

  readDraft() {
    try {
      return String(wx.getStorageSync(DRAFT_KEY) || '');
    } catch (e) {
      return '';
    }
  },

  persistDraft() {
    const text = (this.data.draft || '').trim();
    try {
      if (text) {
        wx.setStorageSync(DRAFT_KEY, this.data.draft);
      } else {
        wx.removeStorageSync(DRAFT_KEY);
      }
    } catch (e) {
      // ignore
    }
  },

  clearDraft() {
    try {
      wx.removeStorageSync(DRAFT_KEY);
    } catch (e) {
      // ignore
    }
  },

  async loadBooks() {
    try {
      let res;
      try {
        res = await traced('books.reading.list(quickNote)', () =>
          withRetry(() =>
            db
              .collection('books')
              .where(withOpenIdFilter({ status: 'reading' }))
              .orderBy('startTime', 'desc')
              .limit(50)
              .field({ notes: false })
              .get()
          )
        );
      } catch (e) {
        res = await traced('books.reading.list(quickNote,no orderBy)', () =>
          withRetry(() =>
            db
              .collection('books')
              .where(withOpenIdFilter({ status: 'reading' }))
              .limit(50)
              .field({ notes: false })
              .get()
          )
        );
      }

      const raw = (res?.data || []).filter((b) => b && b._id);
      raw.sort((a, b) => Number(b.startTime || 0) - Number(a.startTime || 0));

      if (raw.length === 0) {
        this.setData({
          readingBooks: [],
          currentBookId: '',
          currentBookName: '',
          hasMultipleBooks: false,
          canSave: false
        });
        return;
      }

      const pinnedId = this.getLastUsedBookId();
      const pinned = pinnedId ? raw.find((b) => b._id === pinnedId) : null;
      const picked = pinned || raw[0];

      this.setData({
        readingBooks: raw,
        currentBookId: picked._id,
        currentBookName: picked.bookName || '未命名',
        hasMultipleBooks: raw.length > 1,
        canSave: Boolean((this.data.draft || '').trim())
      });
    } catch (e) {
      this.setData({
        readingBooks: [],
        currentBookId: '',
        currentBookName: '',
        hasMultipleBooks: false,
        canSave: false
      });
    }
  },

  getLastUsedBookId() {
    try {
      return String(wx.getStorageSync('_quickNote_lastBookId') || '');
    } catch (e) {
      return '';
    }
  },

  saveLastUsedBookId(id) {
    try {
      if (id) wx.setStorageSync('_quickNote_lastBookId', id);
    } catch (e) {
      // ignore
    }
  },

  onDraftInput(e) {
    const draft = e.detail.value || '';
    const draftLength = draft.length;
    this.setData({
      draft,
      draftLength,
      canSave: Boolean(draft.trim()) && Boolean(this.data.currentBookId)
    });
  },

  onKeyboardHeightChange(e) {
    const height = Number(e.detail.height || 0);
    this.setData({ barBottom: Math.max(0, height) });
  },

  onTypeChange(e) {
    const type = e.currentTarget?.dataset?.type;
    if (type !== 'quote' && type !== 'thought') return;
    this.setData({ type });
  },

  async onChangeBook() {
    const books = this.data.readingBooks || [];

    if (books.length === 0) {
      const res = await wx.showModal({
        title: '先放一本书进书架',
        content: '还没有在读的书，新增一本就能开始记录',
        confirmText: '新增',
        cancelText: '取消'
      });
      if (res.confirm) {
        this.persistDraft();
        wx.redirectTo({ url: '/pages/createBook/createBook' });
      }
      return;
    }

    if (books.length === 1) {
      return;
    }

    try {
      const res = await wx.showActionSheet({
        itemList: books.slice(0, 10).map((b) => `《${b.bookName || '未命名'}》`)
      });
      const picked = books[res.tapIndex];
      if (picked) {
        this.setData({
          currentBookId: picked._id,
          currentBookName: picked.bookName || '未命名',
          canSave: Boolean((this.data.draft || '').trim())
        });
        this.saveLastUsedBookId(picked._id);
      }
    } catch (err) {
      // canceled
    }
  },

  async onSave() {
    if (this.data.saving) return;
    const text = (this.data.draft || '').trim();
    if (!text) {
      wx.showToast({ title: '写点什么再保存', icon: 'none' });
      return;
    }
    const bookId = this.data.currentBookId;
    if (!bookId) {
      wx.showToast({ title: '先选一本书', icon: 'none' });
      return;
    }

    this.setData({ saving: true });
    try {
      await addNoteToCloud(bookId, { text, type: this.data.type });
      this.saveLastUsedBookId(bookId);
      this.clearDraft();
      this.setData({
        draft: '',
        draftLength: 0,
        canSave: false,
        saving: false
      });
      wx.showToast({
        title: this.data.type === 'quote' ? '已存为金句' : '已存为想法',
        icon: 'success',
        duration: 900
      });
      setTimeout(() => {
        wx.navigateBack();
      }, 450);
    } catch (err) {
      this.setData({ saving: false });
      wx.showToast({
        title: err?.message ? `保存失败：${err.message}` : '保存失败',
        icon: 'none'
      });
    }
  }
});
