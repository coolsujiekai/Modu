/**
 * challenge/index.js
 * 阅读挑战活动云函数
 * 用户操作：获取进行中活动、报名、录入打卡、排行榜
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const CHALLENGES_COLLECTION = 'reading_challenges';
const PARTICIPANTS_COLLECTION = 'challenge_participants';
const CHECKINS_COLLECTION = 'challenge_checkins';
const CONFIG_COLLECTION = 'app_config';
const FEATURE_FLAG_DOC_ID = 'reading_challenge_feature';

function getOpenid() {
  return cloud.getWXContext().OPENID;
}

async function isFeatureEnabled() {
  // Default enabled when config is missing
  try {
    const res = await db.collection(CONFIG_COLLECTION).doc(FEATURE_FLAG_DOC_ID).get();
    const enabled = res?.data?.enabled;
    return enabled !== false;
  } catch (e) {
    return true;
  }
}

function formatDateKey(ts = Date.now()) {
  const d = new Date(Number(ts || 0) || Date.now());
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function getActiveChallengeDoc() {
  const res = await db.collection(CHALLENGES_COLLECTION).where({ status: 'active' }).limit(1).get();
  return (res.data || [])[0] || null;
}

async function ensureReadingBookExists(openid, bookNameRaw) {
  const bookName = String(bookNameRaw || '').trim();
  if (!bookName) return null;

  // Try find existing book (same name) for current user
  const existingRes = await db
    .collection('books')
    .where({ _openid: openid, bookName })
    .limit(1)
    .get();

  const existing = (existingRes.data || [])[0] || null;
  if (existing?._id) return existing._id;

  // Create a minimal "reading" book so it appears on the shelf immediately
  const now = Date.now();
  const addRes = await db.collection('books').add({
    data: {
      _openid: openid,
      bookName,
      authorId: '',
      authorName: '',
      authorNameNorm: '',
      startTime: now,
      status: 'reading',
      notes: [],
      notesCount: 0,
      thoughtCount: 0,
      quoteCount: 0,
      durationMin: 0,
      updatedAt: now,
    }
  });
  return addRes?._id || null;
}

async function getMyParticipant(challengeId, openid) {
  const res = await db
    .collection(PARTICIPANTS_COLLECTION)
    .where({ challengeId, _openid: openid })
    .limit(1)
    .get();
  return (res.data || [])[0] || null;
}

async function ensureParticipant(challengeId, openid) {
  const existing = await getMyParticipant(challengeId, openid);
  if (existing?._id) return existing;

  const now = Date.now();
  const addRes = await db.collection(PARTICIPANTS_COLLECTION).add({
    data: {
      challengeId,
      _openid: openid,
      selectedBookId: '',
      selectedBookName: '',
      checkinDays: 0,
      lastCheckinDate: '',
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    }
  });

  const created = await db.collection(PARTICIPANTS_COLLECTION).doc(addRes._id).get();
  return created?.data || null;
}

async function computeCheckinDays(challengeId, openid) {
  // MVP: scan my checkins (bounded) and count unique checkinDate
  const res = await db
    .collection(CHECKINS_COLLECTION)
    .where({ challengeId, _openid: openid })
    .field({ checkinDate: true, checkedAt: true, createdAt: true })
    .limit(500)
    .get();
  const list = res.data || [];
  const set = new Set();
  list.forEach((c) => {
    const key = String(c.checkinDate || '').trim() || formatDateKey(c.checkedAt || c.createdAt || 0);
    if (key) set.add(key);
  });
  return set.size;
}

async function getMyCheckins(challengeId, openid, limitN = 20) {
  const res = await db
    .collection(CHECKINS_COLLECTION)
    .where({ challengeId, _openid: openid })
    .orderBy('checkedAt', 'desc')
    .limit(limitN)
    .get();
  return res.data || [];
}

async function hasCheckedToday(challengeId, openid, dateKey) {
  const res = await db
    .collection(CHECKINS_COLLECTION)
    .where({ challengeId, _openid: openid, checkinDate: dateKey })
    .limit(1)
    .get();
  return (res.data || []).length > 0;
}

async function ensureBookOwned(openid, bookId) {
  const r = await db.collection('books').doc(bookId).get();
  const book = r?.data || null;
  if (!book || book._openid !== openid) return null;
  return { _id: bookId, bookName: book.bookName || '', status: book.status || '' };
}

// 获取当前进行中的活动
async function getActiveChallenge() {
  try {
    const enabled = await isFeatureEnabled();
    if (!enabled) return { ok: true, disabled: true, challenge: null };
    const challenge = await getActiveChallengeDoc();
    return { ok: true, challenge };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// 获取已结束的活动（用于排行榜）
async function getEndedChallenge() {
  try {
    const enabled = await isFeatureEnabled();
    if (!enabled) return { ok: true, disabled: true, challenge: null };
    const res = await db.collection(CHALLENGES_COLLECTION)
      .where({ status: 'ended' })
      .orderBy('endedAt', 'desc')
      .limit(1)
      .get();
    const challenge = (res.data || [])[0] || null;
    return { ok: true, challenge };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// 极简：获取我的活动状态（页面主接口）
async function getMyChallengeStatus(event) {
  const openid = getOpenid();
  if (!openid) return { ok: false, error: 'missing openid' };
  const challengeId = String(event.challengeId || '').trim();
  if (!challengeId) return { ok: false, error: 'challengeId is required' };

  try {
    const enabled = await isFeatureEnabled();
    if (!enabled) return { ok: true, disabled: true, challenge: null, participant: null, todayChecked: false, selectedBook: null, checkins: [], checkinDays: 0 };
    const challengeRes = await db.collection(CHALLENGES_COLLECTION).doc(challengeId).get();
    const challenge = challengeRes?.data || null;
    if (!challenge) return { ok: true, challenge: null, participant: null, todayChecked: false, selectedBook: null, checkins: [] };

    const participant = await getMyParticipant(challengeId, openid);
    const todayKey = formatDateKey(Date.now());
    const todayChecked = participant ? (String(participant.lastCheckinDate || '') === todayKey || await hasCheckedToday(challengeId, openid, todayKey)) : false;

    let selectedBook = null;
    if (participant?.selectedBookId) {
      selectedBook = await ensureBookOwned(openid, participant.selectedBookId);
      if (!selectedBook) {
        // keep display fallback if book deleted
        selectedBook = participant.selectedBookName ? { _id: '', bookName: participant.selectedBookName } : null;
      }
    }

    const checkins = participant ? await getMyCheckins(challengeId, openid, 20) : [];
    const checkinDays = participant ? Number(participant.checkinDays || 0) || (await computeCheckinDays(challengeId, openid)) : 0;
    return { ok: true, challenge, participant, todayChecked, selectedBook, checkins, checkinDays };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// 选择已有在读书，设为当前打卡书
async function selectBook(event) {
  const openid = getOpenid();
  if (!openid) return { ok: false, error: 'missing openid' };
  const challengeId = String(event.challengeId || '').trim();
  const bookId = String(event.bookId || '').trim();
  if (!challengeId) return { ok: false, error: 'challengeId is required' };
  if (!bookId) return { ok: false, error: 'bookId is required' };

  try {
    const enabled = await isFeatureEnabled();
    if (!enabled) return { ok: true, disabled: true, skipped: true };
    const book = await ensureBookOwned(openid, bookId);
    if (!book) return { ok: false, error: 'book not found' };

    // If not reading, flip to reading
    if (book.status && book.status !== 'reading') {
      await db.collection('books').doc(bookId).update({ data: { status: 'reading', updatedAt: Date.now() } });
    }

    const participant = await ensureParticipant(challengeId, openid);
    const now = Date.now();
    await db.collection(PARTICIPANTS_COLLECTION).doc(participant._id).update({
      data: { selectedBookId: bookId, selectedBookName: book.bookName || '', updatedAt: now }
    });

    const latest = await db.collection(PARTICIPANTS_COLLECTION).doc(participant._id).get();
    const todayKey = formatDateKey(now);
    const todayChecked = String(latest?.data?.lastCheckinDate || '') === todayKey || (await hasCheckedToday(challengeId, openid, todayKey));
    const checkins = await getMyCheckins(challengeId, openid, 20);
    const checkinDays = Number(latest?.data?.checkinDays || 0) || (await computeCheckinDays(challengeId, openid));
    return { ok: true, participant: latest?.data || participant, todayChecked, selectedBook: { _id: bookId, bookName: book.bookName || '' }, checkins, checkinDays };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// 新增书籍并自动完成今日打卡
async function createBookAndCheckin(event) {
  const openid = getOpenid();
  if (!openid) return { ok: false, error: 'missing openid' };
  const challengeId = String(event.challengeId || '').trim();
  const bookName = String(event.bookName || '').trim();
  if (!challengeId) return { ok: false, error: 'challengeId is required' };
  if (!bookName) return { ok: false, error: 'bookName is required' };

  try {
    const enabled = await isFeatureEnabled();
    if (!enabled) return { ok: true, disabled: true, skipped: true };
    const bookId = await ensureReadingBookExists(openid, bookName);
    if (!bookId) return { ok: false, error: 'failed to create book' };

    // set participant selected book
    const participant = await ensureParticipant(challengeId, openid);
    const now = Date.now();
    await db.collection(PARTICIPANTS_COLLECTION).doc(participant._id).update({
      data: { selectedBookId: bookId, selectedBookName: bookName, updatedAt: now }
    });

    // auto checkin today
    const todayKey = formatDateKey(now);
    const already = await hasCheckedToday(challengeId, openid, todayKey);
    if (!already) {
      await db.collection(CHECKINS_COLLECTION).add({
        data: {
          challengeId,
          _openid: openid,
          bookId,
          bookName,
          checkinDate: todayKey,
          source: 'button',
          noteId: '',
          checkedAt: now,
          createdAt: now,
        }
      });
    }

    const days = await computeCheckinDays(challengeId, openid);
    await db.collection(PARTICIPANTS_COLLECTION).doc(participant._id).update({
      data: { lastCheckinDate: todayKey, checkinDays: days, updatedAt: Date.now() }
    });

    const latest = await db.collection(PARTICIPANTS_COLLECTION).doc(participant._id).get();
    const checkins = await getMyCheckins(challengeId, openid, 20);
    return {
      ok: true,
      participant: latest?.data || participant,
      todayChecked: true,
      selectedBook: { _id: bookId, bookName },
      checkins,
      checkinDays: days,
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// 今日打卡（每天最多一次）
async function checkinToday(event) {
  const openid = getOpenid();
  if (!openid) return { ok: false, error: 'missing openid' };
  const challengeId = String(event.challengeId || '').trim();
  const bookId = String(event.bookId || '').trim();
  if (!challengeId) return { ok: false, error: 'challengeId is required' };
  if (!bookId) return { ok: false, error: 'bookId is required' };

  try {
    const enabled = await isFeatureEnabled();
    if (!enabled) return { ok: true, disabled: true, skipped: true };
    const book = await ensureBookOwned(openid, bookId);
    if (!book) return { ok: false, error: 'book not found' };

    const participant = await ensureParticipant(challengeId, openid);
    const now = Date.now();
    const todayKey = formatDateKey(now);

    const already = await hasCheckedToday(challengeId, openid, todayKey);
    if (!already) {
      await db.collection(CHECKINS_COLLECTION).add({
        data: {
          challengeId,
          _openid: openid,
          bookId,
          bookName: book.bookName || '',
          checkinDate: todayKey,
          source: 'button',
          noteId: '',
          checkedAt: now,
          createdAt: now,
        }
      });
    }

    const days = await computeCheckinDays(challengeId, openid);
    await db.collection(PARTICIPANTS_COLLECTION).doc(participant._id).update({
      data: {
        selectedBookId: bookId,
        selectedBookName: book.bookName || '',
        lastCheckinDate: todayKey,
        checkinDays: days,
        updatedAt: Date.now(),
      }
    });

    const latest = await db.collection(PARTICIPANTS_COLLECTION).doc(participant._id).get();
    const checkins = await getMyCheckins(challengeId, openid, 20);
    return {
      ok: true,
      alreadyChecked: already,
      participant: latest?.data || participant,
      todayChecked: true,
      selectedBook: { _id: bookId, bookName: book.bookName || '' },
      checkins,
      checkinDays: days,
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// 书籍页添加笔记后自动打卡
async function autoCheckinByNote(event) {
  const openid = getOpenid();
  if (!openid) return { ok: false, error: 'missing openid' };
  const bookId = String(event.bookId || '').trim();
  if (!bookId) return { ok: false, error: 'bookId is required' };

  try {
    const enabled = await isFeatureEnabled();
    if (!enabled) return { ok: true, disabled: true, skipped: true, reason: 'feature disabled' };
    const challenge = await getActiveChallengeDoc();
    if (!challenge?._id) return { ok: true, skipped: true, reason: 'no active challenge' };

    const book = await ensureBookOwned(openid, bookId);
    if (!book) return { ok: true, skipped: true, reason: 'book not found' };

    const challengeId = challenge._id;
    const now = Date.now();
    const todayKey = formatDateKey(now);
    const already = await hasCheckedToday(challengeId, openid, todayKey);
    if (already) return { ok: true, alreadyChecked: true };

    const participant = await ensureParticipant(challengeId, openid);

    await db.collection(CHECKINS_COLLECTION).add({
      data: {
        challengeId,
        _openid: openid,
        bookId,
        bookName: book.bookName || '',
        checkinDate: todayKey,
        source: 'note',
        noteId: '',
        checkedAt: now,
        createdAt: now,
      }
    });

    const days = await computeCheckinDays(challengeId, openid);
    await db.collection(PARTICIPANTS_COLLECTION).doc(participant._id).update({
      data: {
        selectedBookId: bookId,
        selectedBookName: book.bookName || '',
        lastCheckinDate: todayKey,
        checkinDays: days,
        updatedAt: Date.now()
      }
    });

    return { ok: true, checked: true, checkinDays: days };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// 获取用户报名状态
async function getMyStatus(challengeId) {
  const openid = getOpenid();
  if (!openid) return { ok: false, error: 'missing openid' };

  try {
    const res = await db.collection(PARTICIPANTS_COLLECTION)
      .where({ challengeId, _openid: openid })
      .limit(1)
      .get();
    const participant = (res.data || [])[0] || null;

    // 获取打卡记录
    let checkins = [];
    if (participant) {
      const checkinRes = await db.collection(CHECKINS_COLLECTION)
        .where({ challengeId, _openid: openid })
        .orderBy('checkedAt', 'desc')
        .get();
      checkins = checkinRes.data || [];
    }

    // 获取 users 里的昵称头像快照
    let profileSnapshot = { nickname: '', avatar: '' };
    try {
      const userRes = await db.collection('users').doc(openid).get();
      if (userRes?.data) {
        profileSnapshot = {
          nickname: userRes.data.nickname || '',
          avatar: userRes.data.avatar || '',
        };
      }
    } catch (e) {}

    return {
      ok: true,
      joined: !!participant,
      participant,
      checkins,
      profileSnapshot,
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// 报名
async function joinChallenge(event) {
  const openid = getOpenid();
  if (!openid) return { ok: false, error: 'missing openid' };

  const challengeId = String(event.challengeId || '').trim();
  if (!challengeId) return { ok: false, error: 'challengeId is required' };

  try {
    // 获取活动信息
    const chalRes = await db.collection(CHALLENGES_COLLECTION).doc(challengeId).get();
    if (!chalRes?.data || chalRes.data.status !== 'active') {
      return { ok: false, error: '活动不存在或未开始' };
    }

    // 检查是否已报名
    const existing = await db.collection(PARTICIPANTS_COLLECTION)
      .where({ challengeId, _openid: openid })
      .count();
    if (existing.total > 0) {
      return { ok: false, error: '已报名' };
    }

    // 获取用户昵称头像
    const userRes = await db.collection('users').doc(openid).get();
    const nickname = userRes?.data?.nickname || '';
    const avatar = userRes?.data?.avatar || '';

    if (!nickname) {
      return { ok: false, error: '请先完善昵称后再报名' };
    }

    await db.collection(PARTICIPANTS_COLLECTION).add({
      data: {
        challengeId,
        _openid: openid,
        nickname,
        avatar,
        books: [],
        checkinDays: 0,
        completed: false,
        joinedAt: Date.now(),
      }
    });

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// 录入心得/金句（打卡）
async function submitCheckin(event) {
  const openid = getOpenid();
  if (!openid) return { ok: false, error: 'missing openid' };

  const challengeId = String(event.challengeId || '').trim();
  const bookName = String(event.bookName || '').trim();
  const content = String(event.content || '').trim();

  if (!challengeId) return { ok: false, error: 'challengeId is required' };
  if (!bookName) return { ok: false, error: 'bookName is required' };
  if (!content) return { ok: false, error: 'content is required' };

  try {
    const now = Date.now();

    // If user types a custom book name, auto-create it in "books" so it appears on the shelf
    await ensureReadingBookExists(openid, bookName);

    // 添加打卡记录
    await db.collection(CHECKINS_COLLECTION).add({
      data: {
        challengeId,
        _openid: openid,
        bookName,
        content,
        checkedAt: now,
      }
    });

    // 更新参与者的 books 列表（去重）
    const participantRes = await db.collection(PARTICIPANTS_COLLECTION)
      .where({ challengeId, _openid: openid })
      .limit(1)
      .get();
    const participant = (participantRes.data || [])[0];

    if (participant) {
      const books = Array.isArray(participant.books) ? [...participant.books] : [];
      if (!books.includes(bookName)) {
        books.push(bookName);
      }
      // 重新计算打卡天数（同一日期多条记录只算1天）
      const checkinRes = await db.collection(CHECKINS_COLLECTION)
        .where({ challengeId, _openid: openid })
        .get();
      const checkins = checkinRes.data || [];
      const uniqueDays = new Set(
        checkins.map(c => {
          const d = new Date(c.checkedAt);
          return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        })
      );
      await db.collection(PARTICIPANTS_COLLECTION).doc(participant._id).update({
        data: { books, checkinDays: uniqueDays.size }
      });
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// 标记为已完成
async function markCompleted(event) {
  const openid = getOpenid();
  if (!openid) return { ok: false, error: 'missing openid' };

  const challengeId = String(event.challengeId || '').trim();
  if (!challengeId) return { ok: false, error: 'challengeId is required' };

  try {
    await db.collection(PARTICIPANTS_COLLECTION)
      .where({ challengeId, _openid: openid })
      .update({ data: { completed: true } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// 获取排行榜（仅已结束的活动）
async function getRankings(event) {
  const challengeId = String(event.challengeId || '').trim();
  if (!challengeId) return { ok: false, error: 'challengeId is required' };

  try {
    const challengeRes = await db.collection(CHALLENGES_COLLECTION).doc(challengeId).get();
    if (!challengeRes?.data) return { ok: false, error: 'challenge not found' };

    const participantsRes = await db.collection(PARTICIPANTS_COLLECTION)
      .where({ challengeId })
      .orderBy('checkinDays', 'desc')
      .get();

    const participants = (participantsRes.data || []).map(p => ({
      nickname: p.nickname || '匿名',
      avatar: p.avatar || '',
      books: p.books || [],
      checkinDays: p.checkinDays || 0,
      completed: !!p.completed,
    }));

    return { ok: true, challenge: challengeRes.data, participants };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

exports.main = async (event, context) => {
  const action = String(event?.action || '').trim();
  try {
    // Hard kill switch: when disabled, suppress all actions
    const enabled = await isFeatureEnabled();
    if (!enabled) {
      if (action === 'getActiveChallenge' || action === 'getEndedChallenge') return { ok: true, disabled: true, challenge: null };
      if (action === 'getMyChallengeStatus') return { ok: true, disabled: true, challenge: null, participant: null, todayChecked: false, selectedBook: null, checkins: [], checkinDays: 0 };
      // all other actions are treated as no-op
      return { ok: true, disabled: true, skipped: true };
    }

    if (action === 'getActiveChallenge') return await getActiveChallenge();
    if (action === 'getEndedChallenge') return await getEndedChallenge();
    if (action === 'getMyStatus') return await getMyStatus(event.challengeId);
    if (action === 'getMyChallengeStatus') return await getMyChallengeStatus(event);
    if (action === 'selectBook') return await selectBook(event);
    if (action === 'createBookAndCheckin') return await createBookAndCheckin(event);
    if (action === 'checkinToday') return await checkinToday(event);
    if (action === 'autoCheckinByNote') return await autoCheckinByNote(event);
    if (action === 'join') return await joinChallenge(event);
    if (action === 'submitCheckin') return await submitCheckin(event);
    if (action === 'markCompleted') return await markCompleted(event);
    if (action === 'getRankings') return await getRankings(event);
    return { ok: false, error: 'unknown action' };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
};
