function isDev() {
  try {
    return wx.getAccountInfoSync()?.miniProgram?.envVersion !== 'release';
  } catch (e) {
    return false;
  }
}

function getEnvVersion() {
  try {
    return wx.getAccountInfoSync()?.miniProgram?.envVersion || 'unknown';
  } catch (e) {
    return 'unknown';
  }
}

function safeJson(value, fallback = '') {
  try {
    return JSON.stringify(value);
  } catch (e) {
    return fallback;
  }
}

function getCurrentRoute() {
  try {
    const pages = getCurrentPages ? getCurrentPages() : [];
    const cur = pages?.[pages.length - 1];
    const route = cur?.route || '';
    const options = cur?.options || {};
    return { route, options };
  } catch (e) {
    return { route: '', options: {} };
  }
}

function getDeviceContext() {
  try {
    const device = wx.getDeviceInfo?.() || null;
    const windowInfo = wx.getWindowInfo?.() || null;
    const appBase = wx.getAppBaseInfo?.() || null;
    // 兼容旧基础库
    const info = (!device || !windowInfo || !appBase) ? (wx.getSystemInfoSync?.() || null) : null;

    if (!device && !windowInfo && !appBase && !info) return {};
    return {
      brand: device?.brand ?? info?.brand,
      model: device?.model ?? info?.model,
      system: device?.system ?? info?.system,
      platform: device?.platform ?? info?.platform,
      version: appBase?.version ?? info?.version,
      SDKVersion: appBase?.SDKVersion ?? info?.SDKVersion,
      screenWidth: windowInfo?.screenWidth ?? info?.screenWidth,
      screenHeight: windowInfo?.screenHeight ?? info?.screenHeight,
      pixelRatio: windowInfo?.pixelRatio ?? info?.pixelRatio,
      language: appBase?.language ?? info?.language
    };
  } catch (e) {
    return {};
  }
}

function normalizeError(err) {
  if (!err) return { message: '', raw: '' };
  if (typeof err === 'string') return { message: err, raw: err };
  const message = String(err?.message || err?.errMsg || '');
  const stack = String(err?.stack || '');
  return {
    message: message || safeJson(err, ''),
    stack,
    raw: safeJson(err, '')
  };
}

function clipText(s, maxLen) {
  const t = String(s || '').trim();
  if (!t) return '';
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

let _cloudLogger = null;
function getCloudLogger() {
  if (_cloudLogger) return _cloudLogger;
  try {
    if (wx?.cloud?.logger) {
      _cloudLogger = wx.cloud.logger();
      return _cloudLogger;
    }
  } catch (e) {}
  _cloudLogger = null;
  return null;
}

let _lastFlushAt = 0;
function scheduleFlush() {
  const cl = getCloudLogger();
  if (!cl?.flush) return;
  const now = Date.now();
  if (now - _lastFlushAt < 8000) return;
  _lastFlushAt = now;
  try {
    setTimeout(() => {
      try { cl.flush(); } catch (e) {}
    }, 600);
  } catch (e) {}
}

export const logger = {
  info(...args) {
    if (isDev()) console.log(...args);
  },
  debug(...args) {
    if (isDev()) console.log(...args);
  },
  warn(...args) {
    if (isDev()) console.warn(...args);
  },
  error(...args) {
    // Always log errors
    console.error(...args);
  },

  /**
   * 上报到云开发日志（若可用）。默认仅上报 error（release 环境也会上报）。
   * @param {any} err
   * @param {object} context
   */
  reportError(err, context = {}) {
    const payload = {
      level: 'error',
      envVersion: getEnvVersion(),
      at: Date.now(),
      route: getCurrentRoute(),
      device: getDeviceContext(),
      app: {
        openid: getApp?.()?.globalData?.openid || '',
      },
      error: normalizeError(err),
      context
    };

    // local
    console.error('[reportError]', payload.error?.message || payload.error, context);

    // cloud
    try {
      const cl = getCloudLogger();
      if (cl?.error) {
        cl.error(payload);
        scheduleFlush();
      }
    } catch (e) {
      // ignore cloud logger failures
    }

    // fallback: write to DB via cloudfunction (in case client logs are not collected)
    try {
      const p = {
        envVersion: payload.envVersion,
        at: payload.at,
        route: payload.route,
        device: payload.device,
        context: payload.context,
        error: {
          message: clipText(payload.error?.message, 600),
          stack: clipText(payload.error?.stack, 4000),
          raw: clipText(payload.error?.raw, 4000),
        }
      };
      wx.cloud.callFunction({
        name: 'bookOperations',
        data: { action: 'reportClientError', payload: p }
      }).catch(() => {});
    } catch (e) {
      // ignore
    }
  }
};

