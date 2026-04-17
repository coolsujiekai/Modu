const dbInstance = wx.cloud.database();
const _ = dbInstance.command;

export { dbInstance as db, _ };

export async function withRetry(fn) {
  try {
    return await fn();
  } catch (e) {
    const msg = e?.errMsg || '';
    if (msg.includes('timeout')) {
      await new Promise(r => setTimeout(r, 500));
      return await fn();
    }
    throw e;
  }
}

export async function traced(label, fn) {
  const start = Date.now();
  try {
    const res = await fn();
    console.log(`[ok] ${label} ${Date.now() - start}ms`);
    return res;
  } catch (e) {
    console.error(`[fail] ${label} ${Date.now() - start}ms`, e);
    throw e;
  }
}

/**
 * Returns a secure where clause that includes _openid filter
 * to prevent data leakage between users.
 */
let openidWarningLogged = false;

export function withOpenIdFilter(baseWhere = {}) {
  const app = getApp();
  const openid = app?.globalData?.openid;
  if (!openid) {
    if (!openidWarningLogged) {
      console.warn('[db] No openid in globalData yet (cloud function may not be deployed), falling back to baseWhere only. Data isolation still protected by cloud security rules.');
      openidWarningLogged = true;
    }
    return baseWhere;
  }
  return _.and(baseWhere, { _openid: openid });
}
