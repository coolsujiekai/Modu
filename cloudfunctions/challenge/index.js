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

function getOpenid() {
  return cloud.getWXContext().OPENID;
}

// 获取当前进行中的活动
async function getActiveChallenge() {
  try {
    const res = await db.collection(CHALLENGES_COLLECTION)
      .where({ status: 'active' })
      .limit(1)
      .get();
    const challenge = (res.data || [])[0] || null;
    return { ok: true, challenge };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// 获取已结束的活动（用于排行榜）
async function getEndedChallenge() {
  try {
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
    if (action === 'getActiveChallenge') return await getActiveChallenge();
    if (action === 'getEndedChallenge') return await getEndedChallenge();
    if (action === 'getMyStatus') return await getMyStatus(event.challengeId);
    if (action === 'join') return await joinChallenge(event);
    if (action === 'submitCheckin') return await submitCheckin(event);
    if (action === 'markCompleted') return await markCompleted(event);
    if (action === 'getRankings') return await getRankings(event);
    return { ok: false, error: 'unknown action' };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
};
