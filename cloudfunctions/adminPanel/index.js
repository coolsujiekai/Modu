/**
 * adminPanel/index.js
 * 管理员面板：仅 admins 集合内的 openid 可用
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;

const ADMINS_COLLECTION = 'admins';
const TEST_DEVICES_COLLECTION = 'test_devices';
const FEEDBACK_COLLECTION = 'feedback';
const PUBLIC_RANKINGS_COLLECTION = 'public_rankings';
const CONFIG_COLLECTION = 'app_config';
const FEATURE_FLAG_DOC_ID = 'reading_challenge_feature';
const COUNTERS_COLLECTION = 'counters';
const COUNTER_DOC_ID = 'users';
const TODAY_POOL_DOC_ID = 'today_pool';

function getOpenid() {
  return cloud.getWXContext().OPENID;
}

async function isAdmin(openid) {
  if (!openid) return false;
  try {
    const res = await db.collection(ADMINS_COLLECTION).doc(openid).get();
    return !!res?.data;
  } catch (e) {
    const res = await db.collection(ADMINS_COLLECTION).where({ openid }).limit(1).get();
    return !!(res?.data && res.data[0]);
  }
}

function deny() {
  return { ok: false, error: 'FORBIDDEN' };
}

async function getChallengeFeatureFlag() {
  const openid = getOpenid();
  if (!(await isAdmin(openid))) return deny();
  try {
    const res = await db.collection(CONFIG_COLLECTION).doc(FEATURE_FLAG_DOC_ID).get();
    const enabled = res?.data?.enabled;
    return { ok: true, enabled: enabled !== false };
  } catch (e) {
    // default enabled
    return { ok: true, enabled: true };
  }
}

async function setChallengeFeatureFlag(event) {
  const openid = getOpenid();
  if (!(await isAdmin(openid))) return deny();
  const enabled = event?.enabled !== false;
  const now = Date.now();
  try {
    await db.collection(CONFIG_COLLECTION).doc(FEATURE_FLAG_DOC_ID).set({
      data: { enabled, updatedAt: now, updatedBy: openid }
    });
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
  return { ok: true, enabled };
}

async function me() {
  const openid = getOpenid();
  const ok = await isAdmin(openid);
  return { ok: true, isAdmin: ok, openid };
}

async function stats() {
  const openid = getOpenid();
  if (!(await isAdmin(openid))) return deny();

  // 注册用户量：registeredAt > 0（比 users 集合总量更符合“注册”定义）
  const registeredUsersPromise = db
    .collection('users')
    .where({ registeredAt: _.gt(0) })
    .count()
    .catch(() => ({ total: 0 }));

  // 书籍总量（在读/已读）
  const readingBooksPromise = db
    .collection('books')
    .where({ status: 'reading' })
    .count()
    .catch(() => ({ total: 0 }));
  const finishedBooksPromise = db
    .collection('books')
    .where({ status: 'finished' })
    .count()
    .catch(() => ({ total: 0 }));

  // 书单总量
  const wishlistTotalPromise = db.collection('wishlist').count().catch(() => ({ total: 0 }));

  // 内容总量：优先汇总 books 上的 quoteCount/thoughtCount（强一致、全量）
  const notesAggPromise = db
    .collection('books')
    .aggregate()
    .group({
      _id: null,
      quoteTotal: $.sum($.ifNull(['$quoteCount', 0])),
      thoughtTotal: $.sum($.ifNull(['$thoughtCount', 0])),
    })
    .end()
    .catch(() => ({ list: [] }));

  // AI 生成次数：汇总 ai_quota.count（按天/书累计的使用次数）
  const aiAggPromise = db
    .collection('ai_quota')
    .aggregate()
    .group({
      _id: null,
      total: $.sum($.ifNull(['$count', 0])),
    })
    .end()
    .catch(() => ({ list: [] }));

  // 热门书单 TOP10（按 title 聚合）
  const wishlistTopPromise = db
    .collection('wishlist')
    .aggregate()
    .match({ title: _.neq('') })
    .group({
      _id: '$title',
      count: $.sum(1),
      lastAt: $.max($.ifNull(['$createdAt', 0])),
    })
    .sort({ count: -1, lastAt: -1 })
    .limit(10)
    .end()
    .catch(() => ({ list: [] }));

  const [
    registeredUsersRes,
    readingBooksRes,
    finishedBooksRes,
    wishlistTotalRes,
    notesAggRes,
    aiAggRes,
    wishlistTopRes
  ] = await Promise.all([
    registeredUsersPromise,
    readingBooksPromise,
    finishedBooksPromise,
    wishlistTotalPromise,
    notesAggPromise,
    aiAggPromise,
    wishlistTopPromise
  ]);

  const notesRow = (notesAggRes?.list || [])[0] || {};
  const aiRow = (aiAggRes?.list || [])[0] || {};
  const top = (wishlistTopRes?.list || []).map((it) => ({
    title: String(it?._id || '').trim(),
    count: Number(it?.count || 0),
  })).filter((it) => it.title);

  return {
    ok: true,
    stats: {
      registeredUsers: Number(registeredUsersRes?.total || 0),
      booksReading: Number(readingBooksRes?.total || 0),
      booksFinished: Number(finishedBooksRes?.total || 0),
      quoteTotal: Number(notesRow?.quoteTotal || 0),
      thoughtTotal: Number(notesRow?.thoughtTotal || 0),
      aiGenerations: Number(aiRow?.total || 0),
      wishlistTotal: Number(wishlistTotalRes?.total || 0),
      wishlistTop: top,
    }
  };
}

async function listUsers(event) {
  const openid = getOpenid();
  if (!(await isAdmin(openid))) return deny();

  const limit = Math.min(50, Math.max(1, Number(event.limit || 20)));
  const offset = Math.max(0, Number(event.offset || 0));

  const res = await db
    .collection('users')
    .orderBy('registeredAt', 'desc')
    .skip(offset)
    .limit(limit)
    .field({
      _openid: true,
      userNo: true,
      nickname: true,
      avatarType: true,
      avatar: true,
      gender: true,
      age: true,
      registeredAt: true,
      createdAt: true,
      updatedAt: true,
    })
    .get();

  return { ok: true, users: res.data || [], nextOffset: offset + (res.data || []).length };
}

async function listFeedback(event) {
  const openid = getOpenid();
  if (!(await isAdmin(openid))) return deny();

  const limit = Math.min(50, Math.max(1, Number(event.limit || 20)));
  const offset = Math.max(0, Number(event.offset || 0));

  const res = await db
    .collection(FEEDBACK_COLLECTION)
    .orderBy('createdAt', 'desc')
    .skip(offset)
    .limit(limit)
    .field({
      _openid: true,
      content: true,
      createdAt: true,
      device: true,
    })
    .get()
    .catch(() => ({ data: [] }));

  return { ok: true, items: res.data || [], nextOffset: offset + (res.data || []).length };
}

async function listWishlistHot(event) {
  const openid = getOpenid();
  if (!(await isAdmin(openid))) return deny();

  const limit = Math.min(50, Math.max(1, Number(event.limit || 20)));
  const offset = Math.max(0, Number(event.offset || 0));

  const res = await db
    .collection('wishlist')
    .aggregate()
    .match({ title: _.neq('') })
    .group({
      _id: '$title',
      count: $.sum(1),
      lastAt: $.max($.ifNull(['$createdAt', 0])),
    })
    .sort({ count: -1, lastAt: -1 })
    .skip(offset)
    .limit(limit)
    .end()
    .catch(() => ({ list: [] }));

  const items = (res.list || []).map((it) => ({
    title: String(it?._id || '').trim(),
    count: Number(it?.count || 0),
  })).filter((it) => it.title);

  return { ok: true, items, nextOffset: offset + items.length };
}

async function listTestDevices() {
  const openid = getOpenid();
  if (!(await isAdmin(openid))) return deny();

  const res = await db
    .collection(TEST_DEVICES_COLLECTION)
    .where({ enabled: true })
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get()
    .catch(() => ({ data: [] }));

  const items = (res.data || [])
    .map((d) => ({
      openid: String(d.openid || d._id || '').trim(),
      label: String(d.label || '').trim(),
      enabled: d.enabled === true
    }))
    .filter((d) => d.openid);

  return { ok: true, devices: items };
}

async function assertTestDeviceEnabled(targetOpenid) {
  const id = String(targetOpenid || '').trim();
  if (!id) return false;
  try {
    const res = await db.collection(TEST_DEVICES_COLLECTION).doc(id).get();
    const d = res?.data || null;
    if (!d) return false;
    const openid = String(d.openid || d._id || '').trim();
    return !!openid && d.enabled === true;
  } catch (e) {
    const res = await db
      .collection(TEST_DEVICES_COLLECTION)
      .where({ openid: id, enabled: true })
      .limit(1)
      .get();
    return !!(res?.data && res.data[0]);
  }
}

async function deleteByOpenid(collectionName, openid, batchSize = 20) {
  let removed = 0;
  while (true) {
    const res = await db
      .collection(collectionName)
      .where({ _openid: openid })
      .limit(batchSize)
      .field({ _id: true })
      .get()
      .catch(() => ({ data: [] }));
    const ids = (res.data || []).map((d) => d._id).filter(Boolean);
    if (ids.length === 0) break;
    // remove one by one to keep compatibility
    for (const id of ids) {
      try {
        await db.collection(collectionName).doc(id).remove();
        removed += 1;
      } catch (e) {
        // ignore single failures
      }
    }
  }
  return removed;
}

async function resetTestUser(event) {
  const caller = getOpenid();
  if (!(await isAdmin(caller))) return deny();

  const confirmText = String(event.confirmText || '').trim();
  if (confirmText !== 'DELETE') return { ok: false, error: 'CONFIRM_REQUIRED' };

  const target = String(event.openid || '').trim();
  if (!target) return { ok: false, error: 'missing openid' };

  const allowed = await assertTestDeviceEnabled(target);
  if (!allowed) return { ok: false, error: 'NOT_IN_TEST_DEVICES' };

  const counts = {
    users: 0,
    books: 0,
    wishlist: 0,
    recent_notes: 0
  };

  // 先把该用户的 userNo 加入回收列表，再删数据
  let userNoToRecycle = null;
  try {
    const userDoc = await db.collection('users').doc(target).get();
    if (userDoc?.data) {
      userNoToRecycle = Number(userDoc.data.userNo || 0) || null;
    }
  } catch (e) {
    // ignore
  }

  // Remove profile doc (id is openid)
  try {
    await db.collection('users').doc(target).remove();
    counts.users += 1;
  } catch (e) {
    // ignore
  }

  // 把序号加入回收列表
  if (userNoToRecycle) {
    try {
      const counterRef = db.collection(COUNTERS_COLLECTION).doc(COUNTER_DOC_ID);
      const counterSnap = await counterRef.get().catch(() => null);
      const recycledNos = Array.isArray(counterSnap?.data?.recycledNos) ? counterSnap.data.recycledNos : [];
      if (!recycledNos.includes(userNoToRecycle)) {
        recycledNos.push(userNoToRecycle);
        if (counterSnap?.data) {
          await counterRef.update({ data: { recycledNos } });
        } else {
          await counterRef.set({ data: { recycledNos, createdAt: Date.now() } });
        }
      }
    } catch (e) {
      // ignore
    }
  }

  counts.books = await deleteByOpenid('books', target, 20);
  counts.wishlist = await deleteByOpenid('wishlist', target, 20);
  counts.recent_notes = await deleteByOpenid('recent_notes', target, 50);

  return { ok: true, counts };
}

// ===================== 活动管理 =====================

async function createChallenge(event) {
  const caller = getOpenid();
  if (!(await isAdmin(caller))) return deny();

  const name = String(event.name || '').trim();
  const desc = String(event.desc || '').trim();
  const startDate = Number(event.startDate || 0);
  const endDate = Number(event.endDate || 0);

  if (!name) return { ok: false, error: 'name is required' };
  if (!startDate || !endDate) return { ok: false, error: 'startDate and endDate are required' };
  if (endDate <= startDate) return { ok: false, error: 'endDate must be after startDate' };

  const now = Date.now();
  const res = await db.collection('reading_challenges').add({
    data: {
      status: 'pending',
      name,
      desc,
      startDate,
      endDate,
      createdAt: now,
      createdBy: caller,
    }
  });

  return { ok: true, id: res._id };
}

async function startChallenge(event) {
  const caller = getOpenid();
  if (!(await isAdmin(caller))) return deny();

  const id = String(event.id || '').trim();
  if (!id) return { ok: false, error: 'id is required' };

  try {
    await db.collection('reading_challenges').doc(id).update({
      data: { status: 'active', startedAt: Date.now() }
    });
  } catch (e) {
    return { ok: false, error: 'challenge not found' };
  }
  return { ok: true };
}

async function endChallenge(event) {
  const caller = getOpenid();
  if (!(await isAdmin(caller))) return deny();

  const id = String(event.id || '').trim();
  if (!id) return { ok: false, error: 'id is required' };

  try {
    await db.collection('reading_challenges').doc(id).update({
      data: { status: 'ended', endedAt: Date.now() }
    });
  } catch (e) {
    return { ok: false, error: 'challenge not found' };
  }
  return { ok: true };
}

async function listChallenges(event) {
  const caller = getOpenid();
  if (!(await isAdmin(caller))) return deny();

  const status = String(event.status || '').trim();
  let query = db.collection('reading_challenges').orderBy('createdAt', 'desc');
  if (status) query = query.where({ status });

  const res = await query.limit(50).get();
  return { ok: true, items: res.data || [] };
}

// ===================== 今日热榜 =====================

async function getTodayPool() {
  const openid = getOpenid();
  if (!(await isAdmin(openid))) return deny();
  try {
    const res = await db.collection(PUBLIC_RANKINGS_COLLECTION).doc(TODAY_POOL_DOC_ID).get();
    const items = Array.isArray(res?.data?.items) ? res.data.items : [];
    // 兼容旧字符串格式 & 新对象格式 { title }
    const normalized = items.map((t) => {
      if (typeof t === 'object' && t !== null) return String(t.title || '').trim();
      return String(t || '').trim();
    }).filter(Boolean);
    return { ok: true, items: normalized, updatedAt: Number(res?.data?.updatedAt || 0) };
  } catch (e) {
    return { ok: true, items: [], updatedAt: 0 };
  }
}

async function appendTodayPool(event) {
  const openid = getOpenid();
  if (!(await isAdmin(openid))) return deny();

  const raw = String(event?.text || '');
  const incoming = raw
    .split('\n')
    .map((s) => String(s || '').trim())
    .filter(Boolean);

  if (incoming.length === 0) return { ok: true, items: [], added: 0, total: 0 };

  const existingRes = await db.collection(PUBLIC_RANKINGS_COLLECTION).doc(TODAY_POOL_DOC_ID).get().catch(() => ({ data: null }));
  const existingRaw = Array.isArray(existingRes?.data?.items) ? existingRes.data.items : [];

  // 兼容旧字符串格式 & 新对象格式 { title }
  const existingTitles = new Set(
    existingRaw.map((t) => {
      if (typeof t === 'object' && t !== null) return String(t.title || '').trim();
      return String(t || '').trim();
    }).filter(Boolean)
  );

  const seen = new Set(existingTitles);
  const merged = [...existingRaw]; // 保留旧数据格式
  for (const title of incoming) {
    if (seen.has(title)) continue;
    seen.add(title);
    merged.push({ title }); // 统一存为对象
    if (merged.length >= 1000) break; // safety cap
  }

  const added = merged.length - existingRaw.length;

  await db.collection(PUBLIC_RANKINGS_COLLECTION).doc(TODAY_POOL_DOC_ID).set({
    data: {
      items: merged,
      updatedAt: Date.now(),
      updatedBy: openid
    }
  });

  return { ok: true, added: Math.max(0, added), total: merged.length };
}

exports.main = async (event, context) => {
  const action = String(event?.action || '').trim();
  try {
    switch (action) {
      case 'me': return await me();
      case 'stats': return await stats();
      case 'listUsers': return await listUsers(event);
      case 'listTestDevices': return await listTestDevices();
      case 'resetTestUser': return await resetTestUser(event);
      case 'listFeedback': return await listFeedback(event);
      case 'listWishlistHot': return await listWishlistHot(event);
      case 'getChallengeFeatureFlag': return await getChallengeFeatureFlag();
      case 'setChallengeFeatureFlag': return await setChallengeFeatureFlag(event);
      case 'getTodayPool': return await getTodayPool();
      case 'appendTodayPool': return await appendTodayPool(event);
      case 'createChallenge': return await createChallenge(event);
      case 'startChallenge': return await startChallenge(event);
      case 'endChallenge': return await endChallenge(event);
      case 'listChallenges': return await listChallenges(event);
      default:
        return { ok: false, error: 'unknown action' };
    }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
};

