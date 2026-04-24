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

export async function adminMe() {
  const res = await callCloudFunctionWithRetry('adminPanel', { action: 'me' });
  return assertCloudOk(res);
}

export async function adminStats() {
  const res = await callCloudFunctionWithRetry('adminPanel', { action: 'stats' });
  return assertCloudOk(res);
}

export async function adminListUsers(offset = 0, limit = 20) {
  const res = await callCloudFunctionWithRetry('adminPanel', { action: 'listUsers', offset, limit });
  return assertCloudOk(res);
}

export async function adminListTestDevices() {
  const res = await callCloudFunctionWithRetry('adminPanel', { action: 'listTestDevices' });
  return assertCloudOk(res);
}

export async function adminResetTestUser(openid, confirmText) {
  const res = await callCloudFunctionWithRetry('adminPanel', { action: 'resetTestUser', openid, confirmText });
  return assertCloudOk(res);
}

export async function adminListFeedback(offset = 0, limit = 20) {
  const res = await callCloudFunctionWithRetry('adminPanel', { action: 'listFeedback', offset, limit });
  return assertCloudOk(res);
}

export async function adminListWishlistHot(offset = 0, limit = 20) {
  const res = await callCloudFunctionWithRetry('adminPanel', { action: 'listWishlistHot', offset, limit });
  return assertCloudOk(res);
}

export async function adminGetTodayPool() {
  const res = await callCloudFunctionWithRetry('adminPanel', { action: 'getTodayPool' });
  return assertCloudOk(res);
}

export async function adminAppendTodayPool(text) {
  const res = await callCloudFunctionWithRetry('adminPanel', { action: 'appendTodayPool', text });
  return assertCloudOk(res);
}

export async function adminListChallenges(status) {
  const res = await callCloudFunctionWithRetry('adminPanel', { action: 'listChallenges', status: status || '' });
  return assertCloudOk(res);
}

export async function adminCreateChallenge(name, desc, startDate, endDate) {
  const res = await callCloudFunctionWithRetry('adminPanel', { action: 'createChallenge', name, desc, startDate, endDate });
  return assertCloudOk(res);
}

export async function adminStartChallenge(id) {
  const res = await callCloudFunctionWithRetry('adminPanel', { action: 'startChallenge', id });
  return assertCloudOk(res);
}

export async function adminEndChallenge(id) {
  const res = await callCloudFunctionWithRetry('adminPanel', { action: 'endChallenge', id });
  return assertCloudOk(res);
}

