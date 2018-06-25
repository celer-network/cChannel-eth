module.exports = async (instance, accounts) => {
  const peers = [accounts[0], accounts[1]];
  const withdrawalTimeout = [1, 1];

  return instance.openChannel(peers, withdrawalTimeout, 1);
}