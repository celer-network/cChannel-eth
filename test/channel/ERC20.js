// Only test ERC20 related cases. Other cases should be the same as ETH tests.

const Web3 = require('web3');
const web3 = new Web3(new Web3.providers.HttpProvider('http://localhost:8545'));
const sha3 = web3.utils.keccak256;

const protoChainFactory = require('../helper/protoChainFactory');

const fs = require('fs');

const utilities = require('../helper/utilities');
const {
  mineBlockUntil,
  getSortedArray,
  getCoSignedIntendSettle,
  getDeployGasUsed,
  getCallGasUsed
} = utilities;

const CelerChannel = artifacts.require('CelerChannel');
const Resolver = artifacts.require('VirtContractResolver');
const ERC20ExampleToken = artifacts.require('ERC20ExampleToken');
const PayRegistry = artifacts.require('PayRegistry');

contract('CelerChannel using ERC20', async accounts => {
  const peers = getSortedArray([accounts[0], accounts[1]]);
  const overlappedPeers = getSortedArray([peers[0], accounts[2]]);
  const clients = [accounts[8], accounts[9]];  // namely [src, dest]
  const DISPUTE_TIMEOUT = 20;
  const GAS_USED_LOG = 'gas_used_logs/CelerChannel-ERC20.txt';
  // the meaning of the index: [peer index][pay hash list index][pay index]
  const PEERS_PAY_HASH_LISTS_AMTS = [[[1, 2], [3, 4]], [[5, 6], [7, 8]]];

  let instance;
  let channelId;
  let payRegistry;
  let eRC20ExampleToken;
  let eRC20ExampleToken2;

  let protoChainInstance;
  let getOpenChannelRequest;
  let getCooperativeWithdrawRequestBytes;
  let getSignedSimplexStateArrayBytes;
  let getCooperativeSettleRequestBytes;
  let getResolvePayByConditionsRequestBytes;
  let getPayHashListInfo;

  before(async () => {
    fs.writeFileSync(GAS_USED_LOG, '********** Gas Used in CelerChannel-ERC20 Tests **********\n\n');

    const resolver = await Resolver.new();
    eRC20ExampleToken = await ERC20ExampleToken.new();
    eRC20ExampleToken2 = await ERC20ExampleToken.new();
    payRegistry = await PayRegistry.new(resolver.address)

    instance = await CelerChannel.new(
      accounts[9],  // no need for depositPool in an ERC20 channel, just put a random address
      payRegistry.address,
    );

    fs.appendFileSync(GAS_USED_LOG, '***** Deploy Gas Used *****\n');
    let gasUsed = await getDeployGasUsed(resolver);
    fs.appendFileSync(GAS_USED_LOG, 'VirtContractResolver Deploy Gas: ' + gasUsed + '\n');
    gasUsed = await getDeployGasUsed(payRegistry);
    fs.appendFileSync(GAS_USED_LOG, 'PayRegistry Deploy Gas: ' + gasUsed + '\n');
    gasUsed = await getDeployGasUsed(instance);
    fs.appendFileSync(GAS_USED_LOG, 'CelerChannel Deploy Gas: ' + gasUsed + '\n\n');
    fs.appendFileSync(GAS_USED_LOG, '***** Function Calls Gas Used *****\n');

    protoChainInstance = await protoChainFactory(peers, clients);
    getOpenChannelRequest = protoChainInstance.getOpenChannelRequest;
    getCooperativeWithdrawRequestBytes = protoChainInstance.getCooperativeWithdrawRequestBytes;
    getSignedSimplexStateArrayBytes = protoChainInstance.getSignedSimplexStateArrayBytes;
    getCooperativeSettleRequestBytes = protoChainInstance.getCooperativeSettleRequestBytes;
    getResolvePayByConditionsRequestBytes = protoChainInstance.getResolvePayByConditionsRequestBytes;
    getPayHashListInfo = protoChainInstance.getPayHashListInfo;

    // make sure both accounts have some tokens
    await eRC20ExampleToken.transfer(accounts[1], 100000, { from: accounts[0] });
  });

  it('should open a channel correctly when total deposit is zero', async () => {
    const request = await getOpenChannelRequest({
      celerChannelAddress: instance.address,
      disputeTimeout: DISPUTE_TIMEOUT,
      zeroTotalDeposit: true,
      tokenType: 2,
      tokenAddress: eRC20ExampleToken.address
    });
    const openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);

    const tx = await instance.openChannel(openChannelRequest);
    fs.appendFileSync(GAS_USED_LOG, 'openChannel() with zero deposit: ' + getCallGasUsed(tx) + '\n');

    const { event, args } = tx.logs[0];
    channelId = args.channelId.toString();
    const status = await instance.getChannelStatus(channelId);

    assert.equal(event, 'OpenChannel');
    assert.equal(channelId, request.channelId);
    assert.deepEqual(args.peerAddrs, peers);
    assert.equal(args.tokenType, 2); //  2 for ERC20
    assert.equal(args.tokenAddress, eRC20ExampleToken.address);
    assert.equal(args.balances.toString(), [0, 0]);
    assert.equal(status, 1);
  });

  it('should getTokenContract and getTokenType correctly', async () => {
    const tokenAddress = await instance.getTokenContract.call(channelId);
    const tokenType = await instance.getTokenType.call(channelId);

    assert.equal(tokenAddress, eRC20ExampleToken.address);
    assert.equal(tokenType, 2); //  2 for ERC20
  });

  it('should fail to deposit before setting deposit limit', async () => {
    // approve first
    await eRC20ExampleToken.approve(instance.address, 50, { from: peers[0] });

    try {
      await instance.deposit(channelId, peers[0], 50, { from: peers[0] });
    } catch (error) {
      assert.isAbove(
        error.message.search('Deposits exceed limit'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should set deposit limits correctly', async () => {
    const limit = 1000000;
    const tx = await instance.setDepositLimits([eRC20ExampleToken.address], [limit], { from: accounts[0] });
    fs.appendFileSync(GAS_USED_LOG, 'setDepositLimits(): ' + getCallGasUsed(tx) + '\n');

    const depositLimit = await instance.depositLimits.call(eRC20ExampleToken.address);
    assert.equal(limit.toString(), depositLimit.toString());
  });

  it('should deposit correctly', async () => {
    const tx = await instance.deposit(channelId, peers[0], 50, { from: peers[0] });
    fs.appendFileSync(GAS_USED_LOG, 'deposit(): ' + getCallGasUsed(tx) + '\n');

    const { event, args } = tx.logs[0];
    const amount = await instance.getDepositAmount(channelId, peers[0]);
    const depositMap = await instance.getDepositMap(channelId);
    const channelPeers = depositMap[0];
    const channelBalances = depositMap[1];

    assert.equal(event, 'Deposit');
    assert.deepEqual(args.peerAddrs, peers);
    assert.equal(args.balances.toString(), [50, 0]);
    assert.equal(amount, 50);
    assert.deepEqual(channelPeers, peers);
    assert.equal(channelBalances.toString(), [50, 0]);
  });

  it('should fail to deposit when the new deposit sum exceeds the deposit limit', async () => {
    await eRC20ExampleToken.approve(instance.address, 50, { from: peers[0] });
    await eRC20ExampleToken.approve(instance.address, 50, { from: peers[1] });
    await instance.setDepositLimits([eRC20ExampleToken.address], [80], { from: accounts[0] });

    let errorCounter = 0;
    try {
      await instance.deposit(channelId, peers[0], 50, { from: peers[0] });
    } catch (error) {
      if (error.message.search('Deposits exceed limit') > -1) {
        errorCounter++;
      }
    }

    try {
      await instance.deposit(channelId, peers[1], 50, { from: peers[1] });
    } catch (error) {
      if (error.message.search('Deposits exceed limit') > -1) {
        errorCounter++;
      }
    }

    assert.equal(errorCounter, 2);
  });

  it('should disable all deposit limits correctly', async () => {
    const tx = await instance.disableDepositLimits({ from: accounts[0] });
    fs.appendFileSync(GAS_USED_LOG, 'disableDepositLimits(): ' + getCallGasUsed(tx) + '\n');

    const depositLimitsEnabled = await instance.depositLimitsEnabled.call();
    assert.equal(depositLimitsEnabled, false);
  });

  it('should deposit correctly after removing all deposit limits', async () => {
    const tx = await instance.deposit(channelId, peers[0], 50, { from: peers[0] });

    const { event, args } = tx.logs[0];
    const amount = await instance.getDepositAmount(channelId, peers[0]);
    const depositMap = await instance.getDepositMap(channelId);
    const channelPeers = depositMap[0];
    const channelBalances = depositMap[1];

    assert.equal(event, 'Deposit');
    assert.deepEqual(args.peerAddrs, peers);
    assert.equal(args.balances.toString(), [100, 0]);
    assert.equal(amount, 100);
    assert.deepEqual(channelPeers, peers);
    assert.equal(channelBalances.toString(), [100, 0]);
  });

  it('should fail to intendWithdraw and confirmWithdraw from an ERC20 channel to an ETH channel', async () => {
    // deposit to be only used in withdraw related tests
    await eRC20ExampleToken.approve(instance.address, 200, { from: peers[0] });
    await instance.deposit(channelId, peers[0], 200, { from: peers[0] });

    // open an ETH channel
    const request = await getOpenChannelRequest({
      celerChannelAddress: instance.address,
      disputeTimeout: DISPUTE_TIMEOUT,
      zeroTotalDeposit: true
    });
    const openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);
    const tx = await instance.openChannel(openChannelRequest);
    eTHChannelId = tx.logs[0].args.channelId.toString();

    await instance.intendWithdraw(channelId, 200, eTHChannelId, { from: peers[0] });

    const block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + DISPUTE_TIMEOUT, accounts[0]);

    try {
      await instance.confirmWithdraw(channelId, { from: accounts[9] });
    } catch (error) {
      assert.isAbove(
        error.message.search('Token mismatch of recipient channel'),
        -1
      );

      // veto current withdrawal proposal before return
      await instance.vetoWithdraw(channelId);

      return;
    }

    assert.fail('should have thrown before');
  });

  it('should fail to intendWithdraw and confirmWithdraw from an ERC20 channel to another different ERC20 channel', async () => {
    // open another ERC20 channel with different ERC20 token contract
    const request = await getOpenChannelRequest({
      celerChannelAddress: instance.address,
      disputeTimeout: DISPUTE_TIMEOUT,
      zeroTotalDeposit: true,
      tokenType: 2,
      tokenAddress: eRC20ExampleToken2.address
    });
    const openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);
    const tx = await instance.openChannel(openChannelRequest);
    differentERC20ChannelId = tx.logs[0].args.channelId.toString();

    await instance.intendWithdraw(channelId, 200, differentERC20ChannelId, { from: peers[0] });

    const block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + DISPUTE_TIMEOUT, accounts[0]);

    try {
      await instance.confirmWithdraw(channelId, { from: accounts[9] });
    } catch (error) {
      assert.isAbove(
        error.message.search('Token mismatch of recipient channel'),
        -1
      );

      // veto current withdrawal proposal before return
      await instance.vetoWithdraw(channelId);

      return;
    }

    assert.fail('should have thrown before');
  });

  it('should fail to cooperativeWithdraw from an ERC20 channel to an ETH channel', async () => {
    const cooperativeWithdrawRequestBytes = await getCooperativeWithdrawRequestBytes({
      channelId: channelId,
      amount: 200,
      recipientChannelId: eTHChannelId,
      seqNum: 1
    });
    const cooperativeWithdrawRequest = web3.utils.bytesToHex(cooperativeWithdrawRequestBytes);

    try {
      await instance.cooperativeWithdraw(cooperativeWithdrawRequest);
    } catch (error) {
      assert.isAbove(
        error.message.search('Token mismatch of recipient channel'),
        -1
      );

      return;
    }

    assert.fail('should have thrown before');
  });

  it('should fail to cooperativeWithdraw from an ERC20 channel to another different ERC20 channel', async () => {
    const cooperativeWithdrawRequestBytes = await getCooperativeWithdrawRequestBytes({
      channelId: channelId,
      amount: 200,
      recipientChannelId: differentERC20ChannelId,
      seqNum: 1
    });
    const cooperativeWithdrawRequest = web3.utils.bytesToHex(cooperativeWithdrawRequestBytes);

    try {
      await instance.cooperativeWithdraw(cooperativeWithdrawRequest);
    } catch (error) {
      assert.isAbove(
        error.message.search('Token mismatch of recipient channel'),
        -1
      );

      return;
    }

    assert.fail('should have thrown before');
  });

  it('should intendWithdraw and confirmWithdraw to another channel correctly', async () => {
    // open another channel with same ERC20 token contract
    const request = await getOpenChannelRequest({
      celerChannelAddress: instance.address,
      disputeTimeout: DISPUTE_TIMEOUT,
      zeroTotalDeposit: true,
      tokenType: 2,
      tokenAddress: eRC20ExampleToken.address,
      channelPeers: overlappedPeers
    });
    const openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);
    let tx = await instance.openChannel(openChannelRequest);
    eRC20ChannelId2 = tx.logs[0].args.channelId.toString();

    await instance.intendWithdraw(channelId, 60, eRC20ChannelId2, { from: peers[0] });
    fs.appendFileSync(GAS_USED_LOG, 'intendWithdraw(): ' + getCallGasUsed(tx) + '\n');

    const block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + DISPUTE_TIMEOUT, accounts[0]);

    tx = await instance.confirmWithdraw(channelId, { from: accounts[9] });
    fs.appendFileSync(GAS_USED_LOG, 'confirmWithdraw(): ' + getCallGasUsed(tx) + '\n');

    assert.equal(tx.logs[0].event, 'ConfirmWithdraw');
    assert.equal(tx.logs[0].args.channelId, channelId);
    assert.equal(tx.logs[0].args.withdrawalAmounts.toString(), [60, 0]);
    assert.equal(tx.logs[0].args.receiver, peers[0]);
    assert.equal(tx.logs[0].args.recipientChannelId, eRC20ChannelId2);
    assert.equal(tx.logs[0].args.balances.toString(), [240, 0]);

    let expectedBalances;
    if (overlappedPeers[0] == peers[0]) {
      expectedBalances = [60, 0];
    } else {
      expectedBalances = [0, 60];
    }
    assert.equal(tx.logs[1].event, 'Deposit');
    assert.equal(tx.logs[1].args.channelId, eRC20ChannelId2);
    assert.deepEqual(tx.logs[1].args.peerAddrs, overlappedPeers);
    assert.equal(tx.logs[1].args.balances.toString(), expectedBalances);

    const balance = await instance.getDepositAmount(eRC20ChannelId2, peers[0]);
    assert.equal(balance.toString(), 60);
  });

  it('should cooperativeWithdraw to another channel correctly', async () => {
    const cooperativeWithdrawRequestBytes = await getCooperativeWithdrawRequestBytes({
      channelId: channelId,
      amount: 60,
      recipientChannelId: eRC20ChannelId2,
      seqNum: 1
    });
    const cooperativeWithdrawRequest = web3.utils.bytesToHex(cooperativeWithdrawRequestBytes);

    const tx = await instance.cooperativeWithdraw(cooperativeWithdrawRequest);
    fs.appendFileSync(GAS_USED_LOG, 'cooperativeWithdraw(): ' + getCallGasUsed(tx) + '\n');

    assert.equal(tx.logs[0].event, 'CooperativeWithdraw');
    assert.equal(tx.logs[0].args.channelId, channelId);
    assert.equal(tx.logs[0].args.withdrawalAmounts.toString(), [60, 0]);
    assert.equal(tx.logs[0].args.receiver, peers[0]);
    assert.equal(tx.logs[0].args.recipientChannelId, eRC20ChannelId2);
    assert.equal(tx.logs[0].args.balances.toString(), [180, 0]);
    assert.equal(tx.logs[0].args.seqNum, 1);

    let expectedBalances;
    if (overlappedPeers[0] == peers[0]) {
      expectedBalances = [120, 0];
    } else {
      expectedBalances = [0, 120];
    }
    assert.equal(tx.logs[1].event, 'Deposit');
    assert.equal(tx.logs[1].args.channelId, eRC20ChannelId2);
    assert.deepEqual(tx.logs[1].args.peerAddrs, overlappedPeers);
    assert.equal(tx.logs[1].args.balances.toString(), expectedBalances);

    const balance = await instance.getDepositAmount(eRC20ChannelId2, peers[0]);
    assert.equal(balance.toString(), 120);
  });

  it('should cooperativeWithdraw correctly when receiver has enough deposit', async () => {
    const cooperativeWithdrawRequestBytes = await getCooperativeWithdrawRequestBytes({
      channelId: channelId,
      amount: 80,
      recipientChannelId: 0,
      seqNum: 2
    });
    const cooperativeWithdrawRequest = web3.utils.bytesToHex(cooperativeWithdrawRequestBytes);

    const tx = await instance.cooperativeWithdraw(
      cooperativeWithdrawRequest,
      { from: accounts[2] }
    );
    const { event, args } = tx.logs[0];
    assert.equal(event, 'CooperativeWithdraw');
    assert.equal(args.channelId, channelId);
    assert.equal(args.withdrawalAmounts.toString(), [80, 0]);
    assert.equal(args.receiver, peers[0]);
    assert.equal(args.recipientChannelId, 0);
    assert.equal(args.balances.toString(), [100, 0]);
    assert.equal(args.seqNum, 2);
  });

  it('should intendSettle correctly', async () => {
    globalResult = await getCoSignedIntendSettle(
      getPayHashListInfo,
      getSignedSimplexStateArrayBytes,
      [channelId, channelId],
      PEERS_PAY_HASH_LISTS_AMTS,
      [1, 1],  // seqNums
      [999999999, 9999999999],  // lastPayResolveDeadlines
      [10, 20]  // transferAmounts
    );
    const signedSimplexStateArrayBytes = globalResult.signedSimplexStateArrayBytes;
    // resolve the payments in head PayHashList
    for (peerIndex = 0; peerIndex < 2; peerIndex++) {
      for (payIndex = 0; payIndex < globalResult.condPays[peerIndex][0].length; payIndex++) {
        const requestBytes = getResolvePayByConditionsRequestBytes({
          condPayBytes: globalResult.condPays[peerIndex][0][payIndex]
        });
        await payRegistry.resolvePaymentByConditions(requestBytes);
      }
    }

    // pass the resolve deadline but not the last pay resolve deadline
    let block;
    block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + 6, accounts[0]);

    // intend settle
    const tx = await instance.intendSettle(signedSimplexStateArrayBytes);
    fs.appendFileSync(GAS_USED_LOG, 'intendSettle() with two 2-payment-hashList states: ' + getCallGasUsed(tx) + '\n');

    block = await web3.eth.getBlock('latest');
    const settleFinalizedTime = await instance.getSettleFinalizedTime(channelId);
    const expectedSettleFinalizedTime = DISPUTE_TIMEOUT + block.number;
    assert.equal(expectedSettleFinalizedTime, settleFinalizedTime);

    const status = await instance.getChannelStatus(channelId);
    assert.equal(status, 2);

    let payHash;
    const amounts = [1, 2, 5, 6];
    for (let i = 0; i < 2; i++) {  // for each simplex channel
      for (j = 0; j < globalResult.condPays[i][0].length; j++) {  // for each pays in PayHashList
        const logIndex = i * 2 + j;
        assert.equal(tx.logs[logIndex].event, 'LiquidateOnePay');
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

  it('should liquidatePays correctly', async () => {
    // resolve all remaining payments
    for (peerIndex = 0; peerIndex < 2; peerIndex++) {
      for (listIndex = 1; listIndex < globalResult.condPays[peerIndex].length; listIndex++) {
        for (payIndex = 0; payIndex < globalResult.condPays[peerIndex][listIndex].length; payIndex++) {
          const requestBytes = getResolvePayByConditionsRequestBytes({
            condPayBytes: globalResult.condPays[peerIndex][listIndex][payIndex]
          });
          await payRegistry.resolvePaymentByConditions(requestBytes);
        }
      }
    }

    // pass the resolve deadline but not the last pay resolve deadline
    let block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + 6, accounts[0]);

    let tx;
    let payHash;
    const amounts = [[3, 4], [7, 8]];

    for (peerIndex = 0; peerIndex < 2; peerIndex++) {  // for each simplex channel/peerFrom
      tx = await instance.liquidatePays(
        channelId,
        peers[peerIndex],
        globalResult.payHashListBytesArrays[peerIndex][1]
      );
      let count = 0;
      for (listIndex = 1; listIndex < globalResult.condPays[peerIndex].length; listIndex++) {
        for (payIndex = 0; payIndex < globalResult.condPays[peerIndex][listIndex].length; payIndex++) {
          assert.equal(tx.logs[count].event, 'LiquidateOnePay');
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
    fs.appendFileSync(GAS_USED_LOG, 'liquidatePays() with 2 payments: ' + getCallGasUsed(tx) + '\n');
  });

  it('should confirmSettle correctly', async () => {
    await eRC20ExampleToken.approve(instance.address, 100, { from: peers[1] });
    await instance.deposit(channelId, peers[1], 100, { from: peers[1] });

    const settleFinalizedTime = await instance.getSettleFinalizedTime(channelId);
    await mineBlockUntil(settleFinalizedTime, accounts[0]);

    const tx = await instance.confirmSettle(channelId);
    fs.appendFileSync(GAS_USED_LOG, 'confirmSettle(): ' + getCallGasUsed(tx) + '\n');
    const status = await instance.getChannelStatus(channelId);
    const { event, args } = tx.logs[0];

    assert.equal(event, 'ConfirmSettle');
    assert.equal(args.settleBalance.toString(), [126, 74]);
    assert.equal(status, 3);
  });

  it('should open a channel correctly when total deposit is larger than zero', async () => {
    await eRC20ExampleToken.approve(instance.address, 100, { from: peers[0] });
    await eRC20ExampleToken.approve(instance.address, 200, { from: peers[1] });

    const request = await getOpenChannelRequest({
      celerChannelAddress: instance.address,
      disputeTimeout: DISPUTE_TIMEOUT,
      tokenAddress: eRC20ExampleToken.address,
      tokenType: 2  // '2' for ERC20
    });
    const openChannelRequest = web3.utils.bytesToHex(
      request.openChannelRequestBytes
    );

    const tx = await instance.openChannel(openChannelRequest, { from: peers[0] });
    const { event, args } = tx.logs[0];
    fs.appendFileSync(GAS_USED_LOG, 'openChannel() with non-zero ERC20 deposits: ' + getCallGasUsed(tx) + '\n');
    channelId = args.channelId.toString();

    assert.equal(channelId, request.channelId);
    assert.equal(event, 'OpenChannel');
    assert.equal(args.tokenType, 2); //  2 for ERC20
    assert.equal(args.tokenAddress, eRC20ExampleToken.address);
    assert.deepEqual(args.peerAddrs, peers);
    assert.equal(args.balances.toString(), [100, 200]);
  });

  it('should cooperativeWithdraw correctly when receiver doesn\'t have enough deposit but the whole channel does', async () => {
    const cooperativeWithdrawRequestBytes = await getCooperativeWithdrawRequestBytes({
      channelId: channelId,
      amount: 200,
      seqNum: 1
    });
    const cooperativeWithdrawRequest = web3.utils.bytesToHex(cooperativeWithdrawRequestBytes);

    const tx = await instance.cooperativeWithdraw(cooperativeWithdrawRequest);
    const { event, args } = tx.logs[0];
    fs.appendFileSync(GAS_USED_LOG, 'cooperativeWithdraw(): ' + getCallGasUsed(tx) + '\n');

    assert.equal(event, 'CooperativeWithdraw');
    assert.equal(args.channelId, channelId);
    assert.equal(args.withdrawalAmounts.toString(), [100, 100]);
    assert.equal(args.receiver, peers[0]);
    assert.equal(args.recipientChannelId, 0);
    assert.equal(args.balances.toString(), [0, 100]);
    assert.equal(args.seqNum, 1);

    const owedDeposit = await instance.getOwedDepositAmount.call(channelId, peers[0]);
    assert.equal(owedDeposit.toString(), '100');
    const owedDepositMap = await instance.getOwedDepositMap.call(channelId);
    assert.equal(owedDepositMap[1].toString(), [100, 0]);

    // owedDeposit = [100, 0]
  });

  it('should cooperativeSettle correctly', async () => {
    const cooperativeSettleRequestBytes = await getCooperativeSettleRequestBytes({
      channelId: channelId,
      seqNum: 3,
      settleAmounts: [50, 50]
    });
    const cooperativeSettleRequest = web3.utils.bytesToHex(cooperativeSettleRequestBytes);

    const tx = await instance.cooperativeSettle(cooperativeSettleRequest);
    const { event, args } = tx.logs[0];
    fs.appendFileSync(GAS_USED_LOG, 'cooperativeSettle(): ' + getCallGasUsed(tx) + '\n');

    const status = await instance.getChannelStatus(channelId);

    assert.equal(event, 'CooperativeSettle');
    assert.equal(args.channelId, channelId);
    assert.equal(args.settleBalance.toString(), [50, 50]);
    assert.equal(status, 3);
  });
});