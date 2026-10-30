const path = require('node:path');

function isAppUrl(value, origin) {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'blob:') && url.origin === origin;
  } catch { return false; }
}

function isBillingHealth(value, directory, requireMultiUser = false) {
  return value?.application === 'finance-billing' && value.storage === 'local'
    && (!requireMultiUser || value.authentication === 'local-users-v1')
    && typeof value.dataDirectory === 'string'
    && path.resolve(value.dataDirectory).toLowerCase() === path.resolve(directory).toLowerCase();
}

module.exports = { isAppUrl, isBillingHealth };
