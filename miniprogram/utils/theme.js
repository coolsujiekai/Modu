/**
 * 主题管理：支持 auto / light / dark 三种模式
 *
 * CSS 变量的定义在 theme.wxss 的 .page {} 和 .dark-theme {} 中，
 * 这里只负责：
 * 1. 持久化用户选择
 * 2. 设置原生窗口外观（导航栏、Tab栏、窗口背景）
 * 3. 推送 isDark 状态到活跃页面
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

  let isDark = false;
  if (mode === 'dark') {
    isDark = true;
  } else if (mode === 'auto') {
    try {
      const sys = wx.getSystemInfoSync();
      isDark = String(sys.theme || 'light') === 'dark';
    } catch (e) {}
  }

  const bg = isDark ? '#1E1D1B' : '#F7F6F2';

  // 1. 导航栏
  wx.setNavigationBarColor({
    frontColor: isDark ? '#ffffff' : '#000000',
    backgroundColor: bg
  });

  // 2. 窗口背景（下拉刷新区域）
  wx.setBackgroundColor({
    backgroundColor: bg,
    backgroundColorTop: bg,
    backgroundColorBottom: bg
  });
  wx.setBackgroundTextStyle({ textStyle: isDark ? 'light' : 'dark' });

  // 3. Tab 栏（如果当前不在 Tab 页可能失败，路由回调会补调）
  wx.setTabBarStyle({
    color: isDark ? '#8A8984' : '#999999',
    selectedColor: isDark ? '#B8A898' : '#A8907A',
    backgroundColor: bg,
    borderStyle: isDark ? 'black' : 'white',
    fail: () => {} // Tab 栏不可见时静默忽略，路由回调会补调
  });

  // 4. 全局状态
  const app = getApp();
  if (app) {
    app.globalData.isDark = isDark;
    app.globalData.themeMode = mode;
  }

  // 5. 推送到所有活跃页面
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
