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

async function traced(label, fn) {
  const start = Date.now();
  try {
    const res = await fn();
    console.log(`[ok] ${label} ${Date.now() - start}ms`);
    return res;
  } catch (e) {
    console.error(`[fail] ${label} ${Date.now() - start}ms`, e);
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
    readingBooks: []
  },

  onShow() {
    this.loadReadingBooks();
  },

  async startReading() {
    const res = await wx.showModal({
      title: '写下书名',
      content: ' ',
      editable: true,
      placeholderText: '例如：活着'
    });
    if (!res.confirm) return;
    const bookName = (res.content || '').trim();
    if (!bookName) return;

    wx.showLoading({ title: '创建中', mask: true });
    try {
      const startTime = Date.now();
      const addRes = await db.collection('books').add({
        data: {
          bookName: bookName,
          startTime: startTime,
          status: 'reading',
          notes: [],
          notesCount: 0,
          durationMin: 0
        }
      });
      wx.hideLoading();
      wx.showToast({ title: '开读！', icon: 'success', duration: 700 });
      this.loadReadingBooks();
      wx.navigateTo({
        url: `/pages/book/book?id=${addRes._id}`
      });
    } catch (err) {
      wx.hideLoading();
      wx.showModal({
        title: '创建失败',
        content: err.errMsg || JSON.stringify(err),
        showCancel: false
      });
    }
  },

  openBook(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/book/book?id=${id}` });
  },

  async loadReadingBooks() {
    this.setData({ loading: true });
    try {
      let res;
      try {
        // 优先：按开始时间倒序（需要组合索引）
        res = await traced('books.reading.list(orderBy startTime)', () =>
          withRetry(() =>
            db
              .collection('books')
              .where({ status: 'reading' })
              .orderBy('startTime', 'desc')
              .limit(50)
              .field({ notes: false })
              .get()
          )
        );
      } catch (e) {
        // 兜底：不排序查询（不依赖组合索引），确保页面可用
        const msg = e?.errMsg || '';
        if (msg.includes('timeout') || msg.includes('index')) {
          wx.showToast({ title: '排序暂不可用，请先建索引', icon: 'none', duration: 2000 });
        }
        res = await traced('books.reading.list(no orderBy)', () =>
          withRetry(() =>
            db
              .collection('books')
              .where({ status: 'reading' })
              .limit(50)
              .field({ notes: false })
              .get()
          )
        );
      }
      const books = res.data || [];
      const readingBooks = books.map(b => ({
        ...b,
        notesCount: Number(b.notesCount || 0),
        startText: formatDate(b.startTime)
      }));
      this.setData({ loading: false, readingBooks });
    } catch (e) {
      this.setData({ loading: false, readingBooks: [] });
      wx.showModal({
        title: '在读加载失败',
        content: e?.errMsg || JSON.stringify(e),
        showCancel: false
      });
    }
  }
});