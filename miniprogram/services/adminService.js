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

