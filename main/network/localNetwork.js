const os = require("os");

function isPrivateIPv4(address) {
  if (!address || address.startsWith("127.")) {
    return false;
  }

  if (address.startsWith("10.") || address.startsWith("192.168.")) {
    return true;
  }

  const match = /^172\.(\d+)\./.exec(address);
  if (!match) {
    return false;
  }

  const secondOctet = Number(match[1]);
  return secondOctet >= 16 && secondOctet <= 31;
}

function getLocalIPv4Addresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const detailsList of Object.values(interfaces)) {
    for (const details of detailsList || []) {
      if (details.family !== "IPv4" || details.internal) {
        continue;
      }

      addresses.push(details.address);
    }
  }

  addresses.sort((left, right) => {
    const leftScore = isPrivateIPv4(left) ? 0 : 1;
    const rightScore = isPrivateIPv4(right) ? 0 : 1;
    return leftScore - rightScore;
  });

  return [...new Set(addresses)];
}

function getPreferredLocalIp() {
  const addresses = getLocalIPv4Addresses();
  return addresses[0] || "127.0.0.1";
}

module.exports = {
  getLocalIPv4Addresses,
  getPreferredLocalIp,
};
