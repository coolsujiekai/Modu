/**
 * userProfile/index.js
 * 用户资料读写云函数：仅允许操作自己的 openid
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const USERS_COLLECTION = 'users';
const COUNTERS_COLLECTION = 'counters';
const COUNTER_DOC_ID = 'users';

const DEFAULT_AVATARS = [
  '/images/avatar/avatar_male_1.png',
  '/images/avatar/avatar_male_2.png',
  '/images/avatar/avatar_male_3.png',
  '/images/avatar/avatar_female_1.png',
  '/images/avatar/avatar_female_2.png',
  '/images/avatar/avatar_female_3.png',
];

const AVATAR_TYPES = ['default', 'defaultMale', 'defaultFemale', 'custom'];
const GENDERS = ['male', 'female', ''];
const AGE_BUCKETS = ['', 'under18', '18-25', '26-35', '36-45', '46-60', '60+'];

function getOpenid() {
  return cloud.getWXContext().OPENID;
}

function clip(str, maxLen) {
  const s = String(str || '').trim();
  if (!s) return '';
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function assertIn(value, pool, name) {
  if (!pool.includes(value)) throw new Error(`invalid ${name}`);
}

function normalizeUpsertPayload(event) {
  const nickname = clip(event.nickname, 20);
  if (!nickname || nickname.length < 2) throw new Error('nickname is required');

  const avatarType = String(event.avatarType || '').trim() || 'default';
  assertIn(avatarType, AVATAR_TYPES, 'avatarType');

  const gender = String(event.gender ?? '').trim();
  assertIn(gender, GENDERS, 'gender');

  const age = String(event.age ?? '').trim();
  if (age && !AGE_BUCKETS.includes(age)) throw new Error('invalid age');

  const avatar = String(event.avatar || '').trim();
  if (avatarType === 'custom') {
    if (!avatar) throw new Error('avatar is required for custom avatarType');
    // Accept cloud fileID or storage path. Do not accept http(s) URL to avoid privacy leaks.
    if (!avatar.startsWith('cloud://') && !avatar.startsWith('user-avatars/')) {
      throw new Error('invalid avatar');
    }
  } else {
    // Default avatar must be one of bundled assets (or empty -> fallback to first one).
    if (avatar && !DEFAULT_AVATARS.includes(avatar)) {
      throw new Error('invalid avatar');
    }
  }

  return {
    nickname,
    avatarType: avatarType === 'defaultMale' || avatarType === 'defaultFemale' ? 'default' : avatarType,
    avatar: avatarType === 'custom' ? avatar : avatar || DEFAULT_AVATARS[0],
    gender,
    age,
  };
}

async function getProfile() {
  const openid = getOpenid();
  if (!openid) throw new Error('missing openid');

  try {
    const res = await db.collection(USERS_COLLECTION).doc(openid).get();
    if (!res?.data) return { ok: true, found: false };
    return { ok: true, found: true, profile: res.data };
  } catch (e) {
    // Fallback to where query in case doc id strategy differs.
    const res = await db
      .collection(USERS_COLLECTION)
      .where({ _openid: openid })
      .limit(1)
      .get();
    const first = (res?.data || [])[0] || null;
    if (!first) return { ok: true, found: false };
    return { ok: true, found: true, profile: first };
  }
}

async function upsertProfile(event) {
  const openid = getOpenid();
  if (!openid) throw new Error('missing openid');

  const patch = normalizeUpsertPayload(event);
  const now = Date.now();

  const ref = db.collection(USERS_COLLECTION).doc(openid);

  // Transaction: allocate userNo on first creation, never change afterwards.
  const result = await db.runTransaction(async (transaction) => {
    const userSnap = await transaction.collection(USERS_COLLECTION).doc(openid).get().catch(() => null);
    const existing = userSnap?.data || null;

    if (existing) {
      await transaction.collection(USERS_COLLECTION).doc(openid).update({
        data: { ...patch, updatedAt: now },
      });
      return { ok: true, created: false, updatedAt: now, userNo: Number(existing.userNo || 0) || 0 };
    }

    const counterRef = transaction.collection(COUNTERS_COLLECTION).doc(COUNTER_DOC_ID);
    const counterSnap = await counterRef.get().catch(() => null);
    const nextNo = Math.max(1, Number(counterSnap?.data?.nextNo || 1));

    // Increment counter (idempotent in transaction scope)
    if (counterSnap?.data) {
      await counterRef.update({ data: { nextNo: _.inc(1), updatedAt: now } });
    } else {
      await counterRef.set({ data: { nextNo: nextNo + 1, createdAt: now, updatedAt: now } });
    }

    await transaction.collection(USERS_COLLECTION).doc(openid).set({
      data: {
        _openid: openid,
        userNo: nextNo,
        registeredAt: now,
        ...patch,
        createdAt: now,
        updatedAt: now,
      },
    });

    return { ok: true, created: true, createdAt: now, userNo: nextNo };
  });

  return result;
}

exports.main = async (event, context) => {
  const action = String(event?.action || '').trim();
  try {
    if (action === 'get') return await getProfile();
    if (action === 'upsert') return await upsertProfile(event);
    return { ok: false, error: 'unknown action' };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
};

