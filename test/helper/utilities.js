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
  getPayIdListInfo,
  getSignedSimplexStateArrayBytes,
  channelIds,
  payAmountsArray,
  seqNums,
  lastPayResolveDeadlines,
  transferAmounts,
  payResolverAddr
) {
  let headPayIdLists = [];
  let condPays = [];
  let payIdListBytesArrays = [];
  let totalPendingAmounts = [];
  for (i = 0; i < channelIds.length; i++) {
    const payIdListInfo = getPayIdListInfo({
      payAmounts: payAmountsArray[i],
      payResolverAddr: payResolverAddr
    });
    headPayIdLists[i] = payIdListInfo.payIdListProtos[0];
    condPays[i] = payIdListInfo.payBytesArray;
    payIdListBytesArrays[i] = payIdListInfo.payIdListBytesArray;
    totalPendingAmounts[i] = payIdListInfo.totalPendingAmount;
  }

  const signedSimplexStateArrayBytes = await getSignedSimplexStateArrayBytes({
    channelIds: channelIds,
    seqNums: seqNums,
    lastPayResolveDeadlines: lastPayResolveDeadlines,
    payIdLists: headPayIdLists,
    transferAmounts: transferAmounts,
    totalPendingAmounts: totalPendingAmounts
  });

  return {
    signedSimplexStateArrayBytes: signedSimplexStateArrayBytes,
    lastPayResolveDeadlines: lastPayResolveDeadlines,
    condPays: condPays,
    payIdListBytesArrays: payIdListBytesArrays
  };
}

function getSortedArray(peers) {
  if (peers[0].toLowerCase() < peers[1].toLowerCase()) {
    return peers;
  } else {
    return [peers[1], peers[0]];
  }
}

function calculatePayId(payHashHex, setterAddr) {
  const payHashBytes = web3.utils.hexToBytes(payHashHex);
  const setterAddrBytes = web3.utils.hexToBytes(setterAddr);
  return web3.utils.keccak256(payHashBytes.concat(setterAddrBytes));
}

function uint2bytes(x) {
  if (x < 0) {
    throw "Input number is less than 0!";
  }

  var bytes = [];
  do {
    bytes.push(x & 255);
    x = x >> 8;
  } while (x)
  return bytes.reverse();
}

module.exports = {
  getDeployGasUsed,
  getCallGasUsed,
  mineBlockUntil,
  getSortedArray,
  getCoSignedIntendSettle,
  calculatePayId,
  uint2bytes
}
