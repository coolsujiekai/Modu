// pages/shareCard/shareCard.js
// 生成分享卡页面

import { getPersonalizeSettings, savePersonalizeSettings } from '../../utils/personalize';

const TEMPLATES = [
  { id: 'nebula', name: '夜色流光' },
  { id: 'paper', name: '纸页留白' },
  { id: 'sunset', name: '暮光暖调' }
];

Page({
  MAX_SELECT_COUNT: 3,
  MAX_TOTAL_CHARS: 110,
  LONG_QUOTE_LIMIT_1: 58,
  LONG_QUOTE_LIMIT_2: 42,

  data: {
    isDark: false,
    bookId: '',
    bookName: '',
    authorName: '',
    quotes: [],
    displayQuotes: [],
    selectedQuoteIdxs: [],
    selectedCount: 0,
    limitHint: '最多选 3 条，合计不超过 110 字',
    layoutHint: '',
    generating: false,
    canGenerate: false,
    finishedYmdText: '',
    // 模板
    templates: TEMPLATES,
    templateId: 'nebula',
    // 预览
    previewVisible: false,
    previewSrc: '',
    previewSavedHint: ''
  },

  onLoad(options) {
    const { bookId, bookName: urlBookName = '', authorName: urlAuthorName = '', quotes: urlQuotes = '', endTime: urlEndTime = '' } = options;

    // Storage 中转（优先）：解决 URL 长度限制问题
    let bookName = urlBookName;
    let authorName = urlAuthorName;
    let endTime = urlEndTime;
    let parsedQuotes = [];

    if (bookId) {
      const key = `_share_${bookId}`;
      try {
        const stored = wx.getStorageSync(key);
        if (stored) {
          bookName = stored.bookName || urlBookName;
          authorName = stored.authorName || urlAuthorName;
          endTime = stored.endTime || urlEndTime;
          parsedQuotes = Array.isArray(stored.quotes) ? stored.quotes : [];
          wx.removeStorageSync(key);
        }
      } catch (e) {
        // ignore
      }
    }

    // URL 参数兜底（兼容旧版直接跳转）
    if (!parsedQuotes.length && urlQuotes) {
      try {
        parsedQuotes = JSON.parse(decodeURIComponent(urlQuotes)) || [];
      } catch (e) {
        parsedQuotes = [];
      }
    }

    parsedQuotes = parsedQuotes
      .slice()
      .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));

    const endTs = endTime ? Number(endTime) : NaN;
    const finishedYmdText = this.formatYearMonthDay(Number.isFinite(endTs) ? endTs : Date.now());
    const settings = getPersonalizeSettings();
    const nextTemplateId =
      settings.shareTemplateId === 'paper' || settings.shareTemplateId === 'sunset'
        ? settings.shareTemplateId
        : 'nebula';

    this.setData(
      {
        bookId,
        bookName: decodeURIComponent(bookName || ''),
        authorName: decodeURIComponent(authorName || ''),
        quotes: parsedQuotes,
        finishedYmdText,
        templateId: nextTemplateId
      },
      () => {
        this.syncQuoteSelection([]);
        if (!settings.shareFirstRunConfigured) {
          this.showFirstRunSettingsTip();
        }
      }
    );
  },

  showFirstRunSettingsTip() {
    savePersonalizeSettings({ shareFirstRunConfigured: true });
    wx.showToast({
      title: '默认模板可在「更多-个性化」调整',
      icon: 'none',
      duration: 2200
    });
  },

  formatYearMonthDay(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  },

  onBookNameInput(e) {
    this.setData({ bookName: e.detail.value });
  },

  onAuthorNameInput(e) {
    this.setData({ authorName: e.detail.value });
  },

  onTemplateChange(e) {
    const id = e?.currentTarget?.dataset?.id;
    if (!id || this.data.templateId === id) return;
    this.setData({ templateId: id });
    savePersonalizeSettings({
      shareTemplateId: id,
      shareFirstRunConfigured: true
    });
  },

  onQuoteSelect(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const set = new Set(this.data.selectedQuoteIdxs || []);
    if (set.has(idx)) {
      set.delete(idx);
    } else {
      const candidate = Array.from(set);
      candidate.push(idx);
      const check = this.checkSelectionLimit(candidate);
      if (!check.ok) {
        wx.showToast({ title: check.msg, icon: 'none' });
        return;
      }
      set.add(idx);
    }
    const selectedQuoteIdxs = Array.from(set).sort((a, b) => a - b);
    this.syncQuoteSelection(selectedQuoteIdxs);
  },

  syncQuoteSelection(selectedQuoteIdxs) {
    const idxSet = new Set(selectedQuoteIdxs || []);
    const quotes = this.data.quotes || [];
    const selectedTexts = [];

    const displayQuotes = quotes.map((item, idx) => {
      const selected = idxSet.has(idx);
      const text = (item.text || '').trim();
      if (selected) {
        selectedTexts.push(text);
      }
      return { ...item, selected };
    });

    const selectedCount = selectedQuoteIdxs.length;
    const maxCount = this.getMaxSelectableByTexts(selectedTexts);
    const baseHint = `最多选 ${maxCount} 条，合计不超过 ${this.MAX_TOTAL_CHARS} 字`;
    const limitHint = selectedCount
      ? `已选 ${selectedCount} 条 · ${baseHint}`
      : baseHint;

    const plan = selectedTexts.length ? this.planQuoteLayout(selectedTexts, 327, 320) : null;
    const layoutHint = !plan
      ? ''
      : plan.reduced
        ? `内容较长，已自动展示前 ${plan.displayTexts.length} 条金句`
        : plan.clipped
          ? '金句较长，已自动优化换行与字号'
          : '';

    this.setData({
      selectedQuoteIdxs,
      displayQuotes,
      selectedCount,
      limitHint,
      layoutHint,
      canGenerate: selectedCount > 0
    });
  },

  checkSelectionLimit(candidateIdxs) {
    const quotes = this.data.quotes || [];
    const texts = candidateIdxs
      .map((idx) => ((quotes[idx] && quotes[idx].text) || '').trim())
      .filter(Boolean);
    const totalChars = texts.reduce((sum, txt) => sum + txt.length, 0);
    const maxCount = this.getMaxSelectableByTexts(texts);
    if (texts.length > maxCount) {
      if (maxCount === 1) return { ok: false, msg: '包含较长金句时，仅可选择 1 条' };
      if (maxCount === 2) return { ok: false, msg: '包含较长金句时，最多选择 2 条' };
      return { ok: false, msg: `最多选择 ${maxCount} 条` };
    }
    if (totalChars > this.MAX_TOTAL_CHARS) {
      return { ok: false, msg: `总字数最多 ${this.MAX_TOTAL_CHARS} 字` };
    }
    return { ok: true };
  },

  getMaxSelectableByTexts(texts) {
    const lengths = (texts || []).map((txt) => txt.length);
    if (lengths.some((len) => len >= this.LONG_QUOTE_LIMIT_1)) return 1;
    if (lengths.some((len) => len >= this.LONG_QUOTE_LIMIT_2)) return 2;
    return this.MAX_SELECT_COUNT;
  },

  planQuoteLayout(quoteTexts, panelWidth, panelHeight) {
    const normalized = (quoteTexts || []).filter(Boolean);
    const candidates = normalized.slice(0, this.MAX_SELECT_COUNT);
    const counts = [];
    for (let c = candidates.length; c >= 1; c--) counts.push(c);
    const quotePaddingX = 28;
    const fontCandidates = [16, 15, 14];

    for (let ci = 0; ci < counts.length; ci++) {
      const count = counts[ci];
      const texts = candidates.slice(0, count);
      for (let fi = 0; fi < fontCandidates.length; fi++) {
        const fontSize = fontCandidates[fi];
        const lineHeight = Math.round(fontSize * 1.55);
        const maxWidth = panelWidth - quotePaddingX * 2;
        const maxLinesEach = count === 1 ? 8 : count === 2 ? 5 : 3;

        let totalH = 0;
        let overflowLines = 0;
        for (let i = 0; i < texts.length; i++) {
          const lines = this.estimateWrapLines(texts[i], maxWidth, fontSize);
          const usedLines = Math.min(lines.length, maxLinesEach);
          overflowLines += Math.max(0, lines.length - maxLinesEach);
          totalH += usedLines * lineHeight + (count > 1 ? 32 : 24);
        }
        totalH += count > 1 ? 32 : 24;
        const canUse = totalH <= panelHeight && (overflowLines === 0 || count === 1);
        if (canUse) {
          return {
            displayTexts: texts,
            fontSize,
            lineHeight,
            maxLinesEach,
            reduced: count < normalized.length,
            clipped: overflowLines > 0,
            overflowLines
          };
        }
      }
    }
    return {
      displayTexts: normalized.slice(0, 1),
      fontSize: 14,
      lineHeight: 24,
      maxLinesEach: 6,
      reduced: normalized.length > 1,
      clipped: true,
      overflowLines: 1
    };
  },

  estimateWrapLines(text, maxWidth, fontSize) {
    const unitPx = fontSize * 0.56;
    const chars = (text || '').split('');
    let currentWidth = 0;
    let current = '';
    const lines = [];
    chars.forEach((char) => {
      const width = this.measureCharWidth(char, fontSize, unitPx);
      if (current && currentWidth + width > maxWidth) {
        lines.push(current);
        current = char;
        currentWidth = width;
      } else {
        current += char;
        currentWidth += width;
      }
    });
    if (current) lines.push(current);
    return lines;
  },

  measureCharWidth(char, fontSize, unitPx) {
    if (this._measureCtx) {
      this._measureCtx.font = `${fontSize}px sans-serif`;
      const measured = this._measureCtx.measureText(char).width;
      if (measured > 0) return measured;
    }
    return unitPx * this.getCharUnit(char);
  },

  getCharUnit(char) {
    if (!char) return 1;
    if (/[a-zA-Z0-9]/.test(char)) return 0.56;
    if (/[.,:;!?'"`~\-_/\\|]/.test(char)) return 0.45;
    if (/\s/.test(char)) return 0.35;
    return 1;
  },

  onMaskTap() {},

  onCancel() {
    wx.navigateBack();
  },

  async onConfirm() {
    if (!this.data.canGenerate || this.data.generating) return;
    await this.generateAndSaveCard();
  },

  async generateAndSaveCard() {
    const {
      bookName,
      authorName,
      quotes,
      selectedQuoteIdxs,
      finishedYmdText,
      templateId
    } = this.data;

    const quoteTexts = (selectedQuoteIdxs || [])
      .map((idx) => quotes[idx])
      .filter(Boolean)
      .map((item) => (item.text || '').trim())
      .filter(Boolean);
    if (!quoteTexts.length) return;

    const layoutPlan = this.planQuoteLayout(quoteTexts, 327, 320);
    const payload = {
      bookName: (bookName || '').trim() || '未命名书籍',
      authorName: (authorName || '').trim() || '未知作者',
      finishedYmdText,
      quoteTexts,
      layoutPlan,
      templateId
    };

    this.setData({
      generating: true,
      previewVisible: false,
      previewSrc: '',
      previewSavedHint: ''
    });

    try {
      const tempPath = await this.buildCardToTempPath(payload);
      if (!tempPath || typeof tempPath !== 'string' || tempPath.length < 10) {
        throw new Error('INVALID_TEMP_PATH');
      }

      this.setData({
        previewVisible: true,
        previewSrc: tempPath,
        previewSavedHint: '长按图片保存到相册'
      });
      wx.showToast({ title: '长按图片保存', icon: 'none', duration: 1400 });
    } catch (err) {
      const hintMsg = '保存失败，请稍后重试';
      this.setData({ previewVisible: true, previewSavedHint: hintMsg });
      wx.showToast({ title: hintMsg, icon: 'none' });
      console.error('[shareCard] generate failed:', err);
    } finally {
      this.setData({ generating: false });
    }
  },

  onPreviewClose() {
    this.setData({ previewVisible: false, previewSrc: '', previewSavedHint: '' });
    wx.navigateBack();
  },

  onPreviewOpenImage() {
    const src = this.data.previewSrc;
    if (!src) return;
    wx.previewImage({
      urls: [src],
      current: src
    });
  },

  noop() {},

  getPalette(templateId) {
    // 极简留白风格：不做复杂背景，突出内容本身（用于提高传播与转化）
    // 保留 templateId 入口（兼容个性化设置），但视觉统一走极简卡片。
    return {
      bg: '#FFFFFF',
      surface: '#FFFFFF',
      text: '#111111',
      muted: 'rgba(17,17,17,0.55)',
      faint: 'rgba(17,17,17,0.10)',
      accent: '#2C3E50'
    };
  },

  buildCardToTempPath(payload) {
    const sysInfo = wx.getSystemInfoSync();
    const dpr = sysInfo.pixelRatio || 2;
    const cvWidth = 375;
    const cvHeight = 667;
    const widthPx = Math.round(cvWidth * dpr);
    const heightPx = Math.round(cvHeight * dpr);

    const {
      bookName,
      authorName,
      finishedYmdText,
      quoteTexts,
      layoutPlan,
      templateId
    } = payload;

    const palette = this.getPalette(templateId);
    const renderQuotes = (layoutPlan?.displayTexts || quoteTexts || []).slice(0, 3);

    return new Promise((resolve, reject) => {
      const ctx = wx.createCanvasContext('cardCanvas');
      this._measureCtx = wx.createOffscreenCanvas
        ? wx.createOffscreenCanvas({ type: '2d', width: 300, height: 120 }).getContext('2d')
        : null;

      // 极简分享卡：书名 + ⭐精选一句 + 其他摘录(2-3条) + 阅读时间 + 引导文案
      this._drawMinimalCard(ctx, cvWidth, cvHeight, palette, bookName, renderQuotes, finishedYmdText);

      let afterDrawStarted = false;
      const runAfterDraw = () => {
        if (afterDrawStarted) return;
        afterDrawStarted = true;
        this._measureCtx = null;
        let exportTimedOut = false;
        const exportTimeout = setTimeout(() => {
          exportTimedOut = true;
          reject(Object.assign(new Error('CANVAS_EXPORT_TIMEOUT'), { code: 'CANVAS_EXPORT_TIMEOUT' }));
        }, 9000);

        const exportCanvas = (retryLeft = 1) => {
          wx.canvasToTempFilePath({
            canvasId: 'cardCanvas',
            x: 0,
            y: 0,
            width: cvWidth,
            height: cvHeight,
            destWidth: widthPx,
            destHeight: heightPx,
            fileType: 'png',
            quality: 1,
            success: (res) => {
              if (exportTimedOut) return;
              clearTimeout(exportTimeout);
              resolve(res.tempFilePath);
            },
            fail: (err) => {
              if (exportTimedOut) return;
              const msg = String(err?.errMsg || err?.message || '').toLowerCase();
              if (retryLeft > 0 && msg.includes('timeout')) {
                setTimeout(() => exportCanvas(retryLeft - 1), 280);
                return;
              }
              clearTimeout(exportTimeout);
              reject(err);
            }
          });
        };

        exportCanvas(1);
      };

      // 真机上 draw 回调偶发不触发：同时保留回调和延迟兜底
      ctx.draw(false, () => {
        setTimeout(runAfterDraw, 120);
      });
      setTimeout(runAfterDraw, 550);
    });
  },

  _drawBackground(ctx, cvWidth, cvHeight, palette, templateId) {
    // 兼容旧逻辑：极简模式下只铺底色
    ctx.setFillStyle(palette.bg || '#FFFFFF');
    ctx.fillRect(0, 0, cvWidth, cvHeight);
  },

  _drawMinimalCard(ctx, cvWidth, cvHeight, palette, bookName, renderQuotes, finishedYmdText) {
    // 背景：纯白
    ctx.setFillStyle(palette.bg || '#FFFFFF');
    ctx.fillRect(0, 0, cvWidth, cvHeight);

    const paddingX = 28;
    const contentW = cvWidth - paddingX * 2;
    let y = 52;

    // 顶部叙述：我在某天读完《某书》
    const safeBookName = (bookName || '').trim() || '未命名书籍';
    const headerLine = finishedYmdText
      ? `我在${finishedYmdText}读完《${safeBookName}》`
      : `我读完了《${safeBookName}》`;
    ctx.setFillStyle(palette.text);
    ctx.setTextAlign('left');
    ctx.setTextBaseline('top');
    ctx.setFontSize(15);
    const headerLines = this.clampLines(this.wrapTextLines(headerLine, contentW, 15), 2);
    headerLines.forEach((line, idx) => {
      ctx.fillText(line, paddingX, y + idx * 22);
    });
    y += headerLines.length * 22 + 18;

    // 单独保留书名，让信息更完整，也形成更好的字号层级
    ctx.setFillStyle(palette.text);
    ctx.setFontSize(28);
    const bookLines = this.clampLines(this.wrapTextLines(safeBookName, contentW, 28), 2);
    bookLines.forEach((line, idx) => {
      ctx.fillText(line, paddingX, y + idx * 38);
    });
    y += bookLines.length * 38 + 26;

    // 分隔线（极淡）
    ctx.setStrokeStyle(palette.faint || 'rgba(0,0,0,0.08)');
    ctx.setLineWidth(1);
    ctx.beginPath();
    ctx.moveTo(paddingX, y);
    ctx.lineTo(paddingX + contentW, y);
    ctx.stroke();
    y += 26;

    // ⭐精选一句（最突出）
    const featured = (renderQuotes && renderQuotes[0] ? String(renderQuotes[0]).trim() : '') || '（未选择摘录）';
    ctx.setFillStyle(palette.muted);
    ctx.setFontSize(12);
    ctx.fillText('⭐ 精选一句', paddingX, y);
    y += 22;

    // 重要：精选句必须完整展示
    // 做法：根据可用高度自动降字号/行高，必要时让出“其他摘录”空间，优先保证完整显示（不截断）。
    const bottomPad = 28;
    const ctaMaxLines = 2;
    const ctaLineH = 18;
    const reservedBottomH = bottomPad + 18 + ctaLineH * ctaMaxLines + 18; // 底部 CTA + 留白
    const contentBottomLimit = cvHeight - reservedBottomH;

    const featuredFontCandidates = [22, 20, 18, 16, 15, 14];
    let featuredFont = featuredFontCandidates[0];
    let featuredLineH = Math.round(featuredFont * 1.55);
    let featuredLines = this.wrapTextLines(featured, contentW, featuredFont);

    for (let i = 0; i < featuredFontCandidates.length; i++) {
      const f = featuredFontCandidates[i];
      const lh = Math.round(f * 1.55);
      const lines = this.wrapTextLines(featured, contentW, f);
      const h = lines.length * lh;
      if (y + h <= contentBottomLimit) {
        featuredFont = f;
        featuredLineH = lh;
        featuredLines = lines;
        break;
      }
      // 即使不满足，也先记录最小字号结果，后面会通过不渲染“其他摘录”等方式尽量兜底
      featuredFont = f;
      featuredLineH = lh;
      featuredLines = lines;
    }

    // 若在最小字号下仍超出，则进一步压缩行高（仍不截断，允许更紧凑）
    if (y + featuredLines.length * featuredLineH > contentBottomLimit) {
      featuredLineH = Math.max(18, Math.round(featuredFont * 1.35));
    }
    if (y + featuredLines.length * featuredLineH > contentBottomLimit) {
      featuredLineH = Math.max(16, Math.round(featuredFont * 1.22));
    }

    ctx.setFillStyle(palette.text);
    ctx.setFontSize(featuredFont);
    featuredLines.forEach((line, idx) => {
      ctx.fillText(line, paddingX, y + idx * featuredLineH);
    });
    y += featuredLines.length * featuredLineH + 26;

    // 其他摘录（2-3条，弱化）
    const others = (renderQuotes || []).slice(1, 4).map((t) => String(t || '').trim()).filter(Boolean);
    if (others.length && y < contentBottomLimit - 70) {
      ctx.setFillStyle(palette.muted);
      ctx.setFontSize(12);
      ctx.fillText('其他摘录', paddingX, y);
      y += 18;

      const otherFont = 14;
      const otherLineH = 22;
      const otherMaxLinesEach = 2;
      ctx.setFillStyle(palette.text);
      ctx.setFontSize(otherFont);
      // 根据剩余空间动态裁剪条数（优先保证精选句完整展示）
      const maxOthers = 3;
      const availableForOthers = contentBottomLimit - y;
      const estimatedEach = otherLineH * 2 + 10;
      const allowedCount = Math.max(0, Math.min(maxOthers, Math.floor((availableForOthers - 20) / estimatedEach)));
      others.slice(0, allowedCount).forEach((quote) => {
        const prefix = '· ';
        const maxW = contentW - 14;
        const lines = this.clampLines(this.wrapTextLines(quote, maxW, otherFont), otherMaxLinesEach);
        lines.forEach((line, idx) => {
          const textLine = idx === 0 ? `${prefix}${line}` : `  ${line}`;
          ctx.fillText(textLine, paddingX, y + idx * otherLineH);
        });
        y += lines.length * otherLineH + 10;
      });
      y += 14;
    }

    // 底部：只保留一句转化文案
    const cta1 = '我用微信小程序「翻书随手记」记下每次读书的触动';
    const footerY = cvHeight - bottomPad - 18;
    ctx.setFillStyle(palette.muted);
    ctx.setFontSize(12);
    ctx.setTextAlign('left');
    ctx.setTextBaseline('alphabetic');
    const ctaLines = this.clampLines(this.wrapTextLines(cta1, contentW, 12), 2);
    ctaLines.forEach((line, idx) => {
      ctx.fillText(line, paddingX, footerY + idx * 18);
    });
  },

  _drawNebulaDecor(ctx, cvWidth, cvHeight, palette) {
    const cx = cvWidth * 0.5;
    const cy = 50;

    ctx.save();

    const moonGlow = ctx.createLinearGradient(cx - 60, cy - 60, cx + 60, cy + 60);
    moonGlow.addColorStop(0, 'rgba(255,255,255,0.35)');
    moonGlow.addColorStop(0.5, 'rgba(255,255,255,0.15)');
    moonGlow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.setFillStyle(moonGlow);
    ctx.beginPath();
    ctx.arc(cx, cy, 60, 0, Math.PI * 2);
    ctx.fill();

    ctx.setFillStyle('rgba(255,255,255,0.95)');
    ctx.beginPath();
    ctx.arc(cx, cy, 28, 0, Math.PI * 2);
    ctx.fill();

    const stars = [
      { x: 45, y: 100, r: 1.5 },
      { x: 300, y: 80, r: 1.8 },
      { x: 55, y: 280, r: 1.2 },
      { x: 330, y: 250, r: 1.5 },
      { x: 320, y: 450, r: 1.0 },
    ];
    stars.forEach((s) => {
      ctx.setFillStyle('rgba(255,255,255,0.70)');
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.restore();
  },

  _drawPaperDecor(ctx, cvWidth, cvHeight, palette) {
    ctx.save();

    ctx.fillStyle = palette.accentLine || '#C4A77D';
    ctx.fillRect(cvWidth / 2 - 35, 48, 70, 1.5);

    ctx.restore();
  },

  _drawSunsetDecor(ctx, cvWidth, cvHeight, palette) {
    const cx = cvWidth * 0.5;
    const cy = 30;

    ctx.save();

    const sunGlow = ctx.createLinearGradient(cx - 100, cy, cx + 100, cy + 80);
    sunGlow.addColorStop(0, 'rgba(255,180,80,0.30)');
    sunGlow.addColorStop(0.5, 'rgba(255,140,60,0.15)');
    sunGlow.addColorStop(1, 'rgba(200,80,40,0)');
    ctx.setFillStyle(sunGlow);
    ctx.beginPath();
    ctx.arc(cx, cy + 10, 80, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,200,120,0.08)';
    ctx.lineWidth = 1;
    const ray1X = cx - 50;
    ctx.beginPath();
    ctx.moveTo(ray1X, cy + 50);
    ctx.lineTo(ray1X - 30, cvHeight);
    ctx.stroke();

    const ray2X = cx + 55;
    ctx.beginPath();
    ctx.moveTo(ray2X, cy + 50);
    ctx.lineTo(ray2X + 25, cvHeight);
    ctx.stroke();

    ctx.restore();
  },

  _drawHeader(ctx, cvWidth, palette, bookName, authorName, finishedYmdText, templateId) {
    let titleStartY;
    const baseY = templateId === 'sunset' ? 150 : 130;

    ctx.setFillStyle(palette.title);
    ctx.setFontSize(30);
    ctx.setTextAlign('center');
    ctx.setTextBaseline('alphabetic');
    const titleLines = this.clampLines(this.wrapTextLines(bookName, cvWidth - 80, 30), 2);
    titleStartY = baseY;
    titleLines.forEach((line, i) => {
      ctx.fillText(line, cvWidth / 2, titleStartY + i * 38);
    });

    ctx.setFillStyle(palette.sub || palette.subText);
    ctx.setFontSize(13);
    ctx.fillText(authorName || '', cvWidth / 2, titleStartY + titleLines.length * 38 + 22);

    const finishDateY = titleStartY + titleLines.length * 38 + 48;
    const finishDateLine = finishedYmdText
      ? `${finishedYmdText.replace(/年(\d)月(\d)日/, '.$1.$2')} · 我读完这本书`
      : null;
    if (finishDateLine) {
      ctx.setFillStyle(palette.subText || palette.sub || 'rgba(255,255,255,0.60)');
      ctx.setFontSize(11);
      ctx.setTextAlign('center');
      ctx.setTextBaseline('alphabetic');
      ctx.fillText(finishDateLine, cvWidth / 2, finishDateY);
      return finishDateY + 18;
    }
    return finishDateY;
  },

  _drawStars(ctx, cvWidth, startY, palette) {
    const starY = startY + 28;
    const starGap = 24;
    const starR = 6.5;
    const totalW = 5 * starGap - starGap + starR * 2;
    const xStart = (cvWidth - totalW) / 2;

    ctx.setFillStyle(palette.star);
    for (let i = 0; i < 5; i++) {
      const sx = xStart + i * starGap + starR;
      this.drawStarFive(ctx, sx, starY, starR);
    }
  },

  _drawContentPanel(ctx, cvWidth, palette, renderQuotes, layoutPlan, templateId) {
    const panelX = 24;
    const panelY = 250;
    const panelW = cvWidth - panelX * 2;
    const panelH = 320;

    this.drawRoundRect(ctx, panelX, panelY, panelW, panelH, 12);
    ctx.setFillStyle(palette.panel);
    ctx.fill();

    if (palette.panelBorder) {
      ctx.strokeStyle = palette.panelBorder;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.setTextAlign('center');
    ctx.setTextBaseline('alphabetic');
    ctx.setFillStyle(palette.panelHint);
    ctx.setFontSize(11);
    ctx.fillText('摘抄 · 金句', cvWidth / 2, panelY + 28);

    const quotePaddingX = 24;
    const quoteBaseX = panelX + quotePaddingX;
    const quoteMaxW = panelW - quotePaddingX * 2;
    const baseY = panelY + 50;
    const fontSize = layoutPlan?.fontSize || 15;
    const lineHeight = layoutPlan?.lineHeight || Math.round(fontSize * 1.6);
    const maxLinesEach = layoutPlan?.maxLinesEach || (renderQuotes.length === 1 ? 8 : renderQuotes.length === 2 ? 5 : 3);
    let currentY = baseY;

    renderQuotes.forEach((quote, i) => {
      const itemY = currentY;
      const lines = this.clampLines(
        this.wrapTextLines(quote, quoteMaxW, fontSize),
        maxLinesEach
      );
      ctx.setFillStyle(palette.panelText);
      ctx.setFontSize(fontSize);
      ctx.setTextAlign('left');
      ctx.setTextBaseline('top');
      lines.forEach((line, lineIdx) => {
        ctx.fillText(line, quoteBaseX, itemY + lineIdx * lineHeight);
      });

      const textHeight = Math.max(lineHeight, lines.length * lineHeight);
      const blockGap = renderQuotes.length > 1 ? 22 : 16;
      const nextY = itemY + textHeight + blockGap;
      if (i < renderQuotes.length - 1) {
        ctx.setStrokeStyle(palette.separator);
        ctx.beginPath();
        ctx.moveTo(quoteBaseX, nextY - 10);
        ctx.lineTo(panelX + panelW - quotePaddingX, nextY - 10);
        ctx.stroke();
      }
      currentY = nextY;
    });

    return panelY + panelH;
  },

  _drawFooter(ctx, cvWidth, cvHeight, palette, templateId) {
    // 旧模板页脚保留（当前极简模式不调用）
    ctx.setFillStyle('rgba(17,17,17,0.55)');
    ctx.setFontSize(11);
    ctx.setTextAlign('center');
    ctx.setTextBaseline('alphabetic');
    ctx.fillText('翻书随手记', cvWidth / 2, cvHeight - 28);
  },

  saveTempPathToAlbum(tempFilePath) {
    return new Promise((resolve, reject) => {
      wx.saveImageToPhotosAlbum({
        filePath: tempFilePath,
        success: () => {
          resolve();
        },
        fail: (err) => {
          const msg = err?.errMsg || '';
          console.error('[shareCard] save to album failed, errMsg:', msg, 'code:', err?.code);
          const lowerMsg = msg.toLowerCase();
          if (lowerMsg.includes('auth deny') || lowerMsg.includes('authorize') ||
              lowerMsg.includes('auth denied') || lowerMsg.includes('授权') ||
              lowerMsg.includes('权限') || lowerMsg.includes('permission')) {
            reject(Object.assign(new Error(msg || 'AUTH_DENY'), { code: 'AUTH_DENY', errMsg: msg }));
          } else if (lowerMsg.includes('fail file not exist') || lowerMsg.includes('file not exist') ||
                     lowerMsg.includes('文件') || lowerMsg.includes('不存在')) {
            reject(Object.assign(new Error('FILE_NOT_EXIST'), { code: 'FILE_NOT_EXIST', errMsg: msg }));
          } else {
            reject(Object.assign(new Error(msg || 'SAVE_FAILED'), { code: 'SAVE_FAILED', errMsg: msg }));
          }
        }
      });
    });
  },

  drawRoundRect(ctx, x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  },

  clampLines(lines, maxLines) {
    if (!Array.isArray(lines) || lines.length <= maxLines) return lines || [];
    const result = lines.slice(0, maxLines);
    const last = result[maxLines - 1] || '';
    result[maxLines - 1] = last.length > 1 ? `${last.slice(0, last.length - 1)}…` : '…';
    return result;
  },

  drawStarFive(ctx, cx, cy, r) {
    const points = [];
    for (let i = 0; i < 10; i++) {
      const angle = (Math.PI / 5) * i - Math.PI / 2;
      const radius = i % 2 === 0 ? r : r * 0.38;
      points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
    }
    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p[0], p[1]);
      else ctx.lineTo(p[0], p[1]);
    });
    ctx.closePath();
    ctx.fill();
  },

  wrapTextLines(text, maxWidth, fontSize) {
    const unitPx = fontSize * 0.56;
    const chars = (text || '').split('');
    let line = '';
    let width = 0;
    const lines = [];
    for (let i = 0; i < chars.length; i++) {
      const char = chars[i];
      const charWidth = this.measureCharWidth(char, fontSize, unitPx);
      if (line && width + charWidth > maxWidth) {
        lines.push(line);
        line = char;
        width = charWidth;
      } else {
        line += char;
        width += charWidth;
      }
    }
    if (line) lines.push(line);
    return lines;
  }
});
