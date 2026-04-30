const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

async function getOpenId() {
  const wxContext = cloud.getWXContext();
  return {
    openid: wxContext.OPENID,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID
  };
}

exports.main = async (event) => {
  switch (event?.type) {
    case 'getOpenId':
      return await getOpenId();
    default:
      throw new Error(`Unsupported type: ${String(event?.type || '')}`);
  }
};
