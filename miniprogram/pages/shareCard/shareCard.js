// pages/shareCard/shareCard.js
// 生成分享卡页面

Page({
  data: {
    bookId: '',
    bookName: '',
    authorName: '',
    quotes: [],
    selectedQuoteIdx: -1,
    generating: false,
    canGenerate: false
  },

  onLoad(options) {
    const { bookId, bookName = '', authorName = '', quotes = '' } = options;
    let parsedQuotes = [];
    try {
      parsedQuotes = quotes ? JSON.parse(decodeURIComponent(quotes)) : [];
    } catch (e) {
      parsedQuotes = [];
    }
    // Sort quotes by timestamp descending (newest first)
    parsedQuotes = parsedQuotes
      .slice()
      .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
    this.setData({
      bookId,
      bookName: decodeURIComponent(bookName || ''),
      authorName: decodeURIComponent(authorName || ''),
      quotes: parsedQuotes
    });
  },

  onBookNameInput(e) {
    this.setData({ bookName: e.detail.value });
  },

  onAuthorNameInput(e) {
    this.setData({ authorName: e.detail.value });
  },

  onQuoteSelect(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    this.setData({ selectedQuoteIdx: idx, canGenerate: idx >= 0 });
  },

  onMaskTap() {},

  onCancel() {
    wx.navigateBack();
  },

  async onConfirm() {
    if (!this.data.canGenerate || this.data.generating) return;
    const { bookName, authorName, quotes, selectedQuoteIdx } = this.data;
    const selectedQuote = quotes[selectedQuoteIdx];
    if (!selectedQuote) return;
    this.setData({ generating: true });
    try {
      await this.generateCard({
        bookName: bookName.trim(),
        authorName: authorName.trim() || '未知作者',
        quoteText: selectedQuote.text.trim()
      });
    } catch (err) {
      console.error('[shareCard] generate failed:', err);
      wx.showModal({
        title: '生成失败',
        content: err?.errMsg || '请检查相册权限后重试',
        showCancel: false
      });
    } finally {
      this.setData({ generating: false });
    }
  },

  noop() {},

  // ─── Canvas 绘制核心 ───
  async generateCard({ bookName, authorName, quoteText }) {
    const sysInfo = wx.getSystemInfoSync();
    const dpr = sysInfo.pixelRatio || 2;
    const screenWidth = sysInfo.screenWidth;

    // Canvas 尺寸（rpx → px 转换）
    // 保持 9:16 比例，用 375rpx 宽度为基准
    const cvWidth = 375;   // rpx
    const cvHeight = 667;  // rpx (9:16)
    const widthPx = Math.round(cvWidth * dpr);   // 物理像素
    const heightPx = Math.round(cvHeight * dpr);

    return new Promise((resolve, reject) => {
      const ctx = wx.createCanvasContext('cardCanvas');
      // 注意：微信 canvas 单位是 px，不是 rpx
      // 需要用 rpx 转 px 的比例来绘制
      const rpxToPx = screenWidth / 750; // 750rpx = screenWidth px

      // ── 背景白色 ──
      ctx.setFillStyle('#FFFFFF');
      ctx.fillRect(0, 0, cvWidth, cvHeight);

      // ── 上部深色区 40% ──
      const darkH = cvHeight * 0.4;
      ctx.setFillStyle('#2C3E50');
      ctx.fillRect(0, 0, cvWidth, darkH);

      // ── 书名（居中白色大字）──
      ctx.setFillStyle('#FFFFFF');
      ctx.setFontSize(28);
      ctx.setTextAlign('center');
      this.drawText(ctx, bookName, cvWidth / 2, darkH * 0.42, cvWidth - 60, 28, '#FFFFFF');

      // ── 作者名 ──
      ctx.setFillStyle('rgba(255,255,255,0.75)');
      ctx.setFontSize(15);
      ctx.setTextAlign('center');
      ctx.fillText(authorName, cvWidth / 2, darkH * 0.62);

      // ── 五星（金色）──
      const starY = darkH * 0.80;
      const starGap = 26;
      const starR = 8;
      const totalW = 5 * starGap - starGap + starR * 2;
      const startX = (cvWidth - totalW) / 2;
      ctx.setFillStyle('#D4A84B');
      for (let i = 0; i < 5; i++) {
        const sx = startX + i * starGap + starR;
        this.drawStarFive(ctx, sx, starY, starR);
      }

      // ── 下部浅色区 ──
      const lightY = darkH;
      ctx.setFillStyle('#F5F0E8');
      ctx.fillRect(0, lightY, cvWidth, cvHeight - darkH);

      // ── 装饰引号（淡色）──
      ctx.setFillStyle('rgba(44,62,80,0.09)');
      ctx.setFontSize(90);
      ctx.setTextAlign('left');
      ctx.fillText('"', 20, lightY + 90);

      // ── 金句文本（深色）──
      ctx.setFillStyle('#2C3E50');
      ctx.setFontSize(17);
      ctx.setTextAlign('left');
      const lines = this.wrapTextLines(quoteText, cvWidth - 64, 17);
      lines.slice(0, 4).forEach((line, i) => {
        ctx.fillText(line, 32, lightY + 60 + i * 28);
      });

      // ── 底部水印 ──
      ctx.setFillStyle('rgba(150,140,130,0.55)');
      ctx.setFontSize(10);
      ctx.setTextAlign('center');
      ctx.fillText('来自微信小程序——翻书随手记', cvWidth / 2, cvHeight - 24);

      ctx.draw(true, () => {
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
            wx.saveImageToPhotosAlbum({
              filePath: res.tempFilePath,
              success: () => {
                wx.showToast({ title: '已保存到相册', icon: 'success', duration: 1500 });
                resolve();
              },
              fail: (err) => {
                if (err.errMsg?.includes('auth deny') || err.errMsg?.includes('authorize')) {
                  wx.showModal({
                    title: '需要相册权限',
                    content: '请在「设置→隐私」中开启相册权限',
                    showCancel: false,
                    confirmText: '去设置',
                    success: (r) => { if (r.confirm) wx.openSetting(); }
                  });
                } else {
                  reject(err);
                }
              }
            });
          },
          fail: reject
        });
      });
    });
  },

  // 绘制五角星（实心）
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

  // 文本换行
  wrapTextLines(text, maxWidth, fontSize) {
    const chars = (text || '').split('');
    let line = '';
    const lines = [];
    // 简单按字符堆叠估宽
    const avgCharW = fontSize * 0.55;
    for (const char of chars) {
      const test = line + char;
      if (test.length * avgCharW > maxWidth && line) {
        lines.push(line);
        line = char;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  },

  // 带 maxWidth 的居中/左对齐文本绘制
  drawText(ctx, text, x, y, maxWidth, fontSize, color) {
    ctx.setFillStyle(color || '#FFFFFF');
    ctx.setFontSize(fontSize);
    ctx.setTextAlign('center');
    const chars = (text || '').split('');
    let line = '';
    let lineY = y;
    const avgCharW = fontSize * 0.55;
    const lines = [];
    for (const char of chars) {
      const test = line + char;
      if (test.length * avgCharW > maxWidth && line) {
        lines.push(line);
        line = char;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    lines.forEach((ln, i) => {
      ctx.fillText(ln, x, lineY + i * (fontSize + 6));
    });
  }
});
