/**
 * 主题管理：支持 auto / light / dark 三种模式
 */

const THEME_KEY = '_theme_mode_v1';

function safeGet(key) {
  try { return wx.getStorageSync(key); } catch (e) { return null; }
}
function safeSet(key, value) {
  try { wx.setStorageSync(key, value); } catch (e) {}
}

export function getThemeMode() {
  const v = safeGet(THEME_KEY);
  if (v === 'light' || v === 'dark') return v;
  return 'auto';
}

export function setThemeMode(mode) {
  if (mode !== 'light' && mode !== 'dark' && mode !== 'auto') return;
  safeSet(THEME_KEY, mode);
  applyTheme(mode);
}

export function applyTheme(mode) {
  if (!mode) mode = getThemeMode();

  const app = getApp();
  if (app) {
    app.globalData.themeMode = mode;
  }

  let isDark = false;
  if (mode === 'dark') {
    isDark = true;
  } else if (mode === 'auto') {
    const sys = wx.getSystemInfoSync();
    isDark = String(sys.theme || 'light') === 'dark';
  }

  // 窗口外观
  const fg = isDark ? '#F0EFEB' : '#2C2B28';
  const bg = isDark ? '#1E1D1B' : '#F7F6F2';
  wx.setNavigationBarColor({ frontColor: isDark ? '#ffffff' : '#000000', backgroundColor: bg });
  wx.setBackgroundColor({ backgroundColor: bg, backgroundColorTop: bg, backgroundColorBottom: bg });
  wx.setBackgroundTextStyle({ textStyle: isDark ? 'light' : 'dark' });

  // 存到 globalData，各页面 onShow 时读取
  if (app) {
    app.globalData.isDark = isDark;
    app.globalData.themeMode = mode;
  }

  // 推送到所有活跃页面
  const pages = getCurrentPages();
  pages.forEach(page => {
    if (page && typeof page.setData === 'function') {
      page.setData({ isDark });
    }
  });
}

export function isDarkMode() {
  const app = getApp();
  if (app && typeof app.globalData.isDark === 'boolean') {
    return app.globalData.isDark;
  }
  const mode = getThemeMode();
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  try {
    const sys = wx.getSystemInfoSync();
    return String(sys.theme || 'light') === 'dark';
  } catch (e) {
    return false;
  }
}
