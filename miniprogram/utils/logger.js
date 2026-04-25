function isDev() {
  try {
    return wx.getAccountInfoSync()?.miniProgram?.envVersion !== 'release';
  } catch (e) {
    return false;
  }
}

export const logger = {
  debug(...args) {
    if (isDev()) console.log(...args);
  },
  warn(...args) {
    if (isDev()) console.warn(...args);
  },
  error(...args) {
    // Always log errors
    console.error(...args);
  }
};

