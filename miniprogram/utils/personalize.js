export const PERSONALIZE_SETTINGS_KEY = 'personalize_settings_v1';

export const DEFAULT_PERSONALIZE_SETTINGS = {
  homeViewMode: 'grid', // grid | list
  noteTimeMode: 'both', // both | relative | absolute
  saveInputMode: 'clear', // clear | keep
  shareTemplateId: 'nebula', // nebula | paper | sunset
  shareFirstRunConfigured: false
};

function safeGetStorage(key) {
  try {
    return wx.getStorageSync(key);
  } catch (e) {
    return null;
  }
}

function safeSetStorage(key, value) {
  try {
    wx.setStorageSync(key, value);
  } catch (e) {}
}

export function normalizePersonalizeSettings(raw) {
  const next = { ...DEFAULT_PERSONALIZE_SETTINGS };
  const source = raw && typeof raw === 'object' ? raw : {};
  if (source.homeViewMode === 'grid' || source.homeViewMode === 'list') {
    next.homeViewMode = source.homeViewMode;
  }
  if (source.noteTimeMode === 'both' || source.noteTimeMode === 'relative' || source.noteTimeMode === 'absolute') {
    next.noteTimeMode = source.noteTimeMode;
  }
  if (source.saveInputMode === 'clear' || source.saveInputMode === 'keep') {
    next.saveInputMode = source.saveInputMode;
  }
  if (source.shareTemplateId === 'nebula' || source.shareTemplateId === 'paper' || source.shareTemplateId === 'sunset') {
    next.shareTemplateId = source.shareTemplateId;
  }
  if (typeof source.shareFirstRunConfigured === 'boolean') {
    next.shareFirstRunConfigured = source.shareFirstRunConfigured;
  }
  return next;
}

export function getPersonalizeSettings() {
  const saved = safeGetStorage(PERSONALIZE_SETTINGS_KEY);
  return normalizePersonalizeSettings(saved);
}

export function savePersonalizeSettings(patch = {}) {
  const current = getPersonalizeSettings();
  const merged = normalizePersonalizeSettings({ ...current, ...patch });
  safeSetStorage(PERSONALIZE_SETTINGS_KEY, merged);
  return merged;
}

