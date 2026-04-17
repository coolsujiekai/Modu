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
    groupedBooks: [],
    readingCount: 0,
    finishedCount: 0
  },

  onShow() {
    this.loadOverview();
    this.loadFinishedBooks();
  },

  async loadOverview() {
    try {
      const [readingRes, finishedRes] = await Promise.all([
        traced('books.reading.count', () => withRetry(() => db.collection('books').where({ status: 'reading' }).count())),
        traced('books.finished.count', () => withRetry(() => db.collection('books').where({ status: 'finished' }).count()))
      ]);
      this.setData({
        readingCount: readingRes.total || 0,
        finishedCount: finishedRes.total || 0
      });
    } catch (e) {
      // ignore overview errors
    }
  },

  async loadFinishedBooks() {
    wx.showLoading({ title: '加载中' });
    try {
      const res = await traced('books.finished.list(orderBy endTime)', () =>
        withRetry(() =>
          db
            .collection('books')
            .where({ status: 'finished' })
            .orderBy('endTime', 'desc')
            .limit(50)
            .field({ notes: false })
            .get()
        )
      );
      const books = (res.data || []).map(b => ({
        ...b,
        notesCount: Number(b.notesCount || 0),
        endText: formatDate(b.endTime)
      }));
      const groups = {};
      books.forEach(book => {
        const date = new Date(book.endTime);
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
        if (!groups[yearMonth]) groups[yearMonth] = [];
        groups[yearMonth].push(book);
      });
      const groupedBooks = Object.keys(groups).sort().reverse().map(yearMonth => ({
        yearMonth: yearMonth,
        yearMonthText: `${yearMonth.slice(0, 4)}年${Number(yearMonth.slice(5))}月`,
        books: groups[yearMonth]
      }));
      this.setData({ groupedBooks: groupedBooks });
      wx.hideLoading();
    } catch (err) {
      wx.hideLoading();
      wx.showModal({
        title: '已读加载失败',
        content: err?.errMsg || JSON.stringify(err),
        showCancel: false
      });
    }
  },

  viewBookDetail(e) {
    const book = e.currentTarget.dataset.book;
    wx.navigateTo({
      url: `/pages/book/book?id=${book._id}`
    });
  },
});