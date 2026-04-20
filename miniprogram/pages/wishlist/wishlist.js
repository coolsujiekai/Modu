import { db, withRetry, withOpenIdFilter } from '../../utils/db.js';
import { formatDateTime } from '../../utils/util.js';

Page({
  data: {
    items: []
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  async load() {
    wx.showLoading({ title: '加载中' });
    try {
      const res = await withRetry(() =>
        db.collection('wishlist')
          .where(withOpenIdFilter({}))
          .orderBy('createdAt', 'desc')
          .limit(50)
          .get()
      );
      const items = (res.data || []).map(i => ({
        ...i,
        createdText: formatDateTime(i.createdAt),
        slideButtons: [
          {
            text: '删除',
            extClass: 'slide-btn-delete',
            data: { id: i._id }
          }
        ]
      }));
      this.setData({ items });
      wx.hideLoading();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  async addItem() {
    const res = await wx.showModal({
      title: '添加到书单',
      content: ' ',
      editable: true,
      placeholderText: '输入书名（可加作者）'
    });
    if (!res.confirm) return;
    const title = (res.content || '').trim();
    if (!title) return;

    wx.showLoading({ title: '保存中', mask: true });
    try {
      await db.collection('wishlist').add({
        data: {
          title,
          createdAt: Date.now()
        }
      });
      wx.hideLoading();
      wx.showToast({ title: '已加入书单', icon: 'success', duration: 700 });
      this.load();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  async remove(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const confirm = await wx.showModal({
      title: '删除这本书？',
      content: '从书单移除即可，不影响其他记录',
      confirmColor: '#C07D6B',
      confirmText: '删除'
    });
    if (!confirm.confirm) return;

    wx.showLoading({ title: '删除中', mask: true });
    try {
      await db.collection('wishlist').doc(id).remove();
      wx.hideLoading();
      wx.showToast({ title: '已删除', icon: 'success', duration: 700 });
      this.load();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '删除失败', icon: 'none' });
    }
  }
  ,

  onSlideButtonTap(e) {
    const { id } = e.detail?.data || e.currentTarget?.dataset || {};
    if (id) {
      this.remove({ currentTarget: { dataset: { id } } });
    }
  }
});

