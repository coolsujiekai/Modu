/**
 * 离线写入队列 + 上线自动同步引擎。
 *
 * 入队 (enqueue)：离线时将云函数调用暂存到 Storage。
 * 出队 (processQueue)：网络恢复后 FIFO 逐条重放。
 */

import { isOnline } from './network.js';

const STORAGE_KEY = '_offline_queue';
const MAX_QUEUE_SIZE = 500;
const MAX_RETRIES = 5;

// ─── 内部工具 ─────────────────────────────────────────

function generateId() {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 10);
  return `${ts}_${rand}`;
}

function readStorage() {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY);
    if (Array.isArray(raw)) return raw;
    return [];
  } catch (e) {
    return [];
  }
}

function writeStorage(queue) {
  try {
    let list = queue;
    if (list.length > MAX_QUEUE_SIZE) {
      console.warn(`[offlineQueue] 队列溢出 (${list.length})，丢弃最旧 ${list.length - MAX_QUEUE_SIZE} 条`);
      list = list.slice(-MAX_QUEUE_SIZE);
    }
    wx.setStorageSync(STORAGE_KEY, list);
  } catch (e) {
    console.error('[offlineQueue] 写入 Storage 失败:', e);
  }
}

// ─── 公开 API ─────────────────────────────────────────

export function enqueue(cloudFunctionName, cloudFunctionData) {
  const queue = readStorage();
  queue.push({
    id: generateId(),
    cloudFunctionName,
    cloudFunctionData,
    createdAt: Date.now(),
    retryCount: 0
  });
  writeStorage(queue);
}

export function getQueueLength() {
  return readStorage().length;
}

export function getQueue() {
  return readStorage();
}

// ─── 同步引擎 ─────────────────────────────────────────

let _syncing = false;

export async function processQueue() {
  if (_syncing) return;
  _syncing = true;

  try {
    let queue = readStorage();
    if (queue.length === 0) return;

    for (let i = 0; i < queue.length; i++) {
      if (!isOnline()) break; // 网络又断了，停止

      const item = queue[i];
      try {
        const res = await wx.cloud.callFunction({
          name: item.cloudFunctionName,
          data: item.cloudFunctionData
        });
        const errMsg = String(res?.errMsg || '');
        const cloudError = res?.result?.error;

        if ((errMsg && !errMsg.toLowerCase().includes(':ok')) || cloudError) {
          throw new Error(cloudError || errMsg);
        }

        // 成功：从队列移除
        queue = readStorage(); // 重新读，防止本地 Storage 被外部修改
        const idx = queue.findIndex(q => q.id === item.id);
        if (idx >= 0) {
          queue.splice(idx, 1);
          writeStorage(queue);
        }
      } catch (e) {
        const msg = String(e?.message || e?.errMsg || '').toLowerCase();
        const isNetworkError =
          msg.includes('timeout') ||
          msg.includes('time out') ||
          msg.includes('network') ||
          msg.includes('offline') ||
          msg.includes('fail');

        if (isNetworkError) {
          // 网络错误：停止，保留条目等下次
          _syncing = false;
          return;
        }

        // 业务错误：重试计数
        queue = readStorage();
        const idx = queue.findIndex(q => q.id === item.id);
        if (idx >= 0) {
          queue[idx].retryCount += 1;
          if (queue[idx].retryCount >= MAX_RETRIES) {
            console.warn(`[offlineQueue] 丢弃失败操作 (${MAX_RETRIES} 次重试):`, item.cloudFunctionData.action);
            queue.splice(idx, 1);
          }
          writeStorage(queue);
        }
      }
    }
  } finally {
    _syncing = false;
  }
}

// ─── 初始化 ───────────────────────────────────────────

let _inited = false;

export function initOfflineSync() {
  if (_inited) return;
  _inited = true;

  // 冷启动：如果已在线，清空遗留队列
  if (isOnline()) {
    processQueue();
  }

  // 注册网络变化监听（上层 network.js 已注册基础监听，这里追加同步逻辑）
  wx.onNetworkStatusChange(res => {
    if (res.isConnected) {
      processQueue();
    }
  });
}
