import { db, withRetry, traced, withOpenIdFilter } from '../../utils/db.js';
import { addNote as addNoteToCloud } from '../../services/noteService.js';
import { recognizePrintedText } from '../../services/noteService.js';

const DRAFT_KEY = '_quickNote_draft';
const LAST_TYPE_KEY = '_quickNote_lastType';

let siManager = null;

Page({
  data: {
    isDark: false,
    draft: '',
    draftLength: 0,
    draftHasText: false,
    autoFocus: false,
    saving: false,
    type: 'quote',
    readingBooks: [],
    currentBookId: '',
    currentBookName: '',
    hasMultipleBooks: false,
    barBottom: 0,
    canNext: false,
    isRecording: false,
    _voiceBaseDraft: '',

    sheetVisible: false,
    sheetBookId: '',
    sheetType: 'quote',
    fixedBookId: '',

  },

  noop() {},

  hideKeyboard() {
    try {
      wx.hideKeyboard();
    } catch (e) {
      // ignore
    }
  },

  onLoad(options) {
    this.setData({ isDark: getApp()?.globalData?.isDark || false });
    const stored = this.readDraft();
    const lastType = this.getLastUsedType();
    const draftHasText = Boolean(String(stored || '').trim());
    const fixedBookId = String(options?.bookId || '').trim();
    this.setData({
      draft: stored,
      draftLength: stored.length,
      draftHasText,
      canNext: draftHasText,
      type: lastType || 'quote',
      sheetType: lastType || 'quote',
      fixedBookId
    });
    if (fixedBookId) {
      this.loadFixedBook(fixedBookId);
    }
    this.loadBooks();
    this.initVoiceToText();

    setTimeout(() => {
      this.setData({ autoFocus: true });
    }, 80);
  },

  async loadFixedBook(bookId) {
    try {
      const res = await withRetry(() =>
        db.collection('books').doc(bookId).field({ notes: false }).get()
      );
      const b = res?.data;
      if (!b || !b._id) return;
      this.setData({
        currentBookId: b._id,
        currentBookName: b.bookName || '未命名',
        sheetBookId: b._id
      });
    } catch (e) {
      // ignore
    }
  },

  onUnload() {
    this.stopVoiceToTextIfNeeded();
    this.persistDraft();
  },

  onHide() {
    this.stopVoiceToTextIfNeeded();
    this.persistDraft();
  },

  initVoiceToText() {
    try {
      const plugin = requirePlugin('WechatSI');
      const manager = plugin?.getRecordRecognitionManager?.();
      if (!manager) return;
      siManager = manager;

      manager.onRecognize = (res) => {
        const txt = String(res?.result || '');
        const base = this.data._voiceBaseDraft || '';
        const draft = base + txt;
        const draftHasText = Boolean(draft.trim());
        this.setData({
          draft,
          draftLength: draft.length,
          draftHasText,
          canNext: draftHasText
        });
      };

      manager.onStop = (res) => {
        const txt = String(res?.result || '');
        const base = this.data._voiceBaseDraft || '';
        const draft = (base + txt).trimEnd();
        const draftHasText = Boolean(draft.trim());
        this.setData({
          isRecording: false,
          _voiceBaseDraft: '',
          draft,
          draftLength: draft.length,
          draftHasText,
          canNext: draftHasText
        });
      };

      manager.onError = (res) => {
        this.setData({ isRecording: false, _voiceBaseDraft: '' });
        wx.showToast({ title: '语音识别失败，请重试', icon: 'none' });
        console.warn('[quickNote] voice error:', res);
      };
    } catch (e) {
      // plugin not installed or not available
    }
  },

  stopVoiceToTextIfNeeded() {
    try {
      if (this.data.isRecording && siManager?.stop) {
        siManager.stop();
      }
    } catch (e) {
      // ignore
    } finally {
      if (this.data.isRecording) this.setData({ isRecording: false, _voiceBaseDraft: '' });
    }
  },

  async ensureRecordPermission() {
    try {
      const setting = await wx.getSetting();
      const granted = Boolean(setting?.authSetting?.['scope.record']);
      if (granted) return true;

      try {
        await wx.authorize({ scope: 'scope.record' });
        return true;
      } catch (e) {
        const res = await wx.showModal({
          title: '需要麦克风权限',
          content: '请在设置中开启麦克风权限后再使用语音输入。',
          confirmText: '去设置',
          cancelText: '取消'
        });
        if (res.confirm) {
          await wx.openSetting();
        }
        return false;
      }
    } catch (e) {
      return false;
    }
  },

  async onVoiceHoldStart() {
    if (this.data.saving) return;
    if (!siManager?.start) {
      wx.showToast({ title: '语音插件未就绪', icon: 'none' });
      return;
    }
    if (this.data.isRecording) return;

    const ok = await this.ensureRecordPermission();
    if (!ok) return;

    let base = String(this.data.draft || '');
    const baseTrim = base.trimEnd();
    if (baseTrim && !/[，。！？,.!?]\s*$/.test(baseTrim)) {
      base = baseTrim + '，';
    } else {
      base = base;
    }

    this.setData({ isRecording: true, _voiceBaseDraft: base });
    try {
      wx.vibrateShort({ type: 'light' });
    } catch (e) {
      // ignore
    }
    try {
      siManager.start({ duration: 60000, lang: 'zh_CN' });
    } catch (e) {
      this.setData({ isRecording: false, _voiceBaseDraft: '' });
      wx.showToast({ title: '启动录音失败', icon: 'none' });
    }
  },

  onVoiceHoldEnd() {
    if (!this.data.isRecording) return;
    try {
      siManager?.stop?.();
    } catch (e) {
      this.setData({ isRecording: false, _voiceBaseDraft: '' });
    }
  },

  async onOcrPick() {
    try {
      const chooseRes = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['camera', 'album'],
        sizeType: ['compressed']
      });
      const tempFilePath = chooseRes?.tempFiles?.[0]?.tempFilePath;
      if (!tempFilePath) return;

      wx.showLoading({ title: '识别中…', mask: true });

      const cloudPath = `ocr_temp/${Date.now()}_${Math.floor(Math.random() * 1000)}.jpg`;
      const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath: tempFilePath });
      const fileID = uploadRes?.fileID;
      if (!fileID) throw new Error('上传失败');

      const ocrRes = await recognizePrintedText(fileID);
      const text = String(ocrRes?.text || '').trim();
      if (!text) {
        wx.hideLoading();
        wx.showToast({ title: '没识别到文字', icon: 'none' });
        return;
      }

      const base = String(this.data.draft || '').trimEnd();
      const merged = base ? `${base}\n${text}` : text;
      const draftHasText = Boolean(merged.trim());
      this.setData({
        draft: merged,
        draftLength: merged.length,
        draftHasText,
        canNext: draftHasText
      });

      wx.hideLoading();
      wx.showToast({ title: '已识别', icon: 'success', duration: 700 });

      wx.cloud.deleteFile({ fileList: [fileID] }).catch(() => {});
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e?.message ? `识别失败：${e.message}` : '识别失败', icon: 'none' });
    }
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
      if (this.data.fixedBookId) {
        // 详情页入口：不强依赖“在读书架”，仅用于可选切换
        this.setData({ hasMultipleBooks: false });
        return;
      }
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
          sheetBookId: ''
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
        sheetBookId: picked._id
      });
    } catch (e) {
      this.setData({
        readingBooks: [],
        currentBookId: '',
        currentBookName: '',
        hasMultipleBooks: false,
        sheetBookId: ''
      });
    }
  },

  getLastUsedType() {
    try {
      const t = String(wx.getStorageSync(LAST_TYPE_KEY) || '');
      if (t === 'quote' || t === 'thought') return t;
      return '';
    } catch (e) {
      return '';
    }
  },

  saveLastUsedType(type) {
    try {
      if (type === 'quote' || type === 'thought') {
        wx.setStorageSync(LAST_TYPE_KEY, type);
      }
    } catch (e) {
      // ignore
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
    const draftHasText = Boolean(draft.trim());
    this.setData({
      draft,
      draftLength,
      draftHasText,
      canNext: draftHasText
    });
  },

  onKeyboardHeightChange(e) {
    const height = Number(e.detail.height || 0);
    this.setData({ barBottom: Math.max(0, height) });
  },

  async onVoiceToggleTap() {
    if (this.data.saving) return;
    if (this.data.isRecording) {
      this.onVoiceStop();
      return;
    }
    await this.onVoiceStart();
  },

  async onVoiceStart() {
    if (!siManager?.start) {
      wx.showToast({ title: '语音插件未就绪', icon: 'none' });
      return;
    }
    if (this.data.isRecording) return;

    const ok = await this.ensureRecordPermission();
    if (!ok) return;

    let base = String(this.data.draft || '');
    const baseTrim = base.trimEnd();
    if (baseTrim && !/[，。！？,.!?]\s*$/.test(baseTrim)) {
      base = baseTrim + '，';
    }

    this.setData({ isRecording: true, _voiceBaseDraft: base });
    try {
      wx.vibrateShort({ type: 'light' });
    } catch (e) {
      // ignore
    }
    try {
      siManager.start({ duration: 60000, lang: 'zh_CN' });
      wx.showToast({ title: '正在听写…再点一次结束', icon: 'none', duration: 1200 });
    } catch (e) {
      this.setData({ isRecording: false, _voiceBaseDraft: '' });
      wx.showToast({ title: '启动录音失败', icon: 'none' });
    }
  },

  onVoiceStop() {
    if (!this.data.isRecording) return;
    try {
      siManager?.stop?.();
    } catch (e) {
      this.setData({ isRecording: false, _voiceBaseDraft: '' });
    }
  },

  async onNext() {
    if (this.data.saving) return;
    if (!this.data.draftHasText) {
      wx.showToast({ title: '写点什么再继续', icon: 'none' });
      return;
    }

    if (this.data.isRecording) {
      this.onVoiceStop();
      await new Promise((r) => setTimeout(r, 80));
    }

    // 书籍详情页入口：无需弹“保存设置”半屏面板（iOS 真机容易出现点击命中问题）
    // 直接选择类型并保存到固定书籍
    if (this.data.fixedBookId) {
      const bookId = String(this.data.fixedBookId || '').trim();
      if (!bookId) return;

      this.hideKeyboard();
      let pickedType = '';
      try {
        const res = await wx.showActionSheet({ itemList: ['金句', '想法'] });
        pickedType = res.tapIndex === 1 ? 'thought' : 'quote';
      } catch (e) {
        // canceled
        return;
      }

      const text = (this.data.draft || '').trim();
      if (!text) {
        wx.showToast({ title: '写点什么再保存', icon: 'none' });
        return;
      }

      this.setData({ saving: true });
      try {
        await addNoteToCloud(bookId, { text, type: pickedType, bookName: this.data.currentBookName });
        this.saveLastUsedBookId(bookId);
        this.saveLastUsedType(pickedType);

        this.clearDraft();
        this.setData({
          draft: '',
          draftLength: 0,
          draftHasText: false,
          canNext: false,
          saving: false,
          sheetVisible: false,
          type: pickedType,
          sheetType: pickedType,
          currentBookId: bookId,
        });
        wx.showToast({
          title: pickedType === 'quote' ? '已存为金句' : '已存为想法',
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
      return;
    }

    // 首页入口：保留“保存设置”半屏面板（可选书 + 类型）
    const sheetBookId = String(this.data.currentBookId || '');
    const sheetType = this.data.sheetType || this.data.type || 'quote';
    this.setData(
      {
        sheetVisible: true,
        sheetBookId,
        sheetType,
        autoFocus: false
      },
      () => {
        // 关键：面板真正显示后再收起键盘，避免焦点/布局竞争
        this.hideKeyboard();
      }
    );
  },

  onSheetClose() {
    if (this.data.saving) return;
    this.setData({ sheetVisible: false });
  },

  onSheetPickBook(e) {
    if (this.data.saving) return;
    this.hideKeyboard();
    const id = e.currentTarget?.dataset?.id;
    if (!id) return;
    this.setData({ sheetBookId: id });
  },

  onSheetPickType(e) {
    if (this.data.saving) return;
    this.hideKeyboard();
    const type = e.currentTarget?.dataset?.type;
    if (type !== 'quote' && type !== 'thought') return;
    this.setData({ sheetType: type });
  },

  async onCreateBookFromSheet() {
    if (this.data.saving) return;
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
  },

  async onSheetConfirmSave() {
    if (this.data.saving) return;
    const text = (this.data.draft || '').trim();
    if (!text) {
      wx.showToast({ title: '写点什么再保存', icon: 'none' });
      return;
    }
    const bookId = this.data.sheetBookId;
    if (!bookId) {
      wx.showToast({ title: '先选一本书', icon: 'none' });
      return;
    }
    const type = this.data.sheetType === 'thought' ? 'thought' : 'quote';

    this.setData({ saving: true });
    try {
      await addNoteToCloud(bookId, { text, type, bookName: this.data.currentBookName });
      this.saveLastUsedBookId(bookId);
      this.saveLastUsedType(type);
      this.clearDraft();

      this.setData({
        draft: '',
        draftLength: 0,
        draftHasText: false,
        canNext: false,
        saving: false,
        sheetVisible: false,
        type,
        sheetType: type,
        currentBookId: bookId,
      });
      wx.showToast({
        title: type === 'quote' ? '已存为金句' : '已存为想法',
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
