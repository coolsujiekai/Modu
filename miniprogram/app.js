function isRouteAllowed(route) {
  // Avoid redirect loops while onboarding / creating book.
  return (
    route === 'pages/onboarding/onboarding' ||
    route === 'pages/emptyShelf/emptyShelf' ||
    route === 'pages/createBook/createBook'
  );
}

App({
  onError(err) {
    // 捕获脚本错误，便于定位“timeout”来源
    console.error('[App.onError]', err);
  },

  onUnhandledRejection(res) {
    // 捕获未处理的 Promise rejection
    console.error('[App.onUnhandledRejection]', res?.reason || res);
  },

  async maybeForceOnboarding(route, runId = 'pre-fix') {
    if (this._onboardingRedirecting) return;
    if (!route || isRouteAllowed(route)) return;

    // #region agent log
    wx.request({url:'http://127.0.0.1:7770/ingest/6d568e53-1533-490e-8391-dd2094f1a09b',method:'POST',header:{'Content-Type':'application/json','X-Debug-Session-Id':'7934e3'},data:{sessionId:'7934e3',runId,hypothesisId:'H2',location:'miniprogram/app.js:maybeForceOnboarding',message:'maybeForceOnboarding enter',data:{route,hasCloud:!!wx.cloud,hasCloudDb:!!(wx.cloud&&wx.cloud.database)},timestamp:Date.now()},fail:()=>{}});
    // #endregion

    try {
      this._onboardingRedirecting = true;
      const db = wx.cloud.database();
      const [readingRes, finishedRes] = await Promise.all([
        db.collection('books').where({ status: 'reading' }).count(),
        db.collection('books').where({ status: 'finished' }).count()
      ]);
      const readingCount = Number(readingRes?.total || 0);
      const finishedCount = Number(finishedRes?.total || 0);

      // #region agent log
      wx.request({url:'http://127.0.0.1:7770/ingest/6d568e53-1533-490e-8391-dd2094f1a09b',method:'POST',header:{'Content-Type':'application/json','X-Debug-Session-Id':'7934e3'},data:{sessionId:'7934e3',runId,hypothesisId:'H2',location:'miniprogram/app.js:maybeForceOnboarding',message:'count result',data:{route,readingCount,finishedCount},timestamp:Date.now()},fail:()=>{}});
      // #endregion

      if (readingCount === 0 && finishedCount === 0) {
        const onboardingSeen = wx.getStorageSync('_onboarding_v1_seen') === '1';
        const emptyShelfSeen = wx.getStorageSync('_empty_shelf_v1_seen') === '1';

        if (!onboardingSeen) {
          wx.redirectTo({ url: '/pages/onboarding/onboarding' });
          return;
        }
        if (!emptyShelfSeen) {
          wx.redirectTo({ url: '/pages/emptyShelf/emptyShelf' });
          return;
        }
        // Both intro pages have been shown once; do not force redirect.
      }
    } catch (e) {
      // #region agent log
      wx.request({url:'http://127.0.0.1:7770/ingest/6d568e53-1533-490e-8391-dd2094f1a09b',method:'POST',header:{'Content-Type':'application/json','X-Debug-Session-Id':'7934e3'},data:{sessionId:'7934e3',runId,hypothesisId:'H2',location:'miniprogram/app.js:maybeForceOnboarding',message:'count failed',data:{route,errMsg:String(e?.errMsg||e?.message||e)},timestamp:Date.now()},fail:()=>{}});
      // #endregion
    } finally {
      this._onboardingRedirecting = false;
    }
  },

  onLaunch: function () {
    // #region agent log
    wx.request({url:'http://127.0.0.1:7770/ingest/6d568e53-1533-490e-8391-dd2094f1a09b',method:'POST',header:{'Content-Type':'application/json','X-Debug-Session-Id':'7934e3'},data:{sessionId:'7934e3',runId:'pre-fix',hypothesisId:'H1',location:'miniprogram/app.js:onLaunch',message:'onLaunch start',data:{hasCloud:!!wx.cloud},timestamp:Date.now()},fail:()=>{}});
    // #endregion

    wx.cloud.init({
      env: 'reading-log-6gz8yfff5189799d',   // 请替换为真实环境ID
      traceUser: true
    });

    // #region agent log
    wx.request({url:'http://127.0.0.1:7770/ingest/6d568e53-1533-490e-8391-dd2094f1a09b',method:'POST',header:{'Content-Type':'application/json','X-Debug-Session-Id':'7934e3'},data:{sessionId:'7934e3',runId:'pre-fix',hypothesisId:'H1',location:'miniprogram/app.js:onLaunch',message:'wx.cloud.init called',data:{hasCloudDb:!!(wx.cloud&&wx.cloud.database)},timestamp:Date.now()},fail:()=>{}});
    // #endregion

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
          }
        },
        fail: (err) => {
          console.warn('[App] failed to get openid (cloud function may not be deployed yet):', err.errMsg || err);
          // Non-fatal: security rules still protect data. User should deploy cloud function.
        }
      });
    };

    fetchOpenId();

    // Route-driven onboarding check (no artificial delays).
    if (typeof wx.onAppRoute === 'function') {
      wx.onAppRoute(() => {
        const pages = getCurrentPages ? getCurrentPages() : [];
        const currentRoute = pages?.[pages.length - 1]?.route || '';
        this.maybeForceOnboarding(currentRoute, 'pre-fix');
      });
    }
  }
});