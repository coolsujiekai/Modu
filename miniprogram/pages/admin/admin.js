import { adminMe, adminStats, adminListUsers, adminListTestDevices, adminResetTestUser, adminListFeedback, adminListChallenges, adminCreateChallenge, adminStartChallenge, adminEndChallenge, adminGetChallengeFeatureFlag, adminSetChallengeFeatureFlag } from '../../services/adminService.js';

Page({
  data: {
    stats: {
      registeredUsers: 0,
      booksReading: 0,
      booksFinished: 0,
      quoteTotal: 0,
      thoughtTotal: 0,
      aiGenerations: 0,
      wishlistTotal: 0,
      wishlistTop: []
    },
    users: [],
    offset: 0,
    hasMore: true,
    loadingMore: false,

    testDevices: [],
    testDeviceIndex: 0,
    confirmText: '',
    resetting: false,
    lastResetResult: null,

    testDeviceDisplayText: '',

    feedbackItems: [],
    feedbackOffset: 0,
    feedbackHasMore: true,
    feedbackLoadingMore: false,

    challenges: [],
    creating: false,
    templateCreating: false,
    challengeFeatureEnabled: true,
    challengeFeatureLoading: false,
    startingId: '',
    endingId: '',
  },

  async onLoad() {
    await this.guard();
    await this.loadTestDevices();
    await this.refresh();
    await this.loadFeedback(true);
    await this.loadChallenges();
    await this.loadChallengeFeatureFlag();
  },

  goHotWishlist() {
    wx.navigateTo({ url: '/pages/adminWishlist/adminWishlist' });
  },

  formatTs(ts) {
    const n = Number(ts || 0);
    if (!n) return '';
    const d = new Date(n);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  async guard() {
    try {
      const me = await adminMe();
      if (!me?.isAdmin) {
        wx.showModal({
          title: '无权限',
          content: '当前账号不是管理员。',
          showCancel: false
        });
        wx.navigateBack();
      }
    } catch (e) {
      wx.showModal({
        title: '加载失败',
        content: e?.message || e?.errMsg || String(e),
        showCancel: false
      });
      wx.navigateBack();
    }
  },

  async loadTestDevices() {
    try {
      const res = await adminListTestDevices();
      const devices = Array.isArray(res?.devices) ? res.devices : [];
      this.setData({ testDevices: devices, testDeviceIndex: 0 });
      this.updateTestDeviceDisplayText(0, devices);
    } catch (e) {
      this.setData({ testDevices: [] });
    }
  },

  updateTestDeviceDisplayText(index, devices) {
    const list = Array.isArray(devices) ? devices : (this.data.testDevices || []);
    const idx = Math.max(0, Math.min(list.length - 1, Number(index || 0)));
    const d = list[idx] || null;
    const label = String(d?.label || '未命名');
    const openid = String(d?.openid || '');
    const suffix = openid ? openid.slice(-6) : '';
    const text = openid ? `${label}（${suffix}）` : '';
    this.setData({ testDeviceDisplayText: text });
  },

  async refresh() {
    wx.showLoading({ title: '加载中', mask: true });
    try {
      const [s, u] = await Promise.all([
        adminStats(),
        adminListUsers(0, 20)
      ]);
      wx.hideLoading();
      const users = (u.users || []).map((it) => ({
        ...it,
        userNo: it.userNo || '-',
        nickname: it.nickname || '未命名',
      }));
      this.setData({
        stats: s.stats || {
          registeredUsers: 0,
          booksReading: 0,
          booksFinished: 0,
          quoteTotal: 0,
          thoughtTotal: 0,
          aiGenerations: 0,
          wishlistTotal: 0,
          wishlistTop: []
        },
        users,
        offset: u.nextOffset || 0,
        hasMore: users.length >= 20
      });
    } catch (e) {
      wx.hideLoading();
      wx.showModal({
        title: '加载失败',
        content: e?.message || e?.errMsg || String(e),
        showCancel: false
      });
    }
  },

  async loadMore() {
    if (this.data.loadingMore || !this.data.hasMore) return;
    this.setData({ loadingMore: true });
    try {
      const res = await adminListUsers(this.data.offset, 20);
      const more = (res.users || []).map((it) => ({
        ...it,
        userNo: it.userNo || '-',
        nickname: it.nickname || '未命名',
      }));
      const next = [...(this.data.users || []), ...more];
      this.setData({
        users: next,
        offset: res.nextOffset || this.data.offset,
        hasMore: more.length >= 20,
        loadingMore: false
      });
    } catch (e) {
      this.setData({ loadingMore: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  }
  ,

  onPickTestDevice(e) {
    const idx = Number(e?.detail?.value || 0);
    if (!Number.isFinite(idx)) return;
    this.setData({ testDeviceIndex: idx, lastResetResult: null });
    this.updateTestDeviceDisplayText(idx);
  },

  onConfirmInput(e) {
    this.setData({ confirmText: String(e?.detail?.value ?? ''), lastResetResult: null });
  },

  async resetSelectedTestUser() {
    if (this.data.resetting) return;
    const confirmText = String(this.data.confirmText || '').trim();
    if (confirmText !== 'DELETE') {
      wx.showToast({ title: '请输入 DELETE', icon: 'none' });
      return;
    }

    const devices = this.data.testDevices || [];
    const d = devices[this.data.testDeviceIndex] || null;
    const openid = String(d?.openid || '').trim();
    if (!openid) {
      wx.showToast({ title: '请选择测试设备', icon: 'none' });
      return;
    }

    const confirm1 = await wx.showModal({
      title: '重置测试账号？',
      content: `将删除该 openid 的 users/books/wishlist/recent_notes 数据。此操作不可恢复。`,
      confirmText: '确认重置',
      confirmColor: '#C07D6B'
    });
    if (!confirm1.confirm) return;

    this.setData({ resetting: true });
    wx.showLoading({ title: '重置中', mask: true });
    try {
      const res = await adminResetTestUser(openid, 'DELETE');
      wx.hideLoading();
      this.setData({ resetting: false, lastResetResult: res?.counts || null, confirmText: '' });
      wx.showToast({ title: '已重置', icon: 'success' });
      await this.refresh();
    } catch (e) {
      wx.hideLoading();
      this.setData({ resetting: false });
      const msg = e?.message || e?.errMsg || String(e);
      wx.showModal({ title: '重置失败', content: msg, showCancel: false });
    }
  }
  ,

  async loadFeedback(reset = false) {
    if (this.data.feedbackLoadingMore) return;
    if (!reset && !this.data.feedbackHasMore) return;

    const offset = reset ? 0 : Number(this.data.feedbackOffset || 0);
    const limit = 20;
    this.setData({ feedbackLoadingMore: true });
    try {
      const res = await adminListFeedback(offset, limit);
      const items = (res.items || []).map((it) => ({
        ...it,
        content: it.content || '',
        createdText: this.formatTs(it.createdAt)
      }));
      const next = reset ? items : [...(this.data.feedbackItems || []), ...items];
      this.setData({
        feedbackItems: next,
        feedbackOffset: res.nextOffset || (offset + items.length),
        feedbackHasMore: items.length >= limit,
        feedbackLoadingMore: false
      });
    } catch (e) {
      this.setData({ feedbackLoadingMore: false });
      if (reset) this.setData({ feedbackItems: [] });
    }
  },

  loadMoreFeedback() {
    return this.loadFeedback(false);
  },

  async loadChallenges() {
    try {
      const res = await adminListChallenges('');
      this.setData({ challenges: res.items || [] });
    } catch (e) {
      // ignore
    }
  },

  async loadChallengeFeatureFlag() {
    this.setData({ challengeFeatureLoading: true });
    try {
      const res = await adminGetChallengeFeatureFlag();
      this.setData({ challengeFeatureEnabled: res?.enabled !== false, challengeFeatureLoading: false });
    } catch (e) {
      this.setData({ challengeFeatureEnabled: true, challengeFeatureLoading: false });
    }
  },

  async onToggleChallengeFeature(e) {
    const enabled = !!e?.detail?.value;
    this.setData({ challengeFeatureLoading: true });
    try {
      const res = await adminSetChallengeFeatureFlag(enabled);
      this.setData({ challengeFeatureEnabled: res?.enabled !== false, challengeFeatureLoading: false });
      wx.showToast({ title: enabled ? '已开启' : '已关闭', icon: 'success', duration: 700 });
    } catch (err) {
      this.setData({ challengeFeatureLoading: false });
      wx.showToast({ title: err?.message || '操作失败', icon: 'none' });
    }
  },

  formatDate(ts) {
    const n = Number(ts || 0);
    if (!n) return '-';
    const d = new Date(n);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  statusLabel(status) {
    const map = { pending: '待开始', active: '进行中', ended: '已结束' };
    return map[status] || status;
  },

  async openCreateChallenge() {
    if (this.data.creating) return;

    // 输入活动名称（wx.showModal editable 模式）
    const nameResult = await wx.showModal({
      title: '活动名称',
      placeholderText: '如：五一阅读挑战赛',
      editable: true,
      confirmText: '下一步',
      cancelText: '取消',
    });
    if (!nameResult.confirm || !nameResult.content) return;
    const name = nameResult.content.trim();
    if (!name) return;

    // 输入活动描述
    const descResult = await wx.showModal({
      title: '活动描述',
      placeholderText: '简要描述（可选）',
      editable: true,
      confirmText: '下一步',
      cancelText: '取消',
    });
    const desc = descResult.content?.trim() || '';

    // 选择开始日期
    const { dateStr: startPicker } = await this.chooseDate('开始日期');
    if (!startPicker) return;

    // 选择结束日期
    const { dateStr: endPicker } = await this.chooseDate('结束日期');
    if (!endPicker) return;

    const startDate = new Date(startPicker).getTime();
    const endDate = new Date(endPicker + ' 23:59:59').getTime();

    if (endDate <= startDate) {
      wx.showToast({ title: '结束日期需晚于开始', icon: 'none' });
      return;
    }

    this.setData({ creating: true });
    try {
      await adminCreateChallenge(name, desc, startDate, endDate);
      wx.showToast({ title: '已创建', icon: 'success' });
      await this.loadChallenges();
    } catch (e) {
      wx.showToast({ title: e?.message || '创建失败', icon: 'none' });
    } finally {
      this.setData({ creating: false });
    }
  },

  async createDailyReadingCheckinTemplate() {
    if (this.data.creating || this.data.templateCreating) return;

    const confirm = await wx.showModal({
      title: '一键创建活动',
      content: '将创建「每日阅读打卡」活动：今天开始，持续 7 天。',
      confirmText: '创建',
      cancelText: '取消'
    });
    if (!confirm.confirm) return;

    const name = '每日阅读打卡';
    const desc = '每天读一点，坚持更容易。写金句或心得，也会自动完成当天打卡。';

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
    end.setHours(23, 59, 59, 999);

    this.setData({ templateCreating: true });
    try {
      await adminCreateChallenge(name, desc, start.getTime(), end.getTime());
      wx.showToast({ title: '已创建', icon: 'success' });
      await this.loadChallenges();
    } catch (e) {
      wx.showToast({ title: e?.message || '创建失败', icon: 'none' });
    } finally {
      this.setData({ templateCreating: false });
    }
  },

  chooseDate(title = '输入日期') {
    return new Promise((resolve) => {
      wx.showModal({
        title,
        editable: true,
        placeholderText: '格式：2026-05-01',
        confirmText: '确定',
        success: (res) => {
          if (res.confirm && res.content) {
            const val = res.content.trim();
            if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
              resolve({ dateStr: val });
            } else {
              wx.showToast({ title: '日期格式错误', icon: 'none' });
              resolve({ dateStr: null });
            }
          } else {
            resolve({ dateStr: null });
          }
        },
        fail: () => resolve({ dateStr: null })
      });
    });
  },

  async startChallenge(e) {
    const id = e?.currentTarget?.dataset?.id;
    if (!id) return;
    const confirm = await wx.showModal({ title: '确认开始？', content: '活动开始后将显示在用户端。', confirmText: '开始', confirmColor: '#07C160' });
    if (!confirm.confirm) return;
    this.setData({ startingId: id });
    try {
      await adminStartChallenge(id);
      wx.showToast({ title: '已开始', icon: 'success' });
      await this.loadChallenges();
    } catch (e) {
      wx.showToast({ title: e?.message || '操作失败', icon: 'none' });
    } finally {
      this.setData({ startingId: '' });
    }
  },

  async endChallenge(e) {
    const id = e?.currentTarget?.dataset?.id;
    if (!id) return;
    const confirm = await wx.showModal({ title: '确认结束？', content: '结束后排行榜将公开。', confirmText: '结束', confirmColor: '#C07D6B' });
    if (!confirm.confirm) return;
    this.setData({ endingId: id });
    try {
      await adminEndChallenge(id);
      wx.showToast({ title: '已结束', icon: 'success' });
      await this.loadChallenges();
    } catch (e) {
      wx.showToast({ title: e?.message || '操作失败', icon: 'none' });
    } finally {
      this.setData({ endingId: '' });
    }
  }
});

