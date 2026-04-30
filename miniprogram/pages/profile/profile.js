import { db, _, withRetry, withOpenIdFilter } from '../../utils/db.js';
import { adminMe } from '../../services/adminService.js';

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDate(ts) {
  const n = Number(ts || 0);
  if (!n) return '';
  const d = new Date(n);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function safeText(s) {
  return String(s ?? '').replace(/\r\n/g, '\n').trim();
}

async function fetchAllByOpenId(collectionName, options = {}) {
  const pageSize = Math.min(200, Math.max(20, Number(options.pageSize || 200)));
  const field = options.field || null;
  const orderBy = options.orderBy || '_id';
  const orderDir = options.orderDir || 'asc';

  let lastId = '';
  const out = [];
  while (true) {
    let q = db.collection(collectionName).where(withOpenIdFilter({}));
    if (lastId) {
      q = q.where(_.and(withOpenIdFilter({}), { _id: _.gt(lastId) }));
    }
    q = q.orderBy(orderBy, orderDir).limit(pageSize);
    if (field) q = q.field(field);
    const res = await withRetry(() => q.get());
    const items = (res?.data || []).filter((d) => d && d._id);
    if (items.length === 0) break;
    out.push(...items);
    lastId = items[items.length - 1]._id;
    if (items.length < pageSize) break;
  }
  return out;
}

function buildExportText({ profile, books, notes, checkins, wishlist, authors }) {
  const p = profile || {};
  const nickname = safeText(p.nickname) || '未命名';
  const gender = safeText(p.gender);
  const age = p.age != null ? String(p.age) : '';

  const lines = [];
  lines.push('翻书随手记 · 我的数据导出');
  lines.push(`导出时间：${formatDate(Date.now())}`);
  lines.push('');
  lines.push('== 用户 ==');
  lines.push(`昵称：${nickname}`);
  if (gender) lines.push(`性别：${gender}`);
  if (age) lines.push(`年龄：${age}`);
  lines.push('');

  lines.push('== 汇总 ==');
  lines.push(`书籍：${books.length} 本`);
  lines.push(`笔记：${notes.length} 条（心得/金句）`);
  lines.push(`打卡：${checkins.length} 天`);
  lines.push(`书单：${wishlist.length} 本`);
  lines.push(`作者：${authors.length} 位`);
  lines.push('');

  lines.push('== 书籍 ==');
  for (const b of books) {
    const name = safeText(b.bookName) || '未命名';
    const author = safeText(b.authorName) || '未知作者';
    const status = b.status === 'finished' ? '已读' : '在读';
    const start = formatDate(b.startTime);
    const end = formatDate(b.endTime);
    const time = b.status === 'finished' ? (end ? `（${start} ~ ${end}）` : '') : (start ? `（开始 ${start}）` : '');
    lines.push(`- ${status} 《${name}》 / ${author} ${time}`.trim());
  }
  if (books.length === 0) lines.push('- (暂无)');
  lines.push('');

  lines.push('== 笔记 ==');
  // 按书分组
  const byBook = new Map();
  for (const n of notes) {
    const bid = String(n.bookId || '');
    if (!byBook.has(bid)) byBook.set(bid, []);
    byBook.get(bid).push(n);
  }
  for (const [bid, list] of byBook.entries()) {
    const sorted = [...list].sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
    const bookName = safeText(sorted[0]?.bookName) || '未命名';
    lines.push(`- 《${bookName}》(${sorted.length} 条)`);
    for (const it of sorted) {
      const type = it.type === 'quote' ? '金句' : '心得';
      const date = formatDate(it.timestamp);
      const text = safeText(it.text).replace(/\n+/g, ' ');
      lines.push(`  - [${type}] ${date} ${text}`);
    }
  }
  if (notes.length === 0) lines.push('- (暂无)');
  lines.push('');

  lines.push('== 打卡 ==');
  const dates = [...new Set(checkins.map((c) => String(c.date || '').trim()).filter(Boolean))].sort();
  if (dates.length) {
    lines.push(dates.join('、'));
  } else {
    lines.push('(暂无)');
  }
  lines.push('');

  lines.push('== 书单 ==');
  for (const w of wishlist) {
    const title = safeText(w.title) || '未命名';
    const author = safeText(w.author) || safeText(w.authorName) || '';
    lines.push(`- 《${title}》${author ? ` / ${author}` : ''}`.trim());
  }
  if (wishlist.length === 0) lines.push('- (暂无)');
  lines.push('');

  lines.push('== 作者 ==');
  for (const a of authors) {
    const name = safeText(a.name) || safeText(a.authorName) || '未命名';
    lines.push(`- ${name}`);
  }
  if (authors.length === 0) lines.push('- (暂无)');
  lines.push('');

  return lines.join('\n').trim();
}

function toMarkdown(text) {
  // 当前导出文本已是分段结构，这里仅做轻量 Markdown 化（保持兼容易读）
  const t = safeText(text);
  if (!t) return '';
  const lines = t.split('\n');
  const out = [];
  for (const line of lines) {
    if (line.startsWith('== ') && line.endsWith(' ==')) {
      out.push(`## ${line.slice(3, -3).trim()}`);
      continue;
    }
    if (/^翻书随手记 · 我的数据导出/.test(line)) {
      out.push(`# ${line}`);
      continue;
    }
    out.push(line);
  }
  return out.join('\n').trim() + '\n';
}

function buildMarkdownFileName() {
  const d = new Date();
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  return `modu-export-${y}${m}${day}-${hh}${mm}.md`;
}

async function writeMarkdownToLocalFile(markdownText) {
  const fs = wx.getFileSystemManager?.();
  if (!fs) throw new Error('文件系统不可用');
  const fileName = buildMarkdownFileName();
  const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`;
  await new Promise((resolve, reject) => {
    fs.writeFile({
      filePath,
      data: markdownText,
      encoding: 'utf8',
      success: resolve,
      fail: reject
    });
  });
  return { filePath, fileName };
}

Page({
  data: {
    isDark: false,
    isAdmin: false,
    exporting: false,
    exportPanelVisible: false,
    exportFilePath: '',
    exportFileName: ''
  },

  onShow() {
    this.setData({ isDark: getApp()?.globalData?.isDark || false });
    this.checkAdmin();
  },

  async checkAdmin() {
    try {
      const res = await adminMe();
      this.setData({ isAdmin: !!res?.isAdmin });
    } catch (e) {
      this.setData({ isAdmin: false });
    }
  },

  goWishlist() {
    wx.navigateTo({ url: '/pages/wishlist/wishlist' });
  },

  openShelfSearch() {
    wx.navigateTo({ url: '/pages/search/search?type=book' });
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  goPersonalize() {
    wx.navigateTo({ url: '/pages/personalize/personalize' });
  },

  goUserProfile() {
    wx.navigateTo({ url: '/pages/userProfile/userProfile' });
  },

  goAdmin() {
    wx.navigateTo({ url: '/pages/admin/admin' });
  },

  goFeedback() {
    wx.navigateTo({ url: '/pages/feedback/feedback' });
  },

  async exportMyData() {
    if (this.data.exporting) return;
    let mode = 'clipboard';
    try {
      const res = await wx.showActionSheet({
        itemList: ['复制到剪贴板', '生成 Markdown 文件并分享'],
      });
      mode = res.tapIndex === 1 ? 'markdown' : 'clipboard';
    } catch (e) {
      // 用户取消
      return;
    }

    this.setData({ exporting: true });
    wx.showLoading({ title: '导出中…', mask: true });
    try {
      const app = getApp();
      const openid = app?.globalData?.openid || '';
      let profile = null;
      if (openid) {
        // users 文档通常以 openid 为 docId（兼容存在的情况）
        try {
          const userDoc = await withRetry(() => db.collection('users').doc(openid).get());
          profile = userDoc?.data || null;
        } catch (e) {
          profile = null;
        }
      }

      const [books, notes, checkins, wishlist, authors] = await Promise.all([
        fetchAllByOpenId('books', { pageSize: 200, field: { bookName: true, authorName: true, status: true, startTime: true, endTime: true } }),
        fetchAllByOpenId('notes', { pageSize: 200, field: { bookId: true, bookName: true, text: true, type: true, timestamp: true } }),
        fetchAllByOpenId('checkins', { pageSize: 200, field: { date: true } }),
        fetchAllByOpenId('wishlist', { pageSize: 200, field: { title: true, author: true, authorName: true } }),
        fetchAllByOpenId('authors', { pageSize: 200, field: { name: true, authorName: true } }),
      ]);

      const text = buildExportText({ profile, books, notes, checkins, wishlist, authors });
      if (mode === 'markdown') {
        const markdown = toMarkdown(text);
        const { filePath, fileName } = await writeMarkdownToLocalFile(markdown);
        wx.hideLoading();
        this.setData({
          exportPanelVisible: true,
          exportFilePath: filePath,
          exportFileName: fileName
        });
        wx.showToast({ title: '已生成 Markdown', icon: 'success', duration: 1200 });
      } else {
        await wx.setClipboardData({ data: text });
        wx.hideLoading();
        wx.showToast({ title: '已复制到剪贴板', icon: 'success', duration: 1200 });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showModal({
        title: '导出失败',
        content: e?.message || e?.errMsg || String(e),
        showCancel: false
      });
    } finally {
      this.setData({ exporting: false });
    }
  },

  closeExportPanel() {
    this.setData({ exportPanelVisible: false });
  },

  async shareExportFile() {
    const filePath = String(this.data.exportFilePath || '');
    if (!filePath) return;
    if (typeof wx.shareFileMessage !== 'function') {
      wx.showToast({ title: '当前环境不支持分享文件', icon: 'none' });
      return;
    }
    try {
      await wx.shareFileMessage({
        filePath,
        fileName: '我的阅读数据导出.md'
      });
      this.setData({ exportPanelVisible: false });
    } catch (e) {
      wx.showToast({ title: '分享失败', icon: 'none' });
    }
  },

  noop() {},

  async openDangerZone() {
    try {
      const res = await wx.showActionSheet({
        itemList: ['清空书单', '清空所有数据'],
        alertText: '危险操作不可恢复，请谨慎。'
      });
      if (res.tapIndex === 0) {
        this.clearWishlist();
      } else if (res.tapIndex === 1) {
        this.clearAllData();
      }
    } catch (e) {
      // 用户取消
    }
  },

  async clearWishlist() {
    const confirm = await wx.showModal({
      title: '清空书单？',
      content: '将删除你“书单”里的所有条目，此操作不可恢复。',
      confirmColor: '#C07D6B',
      confirmText: '确认清空'
    });
    if (!confirm.confirm) return;

    wx.showLoading({ title: '清空中', mask: true });
    try {
      // 分页删除（每次最多20条），使用 openid 过滤确保仅清理当前用户数据
      while (true) {
        const res = await db.collection('wishlist').where(withOpenIdFilter({})).limit(20).get();
        const items = res.data || [];
        if (items.length === 0) break;
        await Promise.all(items.map(it => db.collection('wishlist').doc(it._id).remove()));
      }
      wx.hideLoading();
      wx.showToast({ title: '书单已清空', icon: 'success', duration: 900 });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '清空失败', icon: 'none' });
    }
  },

  async clearAllData() {
    const confirm1 = await wx.showModal({
      title: '⚠️ 清空所有数据',
      content: '将删除：在读、已读、书单、以及每本书的所有记录。不可恢复。',
      confirmColor: '#C07D6B',
      confirmText: '继续'
    });
    if (!confirm1.confirm) return;

    const confirm2 = await wx.showModal({
      title: '最后确认',
      content: '真的要清空所有数据吗？建议先截图/复制重要内容备份。',
      confirmColor: '#C07D6B',
      confirmText: '确认清空'
    });
    if (!confirm2.confirm) return;

    wx.showLoading({ title: '清空中', mask: true });
    try {
      // 清空 books
      while (true) {
        const res = await db.collection('books').where(withOpenIdFilter({})).limit(20).get();
        const items = res.data || [];
        if (items.length === 0) break;
        await Promise.all(items.map(it => db.collection('books').doc(it._id).remove()));
      }
      // 清空 wishlist
      while (true) {
        const res = await db.collection('wishlist').where(withOpenIdFilter({})).limit(20).get();
        const items = res.data || [];
        if (items.length === 0) break;
        await Promise.all(items.map(it => db.collection('wishlist').doc(it._id).remove()));
      }
      // 清空 recent_notes（否则首页会残留“最近记录”）
      while (true) {
        const res = await db.collection('recent_notes').where(withOpenIdFilter({})).limit(50).get();
        const items = res.data || [];
        if (items.length === 0) break;
        await Promise.all(items.map(it => db.collection('recent_notes').doc(it._id).remove()));
      }

      wx.hideLoading();
      wx.showToast({ title: '已清空', icon: 'success', duration: 900 });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '清空失败', icon: 'none' });
    }
  }
});