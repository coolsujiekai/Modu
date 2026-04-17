App({
  onError(err) {
    // 捕获脚本错误，便于定位“timeout”来源
    console.error('[App.onError]', err);
  },

  onUnhandledRejection(res) {
    // 捕获未处理的 Promise rejection
    console.error('[App.onUnhandledRejection]', res?.reason || res);
  },

  onLaunch: function () {
    wx.cloud.init({
      env: 'reading-log-6gz8yfff5189799d',   // 请替换为真实环境ID
      traceUser: true
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
          }
        },
        fail: (err) => {
          console.warn('[App] failed to get openid (cloud function may not be deployed yet):', err.errMsg || err);
          // Non-fatal: security rules still protect data. User should deploy cloud function.
        }
      });
    };

    fetchOpenId();
  }
});