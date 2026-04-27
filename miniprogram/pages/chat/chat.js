import { sendMessage } from '../../services/chatService.js';
import { getUserProfile } from '../../services/userService.js';

Page({
  data: {
    isDark: false,

    // 对话状态
    messages: [],        // [{role: 'ai'|'user', content: string}]
    inputValue: '',
    loading: false,     // AI 思考中
    scrollTop: 0,
    userAvatarUrl: '',

    // 快捷提示
    hints: ['有什么好书推荐吗', '聊聊我最近读的书', '我今年读书进度怎么样','这本书我读不下去了','阅读有哪些新体会']
  },

  async onLoad() {
    this.setData({ isDark: getApp()?.globalData?.isDark || false });
    await this.loadUserAvatar();
  },

  async onShow() {
    // 从「个人资料」返回时，刷新一次头像（保持实时跟随）
    await this.loadUserAvatar();
  },

  async loadUserAvatar() {
    try {
      const res = await getUserProfile();
      const p = res?.profile || {};
      const avatarType = String(p.avatarType || 'default');
      const avatar = String(p.avatar || '').trim();
      if (!avatar) {
        this.setData({ userAvatarUrl: '' });
        return;
      }

      // default avatars are local paths; custom avatars are cloud fileID
      if (avatarType !== 'custom') {
        this.setData({ userAvatarUrl: avatar });
        return;
      }

      if (!wx?.cloud?.getTempFileURL) {
        this.setData({ userAvatarUrl: '' });
        return;
      }

      const urlRes = await wx.cloud.getTempFileURL({ fileList: [avatar] });
      const url = String(urlRes?.fileList?.[0]?.tempFileURL || '').trim();
      this.setData({ userAvatarUrl: url });
    } catch (e) {
      // 失败则回退到默认字符头像
      this.setData({ userAvatarUrl: '' });
    }
  },

  // ─── 发送消息 ─────────────────────────────────────────

  async onSend() {
    const text = this.data.inputValue || '';
    if (!text.trim() || this.data.loading) return;

    const userMessage = text.trim();
    const history = [...this.data.messages];
    const conversationHistory = history.map(m => ({
      role: m.role === 'ai' ? 'assistant' : 'user',
      content: m.content
    }));

    // 先把用户消息追加到列表
    this.setData({
      inputValue: '',
      messages: [...history, { role: 'user', content: userMessage }],
      loading: true
    });

    this._scrollToBottom();

    try {
      const reply = await sendMessage(userMessage, conversationHistory);
      this.setData({
        loading: false,
        messages: [
          ...this.data.messages,
          { role: 'ai', content: reply }
        ]
      });
      this._scrollToBottom();
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({
        title: e?.message || 'AI 暂时无法回复，请稍后重试',
        icon: 'none',
        duration: 2500
      });
    }
  },

  // ─── 输入框 ───────────────────────────────────────────

  onInput(e) {
    this.setData({ inputValue: e.detail.value });
  },

  onConfirm(e) {
    this.onSend();
  },

  // ─── 滚动 ─────────────────────────────────────────────

  _scrollToBottom() {
    // 等待列表渲染后再滚动
    setTimeout(() => {
      this.setData({ scrollTop: Date.now() });
    }, 50);
  },

  // ─── 快捷提示 ─────────────────────────────────────────

  onHintTap(e) {
    const text = e.currentTarget.dataset.text;
    if (!text) return;
    this.setData({ inputValue: text });
    this.onSend();
  },

  // ─── 清空对话 ─────────────────────────────────────────

  onClear() {
    this.setData({ messages: [] });
  }
});
