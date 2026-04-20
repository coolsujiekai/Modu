let dbInstance = null;

function ensureDb() {
  if (dbInstance) return dbInstance;
  if (!wx?.cloud?.database) {
    throw new Error('Cloud API is not ready: wx.cloud.init may not have been called');
  }
  dbInstance = wx.cloud.database();
  return dbInstance;
}

export const db = new Proxy(
  {},
  {
    get(_target, prop) {
      const real = ensureDb()[prop];
      if (typeof real === 'function') return real.bind(ensureDb());
      return real;
    }
  }
);

export const _ = new Proxy(
  {},
  {
    get(_target, prop) {
      const cmd = ensureDb().command;
      return cmd[prop];
    }
  }
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getErrorMessage(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  return String(error?.errMsg || error?.message || error);
}

function isTimeoutLikeError(error) {
  const msg = getErrorMessage(error).toLowerCase();
  return msg.includes('timeout') || msg.includes('time out');
}

export async function withRetry(fn, options = {}) {
  const retries = Number(options.retries ?? 2);
  const baseDelayMs = Number(options.baseDelayMs ?? 500);
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const canRetry = attempt < retries && isTimeoutLikeError(error);
      if (!canRetry) break;
      await sleep(baseDelayMs * (attempt + 1));
    }
  }
  throw lastError;
}

export async function callCloudFunctionWithRetry(name, data, options = {}) {
  return withRetry(
    () => wx.cloud.callFunction({ name, data }),
    options
  );
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
