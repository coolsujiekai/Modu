import { getUserProfile, upsertUserProfile, uploadAvatar } from '../../services/userService.js';

const PROFILE_DONE_KEY = '_profile_v2_done';
function safeSet(key, value) {
  try { wx.setStorageSync(key, value); } catch (e) {}
}

Page({
  data: {
    isDark: false,
    loading: true,
    saving: false,

    nickname: '',
    avatarType: 'default',
    avatar: '',
    avatarPreview: '',
    gender: '',
    age: '',

    avatarOptionsMale: [],
    avatarOptionsFemale: [],
    selectedAvatarKey: 'm1',
    customAvatarPreview: '',
  },

  ensureDefaultAvatarSelected(options) {
    const key = String(this.data.selectedAvatarKey || '');
    if (key) return;
    const first = (options?.male || [])[0] || null;
    if (!first?.key || !first?.src) return;
    this.setData({
      selectedAvatarKey: first.key,
      avatarType: 'default',
      avatar: first.src,
      avatarPreview: '',
      customAvatarPreview: ''
    });
  },

  async onLoad() {
    this.setData({ isDark: getApp()?.globalData?.isDark || false });
    const { male, female } = this.buildAvatarOptions();
    this.setData({ avatarOptionsMale: male, avatarOptionsFemale: female });
    this.ensureDefaultAvatarSelected({ male, female });
    await this.load();
  },

  async onShow() {
    // keep it simple; no auto-refresh while editing
  },

  async load() {
    this.setData({ loading: true });
    try {
      const res = await getUserProfile();
      const p = res?.profile || {};

      const avatarTypeRaw = String(p.avatarType || 'default') || 'default';
      const avatarType = ['custom', 'default', 'defaultMale', 'defaultFemale'].includes(avatarTypeRaw) ? avatarTypeRaw : 'default';
      const avatar = String(p.avatar || '');
      const isCustom = avatarType === 'custom';
      const selectedKey = this.inferSelectedAvatarKey(avatarType, avatar);

      const customAvatarPreview = isCustom ? avatar : '';

      this.setData({
        loading: false,
        nickname: String(p.nickname || ''),
        avatarType,
        avatar,
        avatarPreview: isCustom ? avatar : '',
        gender: String(p.gender ?? ''),
        age: String(p.age ?? ''),
        selectedAvatarKey: selectedKey,
        customAvatarPreview,
      });

      const nick = String(p.nickname || '').trim();
      if (nick.length >= 2) safeSet(PROFILE_DONE_KEY, '1');

      // profile doesn't have avatar (or avatar mismatch) => fallback to first default
      if (!selectedKey) {
        this.ensureDefaultAvatarSelected({ male: this.data.avatarOptionsMale, female: this.data.avatarOptionsFemale });
      }
    } catch (e) {
      this.setData({ loading: false });
      // If cloud function not deployed, still allow editing but saving will fail.
    }
  },

  buildAvatarOptions() {
    const male = [
      { key: 'm1', src: '/images/avatar/avatar_male_1.png' },
      { key: 'm2', src: '/images/avatar/avatar_male_2.png' },
      { key: 'm3', src: '/images/avatar/avatar_male_3.png' },
    ];
    const female = [
      { key: 'f1', src: '/images/avatar/avatar_female_1.png' },
      { key: 'f2', src: '/images/avatar/avatar_female_2.png' },
      { key: 'f3', src: '/images/avatar/avatar_female_3.png' },
    ];
    return { male, female };
  },

  inferSelectedAvatarKey(avatarType, avatar) {
    if (avatarType === 'custom') return 'custom';
    const mapping = {
      '/images/avatar/avatar_male_1.png': 'm1',
      '/images/avatar/avatar_male_2.png': 'm2',
      '/images/avatar/avatar_male_3.png': 'm3',
      '/images/avatar/avatar_female_1.png': 'f1',
      '/images/avatar/avatar_female_2.png': 'f2',
      '/images/avatar/avatar_female_3.png': 'f3',
    };
    return mapping[String(avatar || '')] || 'm1';
  },

  onNickInput(e) {
    const v = String(e?.detail?.value ?? '');
    this.setData({ nickname: v });
  },

  onPickDefaultAvatar(e) {
    const key = e?.currentTarget?.dataset?.key;
    const src = e?.currentTarget?.dataset?.src;
    if (!key || !src) return;

    this.setData({
      selectedAvatarKey: String(key),
      avatarType: 'default',
      avatar: String(src || ''),
      avatarPreview: '',
      customAvatarPreview: ''
    });
  },

  async onUploadCustomAvatar() {
    try {
      const res = await wx.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera']
      });
      const path = (res?.tempFilePaths || [])[0] || '';
      if (!path) return;
      this.setData({
        selectedAvatarKey: 'custom',
        avatarType: 'custom',
        avatarPreview: path,
        customAvatarPreview: path
      });
    } catch (e) {
      // user canceled
    }
  },

  setGender(e) {
    const g = String(e?.currentTarget?.dataset?.gender ?? '');
    if (!['', 'male', 'female'].includes(g)) return;
    this.setData({ gender: g });
  },

  setAge(e) {
    const age = String(e?.currentTarget?.dataset?.age ?? '');
    this.setData({ age });
  },

  async save() {
    if (this.data.saving) return;
    const nickname = String(this.data.nickname || '').trim();
    if (nickname.length < 2) {
      wx.showToast({ title: '昵称至少 2 个字', icon: 'none' });
      return;
    }

    this.setData({ saving: true });
    wx.showLoading({ title: '保存中', mask: true });

    try {
      let avatarType = this.data.avatarType;
      let avatar = String(this.data.avatar || '');

      if (avatarType === 'custom') {
        const local = String(this.data.avatarPreview || '');
        // If user didn't choose a new file, keep existing cloud fileID (avatar).
        if (local) {
          const up = await uploadAvatar(local, { ext: 'jpg' });
          avatar = up.fileID;
        }
        if (!avatar) throw new Error('请先选择头像');
      } else {
        avatarType = 'default';
        if (!avatar) avatar = '/images/avatar/avatar_male_1.png';
      }

      await upsertUserProfile({
        nickname,
        avatarType,
        avatar,
        gender: String(this.data.gender ?? ''),
        age: String(this.data.age ?? ''),
      });

      safeSet(PROFILE_DONE_KEY, '1');

      wx.hideLoading();
      wx.showToast({ title: '已保存', icon: 'success', duration: 800 });
      this.setData({
        saving: false,
        avatarPreview: avatarType === 'custom' ? avatar : '',
        avatarType,
        avatar,
        selectedAvatarKey: this.inferSelectedAvatarKey(avatarType, avatar),
        customAvatarPreview: avatarType === 'custom' ? avatar : ''
      });
    } catch (e) {
      wx.hideLoading();
      this.setData({ saving: false });
      wx.showModal({
        title: '保存失败',
        content: e?.message || e?.errMsg || String(e),
        showCancel: false
      });
    }
  }
});

