import { callCloudFunctionWithRetry } from '../utils/db.js';

function assertCloudOk(res) {
  const errMsg = String(res?.errMsg || '');
  if (errMsg && !errMsg.toLowerCase().includes(':ok')) {
    throw new Error(errMsg);
  }
  const result = res?.result || null;
  if (!result) throw new Error('empty cloud result');
  if (result.ok === false) throw new Error(result.error || 'cloud error');
  return result;
}

function cloud(action, data = {}) {
  return callCloudFunctionWithRetry('challenge', { action, ...data });
}

export async function getActiveChallenge() {
  return assertCloudOk(await cloud('getActiveChallenge'));
}

export async function getEndedChallenge() {
  return assertCloudOk(await cloud('getEndedChallenge'));
}

export async function getMyStatus(challengeId) {
  return assertCloudOk(await cloud('getMyStatus', { challengeId }));
}

export async function joinChallenge(challengeId) {
  return assertCloudOk(await cloud('join', { challengeId }));
}

export async function submitCheckin(challengeId, bookName, content) {
  return assertCloudOk(await cloud('submitCheckin', { challengeId, bookName, content }));
}

export async function markCompleted(challengeId) {
  return assertCloudOk(await cloud('markCompleted', { challengeId }));
}

export async function getRankings(challengeId) {
  return assertCloudOk(await cloud('getRankings', { challengeId }));
}

// ---- 极简打卡新接口（优先使用）----

export async function getMyChallengeStatus(challengeId) {
  return assertCloudOk(await cloud('getMyChallengeStatus', { challengeId }));
}

export async function selectBook(challengeId, bookId) {
  return assertCloudOk(await cloud('selectBook', { challengeId, bookId }));
}

export async function createBookAndCheckin(challengeId, bookName) {
  return assertCloudOk(await cloud('createBookAndCheckin', { challengeId, bookName }));
}

export async function checkinToday(challengeId, bookId) {
  return assertCloudOk(await cloud('checkinToday', { challengeId, bookId }));
}

export async function autoCheckinByNote(bookId, noteType, noteTimestamp) {
  return assertCloudOk(await cloud('autoCheckinByNote', { bookId, noteType, noteTimestamp }));
}
