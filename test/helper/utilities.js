async function getDeployGasUsed(instance) {
  let receipt = await web3.eth.getTransactionReceipt(instance.transactionHash);
  return receipt.gasUsed;
}

function getCallGasUsed(tx) {
  return tx.receipt.gasUsed;
}

async function mineBlockUntil(deadline, sendAccount) {
  let block = await web3.eth.getBlock('latest');
  while (block.number <= deadline) {
    await web3.eth.sendTransaction({ from: sendAccount });  // dummy block consumer
    block = await web3.eth.getBlock('latest');
  }
}

// get one or two co-signed states for intendSettle()
async function getCoSignedIntendSettle(
  getPayHashListInfo,
  getSignedSimplexStateArrayBytes,
  channelIds,
  payAmountsArray,
  seqNums,
  lastPayResolveDeadlines,
  transferAmounts
) {
  let headPayHashLists = [];
  let condPays = [];
  let payHashListBytesArrays = [];
  for (i = 0; i < channelIds.length; i++) {
    const payHashListInfo = getPayHashListInfo({ payAmounts: payAmountsArray[i] });
    headPayHashLists[i] = payHashListInfo.payHashListProtos[0];
    condPays[i] = payHashListInfo.payBytesArray;
    payHashListBytesArrays[i] = payHashListInfo.payHashListBytesArray;
  }

  const signedSimplexStateArrayBytes = await getSignedSimplexStateArrayBytes({
    channelIds: channelIds,
    seqNums: seqNums,
    lastPayResolveDeadlines: lastPayResolveDeadlines,
    payHashLists: headPayHashLists,
    transferAmounts: transferAmounts
  });

  return {
    signedSimplexStateArrayBytes: signedSimplexStateArrayBytes,
    lastPayResolveDeadlines: lastPayResolveDeadlines,
    condPays: condPays,
    payHashListBytesArrays: payHashListBytesArrays
  };
}

function getSortedArray(peers) {
  if (peers[0].toLowerCase() < peers[1].toLowerCase()) {
    return peers;
  } else {
    return [peers[1], peers[0]];
  }
}

module.exports = {
  getDeployGasUsed: getDeployGasUsed,
  getCallGasUsed: getCallGasUsed,
  mineBlockUntil: mineBlockUntil,
  getSortedArray: getSortedArray,
  getCoSignedIntendSettle: getCoSignedIntendSettle
}