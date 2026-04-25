function isRouteAllowed(route) {
  // Avoid redirect loops while onboarding / creating book.
  return (
    route === 'pages/intro/intro' ||
    route === 'pages/emptyShelf/emptyShelf' ||
    route === 'pages/createBook/createBook'
  );
}

function shouldIngest() {
  try {
    return wx.getStorageSync('_debug_ingest') === '1';
  } catch (e) {
    return false;
  }
}

function ingest(data) {
  if (!shouldIngest()) return;
  try {
    wx.request({
      url: 'http://127.0.0.1:7770/ingest/6d568e53-1533-490e-8391-dd2094f1a09b',
      method: 'POST',
      header: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '7934e3' },
      data,
      fail: () => {}
    });
  } catch (e) {
    // ignore
  }
}

function safeGet(key) {
  try { return wx.getStorageSync(key); } catch (e) { return null; }
}
function safeSet(key, value) {
  try { wx.setStorageSync(key, value); } catch (e) {}
}

const INTRO_SEEN_KEY = '_intro_v2_seen';
const PROFILE_DONE_KEY = '_profile_v2_done';

App({
  onError(err) {
    // 捕获脚本错误，便于定位“timeout”来源
    console.error('[App.onError]', err);
  },

  onUnhandledRejection(res) {
    // 捕获未处理的 Promise rejection
    console.error('[App.onUnhandledRejection]', res?.reason || res);
  },

  async maybeForceIntro(route, runId = 'intro-v2') {
    if (this._introRedirecting) return;
    if (this._introChecked) return;
    if (!route || isRouteAllowed(route)) return;

    // 优先读本地 flag，快速返回，避免每次启动都请求云函数。
    // _profile_v2_done 是旧逻辑留下的完成标记，这里顺手迁移到统一的 _intro_v2_seen。
    try {
      if (safeGet(INTRO_SEEN_KEY) === '1' || safeGet(PROFILE_DONE_KEY) === '1') {
        safeSet(INTRO_SEEN_KEY, '1');
        this._introChecked = true;
        return;
      }
    } catch (e) {}

    // openid 未就绪时跳过，等 openid ready 后再检查一次。
    const openid = this.globalData?.openid || '';
    if (!openid) return;

    // 启动期间只检查一次，避免页面切换时反复查云端 / 反复跳转。
    this._introChecked = true;

    // 云函数查询用户是否已有昵称（已有用户不再弹引导）
    try {
      const res = await new Promise((resolve, reject) => {
        wx.cloud.callFunction({
          name: 'userProfile',
          data: { action: 'get' },
          success: resolve,
          fail: reject
        });
      });
      const r = res?.result || {};
      const nick = String(r?.profile?.nickname || '').trim();
      const profileFound = !!r?.found && nick.length >= 2;
      if (profileFound) {
        safeSet(PROFILE_DONE_KEY, '1');
        safeSet(INTRO_SEEN_KEY, '1');
        return;
      }
    } catch (e) {
      // 云函数未部署或调用失败：不弹引导，避免老用户被异常打断。
      return;
    }

    // 新用户：只在首次启动时进入引导页。
    try {
      this._introRedirecting = true;
      // Set flag before navigation so intro won't re-appear if navigation is interrupted.
      safeSet(INTRO_SEEN_KEY, '1');
      wx.navigateTo({ url: '/pages/intro/intro' });
    } finally {
      this._introRedirecting = false;
    }
  },

  onLaunch: function () {
    const launchStart = Date.now();
    ingest({
      sessionId: '7934e3',
      runId: 'pre-fix',
      hypothesisId: 'H1',
      location: 'miniprogram/app.js:onLaunch',
      message: 'onLaunch start',
      data: { hasCloud: !!wx.cloud },
      timestamp: Date.now()
    });

    wx.cloud.init({
      env: 'reading-log-6gz8yfff5189799d',   // 请替换为真实环境ID
      traceUser: true
    });

    ingest({
      sessionId: '7934e3',
      runId: 'pre-fix',
      hypothesisId: 'H1',
      location: 'miniprogram/app.js:onLaunch',
      message: 'wx.cloud.init called',
      data: { hasCloudDb: !!(wx.cloud && wx.cloud.database) },
      timestamp: Date.now()
    });

    this.globalData = {};

    // Fetch openid for client-side security filtering (defense in depth)
    // Note: Requires cloud function `quickstartFunctions` to be deployed
    const fetchOpenId = () => {
      wx.cloud.callFunction({
        name: 'quickstartFunctions',
        data: { type: 'getOpenId' },
        success: (res) => {
          if (res.result?.openid) {
            this.globalData.openid = res.result.openid;
            console.log('[App] openid loaded successfully:', res.result.openid.substring(0, 8) + '...');
            if (Array.isArray(this._openidReadyCbs) && this._openidReadyCbs.length) {
              const cbs = this._openidReadyCbs.slice();
              this._openidReadyCbs.length = 0;
              cbs.forEach((cb) => {
                try { cb(res.result.openid); } catch (e) {}
              });
            }
            const pages = getCurrentPages ? getCurrentPages() : [];
            const currentRoute = pages?.[pages.length - 1]?.route || '';
            this.maybeForceIntro(currentRoute, 'intro-v2-openid-ready');
          }
        },
        fail: (err) => {
          console.warn('[App] failed to get openid (cloud function may not be deployed yet):', err.errMsg || err);
          // Non-fatal: security rules still protect data. User should deploy cloud function.
        }
      });
    };

    this._openidReadyCbs = [];
    this.onOpenIdReady = (cb) => {
      const id = this.globalData?.openid || '';
      if (id) {
        try { cb(id); } catch (e) {}
        return;
      }
      this._openidReadyCbs.push(cb);
    };

    fetchOpenId();
    console.log(`[Perf] App.onLaunch took ${Date.now() - launchStart}ms`);

    // Route-driven onboarding check (no artificial delays).
    if (typeof wx.onAppRoute === 'function') {
      wx.onAppRoute(() => {
        const pages = getCurrentPages ? getCurrentPages() : [];
        const currentRoute = pages?.[pages.length - 1]?.route || '';
        this.maybeForceIntro(currentRoute, 'intro-v2');
      });
    }
  }
});