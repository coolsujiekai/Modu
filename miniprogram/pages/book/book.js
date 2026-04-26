import { db, _, withRetry } from '../../utils/db.js';
import { formatDate } from '../../utils/util.js';
import { getPersonalizeSettings } from '../../utils/personalize';
import { formatNoteTime, addNote as addNoteToCloud, deleteNote as deleteNoteFromCloud, recognizePrintedText } from '../../services/noteService.js';
import { loadBook as fetchBook, loadBookNotes as fetchBookNotes, finishBook, unfinishBook } from '../../services/bookService.js';

let siManager = null;

Page({
  data: {
    isDark: false,
    loading: true,
    bookId: '',
    book: null,
    notes: [],
    thoughtNotes: [],
    quoteNotes: [],
    timelineGroups: [],
    aiReflection: '',
    aiReflectionLoading: false,
    aiReflectionError: '',
    aiQuotaRemaining: 0,
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
    autoFocusNote: false,
    isRecording: false,
    _voiceBaseDraft: ''
  },

  _dblTap: { key: '', at: 0 },

  onLoad(options) {
    const shouldFocus = options.focus === '1' || options.focus === 1;
    this.setData({
      bookId: options.id || '',
      noteFocused: shouldFocus,
      autoFocusNote: shouldFocus
    });
    this.initVoiceToText();
  },

  onShow() {
    this.applyPersonalizeSettings();
    this.loadBook();
  },

  onHide() {
    this.stopVoiceToTextIfNeeded();
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

  initVoiceToText() {
    try {
      const plugin = requirePlugin('WechatSI');
      const manager = plugin?.getRecordRecognitionManager?.();
      if (!manager) return;
      siManager = manager;

      manager.onRecognize = (res) => {
        const txt = String(res?.result || '');
        const base = this.data._voiceBaseDraft || '';
        const noteDraft = base + txt;
        this.setData({
          noteDraft,
          canSaveDraft: Boolean(noteDraft.trim())
        });
      };

      manager.onStop = (res) => {
        const txt = String(res?.result || '');
        const base = this.data._voiceBaseDraft || '';
        const noteDraft = (base + txt).trimEnd();
        this.setData({
          isRecording: false,
          _voiceBaseDraft: '',
          noteDraft,
          canSaveDraft: Boolean(noteDraft.trim())
        });
      };

      manager.onError = (res) => {
        this.setData({ isRecording: false, _voiceBaseDraft: '' });
        wx.showToast({ title: '语音识别失败，请重试', icon: 'none' });
        console.warn('[book] voice error:', res);
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
    if (!siManager?.start) {
      wx.showToast({ title: '语音插件未就绪', icon: 'none' });
      return;
    }
    if (this.data.isRecording) return;

    const ok = await this.ensureRecordPermission();
    if (!ok) return;

    let base = String(this.data.noteDraft || '');
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

      const base = String(this.data.noteDraft || '').trimEnd();
      const merged = base ? `${base}\n${text}` : text;
      this.setData({
        noteDraft: merged,
        canSaveDraft: Boolean(merged.trim())
      });

      wx.hideLoading();
      wx.showToast({ title: '已识别', icon: 'success', duration: 700 });

      wx.cloud.deleteFile({ fileList: [fileID] }).catch(() => {});
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e?.message ? `识别失败：${e.message}` : '识别失败', icon: 'none' });
    }
  },

  async loadBook() {
    const bookId = this.data.bookId;
    if (!bookId) {
      this.setData({ loading: false, book: null });
      return;
    }

    this.setData({ loading: true });
    try {
      const [book, notes] = await Promise.all([
        fetchBook(bookId),
        fetchBookNotes(bookId)
      ]);
      if (!book) throw new Error('book not found');
      const thoughtNotes = notes.filter(n => n.type === 'thought');
      const quoteNotes = notes.filter(n => n.type === 'quote');
      const thoughtCount = thoughtNotes.length;
      const quoteCount = quoteNotes.length;
      const timelineGroups = this.buildTimelineGroups(notes);
      const exportMeta = this.buildExportMeta(thoughtCount, quoteCount);

      this.setData({
        loading: false,
        book: { ...book, thoughtCount, quoteCount },
        aiReflection: String(book.aiReflection || ''),
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
    } catch (e) {
      this.setData({ loading: false, book: null });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  async onGenerateReflection() {
    if (this.data.aiReflectionLoading) return;
    const bookId = this.data.book?._id || this.data.bookId;
    if (!bookId) return;
    if (this.data.book?.status !== 'finished') {
      wx.showToast({ title: '读完后可生成', icon: 'none' });
      return;
    }

    this.setData({ aiReflectionLoading: true, aiReflectionError: '' });
    wx.showLoading({ title: '生成中…', mask: true });
    try {
      const pre = await wx.cloud.callFunction({
        name: 'bookOperations',
        // 单按钮逻辑：每点一次都算一次“生成”，因此强制走 force=true，不吃缓存免扣次数
        data: { action: 'reflectionPrepare', bookId, force: true }
      });
      const result = pre?.result || {};
      if (!result?.ok) {
        const code = result?.code || '';
        if (code === 'INSUFFICIENT_MATERIAL') {
          wx.showToast({ title: '素材不足：写 1 条心得或收 2 条金句', icon: 'none' });
        } else if (code === 'QUOTA_EXCEEDED') {
          wx.showToast({ title: '今日已用完 3 次', icon: 'none' });
        } else {
          wx.showToast({ title: '生成失败，请稍后重试', icon: 'none' });
        }
        this.setData({
          aiReflectionError: result?.message || '生成失败',
          aiReflection: String(result?.cachedText || this.data.aiReflection || ''),
          aiQuotaRemaining: Number(result?.quota?.remaining || 0)
        });
        return;
      }

      // Stream generation on client via wx.cloud.extend.AI
      const prompts = result?.prompts || {};
      const ai = wx?.cloud?.extend?.AI;
      if (!ai || typeof ai.createModel !== 'function') {
        wx.showToast({ title: '基础库过低，无法使用AI能力', icon: 'none' });
        this.setData({ aiReflectionError: 'wx.cloud.extend.AI 不可用' });
        return;
      }

      const model = ai.createModel(prompts.createModel || 'hunyuan-exp');
      const streamRes = await model.streamText({
        data: {
          model: prompts.model || 'hunyuan-turbos-latest',
          messages: [
            { role: 'system', content: String(prompts.system || '') },
            { role: 'user', content: String(prompts.user || '') }
          ]
        }
      });

      let acc = '';
      for await (const event of streamRes.eventStream) {
        if (event.data === '[DONE]') break;
        try {
          const data = JSON.parse(event.data);
          const delta = data?.choices?.[0]?.delta || {};
          const text = String(delta.content || '');
          if (text) {
            acc += text;
            this.setData({ aiReflection: acc });
          }
        } catch (e) {
          // ignore malformed chunk
        }
      }

      // Commit to server after streaming finished; charge quota on success.
      const commit = await wx.cloud.callFunction({
        name: 'bookOperations',
        data: { action: 'reflectionCommit', bookId, force: true, text: acc }
      });
      const committed = commit?.result || {};
      if (!committed?.ok) {
        const code = committed?.code || '';
        if (code === 'QUOTA_EXCEEDED') {
          wx.showToast({ title: '今日已用完 3 次', icon: 'none' });
          this.setData({
            aiReflection: String(committed?.cachedText || acc || ''),
            aiQuotaRemaining: Number(committed?.quota?.remaining || 0),
            aiReflectionError: committed?.message || '次数已用完'
          });
          return;
        }
        wx.showToast({ title: '保存失败，请稍后重试', icon: 'none' });
        this.setData({ aiReflectionError: committed?.message || '保存失败' });
        return;
      }

      this.setData({
        aiReflection: String(committed.text || acc || ''),
        aiQuotaRemaining: Number(committed?.quota?.remaining ?? 0),
        aiReflectionError: ''
      });
    } catch (e) {
      this.setData({ aiReflectionError: e?.errMsg || e?.message || '生成失败' });
      wx.showToast({ title: '生成失败，请稍后重试', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ aiReflectionLoading: false });
    }
  },

  copyReflection() {
    const text = String(this.data.aiReflection || '').trim();
    if (!text) return;
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制', icon: 'success', duration: 800 })
    });
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
        typeLabel: n.type === 'quote' ? '金句' : '想法',
        slideButtons: [
          {
            text: '删除',
            extClass: 'slide-btn-delete',
            data: { ts }
          }
        ]
      });
    }

    return groups.map((g) => ({ ...g, count: g.items.length }));
  },

  onTimelineSlideButtonTap(e) {
    const ts =
      e?.detail?.data?.ts ??
      e?.detail?.ts ??
      e?.currentTarget?.dataset?.ts;
    if (ts) this.deleteNote({ currentTarget: { dataset: { ts } } });
  },

  async onTimelineLongPress(e) {
    const ts = Number(e.currentTarget?.dataset?.ts || 0);
    const text = e.currentTarget?.dataset?.text || '';
    if (!ts) return;
    try {
      const res = await wx.showActionSheet({
        itemList: ['编辑', '复制', '删除'],
        itemColor: '#2E2721'
      });
      if (res.tapIndex === 0) {
        this.editNote({ currentTarget: { dataset: { ts } } });
        return;
      }
      if (res.tapIndex === 1) {
        this.copyNote({ currentTarget: { dataset: { text } } });
        return;
      }
      if (res.tapIndex === 2) {
        this.deleteNote({ currentTarget: { dataset: { ts } } });
      }
    } catch (err) {
      // canceled
    }
  },

  onTimelineDoubleTapCopy(e) {
    const ts = Number(e.currentTarget?.dataset?.ts || 0);
    const text = e.currentTarget?.dataset?.text || '';
    if (!ts || !text) return;

    const now = Date.now();
    const key = String(ts);
    const isDouble = this._dblTap.key === key && now - this._dblTap.at < 260;
    this._dblTap = { key, at: now };
    if (!isDouble) return;

    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制', duration: 600 })
    });
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

  openQuickNoteForBook() {
    const bookId = this.data.bookId || this.data.book?._id;
    if (!bookId) return;
    wx.navigateTo({ url: `/pages/quickNote/quickNote?bookId=${bookId}` });
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
      await addNoteToCloud(this.data.book._id, { text, type, bookName: this.data.book?.bookName });
      const newNotes = [
        ...this.data.notes,
        { text, type, timestamp: Date.now() }
      ];
      const thoughtList = newNotes.filter(n => n.type === 'thought');
      const quoteList = newNotes.filter(n => n.type === 'quote');
      const thoughtCount = thoughtList.length;
      const quoteCount = quoteList.length;
      const timelineGroups = this.buildTimelineGroups(newNotes);
      const exportMeta = this.buildExportMeta(thoughtCount, quoteCount);
      this.setData({
        notes: newNotes,
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
      await deleteNoteFromCloud(this.data.book._id, ts);
      const newNotes = this.data.notes.filter(n => Number(n.timestamp) !== Number(ts));
      const thoughtList = newNotes.filter(n => n.type === 'thought');
      const quoteList = newNotes.filter(n => n.type === 'quote');
      const thoughtCount = thoughtList.length;
      const quoteCount = quoteList.length;
      const timelineGroups = this.buildTimelineGroups(newNotes);
      const exportMeta = this.buildExportMeta(thoughtCount, quoteCount);
      this.setData({
        notes: newNotes,
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
    this.stopVoiceToTextIfNeeded();
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

