const dns = require("dns");

function configureDns() {
  const raw = process.env.DNS_SERVERS;

  if (!raw) {
    return [];
  }

  const servers = raw.split(",").map((server) => server.trim()).filter(Boolean);

  if (servers.length > 0) {
    dns.setServers(servers);
  }

  return servers;
}

module.exports = {
  configureDns
};
