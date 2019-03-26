const Web3 = require('web3');
const web3 = new Web3(new Web3.providers.HttpProvider('http://localhost:8545'));
const sha3 = web3.utils.keccak256;

const protoChainFactory = require('../helper/protoChainFactory');

const utilities = require('../helper/utilities');
const mineBlockUntil = utilities.mineBlockUntil;
const getSortedArray = utilities.getSortedArray;
const prepareCoSignedIntendSettle = utilities.prepareCoSignedIntendSettle;

const CelerChannel = artifacts.require('CelerChannel');
const Resolver = artifacts.require('VirtContractResolver');
const EthPool = artifacts.require('EthPool');

const SETTLE_TIMEOUT = 20;

// get the original indeces of a sorted array
function getSortIndeces(toSort) {
  let tmp = [];
  for (i = 0; i < toSort.length; i++) {
    tmp[i] = [toSort[i], i];
  }
  tmp.sort(function(left, right) {
    return BigInt(left[0]) < BigInt(right[0]) ? -1 : 1;
  });
  let sortIndices = [];
  for (i = 0; i < tmp.length; i++) {
    sortIndices.push(tmp[i][1]);
  }
  return sortIndices;
}

function reorder(toOrder, sortIndeces) {
  let result = [];
  for (i = 0; i < toOrder.length; i++) {
    result[i] = toOrder[sortIndeces[i]];
  }
  return result;
}

contract('CelerChannel using ETH', async accounts => {
  const peers = getSortedArray([accounts[0], accounts[1]]);
  const peers2 = getSortedArray([accounts[2], accounts[3]]);
  const clients = [accounts[8], accounts[9]];  // namely [src, dest]
  // contract enforce ascending order of addresses
  let instance;
  let ethPool;
  let channelId;
  let globalResult;
  let uniqueChannelIds = [];

  let protoChainInstance;
  let getOpenChannelRequest;
  let getCooperativeWithdrawRequestBytes;
  let getSignedSimplexStateArrayBytes;
  let getCooperativeSettleRequestBytes;
  let getResolvePayByConditionsRequestBytes;
  let getPayHashListInfo;

  before(async () => {
    const resolver = await Resolver.new();
    ethPool = await EthPool.new();
    instance = await CelerChannel.new(ethPool.address, resolver.address);

    protoChainInstance = await protoChainFactory(peers, clients);
    getOpenChannelRequest = protoChainInstance.getOpenChannelRequest;
    getCooperativeWithdrawRequestBytes = protoChainInstance.getCooperativeWithdrawRequestBytes;
    getSignedSimplexStateArrayBytes = protoChainInstance.getSignedSimplexStateArrayBytes;
    getCooperativeSettleRequestBytes = protoChainInstance.getCooperativeSettleRequestBytes;
    getResolvePayByConditionsRequestBytes = protoChainInstance.getResolvePayByConditionsRequestBytes;
    getPayHashListInfo = protoChainInstance.getPayHashListInfo;

    // make sure peers deposit enough ETH in ETH pool
    await ethPool.deposit(
      peers[0],
      {
        from: peers[0],
        value: 1000000000
      }
    );

    await ethPool.deposit(
      peers[1],
      {
        from: peers[1],
        value: 1000000000
      }
    );
  });

  it('should fail to transfer ETH to CelerChannel from a non-EthPool address', async () => {
    let err = null;

    try {
      await instance.sendTransaction({ value: 100, from: accounts[0]});
    } catch (error) {
      err = error;
    }
    assert.isOk(err instanceof Error);
  });

  it('should transfer ETH to CelerChannel correctly from EthPool address', async () => {
    instanceTmp = await CelerChannel.new(
      accounts[0],  // eth pool address
      accounts[1]
    );

    let balance;
    balance = await web3.eth.getBalance(instanceTmp.address);
    assert.equal(balance, 0);

    await instanceTmp.sendTransaction({ value: 100, from: accounts[0]});
    balance = await web3.eth.getBalance(instanceTmp.address);
    assert.equal(balance, 100);
  });

  it('should return Uninitialized status for an inexistent channel', async () => {
    const status = await instance.getChannelStatus(1);

    assert.equal(status, 0);
  });

  it('should fail to open a channel after openDeadline', async () => {
    const request = await getOpenChannelRequest({
      CelerChannelAddress: instance.address,
      settleTimeout: SETTLE_TIMEOUT,
      zeroTotalDeposit: true,
      openDeadline: 0
    });
    const openChannelRequest = web3.utils.bytesToHex(
      request.openChannelRequestBytes
    );

    try {
      await instance.openChannel(openChannelRequest);
    } catch (e) {
      assert.isAbove(
        e.message.search('Open deadline passed'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should open a channel correctly when total deposit is zero', async () => {
    const request = await getOpenChannelRequest({
      CelerChannelAddress: instance.address,
      settleTimeout: SETTLE_TIMEOUT,
      zeroTotalDeposit: true
    });
    const openChannelRequest = web3.utils.bytesToHex(
      request.openChannelRequestBytes
    );

    const tx = await instance.openChannel(openChannelRequest);

    const { event, args } = tx.logs[0];
    channelId = args.channelId.toString();
    const status = await instance.getChannelStatus(channelId);

    assert.equal(event, 'OpenChannel');
    assert.equal(channelId, request.channelId);
    assert.equal(args.tokenType, 1); //  1 for ETH
    assert.equal(args.tokenAddress, '0x0000000000000000000000000000000000000000');
    assert.deepEqual(args.peers, peers);
    assert.equal(args.balances.toString(), [0, 0]);
    assert.equal(status, 1);
  });

  it('should fail to open a channel with an occupied channel ID ' +
      '(by used channel initializer)', async () => {
    const request = await getOpenChannelRequest({
      CelerChannelAddress: instance.address,
      settleTimeout: SETTLE_TIMEOUT,
      zeroTotalDeposit: true
    });
    const openChannelRequest = web3.utils.bytesToHex(
      request.openChannelRequestBytes
    );

    try {
      await instance.openChannel(openChannelRequest);
    } catch (e) {
      assert.isAbove(
        e.message.search('Occupied channel id'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should getTokenContract and getTokenType correctly', async () => {
    const tokenAddress = await instance.getTokenContract.call(channelId);
    const tokenType = await instance.getTokenType.call(channelId);

    assert.equal(tokenAddress, '0x0000000000000000000000000000000000000000');
    assert.equal(tokenType, 1); //  1 for ETH
  });

  it('should fail to cooperativeWithdraw (because of no deposit)', async () => {
    const cooperativeWithdrawRequestBytes = await getCooperativeWithdrawRequestBytes({
      channelId: channelId,
      amount: 100
    });
    const cooperativeWithdrawRequest =
      web3.utils.bytesToHex(cooperativeWithdrawRequestBytes);

    let err = null;

    try {
      await instance.cooperativeWithdraw(cooperativeWithdrawRequest);
    } catch (error) {
      err = error;
    }
    assert.isOk(err instanceof Error);
  });

  it('should open another channel correctly', async () => {
    // Open another channel and try to deposit to channel that is not created the last.
    const request = await getOpenChannelRequest({
      CelerChannelAddress: instance.address,
      settleTimeout: SETTLE_TIMEOUT,
      zeroTotalDeposit: true,
      channelPeers: peers2
    });
    const openChannelRequest = web3.utils.bytesToHex(
      request.openChannelRequestBytes
    );

    const tx = await instance.openChannel(openChannelRequest);

    const { event, args } = tx.logs[0];
    const channelId2 = args.channelId;
    const status = await instance.getChannelStatus(channelId2);

    assert.equal(event, 'OpenChannel');
    assert.equal(channelId2, request.channelId);
    assert.equal(args.tokenType, 1); //  1 for ETH
    assert.equal(args.tokenAddress, '0x0000000000000000000000000000000000000000');
    assert.deepEqual(args.peers, peers2);
    assert.equal(args.balances.toString(), [0, 0]);
    assert.equal(status, 1);
  });

  it('should deposit from msg.value and emit correctly', async () => {
    const tx = await instance.deposit(
      channelId,
      peers[0],
      0,
      {
        from: peers[0],
        value: 100
      }
    );

    const { event, args } = tx.logs[0];
    const amount = await instance.getDepositAmount(channelId, peers[0]);
    const depositMap = await instance.getDepositMap(channelId);
    const channelPeers = depositMap[0];
    const channelBalances = depositMap[1];

    assert.equal(event, 'Deposit');
    assert.deepEqual(args.peers, peers);
    assert.equal(args.balances.toString(), [100, 0]);
    assert.equal(amount, 100);
    assert.deepEqual(channelPeers, peers);
    assert.equal(channelBalances.toString(), [100, 0]);
  });

  it('should deposit from ethpool and emit correctly', async () => {
    await ethPool.approve(
      instance.address,
      100,
      {from: peers[0]}
    );
    const tx = await instance.deposit(
      channelId,
      peers[0],
      100,
      {
        from: peers[0],
      }
    );

    const { event, args } = tx.logs[0];
    const amount = await instance.getDepositAmount(channelId, peers[0]);
    const depositMap = await instance.getDepositMap(channelId);
    const channelPeers = depositMap[0];
    const channelBalances = depositMap[1];

    assert.equal(event, 'Deposit');
    assert.deepEqual(args.peers, peers);
    assert.equal(args.balances.toString(), [200, 0]);
    assert.equal(amount, 200);
    assert.deepEqual(channelPeers, peers);
    assert.equal(channelBalances.toString(), [200, 0]);
  });

  it('should fail to cooperativeWithdraw after withdraw deadline', async () => {
    const cooperativeWithdrawRequestBytes = await getCooperativeWithdrawRequestBytes({
      channelId: channelId,
      amount: 200,
      withdrawDeadline: 1
    });
    const cooperativeWithdrawRequest =
      web3.utils.bytesToHex(cooperativeWithdrawRequestBytes);

    try {
      await instance.cooperativeWithdraw(cooperativeWithdrawRequest);
    } catch (e) {
      assert.isAbove(
        e.message.search('Withdraw deadline passed'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should cooperativeWithdraw correctly when receiver has enough deposit', async () => {
    const cooperativeWithdrawRequestBytes = await getCooperativeWithdrawRequestBytes({
      channelId: channelId,
      amount: 200
    });
    const cooperativeWithdrawRequest =
      web3.utils.bytesToHex(cooperativeWithdrawRequestBytes);

    const tx = await instance.cooperativeWithdraw(
      cooperativeWithdrawRequest,
      { from: accounts[2] }
    );
    const { event, args } = tx.logs[0];
    assert.equal(event, 'CooperativeWithdraw');
    assert.equal(args.channelId, channelId);
    assert.equal(args.withdrawalAmounts.toString(), [200, 0]);
    assert.equal(args.receiver, peers[0]);
    assert.equal(args.balances.toString(), [0, 0]);
    assert.equal(args.seqNum, 1);
  });

  it('should fail to cooperativeWithdraw when using an unexpected seqNum', async () => {
    let cooperativeWithdrawRequestBytes;
    let cooperativeWithdrawRequest;
    let flag = false;
    await instance.deposit(
      channelId,
      peers[0],
      0,
      {
        from: peers[0],
        value: 10
      }
    );

    // smaller seqNum than expected one
    cooperativeWithdrawRequestBytes = await getCooperativeWithdrawRequestBytes({
      channelId: channelId,
      seqNum: 1,
      amount: 10
    });
    cooperativeWithdrawRequest =
      web3.utils.bytesToHex(cooperativeWithdrawRequestBytes);
    
    try {
      await instance.cooperativeWithdraw(cooperativeWithdrawRequest);
    } catch (e) {
      assert.isAbove(
        e.message.search('seqNum should increase by 1'),
        -1
      );
      flag = true;
    }
    assert.isOk(flag);

    // larger seqNum than expected one
    cooperativeWithdrawRequestBytes = await getCooperativeWithdrawRequestBytes({
      channelId: channelId,
      seqNum: 3,
      amount: 10
    });
    cooperativeWithdrawRequest =
      web3.utils.bytesToHex(cooperativeWithdrawRequestBytes);

    flag = false;
    try {
      await instance.cooperativeWithdraw(cooperativeWithdrawRequest);
    } catch (e) {
      assert.isAbove(
        e.message.search('seqNum should increase by 1'),
        -1
      );
      flag = true;
    }
    assert.isOk(flag);

    // expected seqNum
    cooperativeWithdrawRequestBytes = await getCooperativeWithdrawRequestBytes({
      channelId: channelId,
      seqNum: 2,
      amount: 10
    });
    cooperativeWithdrawRequest =
      web3.utils.bytesToHex(cooperativeWithdrawRequestBytes);

    const tx = await instance.cooperativeWithdraw(
      cooperativeWithdrawRequest,
      { from: accounts[2] }
    );
    const { event, args } = tx.logs[0];

    assert.equal(event, 'CooperativeWithdraw');
    assert.equal(args.channelId, channelId);
    assert.equal(args.withdrawalAmounts.toString(), [10, 0]);
    assert.equal(args.receiver, peers[0]);
    assert.equal(args.balances.toString(), [0, 0]);
    assert.equal(args.seqNum, 2);
  });

  it('should cooperativeWithdraw correctly ' +
      'when receiver doesn\'t have enough deposit', async () => {
    await instance.deposit(
      channelId,
      peers[0],
      0,
      {
        from: peers[0],
        value: 160
      }
    );

    await instance.deposit(
      channelId,
      peers[1],
      0,
      {
        from: peers[1],
        value: 40
      }
    );

    const cooperativeWithdrawRequestBytes = await getCooperativeWithdrawRequestBytes({
      channelId: channelId,
      amount: 200,
      seqNum: 3
    });
    const cooperativeWithdrawRequest =
      web3.utils.bytesToHex(cooperativeWithdrawRequestBytes);

    const tx = await instance.cooperativeWithdraw(
      cooperativeWithdrawRequest,
      { from: accounts[2]}
    );
    const { event, args } = tx.logs[0];

    assert.equal(event, 'CooperativeWithdraw');
    assert.equal(args.channelId, channelId);
    assert.equal(args.withdrawalAmounts.toString(), [160, 40]);
    assert.equal(args.receiver, peers[0]);
    assert.equal(args.balances.toString(), [0, 0]);
    assert.equal(args.seqNum, 3);
  });

  it('should fail to intendSettle when some pays in head list are not finalized ' +
      'before last pay resolve deadline', async () => {
    globalResult = await prepareCoSignedIntendSettle(
      getPayHashListInfo,
      getSignedSimplexStateArrayBytes,
      [channelId, channelId]
    );
    const signedSimplexStateArrayBytes = globalResult.signedSimplexStateArrayBytes;

    // resolve only one payment
    const requestBytes = getResolvePayByConditionsRequestBytes({
      condPayBytes: globalResult.condPays[0][0][0]
    });
    await instance.resolvePaymentByConditions(requestBytes);

    // let resolve timeout but not pass the last pay resolve deadline
    let block;
    block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + 6, accounts[0]);

    // intend settle
    try {
      await instance.intendSettle(signedSimplexStateArrayBytes);
    } catch (e) {
      const count = e.message.search('Should pass last pay resolve deadline if never resolved') +
        e.message.search('Should pass resolve deadline if resolved');
      assert.isAbove(count, -2);
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should intendSettle correctly when all pays in head list are finalized ' +
      'before last pay resolve deadline', async () => {
    const signedSimplexStateArrayBytes = globalResult.signedSimplexStateArrayBytes;

    // resolve the payments in head PayHashList
    // the head list of peerFrom 0. Already resolved the first payment in last test case
    for (i = 1; i < globalResult.condPays[0][0].length; i++) {
      const requestBytes = getResolvePayByConditionsRequestBytes({
        condPayBytes: globalResult.condPays[0][0][i]
      });
      await instance.resolvePaymentByConditions(requestBytes);
    }
    // the head list of peerFrom 1
    for (i = 0; i < globalResult.condPays[1][0].length; i++) {
      const requestBytes = getResolvePayByConditionsRequestBytes({
        condPayBytes: globalResult.condPays[1][0][i]
      });
      await instance.resolvePaymentByConditions(requestBytes);
    }

    // let resolve timeout but not pass the last pay resolve deadline
    let block;
    block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + 6, accounts[0]);

    // intend settle
    const tx = await instance.intendSettle(signedSimplexStateArrayBytes);

    block = await web3.eth.getBlock('latest');
    const settleFinalizedTime = await instance.getSettleFinalizedTime(channelId);
    const expectedSettleFinalizedTime = SETTLE_TIMEOUT + block.number;
    assert.equal(expectedSettleFinalizedTime, settleFinalizedTime);

    const status = await instance.getChannelStatus(channelId);
    assert.equal(status, 2);

    let payHash;
    const amounts = [1, 2, 5, 6];
    for (i = 0; i < 2; i++) {  // for each simplex state
      for (j = 0; j < 2; j++) {  // for each pays in head PayHashList
        const logIndex = i * 2 + j;
        assert.equal(tx.logs[logIndex].event, 'LiquidateCondPay');
        assert.equal(tx.logs[logIndex].args.channelId, channelId);
        payHash = sha3(web3.utils.bytesToHex(globalResult.condPays[i][0][j]));
        assert.equal(tx.logs[logIndex].args.condPayHash, payHash);
        assert.equal(tx.logs[logIndex].args.peerFrom, peers[i]);
        assert.equal(tx.logs[logIndex].args.amount.toString(), amounts[logIndex]);
      }
    }

    assert.equal(tx.logs[4].event, 'IntendSettle');
    assert.equal(tx.logs[4].args.channelId, channelId);
    assert.equal(tx.logs[4].args.seqNums.toString(), [1, 1]);
  });

  it('should fail to liquidatePayment when payments are not finalized ' + 
      'before last pay resolve deadline', async () => {
    try {
      await instance.liquidatePayment(
        channelId,
        peers[0],
        globalResult.payHashListBytesArrays[0][1]
      );
    } catch (e) {
      const count = e.message.search('Should pass last pay resolve deadline if never resolved') + 
        e.message.search('Should pass resolve deadline if resolved');
      assert.isAbove(count, -2);
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should liquidatePayment correctly when payments are finalized', async () => {
    // resolve all remaining payments
    for (peerIndex = 0; peerIndex < 2; ++peerIndex) {
      for (listIndex = 1; listIndex < globalResult.condPays[peerIndex].length; ++listIndex) {
        for (payIndex = 0; payIndex < globalResult.condPays[peerIndex][listIndex].length; ++payIndex) {
          const requestBytes = getResolvePayByConditionsRequestBytes({
            condPayBytes: globalResult.condPays[peerIndex][listIndex][payIndex]
          });
          await instance.resolvePaymentByConditions(requestBytes);
        }
      }
    }

    // let resolve timeout but not pass the last pay resolve deadline
    let block;
    block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + 6, accounts[0]);

    let tx;
    let payHash;
    const amounts = [[3, 4], [7, 8]];

    for (peerIndex = 0; peerIndex < 2; ++peerIndex) {  // for each simplex state
      tx = await instance.liquidatePayment(
        channelId,
        peers[peerIndex],
        globalResult.payHashListBytesArrays[peerIndex][1]
      );
      let count = 0;
      for (listIndex = 1; listIndex < globalResult.condPays[peerIndex].length; ++listIndex) {
        for (payIndex = 0; payIndex < globalResult.condPays[peerIndex][listIndex].length; ++payIndex) {
          assert.equal(tx.logs[count].event, 'LiquidateCondPay');
          assert.equal(tx.logs[count].args.channelId, channelId);
          payHash = sha3(web3.utils.bytesToHex(
            globalResult.condPays[peerIndex][listIndex][payIndex]
          ));
          assert.equal(tx.logs[count].args.condPayHash, payHash);
          assert.equal(tx.logs[count].args.peerFrom, peers[peerIndex]);
          assert.equal(tx.logs[count].args.amount, amounts[peerIndex][count]);
          count++;
        }
      }
    }
  });

  it('should fail to ConfirmSettle or ConfirmSettleFail (namely revert) ' +
      'due to not reaching settleFinalizedTime', async () => {
    let flag = false;

    try {
      await instance.confirmSettle(channelId);
    } catch (e) {
      assert.isAbove(
        e.message.search('Not reach settle finalized time'),
        -1
      );
      flag = true;
    }
    assert.isOk(flag);

    const block = await web3.eth.getBlock('latest');
    const settleFinalizedTime = await instance.getSettleFinalizedTime(channelId);
    assert.isOk(block.number < settleFinalizedTime);
  });

  it('should ConfirmSettleFail due to lack of deposit', async () => {
    //  update balances to [10, 20]
    await instance.deposit(
      channelId,
      peers[0],
      0,
      { value: 10 }
    );
    await instance.deposit(
      channelId,
      peers[1],
      0,
      { value: 20 }
    );

    const settleFinalizedTime = await instance.getSettleFinalizedTime(channelId);
    await mineBlockUntil(settleFinalizedTime, accounts[0]);

    const tx = await instance.confirmSettle(channelId);
    const status = await instance.getChannelStatus(channelId);
    const depositMap = await instance.getDepositMap(channelId);
    const channelBalances = depositMap[1];

    assert.equal(tx.logs[0].event, 'ConfirmSettleFail');
    assert.equal(status, 1);
    assert.equal(channelBalances.toString(), [10, 20]);
  });

  it('should liquidatePayment correctly after settleFinalizedTime', async () => {
    const signedSimplexStateArrayBytes  = globalResult.signedSimplexStateArrayBytes;
    await instance.intendSettle(signedSimplexStateArrayBytes);

    // pass after settleFinalizedTime
    const settleFinalizedTime = await instance.getSettleFinalizedTime(channelId);
    await mineBlockUntil(settleFinalizedTime, accounts[0]);

    let tx;
    let payHash;
    const amounts = [[3, 4], [7, 8]];

    for (peerIndex = 0; peerIndex < 2; ++peerIndex) {  // for each simplex state
      tx = await instance.liquidatePayment(
        channelId,
        peers[peerIndex],
        globalResult.payHashListBytesArrays[peerIndex][1]
      );
      let count = 0;
      for (listIndex = 1; listIndex < globalResult.condPays[peerIndex].length; ++listIndex) {
        for (payIndex = 0; payIndex < globalResult.condPays[peerIndex][listIndex].length; ++payIndex) {
          assert.equal(tx.logs[count].event, 'LiquidateCondPay');
          assert.equal(tx.logs[count].args.channelId, channelId);
          payHash = sha3(web3.utils.bytesToHex(
            globalResult.condPays[peerIndex][listIndex][payIndex]
          ));
          assert.equal(tx.logs[count].args.condPayHash, payHash);
          assert.equal(tx.logs[count].args.peerFrom, peers[peerIndex]);
          assert.equal(tx.logs[count].args.amount, amounts[peerIndex][count]);
          count++;
        }
      }
    }
  });

  it('should fail to intendSettle after settleFinalizedTime', async () => {
    const result = await prepareCoSignedIntendSettle(
      getPayHashListInfo,
      getSignedSimplexStateArrayBytes,
      [channelId, channelId],
      [5, 5]  // seqNums
    );
    const signedSimplexStateArrayBytes = result.signedSimplexStateArrayBytes;
    // resolve the payments in head PayHashList
    for (peerIndex = 0; peerIndex < 2; ++peerIndex) {
      for (payIndex = 0; payIndex < result.condPays[peerIndex][0].length; ++payIndex) {
        const requestBytes = getResolvePayByConditionsRequestBytes({
          condPayBytes: result.condPays[peerIndex][0][payIndex]
        });
        await instance.resolvePaymentByConditions(requestBytes);
      }
    }

    // let resolve timeout but not pass the last pay resolve deadline
    let block;
    block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + 6, accounts[0]);

    // intend settle
    try {
      await instance.intendSettle(signedSimplexStateArrayBytes);
    } catch (e) {
      // remove this msg due to out of gas during deployment
      // assert.isAbove(
      //   e.message.search('Should never intendSettle or not pass the settle finalized time'),
      //   -1
      // );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should confirmSettle correctly', async () => {
    //  update balances to [100, 100]
    await instance.deposit(
      channelId,
      peers[0],
      0,
      { value: 90 }
    );
    await instance.deposit(
      channelId,
      peers[1],
      0,
      { value: 80 }
    );
    const depositMap = await instance.getDepositMap(channelId);
    const channelBalances = depositMap[1];
    assert.equal(channelBalances.toString(), [100, 100]);

    let tx = await instance.confirmSettle(
      channelId,
      { from: accounts[2] }  // let peers not pay for gas
    );
    const status = await instance.getChannelStatus(channelId);
    const { event, args } = tx.logs[0];

    assert.equal(event, 'ConfirmSettle');
    assert.equal(args.settleBalance.toString(), [126, 74]);
    assert.equal(status, 3);
  });

  it('should open a channel correctly when total deposit is larger than zero', async () => {
    await ethPool.approve(
      instance.address,
      200,
      {from: peers[1]}
    );

    const request = await getOpenChannelRequest({
      CelerChannelAddress: instance.address,
      settleTimeout: SETTLE_TIMEOUT
    });
    const openChannelRequest = web3.utils.bytesToHex(
      request.openChannelRequestBytes
    );

    const tx = await instance.openChannel(
      openChannelRequest,
      {
        from: peers[0],
        value: 100
      }
    );
    const { event, args } = tx.logs[0];
    channelId = args.channelId.toString();

    assert.equal(channelId, request.channelId);
    assert.equal(event, 'OpenChannel');
    assert.equal(args.tokenType, 1); //  '1' for ETH
    assert.equal(args.tokenAddress, '0x0000000000000000000000000000000000000000');
    assert.deepEqual(args.peers, peers);
    assert.equal(args.balances.toString(), [100, 200]);
  });

  it('should open a channel correctly when total deposit is larger than zero, ' +
      'and msgValueRecipient is 1, and caller is not peers', async () => {
    await ethPool.approve(
      instance.address,
      100,
      {from: peers[0]}
    );

    const request = await getOpenChannelRequest({
      CelerChannelAddress: instance.address,
      settleTimeout: SETTLE_TIMEOUT,
      msgValueRecipient: 1
    });
    const openChannelRequest = web3.utils.bytesToHex(
      request.openChannelRequestBytes
    );

    const tx = await instance.openChannel(
      openChannelRequest,
      {
        from: accounts[2],
        value: 200
      }
    );
    const { event, args } = tx.logs[0];
    channelId = args.channelId.toString();

    assert.equal(channelId, request.channelId);
    assert.equal(event, 'OpenChannel');
    assert.equal(args.tokenType, 1); //  '1' for ETH
    assert.equal(args.tokenAddress, '0x0000000000000000000000000000000000000000');
    assert.deepEqual(args.peers, peers);
    assert.equal(args.balances.toString(), [100, 200]);
  });

  it('should fail to cooperativeSettle when submitted sum ' +
      'is not equal to deposit sum', async () => {
    const cooperativeSettleRequestBytes = await getCooperativeSettleRequestBytes({
      channelId: channelId,
      seqNum: 2,
      settleAmounts: [200, 200]
    });
    const cooperativeSettleRequest = web3.utils.bytesToHex(cooperativeSettleRequestBytes);

    try {
      await instance.cooperativeSettle(cooperativeSettleRequest);
    } catch (e) {
      assert.isAbove(
        e.message.search('Balance sum doesn\'t match'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should cooperativeSettle correctly', async () => {
    const cooperativeSettleRequestBytes = await getCooperativeSettleRequestBytes({
      channelId: channelId,
      seqNum: 3,
      settleAmounts: [50, 250]
    });
    const cooperativeSettleRequest = web3.utils.bytesToHex(cooperativeSettleRequestBytes);

    let tx = await instance.cooperativeSettle(cooperativeSettleRequest);
    const { event, args } = tx.logs[0];

    const status = await instance.getChannelStatus(channelId);

    assert.equal(event, 'CooperativeSettle');
    assert.equal(args.channelId, channelId);
    assert.equal(args.settleBalance.toString(), [50, 250]);
    assert.equal(status, 3);
  });

  it('should intendSettle correctly when time is after last pay resolve deadline', async () => {
    let tx;

    // open a new channel
    await ethPool.approve(
      instance.address,
      200,
      {from: peers[1]}
    );
    const request = await getOpenChannelRequest({
      CelerChannelAddress: instance.address,
      openDeadline: 100000000,  // make initializer hash different
      settleTimeout: SETTLE_TIMEOUT,
    });
    const openChannelRequest = web3.utils.bytesToHex(
      request.openChannelRequestBytes
    );
    tx = await instance.openChannel(
      openChannelRequest,
      {
        from: peers[0],
        value: 100
      }
    );
    channelId = tx.logs[0].args.channelId.toString();

    const result = await prepareCoSignedIntendSettle(
      getPayHashListInfo,
      getSignedSimplexStateArrayBytes,
      [channelId, channelId],
      [1, 1],
      [2, 2]
    );
    const signedSimplexStateArrayBytes = result.signedSimplexStateArrayBytes;
    const condPays = result.condPays;

    // ensure it passes the last pay resolve deadline
    let block;
    block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + 2, accounts[0]);

    // intend settle
    tx = await instance.intendSettle(signedSimplexStateArrayBytes);

    block = await web3.eth.getBlock('latest');
    const settleFinalizedTime = await instance.getSettleFinalizedTime(channelId);
    const expectedSettleFinalizedTime = SETTLE_TIMEOUT + block.number;
    assert.equal(expectedSettleFinalizedTime.toString(), settleFinalizedTime.toString());

    const status = await instance.getChannelStatus(channelId);
    assert.equal(status, 2);

    let payHash;
    for (i = 0; i < 2; i++) {  // for each simplex state
      for (j = 0; j < 2; j++) {  // for each pays in head PayHashList
        const logIndex = i * 2 + j;
        assert.equal(tx.logs[logIndex].event, 'LiquidateCondPay');
        assert.equal(tx.logs[logIndex].args.channelId, request.channelId);
        payHash = sha3(web3.utils.bytesToHex(condPays[i][0][j]));
        assert.equal(tx.logs[logIndex].args.condPayHash, payHash);
        assert.equal(tx.logs[logIndex].args.peerFrom, peers[i]);
        assert.equal(tx.logs[logIndex].args.amount, 0);
      }
    }

    assert.equal(tx.logs[4].event, 'IntendSettle');
    assert.equal(tx.logs[4].args.channelId, channelId);
    assert.equal(tx.logs[4].args.seqNums.toString(), [1, 1]);
  });

  it('should confirmSettle correctly when pay proof type is HashArray and ' +
        'time is after last pay resolve deadline', async () => {
    const settleFinalizedTime = await instance.getSettleFinalizedTime(channelId);
    await mineBlockUntil(settleFinalizedTime, accounts[0]);

    let tx = await instance.confirmSettle(
      channelId,
      { from: accounts[2] }
    );
    const status = await instance.getChannelStatus(channelId);
    const { event, args } = tx.logs[0];

    assert.equal(event, 'ConfirmSettle');
    assert.equal(args.settleBalance.toString(), [110, 190]);
    assert.equal(status, 3);
  });

  it('should intendSettle correctly with 0 payment (null state)', async () => {
    let tx;

    // open a new channel
    await ethPool.approve(
      instance.address,
      200,
      {from: peers[1]}
    );
    const request = await getOpenChannelRequest({
      CelerChannelAddress: instance.address,
      openDeadline: 100000001,  // make initializer hash different
      settleTimeout: SETTLE_TIMEOUT,
    });
    const openChannelRequest = web3.utils.bytesToHex(
      request.openChannelRequestBytes
    );
    tx = await instance.openChannel(
      openChannelRequest,
      { value: 100 }
    );
    channelId = tx.logs[0].args.channelId.toString();

    singleSignedNullStateBytes = await getSignedSimplexStateArrayBytes({
      channelIds: [channelId],
      seqNums: [0],
      signers: [peers[0]]
    });

    // intend settle
    tx = await instance.intendSettle(singleSignedNullStateBytes);

    const block = await web3.eth.getBlock('latest');
    const settleFinalizedTime = await instance.getSettleFinalizedTime(channelId);
    const expectedSingleSettleFinalizedTime = SETTLE_TIMEOUT + block.number;
    assert.equal(expectedSingleSettleFinalizedTime.toString(), settleFinalizedTime.toString());

    const status = await instance.getChannelStatus(channelId);
    assert.equal(status, 2);

    const { event, args } = tx.logs[0];
    assert.equal(event, 'IntendSettle');
    assert.equal(args.channelId, channelId);
    assert.equal(args.seqNums.toString(), [0, 0]);
  });

  it('should fail to intendSettle with 0 payment (null state) again', async () => {
    let err = null;

    try {
      await instance.intendSettle(singleSignedNullStateBytes);
    } catch (error) {
      err = error;
    }
    assert.isOk(err instanceof Error);
  });

  it('should confirmSettle correctly after 0-payment (null-state) intendSettle', async () => {
    const settleFinalizedTime = await instance.getSettleFinalizedTime(channelId);
    await mineBlockUntil(settleFinalizedTime, accounts[0]);

    let tx = await instance.confirmSettle(
      channelId,
      { from: accounts[2] }
    );
    const status = await instance.getChannelStatus(channelId);
    const { event, args } = tx.logs[0];

    assert.equal(event, 'ConfirmSettle');
    assert.equal(args.settleBalance.toString(), [100, 200]);
    assert.equal(status, 3);
  });

  it('should intendSettle correctly with one non-null simplex state', async () => {
    let tx;

    // open a new channel
    await ethPool.approve(
      instance.address,
      200,
      {from: peers[1]}
    );
    const request = await getOpenChannelRequest({
      CelerChannelAddress: instance.address,
      openDeadline: 100000002,  // make initializer hash different
      settleTimeout: SETTLE_TIMEOUT,
    });
    const openChannelRequest = web3.utils.bytesToHex(
      request.openChannelRequestBytes
    );
    tx = await instance.openChannel(
      openChannelRequest,
      { value: 100 }
    );
    channelId = tx.logs[0].args.channelId.toString();

    const payHashListInfo = getPayHashListInfo({payAmounts: [[1, 2]]});
    const signedSimplexStateArrayBytes = await getSignedSimplexStateArrayBytes({
      channelIds: [channelId],
      seqNums: [5],
      lastPayResolveDeadlines: [999999],
      payHashLists: [payHashListInfo.payHashListProtos[0]],
      transferAmounts: [10],
      peerFroms: [peers[0]]
    });

    // resolve the payments in head PayHashList
    for (i = 0; i < payHashListInfo.payBytesArray[0].length; i++) {
      const requestBytes = getResolvePayByConditionsRequestBytes({
        condPayBytes: payHashListInfo.payBytesArray[0][i]
      });
      await instance.resolvePaymentByConditions(requestBytes);
    }

    // let resolve timeout but not pass the last pay resolve deadline
    let block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + 6, accounts[0]);

    // intend settle
    tx = await instance.intendSettle(signedSimplexStateArrayBytes);

    block = await web3.eth.getBlock('latest');
    const settleFinalizedTime = await instance.getSettleFinalizedTime(channelId);
    const expectedSingleSettleFinalizedTime = SETTLE_TIMEOUT + block.number;
    assert.equal(expectedSingleSettleFinalizedTime.toString(), settleFinalizedTime.toString());

    const status = await instance.getChannelStatus(channelId);
    assert.equal(status, 2);

    const amounts = [1, 2];
    for (i = 0; i < 2; i++) {  // for each pays in head PayHashList
      assert.equal(tx.logs[i].event, 'LiquidateCondPay');
      assert.equal(tx.logs[i].args.channelId, channelId);
      const payHash = sha3(web3.utils.bytesToHex(payHashListInfo.payBytesArray[0][i]));
      assert.equal(tx.logs[i].args.condPayHash, payHash);
      assert.equal(tx.logs[i].args.peerFrom, peers[0]);
      assert.equal(tx.logs[i].args.amount, amounts[i]);
    }

    assert.equal(tx.logs[2].event, 'IntendSettle');
    assert.equal(tx.logs[2].args.channelId, channelId);
    assert.equal(tx.logs[2].args.seqNums.toString(), [5, 0]);
  });

  it('should confirmSettle correctly with one non-null simplex state', async () => {
    const settleFinalizedTime = await instance.getSettleFinalizedTime(channelId);
    await mineBlockUntil(settleFinalizedTime, accounts[0]);

    let tx = await instance.confirmSettle(channelId);
    const status = await instance.getChannelStatus(channelId);
    const { event, args } = tx.logs[0];

    assert.equal(event, 'ConfirmSettle');
    assert.equal(args.settleBalance.toString(), [87, 213]);
    assert.equal(status, 3);
  });

  it('should intendSettle correctly with multiple cross-channel simplex states', async () => {
    // 1 pair of simplex states + 1 non-null simplex state + 1 null simplex state
    let tx;

    // open 3 new channels
    await ethPool.approve(
      instance.address,
      200 * 3,
      {from: peers[1]}
    );
    for (i = 0; i < 3; i++) {
      const request = await getOpenChannelRequest({
        CelerChannelAddress: instance.address,
        openDeadline: 100000003 + i,  // make initializer hash different
        settleTimeout: SETTLE_TIMEOUT,
      });
      const openChannelRequest = web3.utils.bytesToHex(
        request.openChannelRequestBytes
      );
      tx = await instance.openChannel(
        openChannelRequest,
        { value: 100 }
      );
      uniqueChannelIds[i] = tx.logs[0].args.channelId.toString();
    }

    let channelIds = [uniqueChannelIds[0], uniqueChannelIds[0], uniqueChannelIds[1], uniqueChannelIds[2]];
    const sortIndeces = getSortIndeces(channelIds);
    channelIds = reorder(channelIds, sortIndeces);
    const peerFroms = reorder([peers[0], peers[1], peers[0], null], sortIndeces);
    // prepare for intendSettle
    let payHashListInfos = [
      // 1 pair of simplex states
      getPayHashListInfo({payAmounts: [[1, 2]]}),
      getPayHashListInfo({payAmounts: [[3, 4]]}),
      // 1 non-null simplex state
      getPayHashListInfo({payAmounts: [[1, 2]]}),
      // 1 null simplex state doesn't need payHashList, keep this as null
      null
    ];
    const payAmounts = reorder([[1, 2], [3, 4], [1, 2], null], sortIndeces);
    let payHashLists = [
      payHashListInfos[0].payHashListProtos[0],
      payHashListInfos[1].payHashListProtos[0],
      payHashListInfos[2].payHashListProtos[0],
      null
    ];
    payHashListInfos = reorder(payHashListInfos, sortIndeces);
    const seqNums = reorder([1, 1, 5, 0], sortIndeces);
    const seqNumsArray = reorder([[1, 1], [1, 1], [5, 0], [0, 0]], sortIndeces);

    const signedSimplexStateArrayBytes = await getSignedSimplexStateArrayBytes({
      channelIds: channelIds,
      seqNums: seqNums,
      transferAmounts: reorder([10, 20, 30, null], sortIndeces),
      lastPayResolveDeadlines: reorder([999999, 999999, 999999, null], sortIndeces),
      payHashLists: reorder(payHashLists, sortIndeces),
      peerFroms: peerFroms,
      signers: reorder([ null, null, null, peers[0]], sortIndeces)
    });

    // resolve the payments in all head PayHashLists
    for (i = 0; i < payHashListInfos.length; i++) {
      if (payHashListInfos[i] == null) continue;
      for (j = 0; j < payHashListInfos[i].payBytesArray[0].length; j++) {
        const requestBytes = getResolvePayByConditionsRequestBytes({
          condPayBytes: payHashListInfos[i].payBytesArray[0][j]
        });
        await instance.resolvePaymentByConditions(requestBytes);
      }
    }

    // let resolve timeout but not pass the last pay resolve deadline
    let block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + 6, accounts[0]);

    // intend settle
    tx = await instance.intendSettle(signedSimplexStateArrayBytes);

    block = await web3.eth.getBlock('latest');
    const expectedSettleFinalizedTime = SETTLE_TIMEOUT + block.number;
    for (i = 0; i < uniqueChannelIds.length; i++) {
      const settleFinalizedTime = await instance.getSettleFinalizedTime(uniqueChannelIds[i]);
      assert.equal(expectedSettleFinalizedTime, settleFinalizedTime);

      const status = await instance.getChannelStatus(uniqueChannelIds[i]);
      assert.equal(status, 2);
    }

    let payHash;
    let logIndex = 0;
    // for each simplex state
    for (i = 0; i < channelIds.length; i++) {
      if (payHashListInfos[i] != null) {
        // for each pays in head PayHashList
        for (j = 0; j < payHashListInfos[i].payBytesArray[0].length; j++) {
          assert.equal(tx.logs[logIndex].event, 'LiquidateCondPay');
          assert.equal(tx.logs[logIndex].args.channelId, channelIds[i]);
          payHash = sha3(web3.utils.bytesToHex(payHashListInfos[i].payBytesArray[0][j]));
          assert.equal(tx.logs[logIndex].args.condPayHash, payHash);
          assert.equal(tx.logs[logIndex].args.peerFrom, peerFroms[i]);
          assert.equal(tx.logs[logIndex].args.amount.toString(), payAmounts[i][j]);
          logIndex++;
        }
      }
      if (i == channelIds.length-1 ||  channelIds[i] != channelIds[i+1]) {
        assert.equal(tx.logs[logIndex].event, 'IntendSettle');
        assert.equal(tx.logs[logIndex].args.channelId, channelIds[i]);
        assert.equal(tx.logs[logIndex].args.seqNums.toString(), seqNumsArray[i]);
        logIndex++;
      }
    }
  });

  it('should confirmSettle correctly with multiple cross-channel simplex states', async () => {
    let settleFinalizedTime = 0;
    for (i = 0; i < uniqueChannelIds.length; i++) {
      const tmp = await instance.getSettleFinalizedTime(uniqueChannelIds[i]);
      settleFinalizedTime = Math.max(settleFinalizedTime, tmp);
    }
    await mineBlockUntil(settleFinalizedTime, accounts[0]);

    const expectedSettleBalances = [[114, 186], [67, 233], [100, 200]];
    for (i = 0; i < uniqueChannelIds.length; i++) {
      let tx = await instance.confirmSettle(uniqueChannelIds[i]);
      const status = await instance.getChannelStatus(uniqueChannelIds[i]);
      const { event, args } = tx.logs[0];
  
      assert.equal(event, 'ConfirmSettle');
      assert.equal(args.settleBalance.toString(), expectedSettleBalances[i]);
      assert.equal(status, 3);
    }
  });
});
