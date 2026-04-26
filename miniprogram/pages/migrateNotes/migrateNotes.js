import { db, _, withRetry, withOpenIdFilter } from '../../utils/db.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function makeNoteDocId(bookId, ts) {
  return `${bookId}_${ts}`;
}

function normalizeType(t) {
  return t === 'thought' ? 'thought' : 'quote';
}

Page({
  onLoad() {
    this.setData({ isDark: getApp()?.globalData?.isDark || false });
  },

  data: {
    isDark: false,
    running: false,
    hasResult: false,
    booksScanned: 0,
    notesScanned: 0,
    notesWritten: 0,
    notesSkipped: 0,
    notesFailed: 0,
    elapsedMs: 0,
    logLines: []
  },

  log(line) {
    const msg = String(line || '').trim();
    if (!msg) return;
    const next = [msg, ...(this.data.logLines || [])].slice(0, 60);
    this.setData({ logLines: next });
  },

  resetStats() {
    this.setData({
      hasResult: false,
      booksScanned: 0,
      notesScanned: 0,
      notesWritten: 0,
      notesSkipped: 0,
      notesFailed: 0,
      elapsedMs: 0,
      logLines: []
    });
  },

  async onDryRun() {
    if (this.data.running) return;
    this.resetStats();
    this.setData({ running: true });
    const start = Date.now();
    try {
      await this.migrate({ dryRun: true });
    } finally {
      this.setData({ running: false, hasResult: true, elapsedMs: Date.now() - start });
    }
  },

  async onStart() {
    if (this.data.running) return;
    const { confirm } = await wx.showModal({
      title: '开始迁移？',
      content: '将写入 notes 集合。重复执行会自动跳过已存在的记录。',
      confirmText: '开始',
      cancelText: '取消'
    });
    if (!confirm) return;

    this.resetStats();
    this.setData({ running: true });
    const start = Date.now();
    try {
      await this.migrate({ dryRun: false });
      wx.showToast({ title: '迁移完成', icon: 'success', duration: 1000 });
    } catch (e) {
      wx.showModal({
        title: '迁移失败',
        content: e?.errMsg || e?.message || JSON.stringify(e),
        showCancel: false
      });
    } finally {
      this.setData({ running: false, hasResult: true, elapsedMs: Date.now() - start });
    }
  },

  async migrate({ dryRun }) {
    // Pull all books with notes; page through by _id for stability.
    const pageSize = 50;
    let lastId = '';
    let rounds = 0;

    while (true) {
      rounds += 1;
      let q = db.collection('books')
        .where(withOpenIdFilter({}));
      if (lastId) {
        q = q.where(_.and(withOpenIdFilter({}), { _id: _.gt(lastId) }));
      }

      const res = await withRetry(() =>
        q.orderBy('_id', 'asc')
          .limit(pageSize)
          .field({ _id: true, bookName: true, notes: true })
          .get()
      );

      const books = (res?.data || []).filter((b) => b && b._id);
      if (books.length === 0) break;

      this.setData({ booksScanned: this.data.booksScanned + books.length });
      lastId = books[books.length - 1]._id;

      for (const b of books) {
        const bookId = b._id;
        const bookName = (b.bookName || '未命名').trim();
        const notes = Array.isArray(b.notes) ? b.notes : [];
        if (notes.length === 0) continue;

        // Process notes sequentially per book but with small concurrency windows per chunk.
        const chunkSize = 20;
        for (let i = 0; i < notes.length; i += chunkSize) {
          const chunk = notes.slice(i, i + chunkSize);
          const tasks = chunk.map(async (n) => {
            const ts = Number(n?.timestamp || 0);
            const text = String(n?.text || '').trim();
            if (!ts || !text) return { kind: 'skip' };
            const type = normalizeType(n?.type);
            const docId = makeNoteDocId(bookId, ts);
            this.setData({ notesScanned: this.data.notesScanned + 1 });

            if (dryRun) return { kind: 'dry' };

            try {
              await withRetry(() =>
                db.collection('notes').doc(docId).create({
                  data: {
                    bookId,
                    bookName,
                    text,
                    type,
                    timestamp: ts
                  }
                })
              );
              return { kind: 'written' };
            } catch (e) {
              const msg = String(e?.errMsg || e?.message || '');
              // 已存在：create 会报错，视为跳过
              if (msg.includes('document exists') || msg.includes('already exists') || msg.includes('exist')) {
                return { kind: 'skipped' };
              }
              return { kind: 'failed', error: e };
            }
          });

          const results = await Promise.all(tasks);
          let w = 0; let s = 0; let f = 0;
          for (const r of results) {
            if (r.kind === 'written') w += 1;
            else if (r.kind === 'skipped') s += 1;
            else if (r.kind === 'failed') f += 1;
          }
          if (w) this.setData({ notesWritten: this.data.notesWritten + w });
          if (s) this.setData({ notesSkipped: this.data.notesSkipped + s });
          if (f) this.setData({ notesFailed: this.data.notesFailed + f });

          // Give UI thread some breathing room on iOS.
          await sleep(20);
        }
      }

      this.log(`已扫描到书籍 ${this.data.booksScanned} 本（轮次 ${rounds}）`);
    }
  }
});

