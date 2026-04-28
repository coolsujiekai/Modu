/**
 * 同步状态辅助，供页面展示离线/待同步状态。
 */

import { getQueueLength } from './offlineQueue.js';
import { isOnline } from './network.js';

export function getSyncStatus() {
  const pendingCount = getQueueLength();
  return {
    isOffline: !isOnline(),
    pendingCount,
    showBanner: !isOnline() || pendingCount > 0
  };
}
