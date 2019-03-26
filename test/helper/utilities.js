async function mineBlockUntil(deadline, sendAccount) {
  let block = await web3.eth.getBlock('latest');
  while(block.number <= deadline) {
    await web3.eth.sendTransaction({from: sendAccount});  // dummy block consumer
    block = await web3.eth.getBlock('latest');
  }
}

async function prepareCoSignedIntendSettle(
  getPayHashListInfo,
  getSignedSimplexStateArrayBytes,
  channelIds,
  seqNums = [1, 1],
  lastPayResolveDeadlines = [999999999, 9999999999],
  transferAmounts = [10, 20]
) {
  const payHashListInfos = [
    getPayHashListInfo({payAmounts: [[1, 2], [3, 4]]}),
    getPayHashListInfo({payAmounts: [[5, 6], [7, 8]]})
  ];

  const signedSimplexStateArrayBytes = await getSignedSimplexStateArrayBytes({
    channelIds: channelIds,
    seqNums: seqNums,
    lastPayResolveDeadlines: lastPayResolveDeadlines,
    payHashLists: [
      payHashListInfos[0].payHashListProtos[0],
      payHashListInfos[1].payHashListProtos[0]
    ],
    transferAmounts: transferAmounts
  });

  return {
    signedSimplexStateArrayBytes: signedSimplexStateArrayBytes,
    lastPayResolveDeadlines: lastPayResolveDeadlines,
    condPays: [
      payHashListInfos[0].payBytesArray,
      payHashListInfos[1].payBytesArray
    ],
    payHashListBytesArrays: [
      payHashListInfos[0].payHashListBytesArray,
      payHashListInfos[1].payHashListBytesArray
    ]
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
  mineBlockUntil: mineBlockUntil,
  prepareCoSignedIntendSettle: prepareCoSignedIntendSettle,
  getSortedArray: getSortedArray
}