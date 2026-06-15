// utils/mongoDns.js
const dns = require('dns');
const config = require('../config');

function configureMongoDns() {
  if (!config.mongoDnsServers) {
    return;
  }

  const servers = config.mongoDnsServers
    .split(',')
    .map(server => server.trim())
    .filter(Boolean);

  if (servers.length > 0) {
    dns.setServers(servers);
  }
}

module.exports = { configureMongoDns };
