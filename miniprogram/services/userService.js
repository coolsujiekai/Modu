/**
 * userService.js
 * 用户资料相关逻辑：云函数读写 + 头像上传
 */
import { callCloudFunctionWithRetry, getErrorMessage } from '../utils/db.js';

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

export async function getUserProfile() {
  const res = await callCloudFunctionWithRetry('userProfile', { action: 'get' });
  const result = assertCloudOk(res);
  return {
    found: !!result.found,
    profile: result.profile || null
  };
}

export async function upsertUserProfile(payload) {
  const res = await callCloudFunctionWithRetry('userProfile', { action: 'upsert', ...payload });
  return assertCloudOk(res);
}

export async function uploadAvatar(localPath, options = {}) {
  if (!localPath) throw new Error('missing localPath');
  if (!wx?.cloud?.uploadFile) throw new Error('wx.cloud.uploadFile is not available');

  const app = getApp();
  const openid = app?.globalData?.openid || '';
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const ext = String(options.ext || 'jpg').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'jpg';
  const cloudPath = `user-avatars/${openid || 'unknown'}/${ts}_${rand}.${ext}`;

  try {
    const res = await wx.cloud.uploadFile({
      cloudPath,
      filePath: localPath
    });
    const fileID = res?.fileID || '';
    if (!fileID) throw new Error('upload failed: missing fileID');
    return { fileID, cloudPath };
  } catch (e) {
    throw new Error(getErrorMessage(e) || 'upload failed');
  }
}

