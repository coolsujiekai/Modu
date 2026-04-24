import { db } from '../../utils/db.js';
import { getUserProfile, upsertUserProfile, uploadAvatar } from '../../services/userService.js';

const INTRO_SEEN_KEY = '_intro_v2_seen';
const PROFILE_SKIPPED_KEY = 'profile_onboarding_skipped_v2';
const BOOK_SEEN_KEY = '_book_onboarding_v2_seen';
const PROFILE_DONE_KEY = '_profile_v2_done';

function safeGet(key) {
  try { return wx.getStorageSync(key); } catch (e) { return null; }
}
function safeSet(key, value) {
  try { wx.setStorageSync(key, value); } catch (e) {}
}

Page({
  data: {
    step: 'profile', // 'profile' | 'book' | 'done'
    saving: false,

    profileNickname: '',
    selectedAvatarKey: 'm1',
    selectedAvatarType: 'default',
    selectedAvatarSrc: '/images/avatar/avatar_male_1.png',
    selectedAvatarLocalPath: '',

    avatarOptionsMale: [],
    avatarOptionsFemale: [],
    customAvatarPreview: '',

    gender: '',
    age: '',
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

  ensureDefaultAvatarSelected(options) {
    const key = String(this.data.selectedAvatarKey || '');
    if (key) return;
    const first = (options?.male || [])[0] || null;
    if (!first?.key || !first?.src) return;
    this.setData({
      selectedAvatarKey: first.key,
      selectedAvatarType: 'default',
      selectedAvatarSrc: first.src,
      selectedAvatarLocalPath: '',
      customAvatarPreview: ''
    });
  },

  onLoad() {
    // Mark intro as seen early to prevent redirect loops.
    safeSet(INTRO_SEEN_KEY, '1');

    const app = getApp();
    if (typeof app?.onOpenIdReady === 'function') {
      app.onOpenIdReady(() => this.bootstrap());
    } else {
      this.bootstrap();
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

  async bootstrap() {
    const { male, female } = this.buildAvatarOptions();
    this.setData({ avatarOptionsMale: male, avatarOptionsFemale: female });
    this.ensureDefaultAvatarSelected({ male, female });

    let profileFound = false;
    try {
      const res = await getUserProfile();
      const nick = String(res?.profile?.nickname || '').trim();
      profileFound = !!res?.found && nick.length >= 2;
      if (nick) this.setData({ profileNickname: nick });
      const gender = String(res?.profile?.gender ?? '').trim();
      const age = String(res?.profile?.age ?? '').trim();
      if (['', 'male', 'female'].includes(gender)) this.setData({ gender });
      if (age !== undefined) this.setData({ age });

      const avatarTypeRaw = String(res?.profile?.avatarType || 'default') || 'default';
      const avatarType = ['custom', 'default', 'defaultMale', 'defaultFemale'].includes(avatarTypeRaw) ? avatarTypeRaw : 'default';
      const avatar = String(res?.profile?.avatar || '');
      const selectedKey = this.inferSelectedAvatarKey(avatarType, avatar);
      if (selectedKey === 'custom') {
        if (avatar) {
          this.setData({
            selectedAvatarKey: 'custom',
            selectedAvatarType: 'custom',
            selectedAvatarSrc: '',
            selectedAvatarLocalPath: '',
            customAvatarPreview: avatar
          });
        }
      } else {
        const mapping = {
          m1: '/images/avatar/avatar_male_1.png',
          m2: '/images/avatar/avatar_male_2.png',
          m3: '/images/avatar/avatar_male_3.png',
          f1: '/images/avatar/avatar_female_1.png',
          f2: '/images/avatar/avatar_female_2.png',
          f3: '/images/avatar/avatar_female_3.png',
        };
        const src = mapping[selectedKey] || '/images/avatar/avatar_male_1.png';
        this.setData({
          selectedAvatarKey: selectedKey,
          selectedAvatarType: 'default',
          selectedAvatarSrc: src,
          selectedAvatarLocalPath: '',
          customAvatarPreview: ''
        });
      }
    } catch (e) {
      profileFound = false;
    }

    if (profileFound) safeSet(PROFILE_DONE_KEY, '1');

    const profileSkipped = safeGet(PROFILE_SKIPPED_KEY) === '1';
    const shouldProfile = !profileFound && !profileSkipped;

    const bookSeen = safeGet(BOOK_SEEN_KEY) === '1';
    const shouldBook = !bookSeen && (await this.hasAnyBook() === false);

    if (shouldProfile) {
      this.setData({ step: 'profile' });
      return;
    }
    if (shouldBook) {
      this.setData({ step: 'book' });
      return;
    }

    this.finish();
  },

  async hasAnyBook() {
    try {
      const app = getApp();
      const openid = app?.globalData?.openid || '';
      if (!openid) return true; // be conservative to avoid blocking
      const [readingRes, finishedRes] = await Promise.all([
        db.collection('books').where({ _openid: openid, status: 'reading' }).count(),
        db.collection('books').where({ _openid: openid, status: 'finished' }).count()
      ]);
      const readingCount = Number(readingRes?.total || 0);
      const finishedCount = Number(finishedRes?.total || 0);
      return readingCount + finishedCount > 0;
    } catch (e) {
      return true;
    }
  },

  finish() {
    this.setData({ step: 'done' });
    // pages/index/index is a tabBar page; must use switchTab.
    wx.switchTab({ url: '/pages/index/index' });
  },

  onNickInput(e) {
    this.setData({ profileNickname: String(e?.detail?.value ?? '') });
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

  onPickDefaultAvatar(e) {
    const key = e?.currentTarget?.dataset?.key;
    const src = e?.currentTarget?.dataset?.src;
    if (!key || !src) return;
    this.setData({
      selectedAvatarKey: String(key),
      selectedAvatarType: 'default',
      selectedAvatarSrc: String(src || ''),
      selectedAvatarLocalPath: '',
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
        selectedAvatarType: 'custom',
        selectedAvatarSrc: '',
        selectedAvatarLocalPath: path,
        customAvatarPreview: path
      });
    } catch (e) {
      // user canceled
    }
  },

  skipProfile() {
    safeSet(PROFILE_SKIPPED_KEY, '1');
    // Continue to book step or finish.
    this.bootstrap();
  },

  async saveProfile() {
    if (this.data.saving) return;
    const nickname = String(this.data.profileNickname || '').trim();
    if (nickname.length < 2) {
      wx.showToast({ title: '昵称至少 2 个字', icon: 'none' });
      return;
    }

    this.setData({ saving: true });
    wx.showLoading({ title: '保存中', mask: true });

    try {
      let avatarType = this.data.selectedAvatarType;
      let avatar = '';

      if (avatarType === 'custom') {
        const local = this.data.selectedAvatarLocalPath;
        if (!local) throw new Error('请先选择头像');
        const up = await uploadAvatar(local, { ext: 'jpg' });
        avatar = up.fileID;
      } else {
        avatarType = 'default';
        avatar = String(this.data.selectedAvatarSrc || '');
      }

      await upsertUserProfile({
        nickname,
        avatarType,
        avatar,
        gender: String(this.data.gender ?? ''),
        age: String(this.data.age ?? '')
      });

      safeSet(PROFILE_DONE_KEY, '1');
      safeSet(INTRO_SEEN_KEY, '1');

      wx.hideLoading();
      this.setData({ saving: false });

      // Next step: book onboarding if needed.
      const hasBook = await this.hasAnyBook();
      if (!hasBook && safeGet(BOOK_SEEN_KEY) !== '1') {
        this.setData({ step: 'book' });
        return;
      }
      this.finish();
    } catch (e) {
      wx.hideLoading();
      this.setData({ saving: false });
      wx.showModal({
        title: '保存失败',
        content: e?.message || e?.errMsg || String(e),
        showCancel: false
      });
    }
  },

  startBook() {
    safeSet(BOOK_SEEN_KEY, '1');
    wx.redirectTo({ url: '/pages/createBook/createBook' });
  },

  skipBook() {
    safeSet(BOOK_SEEN_KEY, '1');
    wx.redirectTo({ url: '/pages/emptyShelf/emptyShelf' });
  }
});

