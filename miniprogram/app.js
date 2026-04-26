import { applyTheme } from './utils/theme.js';

function isRouteAllowed(route) {
  // Avoid redirect loops while onboarding / creating book.
  return (
    route === 'pages/intro/intro' ||
    route === 'pages/emptyShelf/emptyShelf' ||
    route === 'pages/createBook/createBook'
  );
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

    wx.cloud.init({
      env: 'reading-log-6gz8yfff5189799d',   // 请替换为真实环境ID
      traceUser: true
    });

    this.globalData = {};

    // 初始化主题（auto / light / dark）
    applyTheme();

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

    // Route-driven onboarding check + theme push (no artificial delays).
    if (typeof wx.onAppRoute === 'function') {
      wx.onAppRoute(() => {
        const pages = getCurrentPages ? getCurrentPages() : [];
        const currentRoute = pages?.[pages.length - 1]?.route || '';
        const isDark = this.globalData?.isDark || false;

        // 导航栏 — wx.setNavigationBarColor 只对当前页生效，
        // 每次路由切换必须为新页面重新设置，否则回退到 app.json 的浅色默认值。
        const bg = isDark ? '#1E1D1B' : '#F7F6F2';
        wx.setNavigationBarColor({
          frontColor: isDark ? '#ffffff' : '#000000',
          backgroundColor: bg
        });
        wx.setBackgroundColor({
          backgroundColor: bg,
          backgroundColorTop: bg,
          backgroundColorBottom: bg
        });

        // Tab 栏 — 路由到 Tab 页面时 Tab 栏可见，此时才能成功设置。
        // onLaunch / 非 Tab 页中调用可能因 Tab 栏不可见而静默失败。
        wx.setTabBarStyle({
          color: isDark ? '#8A8984' : '#999999',
          selectedColor: isDark ? '#B8A898' : '#A8907A',
          backgroundColor: bg,
          borderStyle: isDark ? 'black' : 'white',
          fail: () => {}
        });

        // 推送到所有活跃页面
        pages.forEach(page => {
          if (page && typeof page.setData === 'function') {
            page.setData({ isDark });
          }
        });
        this.maybeForceIntro(currentRoute, 'intro-v2');
      });
    }
  }
});