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
    this.setData({
      selectedQuoteIdx: idx,
      canGenerate: idx >= 0
    });
  },

  onMaskTap() {
    // Don't close on mask tap during generation
  },

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
      this.setData({ generating: false });
    } catch (err) {
      this.setData({ generating: false });
      wx.showModal({
        title: '生成失败',
        content: err?.errMsg || '请检查相册权限后重试',
        showCancel: false
      });
    }
  },

  noop() {},

  // ─── Canvas 绘制核心 ───
  async generateCard({ bookName, authorName, quoteText }) {
    const dpr = wx.getSystemInfoSync().pixelRatio || 2;
    const cardWidth = 375;  // 设计稿宽度 rpx
    const cardHeight = 812; // 9:16 → 375:(375*16/9)≈667，但微信卡片常用 812

    // 换算物理像素
    const W = Math.round(cardWidth * dpr);
    const H = Math.round(cardHeight * dpr);

    // 创建 canvas
    return new Promise((resolve, reject) => {
      const ctx = wx.createCanvasContext('cardCanvas');

      // 填充白色背景
      ctx.setFillStyle('#FFFFFF');
      ctx.fillRect(0, 0, cardWidth, cardHeight);

      // ── 上部深色区 (40%) ──
      const darkHeight = Math.round(cardHeight * 0.4);
      ctx.setFillStyle('#2C3E50');
      ctx.fillRect(0, 0, cardWidth, darkHeight);

      // ── 书名 ──
      ctx.setFillStyle('#FFFFFF');
      ctx.setFontSize(28);
      ctx.setTextAlign('center');
      ctx.fillText(bookName, cardWidth / 2, darkHeight / 2 - 20);

      // ── 作者 ──
      ctx.setFillStyle('rgba(255,255,255,0.75)');
      ctx.setFontSize(16);
      ctx.fillText(authorName, cardWidth / 2, darkHeight / 2 + 20);

      // ── 五星评分（固定显示）──
      const starY = darkHeight / 2 + 60;
      const starSize = 16;
      const starGap = 26;
      const starStartX = (cardWidth - (5 * starGap - (starGap - starSize))) / 2;
      ctx.setFillStyle('#D4A84B');
      for (let i = 0; i < 5; i++) {
        const starX = starStartX + i * starGap + starSize / 2;
        this.drawStar(ctx, starX, starY, starSize / 2);
      }

      // ── 下部浅色区 ──
      const lightY = darkHeight;
      const lightHeight = cardHeight - darkHeight;
      ctx.setFillStyle('#F5F0E8');
      ctx.fillRect(0, lightY, cardWidth, lightHeight);

      // ── 装饰引号 ──
      ctx.setFillStyle('rgba(44,62,80,0.10)');
      ctx.setFontSize(100);
      ctx.setTextAlign('left');
      ctx.fillText('"', 24, lightY + 80);

      // ── 金句文本 ──
      ctx.setFillStyle('#2C3E50');
      ctx.setFontSize(18);
      ctx.setTextAlign('left');

      // 多行文本处理（简单截断，超过3行显示…）
      const maxWidth = cardWidth - 48;
      const lineHeight = 30;
      const lines = this.wrapText(ctx, quoteText, maxWidth, 18, 3);
      lines.forEach((line, i) => {
        ctx.fillText(line, 24, lightY + 60 + i * lineHeight);
      });

      // ── 底部水印 ──
      ctx.setFillStyle('rgba(150,140,130,0.55)');
      ctx.setFontSize(11);
      ctx.setTextAlign('center');
      ctx.fillText('来自微信小程序——翻书随手记', cardWidth / 2, cardHeight - 28);

      ctx.draw(true, () => {
        // 导出图片
        wx.canvasToTempFilePath({
          canvasId: 'cardCanvas',
          x: 0,
          y: 0,
          width: cardWidth,
          height: cardHeight,
          destWidth: W,
          destHeight: H,
          fileType: 'png',
          quality: 1,
          success: (res) => {
            // 保存到相册
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
                    content: '请在设置中开启相册权限后重试',
                    showCancel: false,
                    confirmText: '去设置',
                    success: (r) => {
                      if (r.confirm) wx.openSetting();
                    }
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

  // 画五角星辅助
  drawStar(ctx, cx, cy, r) {
    const points = 5;
    const outerR = r;
    const innerR = r * 0.38;
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const radius = i % 2 === 0 ? outerR : innerR;
      const angle = (Math.PI / points) * i - Math.PI / 2;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  },

  // 文本换行
  wrapText(ctx, text, maxWidth, fontSize, maxLines) {
    ctx.setFontSize(fontSize);
    const chars = text.split('');
    let line = '';
    const lines = [];
    for (const char of chars) {
      const testLine = line + char;
      const testWidth = ctx.measureText(testLine).width;
      if (testWidth > maxWidth && line) {
        lines.push(line);
        line = char;
        if (lines.length >= maxLines) break;
      } else {
        line = testLine;
      }
    }
    if (line && lines.length < maxLines) {
      lines.push(line);
    }
    if (lines.length >= maxLines && line !== lines[lines.length - 1]) {
      const last = lines[lines.length - 1];
      lines[lines.length - 1] = last.length > 0 ? last.slice(0, -1) + '…' : last + '…';
    }
    return lines;
  }
});
