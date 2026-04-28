/**
 * 网络状态追踪模块。
 * 无任何 import，确保任意模块可安全引用，不会产生循环依赖。
 */

let _online = true;
let _inited = false;

export function isOnline() {
  return _online;
}

export function initNetwork() {
  if (_inited) return;
  _inited = true;

  wx.getNetworkType({
    success(res) {
      _online = res.networkType !== 'none';
    }
  });

  wx.onNetworkStatusChange(res => {
    _online = res.isConnected;
  });
}
