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
const EthPool = artifacts.require('EthPool');
const ERC20ExampleToken = artifacts.require('ERC20ExampleToken');
const PayRegistry = artifacts.require('PayRegistry');

contract('CelerChannel using ETH', async accounts => {
  const peers = getSortedArray([accounts[0], accounts[1]]);
  const overlappedPeers = getSortedArray([peers[0], accounts[2]]);
  const differentPeers = getSortedArray([accounts[2], accounts[3]]);
  const clients = [accounts[8], accounts[9]];  // namely [src, dest]
  const ETH_ADDR = '0x0000000000000000000000000000000000000000';
  const DISPUTE_TIMEOUT = 20;
  const GAS_USED_LOG = 'gas_used_logs/CelerChannel-ETH.txt';
  // the meaning of the index: [peer index][pay hash list index][pay index]
  const PEERS_PAY_HASH_LISTS_AMTS = [[[1, 2], [3, 4]], [[5, 6], [7, 8]]];

  // contract enforce ascending order of addresses
  let instance;
  let ethPool;
  let channelId;
  let payRegistry;
  let globalResult;
  let uniqueChannelIds = [];
  let coWithdrawSeqNum = 1;

  let protoChainInstance;
  let getOpenChannelRequest;
  let getCooperativeWithdrawRequestBytes;
  let getSignedSimplexStateArrayBytes;
  let getCooperativeSettleRequestBytes;
  let getResolvePayByConditionsRequestBytes;
  let getPayHashListInfo;

  before(async () => {
    fs.writeFileSync(GAS_USED_LOG, '********** Gas Used in CelerChannel-ETH Tests **********\n\n');

    const resolver = await Resolver.new();
    ethPool = await EthPool.new();
    payRegistry = await PayRegistry.new(resolver.address)
    instance = await CelerChannel.new(ethPool.address, payRegistry.address);

    fs.appendFileSync(GAS_USED_LOG, '***** Deploy Gas Used *****\n');
    let gasUsed = await getDeployGasUsed(resolver);
    fs.appendFileSync(GAS_USED_LOG, 'VirtContractResolver Deploy Gas: ' + gasUsed + '\n');
    gasUsed = await getDeployGasUsed(ethPool);
    fs.appendFileSync(GAS_USED_LOG, 'EthPool Deploy Gas: ' + gasUsed + '\n');
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

    // make sure peers deposit enough ETH in ETH pool
    await ethPool.deposit(peers[0], { value: 1000000000 });
    await ethPool.deposit(peers[1], { value: 1000000000 });
  });

  it('should fail to transfer ETH to CelerChannel from a non-EthPool address', async () => {
    try {
      await instance.sendTransaction({ value: 100, from: accounts[0] });
    } catch (error) {
      assert.isAbove(
        error.message.search('Sender is not EthPool'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should transfer ETH to CelerChannel correctly from EthPool address', async () => {
    instanceTmp = await CelerChannel.new(
      accounts[0],  // eth pool address
      accounts[1]
    );

    let balance;
    balance = await web3.eth.getBalance(instanceTmp.address);
    assert.equal(balance, 0);

    await instanceTmp.sendTransaction({ value: 100, from: accounts[0] });
    balance = await web3.eth.getBalance(instanceTmp.address);
    assert.equal(balance, 100);
  });

  it('should return Uninitialized status for an inexistent channel', async () => {
    const status = await instance.getChannelStatus(1);

    assert.equal(status, 0);
  });

  it('should fail to open a channel after openDeadline', async () => {
    const request = await getOpenChannelRequest({
      celerChannelAddress: instance.address,
      disputeTimeout: DISPUTE_TIMEOUT,
      zeroTotalDeposit: true,
      openDeadline: 0
    });
    const openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);

    try {
      await instance.openChannel(openChannelRequest);
    } catch (error) {
      assert.isAbove(
        error.message.search('Open deadline passed'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should fail to open a channel with deposits before setting the deposit limits', async () => {
    await ethPool.approve(instance.address, 200, { from: peers[1] });

    const request = await getOpenChannelRequest({
      celerChannelAddress: instance.address,
      disputeTimeout: DISPUTE_TIMEOUT
    });
    const openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);

    try {
      await instance.openChannel(openChannelRequest);
    } catch (error) {
      assert.isAbove(
        error.message.search('Deposits exceed limit'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should open a channel correctly when total deposit is zero', async () => {
    const request = await getOpenChannelRequest({
      celerChannelAddress: instance.address,
      disputeTimeout: DISPUTE_TIMEOUT,
      zeroTotalDeposit: true
    });
    const openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);

    const tx = await instance.openChannel(openChannelRequest);
    fs.appendFileSync(GAS_USED_LOG, 'openChannel() with zero deposit: ' + getCallGasUsed(tx) + '\n');

    const { event, args } = tx.logs[0];
    channelId = args.channelId.toString();
    const status = await instance.getChannelStatus(channelId);

    assert.equal(event, 'OpenChannel');
    assert.equal(channelId, request.channelId);
    assert.equal(args.tokenType, 1); //  1 for ETH
    assert.equal(args.tokenAddress, ETH_ADDR);
    assert.deepEqual(args.peerAddrs, peers);
    assert.equal(args.balances.toString(), [0, 0]);
    assert.equal(status, 1);

    // balances = [0, 0]
  });

  it('should fail to open a channel with an occupied channel ID (by used channel initializer)', async () => {
    const request = await getOpenChannelRequest({
      celerChannelAddress: instance.address,
      disputeTimeout: DISPUTE_TIMEOUT,
      zeroTotalDeposit: true
    });
    const openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);

    try {
      await instance.openChannel(openChannelRequest);
    } catch (error) {
      assert.isAbove(
        error.message.search('Occupied channelId'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should getTokenContract and getTokenType correctly', async () => {
    const tokenAddress = await instance.getTokenContract.call(channelId);
    const tokenType = await instance.getTokenType.call(channelId);

    assert.equal(tokenAddress, ETH_ADDR);
    assert.equal(tokenType, 1); //  1 for ETH
  });

  it('should fail to cooperativeWithdraw (because of no deposit)', async () => {
    const cooperativeWithdrawRequestBytes = await getCooperativeWithdrawRequestBytes({
      channelId: channelId,
      amount: 100
    });
    const cooperativeWithdrawRequest =
      web3.utils.bytesToHex(cooperativeWithdrawRequestBytes);

    try {
      await instance.cooperativeWithdraw(cooperativeWithdrawRequest);
    } catch (error) {
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should open another channel correctly', async () => {
    // Open another channel and try to deposit to channel that is not created the last.
    const request = await getOpenChannelRequest({
      celerChannelAddress: instance.address,
      disputeTimeout: DISPUTE_TIMEOUT,
      zeroTotalDeposit: true,
      channelPeers: differentPeers
    });
    const openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);

    const tx = await instance.openChannel(openChannelRequest);

    const { event, args } = tx.logs[0];
    differentPeersChannelId = args.channelId.toString();
    const status = await instance.getChannelStatus(differentPeersChannelId);

    assert.equal(event, 'OpenChannel');
    assert.equal(differentPeersChannelId, request.channelId);
    assert.equal(args.tokenType, 1); //  1 for ETH
    assert.equal(args.tokenAddress, ETH_ADDR);
    assert.deepEqual(args.peerAddrs, differentPeers);
    assert.equal(args.balances.toString(), [0, 0]);
    assert.equal(status, 1);
  });

  it('should fail to deposit before setting deposit limit', async () => {
    try {
      await instance.deposit(
        channelId,
        peers[0],
        0,
        {
          from: peers[0],
          value: 100
        }
      );
    } catch (error) {
      assert.isAbove(
        error.message.search('Deposits exceed limit'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should fail to set deposit limits if not owner', async () => {
    try {
      await instance.setDepositLimits([ETH_ADDR], [1000000], { from: accounts[1] });
    } catch (error) {
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should set deposit limits correctly', async () => {
    const limit = 1000000;
    const tx = await instance.setDepositLimits([ETH_ADDR], [limit], { from: accounts[0] });
    fs.appendFileSync(GAS_USED_LOG, 'setDepositLimits(): ' + getCallGasUsed(tx) + '\n');

    const depositLimit = await instance.depositLimits.call(ETH_ADDR);
    assert.equal(limit.toString(), depositLimit.toString());
  });

  it('should open a channel with funds correctly after setting deposit limit', async () => {
    await ethPool.approve(instance.address, 200, { from: peers[1] });

    const request = await getOpenChannelRequest({
      celerChannelAddress: instance.address,
      disputeTimeout: DISPUTE_TIMEOUT,
      openDeadline: 1234567890  // for a unique channel ID
    });
    const openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);

    const tx = await instance.openChannel(openChannelRequest, { value: 100 });
    const { event, args } = tx.logs[0];
    channelIdTmp = args.channelId.toString();

    assert.equal(channelIdTmp, request.channelId);
    assert.equal(event, 'OpenChannel');
    assert.equal(args.tokenType, 1); //  '1' for ETH
    assert.equal(args.tokenAddress, ETH_ADDR);
    assert.deepEqual(args.peerAddrs, peers);
    assert.equal(args.balances.toString(), [100, 200]);
  });

  it('should deposit via msg.value correctly', async () => {
    const tx = await instance.deposit(
      channelId,
      peers[0],
      0,
      {
        from: peers[0],
        value: 50
      }
    );
    fs.appendFileSync(GAS_USED_LOG, 'deposit() via msg.value: ' + getCallGasUsed(tx) + '\n');

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

    // balances = [50, 0]
  });

  it('should fail to deposit when the new deposit sum exceeds the deposit limit', async () => {
    await instance.setDepositLimits([ETH_ADDR], [60], { from: accounts[0] });

    let errorCounter = 0;
    try {
      await instance.deposit(
        channelId,
        peers[0],
        0,
        {
          from: peers[0],
          value: 50
        }
      );
    } catch (error) {
      if (error.message.search('Deposits exceed limit') > -1) {
        errorCounter++;
      }
    }

    try {
      await instance.deposit(
        channelId,
        peers[1],
        0,
        {
          from: peers[1],
          value: 50
        }
      );
    } catch (error) {
      if (error.message.search('Deposits exceed limit') > -1) {
        errorCounter++;
      }
    }

    assert.equal(errorCounter, 2);
  });

  it('should fail to disable all deposit limits if not owner', async () => {
    try {
      await instance.disableDepositLimits({ from: accounts[1] });
    } catch (error) {
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should disable all deposit limits correctly', async () => {
    const tx = await instance.disableDepositLimits({ from: accounts[0] });
    fs.appendFileSync(GAS_USED_LOG, 'disableDepositLimits(): ' + getCallGasUsed(tx) + '\n');

    const depositLimitsEnabled = await instance.depositLimitsEnabled.call();
    assert.equal(depositLimitsEnabled, false);
  });

  it('should deposit correctly after removing deposit limits', async () => {
    const tx = await instance.deposit(
      channelId,
      peers[0],
      0,
      {
        from: peers[0],
        value: 50
      }
    );

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

    // balances = [100, 0]
  });

  it('should fail to enable all deposit limits if not owner', async () => {
    try {
      await instance.enableDepositLimits({ from: accounts[1] });
    } catch (error) {
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should enable all deposit limits correctly', async () => {
    const tx = await instance.enableDepositLimits({ from: accounts[0] });
    fs.appendFileSync(GAS_USED_LOG, 'enableDepositLimits(): ' + getCallGasUsed(tx) + '\n');

    const depositLimitsEnabled = await instance.depositLimitsEnabled.call();
    const limit = await instance.depositLimits.call(ETH_ADDR);
    assert.equal(depositLimitsEnabled, true);
    assert.equal(limit.toString(), '60');
  });

  it('should fail to deposit after deposit limits reenabled and being exceeded', async () => {
    try {
      await instance.deposit(
        channelId,
        peers[0],
        0,
        {
          from: peers[0],
          value: 50
        }
      );
    } catch (error) {
      assert.isAbove(
        error.message.search('Deposits exceed limit'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should deposit via EthPool correctly', async () => {
    await instance.disableDepositLimits({ from: accounts[0] });
    await ethPool.approve(instance.address, 100, { from: peers[0] });
    const tx = await instance.deposit(channelId, peers[0], 100, { from: peers[0] });
    fs.appendFileSync(GAS_USED_LOG, 'deposit() via EthPool: ' + getCallGasUsed(tx) + '\n');

    const { event, args } = tx.logs[0];
    const amount = await instance.getDepositAmount(channelId, peers[0]);
    const depositMap = await instance.getDepositMap(channelId);
    const channelPeers = depositMap[0];
    const channelBalances = depositMap[1];

    assert.equal(event, 'Deposit');
    assert.deepEqual(args.peerAddrs, peers);
    assert.equal(args.balances.toString(), [200, 0]);
    assert.equal(amount, 200);
    assert.deepEqual(channelPeers, peers);
    assert.equal(channelBalances.toString(), [200, 0]);

    // balances = [200, 0]
  });

  it('should intendWithdraw correctly', async () => {
    const tx = await instance.intendWithdraw(channelId, 200, 0, { from: peers[0] });
    const { event, args } = tx.logs[0];
    fs.appendFileSync(GAS_USED_LOG, 'intendWithdraw(): ' + getCallGasUsed(tx) + '\n');

    assert.equal(event, 'IntendWithdraw');
    assert.equal(args.channelId, channelId);
    assert.equal(args.receiver, peers[0]);
    assert.equal(args.amount.toString(), 200);
  });

  it('should fail to intendWithdraw when there is a pending WithdrawIntent', async () => {
    try {
      await instance.intendWithdraw(channelId, 200, 0, { from: peers[0] });
    } catch (error) {
      assert.isAbove(
        error.message.search('Pending withdraw intent exists'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should fail to confirmWithdraw before confirmableTime', async () => {
    try {
      await instance.confirmWithdraw(channelId, { from: accounts[9] });
    } catch (error) {
      assert.isAbove(
        error.message.search('Dispute not timeout'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should vetoWithdraw correctly', async () => {
    const tx = await instance.vetoWithdraw(channelId, { from: peers[1] });
    const { event, args } = tx.logs[0];
    fs.appendFileSync(GAS_USED_LOG, 'vetoWithdraw(): ' + getCallGasUsed(tx) + '\n');

    assert.equal(event, 'VetoWithdraw');
    assert.equal(args.channelId, channelId);
  });

  it('should fail to confirmWithdraw after vetoWithdraw', async () => {
    const block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + DISPUTE_TIMEOUT, accounts[0]);

    try {
      await instance.confirmWithdraw(channelId, { from: accounts[9] });
    } catch (error) {
      assert.isAbove(
        error.message.search('Withdraw receiver is 0'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should confirmWithdraw correctly', async () => {
    await instance.intendWithdraw(channelId, 200, 0, { from: peers[0] });

    const block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + DISPUTE_TIMEOUT, accounts[0]);

    const tx = await instance.confirmWithdraw(channelId, { from: accounts[9] });
    const { event, args } = tx.logs[0];
    fs.appendFileSync(GAS_USED_LOG, 'confirmWithdraw(): ' + getCallGasUsed(tx) + '\n');

    assert.equal(event, 'ConfirmWithdraw');
    assert.equal(args.channelId, channelId);
    assert.equal(args.withdrawalAmounts.toString(), [200, 0]);
    assert.equal(args.receiver, peers[0]);
    assert.equal(args.recipientChannelId, 0);
    assert.equal(args.balances.toString(), [0, 0]);

    // balances = [0, 0]
  });

  it('should fail to confirmWithdraw again after confirmWithdraw', async () => {
    try {
      await instance.confirmWithdraw(channelId, { from: accounts[9] });
    } catch (error) {
      assert.isAbove(
        error.message.search('Withdraw receiver is 0'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should fail to intendWithdraw and confirmWithdraw from an ETH channel to an ERC20 channel', async () => {
    const eRC20ExampleToken = await ERC20ExampleToken.new();
    const request = await getOpenChannelRequest({
      celerChannelAddress: instance.address,
      disputeTimeout: DISPUTE_TIMEOUT,
      zeroTotalDeposit: true,
      tokenType: 2,
      tokenAddress: eRC20ExampleToken.address,
      channelPeers: peers
    });
    const openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);
    const tx = await instance.openChannel(openChannelRequest);
    eRC20ChannelId = tx.logs[0].args.channelId.toString();

    await instance.deposit(channelId, peers[0], 0, { value: 200 });
    await instance.intendWithdraw(channelId, 200, eRC20ChannelId, { from: peers[0] });

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

    // balances = [200, 0]
  });

  it('should fail to intendWithdraw and confirmWithdraw to another channel without such a receiver', async () => {
    await instance.intendWithdraw(channelId, 200, differentPeersChannelId, { from: peers[0] });

    const block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + DISPUTE_TIMEOUT, accounts[0]);

    try {
      await instance.confirmWithdraw(channelId, { from: accounts[9] });
    } catch (error) {
      assert.isAbove(
        error.message.search('Nonexist peer'),
        -1
      );

      // veto current withdrawal proposal before return
      await instance.vetoWithdraw(channelId);

      return;
    }

    assert.fail('should have thrown before');

    // balances = [200, 0]
  });

  it('should intendWithdraw and confirmWithdraw to another channel correctly', async () => {
    // open another channel with an overlapped peer
    const request = await getOpenChannelRequest({
      celerChannelAddress: instance.address,
      disputeTimeout: DISPUTE_TIMEOUT,
      zeroTotalDeposit: true,
      channelPeers: overlappedPeers
    });
    const openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);
    let tx = await instance.openChannel(openChannelRequest);
    overlappedPeersChannelId = tx.logs[0].args.channelId.toString();

    await instance.intendWithdraw(channelId, 200, overlappedPeersChannelId, { from: peers[0] });

    const block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + DISPUTE_TIMEOUT, accounts[0]);

    tx = await instance.confirmWithdraw(channelId, { from: accounts[9] });

    assert.equal(tx.logs[0].event, 'ConfirmWithdraw');
    assert.equal(tx.logs[0].args.channelId, channelId);
    assert.equal(tx.logs[0].args.withdrawalAmounts.toString(), [200, 0]);
    assert.equal(tx.logs[0].args.receiver, peers[0]);
    assert.equal(tx.logs[0].args.recipientChannelId, overlappedPeersChannelId);
    assert.equal(tx.logs[0].args.balances.toString(), [0, 0]);

    let expectedBalances;
    if (overlappedPeers[0] == peers[0]) {
      expectedBalances = [200, 0];
    } else {
      expectedBalances = [0, 200];
    }
    assert.equal(tx.logs[1].event, 'Deposit');
    assert.equal(tx.logs[1].args.channelId, overlappedPeersChannelId);
    assert.deepEqual(tx.logs[1].args.peerAddrs, overlappedPeers);
    assert.equal(tx.logs[1].args.balances.toString(), expectedBalances);

    const balance = await instance.getDepositAmount(overlappedPeersChannelId, peers[0]);
    assert.equal(balance.toString(), 200);

    // balances = [0, 0]
  });

  it('should fail to cooperativeWithdraw after withdraw deadline', async () => {
    await instance.deposit(channelId, peers[0], 0, { value: 200 });

    const cooperativeWithdrawRequestBytes = await getCooperativeWithdrawRequestBytes({
      channelId: channelId,
      amount: 200,
      withdrawDeadline: 1
    });
    const cooperativeWithdrawRequest = web3.utils.bytesToHex(cooperativeWithdrawRequestBytes);

    try {
      await instance.cooperativeWithdraw(cooperativeWithdrawRequest);
    } catch (error) {
      assert.isAbove(
        error.message.search('Withdraw deadline passed'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');

    // balances = [200, 0]
  });

  it('should cooperativeWithdraw correctly when receiver has enough deposit', async () => {
    const cooperativeWithdrawRequestBytes = await getCooperativeWithdrawRequestBytes({
      channelId: channelId,
      amount: 200,
      seqNum: coWithdrawSeqNum
    });
    coWithdrawSeqNum++;
    const cooperativeWithdrawRequest = web3.utils.bytesToHex(cooperativeWithdrawRequestBytes);

    const tx = await instance.cooperativeWithdraw(
      cooperativeWithdrawRequest,
      { from: accounts[2] }
    );
    const { event, args } = tx.logs[0];
    fs.appendFileSync(GAS_USED_LOG, 'cooperativeWithdraw(): ' + getCallGasUsed(tx) + '\n');

    assert.equal(event, 'CooperativeWithdraw');
    assert.equal(args.channelId, channelId);
    assert.equal(args.withdrawalAmounts.toString(), [200, 0]);
    assert.equal(args.receiver, peers[0]);
    assert.equal(args.recipientChannelId, 0);
    assert.equal(args.balances.toString(), [0, 0]);
    assert.equal(args.seqNum, coWithdrawSeqNum - 1);

    // balances = [0, 0]
  });

  it('should fail to cooperativeWithdraw when using an unexpected seqNum', async () => {
    let cooperativeWithdrawRequestBytes;
    let cooperativeWithdrawRequest;
    let flag = false;
    await instance.deposit(channelId, peers[0], 0, { value: 10 });

    // smaller seqNum than expected one
    cooperativeWithdrawRequestBytes = await getCooperativeWithdrawRequestBytes({
      channelId: channelId,
      seqNum: coWithdrawSeqNum - 1,
      amount: 10
    });
    cooperativeWithdrawRequest = web3.utils.bytesToHex(cooperativeWithdrawRequestBytes);

    try {
      await instance.cooperativeWithdraw(cooperativeWithdrawRequest);
    } catch (error) {
      assert.isAbove(
        error.message.search('seqNum error'),
        -1
      );
      flag = true;
    }
    assert.isOk(flag);

    // larger seqNum than expected one
    cooperativeWithdrawRequestBytes = await getCooperativeWithdrawRequestBytes({
      channelId: channelId,
      seqNum: coWithdrawSeqNum + 1,
      amount: 10
    });
    cooperativeWithdrawRequest =
      web3.utils.bytesToHex(cooperativeWithdrawRequestBytes);

    flag = false;
    try {
      await instance.cooperativeWithdraw(cooperativeWithdrawRequest);
    } catch (error) {
      assert.isAbove(
        error.message.search('seqNum error'),
        -1
      );
      flag = true;
    }
    assert.isOk(flag);

    // expected seqNum
    cooperativeWithdrawRequestBytes = await getCooperativeWithdrawRequestBytes({
      channelId: channelId,
      seqNum: coWithdrawSeqNum,
      amount: 10
    });
    coWithdrawSeqNum++;
    cooperativeWithdrawRequest = web3.utils.bytesToHex(cooperativeWithdrawRequestBytes);

    const tx = await instance.cooperativeWithdraw(
      cooperativeWithdrawRequest,
      { from: accounts[2] }
    );
    const { event, args } = tx.logs[0];

    assert.equal(event, 'CooperativeWithdraw');
    assert.equal(args.channelId, channelId);
    assert.equal(args.withdrawalAmounts.toString(), [10, 0]);
    assert.equal(args.receiver, peers[0]);
    assert.equal(args.recipientChannelId, 0);
    assert.equal(args.balances.toString(), [0, 0]);
    assert.equal(args.seqNum, coWithdrawSeqNum - 1);

    // balances = [0, 0]
  });

  it('should cooperativeWithdraw correctly when receiver doesn\'t have enough deposit but the whole channel does', async () => {
    await instance.deposit(channelId, peers[0], 0, { value: 160 });
    await instance.deposit(channelId, peers[1], 0, { value: 40 });

    const cooperativeWithdrawRequestBytes = await getCooperativeWithdrawRequestBytes({
      channelId: channelId,
      amount: 200,
      seqNum: coWithdrawSeqNum
    });
    coWithdrawSeqNum++;
    const cooperativeWithdrawRequest = web3.utils.bytesToHex(cooperativeWithdrawRequestBytes);

    const tx = await instance.cooperativeWithdraw(
      cooperativeWithdrawRequest,
      { from: accounts[2] }
    );
    const { event, args } = tx.logs[0];

    assert.equal(event, 'CooperativeWithdraw');
    assert.equal(args.channelId, channelId);
    assert.equal(args.withdrawalAmounts.toString(), [160, 40]);
    assert.equal(args.receiver, peers[0]);
    assert.equal(args.recipientChannelId, 0);
    assert.equal(args.balances.toString(), [0, 0]);
    assert.equal(args.seqNum, coWithdrawSeqNum - 1);

    const owedDeposit = await instance.getOwedDepositAmount.call(channelId, peers[0]);
    assert.equal(owedDeposit.toString(), '40');
    const owedDepositMap = await instance.getOwedDepositMap.call(channelId);
    assert.equal(owedDepositMap[1].toString(), [40, 0]);

    // balances = [0, 0]
    // owedDeposit = [40, 0]
  });

  it('should cooperativeWithdraw to another channel correctly', async () => {
    await instance.deposit(channelId, peers[0], 0, { value: 200 });

    const cooperativeWithdrawRequestBytes = await getCooperativeWithdrawRequestBytes({
      channelId: channelId,
      amount: 200,
      recipientChannelId: overlappedPeersChannelId,
      seqNum: coWithdrawSeqNum
    });
    coWithdrawSeqNum++;
    const cooperativeWithdrawRequest = web3.utils.bytesToHex(cooperativeWithdrawRequestBytes);

    const tx = await instance.cooperativeWithdraw(cooperativeWithdrawRequest);

    assert.equal(tx.logs[0].event, 'CooperativeWithdraw');
    assert.equal(tx.logs[0].args.channelId, channelId);
    assert.equal(tx.logs[0].args.withdrawalAmounts.toString(), [200, 0]);
    assert.equal(tx.logs[0].args.receiver, peers[0]);
    assert.equal(tx.logs[0].args.recipientChannelId, overlappedPeersChannelId);
    assert.equal(tx.logs[0].args.balances.toString(), [0, 0]);
    assert.equal(tx.logs[0].args.seqNum, 4);

    let expectedBalances;
    if (overlappedPeers[0] == peers[0]) {
      expectedBalances = [400, 0];
    } else {
      expectedBalances = [0, 400];
    }
    assert.equal(tx.logs[1].event, 'Deposit');
    assert.equal(tx.logs[1].args.channelId, overlappedPeersChannelId);
    assert.deepEqual(tx.logs[1].args.peerAddrs, overlappedPeers);
    assert.equal(tx.logs[1].args.balances.toString(), expectedBalances);

    const balance = await instance.getDepositAmount(overlappedPeersChannelId, peers[0]);
    assert.equal(balance.toString(), 400);

    // balances = [0, 0]
    // owedDeposit = [40, 0]
  });

  it('should fail to cooperativeWithdraw to another channel without such a receiver', async () => {
    await instance.deposit(channelId, peers[0], 0, { value: 100 });

    const cooperativeWithdrawRequestBytes = await getCooperativeWithdrawRequestBytes({
      channelId: channelId,
      amount: 100,
      recipientChannelId: differentPeersChannelId,
      seqNum: coWithdrawSeqNum
    });
    const cooperativeWithdrawRequest = web3.utils.bytesToHex(cooperativeWithdrawRequestBytes);

    try {
      await instance.cooperativeWithdraw(cooperativeWithdrawRequest);
    } catch (error) {
      assert.isAbove(
        error.message.search('Nonexist peer'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');

    // balances = [100, 0]
    // owedDeposit = [40, 0]
  });

  it('should fail to cooperativeWithdraw from an ETH channel to an ERC20 channel', async () => {
    const cooperativeWithdrawRequestBytes = await getCooperativeWithdrawRequestBytes({
      channelId: channelId,
      amount: 100,
      recipientChannelId: eRC20ChannelId,
      seqNum: coWithdrawSeqNum
    });
    const cooperativeWithdrawRequest = web3.utils.bytesToHex(cooperativeWithdrawRequestBytes);

    try {
      await instance.cooperativeWithdraw(cooperativeWithdrawRequest);
    } catch (error) {
      assert.isAbove(
        error.message.search('Token mismatch of recipient channel'),
        -1
      );

      // withdraw all funds to keep balances 0
      const cooperativeWithdrawRequestBytes = await getCooperativeWithdrawRequestBytes({
        channelId: channelId,
        amount: 100,
        seqNum: coWithdrawSeqNum,
        receiverAccount: peers[0]
      });
      coWithdrawSeqNum++;
      const cooperativeWithdrawRequest = web3.utils.bytesToHex(cooperativeWithdrawRequestBytes);
      const tx = await instance.cooperativeWithdraw(cooperativeWithdrawRequest);
      const { event, args } = tx.logs[0];
      assert.equal(event, 'CooperativeWithdraw');
      assert.equal(args.withdrawalAmounts.toString(), [100, 0]);

      return;
    }

    assert.fail('should have thrown before');

    // balances = [0, 0]
    // owedDeposit = [40, 0]
  });

  it('should fail to intendSettle when some pays in head list are not finalized before last pay resolve deadline', async () => {
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

    // resolve only one payment
    const requestBytes = getResolvePayByConditionsRequestBytes({
      condPayBytes: globalResult.condPays[0][0][0]
    });
    await payRegistry.resolvePaymentByConditions(requestBytes);

    // let resolve timeout but not pass the last pay resolve deadline
    let block;
    block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + 6, accounts[0]);

    // intend settle
    try {
      await instance.intendSettle(signedSimplexStateArrayBytes);
    } catch (error) {
      assert.isAbove(
        error.message.search('Payment is not finalized'),
        -1
      );

      return;
    }

    assert.fail('should have thrown before');
  });

  it('should intendSettle correctly when all pays in head list are finalized before last pay resolve deadline', async () => {
    const signedSimplexStateArrayBytes = globalResult.signedSimplexStateArrayBytes;

    // resolve the payments in head PayHashList
    // the head list of peerFrom 0. Already resolved the first payment in last test case
    for (let i = 1; i < globalResult.condPays[0][0].length; i++) {
      const requestBytes = getResolvePayByConditionsRequestBytes({
        condPayBytes: globalResult.condPays[0][0][i]
      });
      await payRegistry.resolvePaymentByConditions(requestBytes);
    }
    // the head list of peerFrom 1
    for (let i = 0; i < globalResult.condPays[1][0].length; i++) {
      const requestBytes = getResolvePayByConditionsRequestBytes({
        condPayBytes: globalResult.condPays[1][0][i]
      });
      await payRegistry.resolvePaymentByConditions(requestBytes);
    }

    // let resolve timeout but not pass the last pay resolve deadline
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
    for (let i = 0; i < 2; i++) {  // for each simplex state
      for (j = 0; j < 2; j++) {  // for each pays in head PayHashList
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

  it('should fail to liquidatePays when payments are not finalized before last pay resolve deadline', async () => {
    try {
      await instance.liquidatePays(
        channelId,
        peers[0],
        globalResult.payHashListBytesArrays[0][1]
      );
    } catch (error) {
      assert.isAbove(
        error.message.search('Payment is not finalized'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should liquidatePays correctly when payments are finalized', async () => {
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

    // let resolve timeout but not pass the last pay resolve deadline
    let block;
    block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + 6, accounts[0]);

    let tx;
    let payHash;
    const amounts = [[3, 4], [7, 8]];

    for (peerIndex = 0; peerIndex < 2; peerIndex++) {  // for each simplex state
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

  it('should fail to ConfirmSettle or ConfirmSettleFail (namely revert) due to not reaching settleFinalizedTime', async () => {
    let flag = false;

    try {
      await instance.confirmSettle(channelId);
    } catch (error) {
      assert.isAbove(
        error.message.search('Settle is not finalized'),
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
    await instance.deposit(channelId, peers[0], 0, { value: 10 });
    await instance.deposit(channelId, peers[1], 0, { value: 20 });

    const settleFinalizedTime = await instance.getSettleFinalizedTime(channelId);
    await mineBlockUntil(settleFinalizedTime, accounts[0]);

    const tx = await instance.confirmSettle(channelId);
    const status = await instance.getChannelStatus(channelId);
    const depositMap = await instance.getDepositMap(channelId);
    const channelBalances = depositMap[1];

    assert.equal(tx.logs[0].event, 'ConfirmSettleFail');
    assert.equal(status, 1);
    assert.equal(channelBalances.toString(), [10, 20]);

    // balances = [10, 20]
  });

  it('should liquidatePays correctly after settleFinalizedTime', async () => {
    const signedSimplexStateArrayBytes = globalResult.signedSimplexStateArrayBytes;
    await instance.intendSettle(signedSimplexStateArrayBytes);

    // pass after settleFinalizedTime
    const settleFinalizedTime = await instance.getSettleFinalizedTime(channelId);
    await mineBlockUntil(settleFinalizedTime, accounts[0]);

    let tx;
    let payHash;
    const amounts = [[3, 4], [7, 8]];

    for (peerIndex = 0; peerIndex < 2; peerIndex++) {  // for each simplex state
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
    // balances = [10, 20]
  });

  it('should fail to intendSettle after settleFinalizedTime', async () => {
    const result = await getCoSignedIntendSettle(
      getPayHashListInfo,
      getSignedSimplexStateArrayBytes,
      [channelId, channelId],
      PEERS_PAY_HASH_LISTS_AMTS,
      [5, 5],  // seqNums
      [999999999, 9999999999],  // lastPayResolveDeadlines
      [10, 20]  // transferAmounts
    );
    const signedSimplexStateArrayBytes = result.signedSimplexStateArrayBytes;
    // resolve the payments in head PayHashList
    for (peerIndex = 0; peerIndex < 2; peerIndex++) {
      for (payIndex = 0; payIndex < result.condPays[peerIndex][0].length; payIndex++) {
        const requestBytes = getResolvePayByConditionsRequestBytes({
          condPayBytes: result.condPays[peerIndex][0][payIndex]
        });
        await payRegistry.resolvePaymentByConditions(requestBytes);
      }
    }

    // let resolve timeout but not pass the last pay resolve deadline
    let block;
    block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + 6, accounts[0]);

    // intend settle
    try {
      await instance.intendSettle(signedSimplexStateArrayBytes);
    } catch (error) {
      assert.isAbove(
        error.message.search('Settle has already finalized'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
    // balances = [10, 20]
  });

  it('should confirmSettle correctly', async () => {
    //  update balances to [100, 100]
    await instance.deposit(channelId, peers[0], 0, { value: 90 });
    await instance.deposit(channelId, peers[1], 0, { value: 80 });
    const depositMap = await instance.getDepositMap(channelId);
    const channelBalances = depositMap[1];
    assert.equal(channelBalances.toString(), [100, 100]);

    let tx = await instance.confirmSettle(
      channelId,
      { from: accounts[2] }  // let peers not pay for gas
    );
    fs.appendFileSync(GAS_USED_LOG, 'confirmSettle(): ' + getCallGasUsed(tx) + '\n');
    const status = await instance.getChannelStatus(channelId);
    const { event, args } = tx.logs[0];

    assert.equal(event, 'ConfirmSettle');
    // also include the owedDeposits
    assert.equal(args.settleBalance.toString(), [86, 114]);
    assert.equal(status, 3);
  });

  it('should open a channel correctly when total deposit is larger than zero', async () => {
    await ethPool.approve(instance.address, 200, { from: peers[1] });

    const request = await getOpenChannelRequest({
      celerChannelAddress: instance.address,
      disputeTimeout: DISPUTE_TIMEOUT
    });
    const openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);

    const tx = await instance.openChannel(openChannelRequest, { value: 100 });
    const { event, args } = tx.logs[0];
    fs.appendFileSync(GAS_USED_LOG, 'openChannel() using EthPool and msg.value: ' + getCallGasUsed(tx) + '\n');
    channelId = args.channelId.toString();

    assert.equal(channelId, request.channelId);
    assert.equal(event, 'OpenChannel');
    assert.equal(args.tokenType, 1); //  '1' for ETH
    assert.equal(args.tokenAddress, ETH_ADDR);
    assert.deepEqual(args.peerAddrs, peers);
    assert.equal(args.balances.toString(), [100, 200]);
  });

  it('should open a channel correctly when total deposit is larger than zero, and msgValueRecipient is 1, and caller is not peers', async () => {
    await ethPool.approve(instance.address, 100, { from: peers[0] });

    const request = await getOpenChannelRequest({
      celerChannelAddress: instance.address,
      disputeTimeout: DISPUTE_TIMEOUT,
      msgValueRecipient: 1
    });
    const openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);

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
    assert.equal(args.tokenAddress, ETH_ADDR);
    assert.deepEqual(args.peerAddrs, peers);
    assert.equal(args.balances.toString(), [100, 200]);
  });

  it('should fail to cooperativeSettle when submitted sum is not equal to deposit sum', async () => {
    const cooperativeSettleRequestBytes = await getCooperativeSettleRequestBytes({
      channelId: channelId,
      seqNum: 2,  // need to be > 0 (default value of both state seqNums)
      settleAmounts: [200, 200]
    });
    const cooperativeSettleRequest = web3.utils.bytesToHex(cooperativeSettleRequestBytes);

    try {
      await instance.cooperativeSettle(cooperativeSettleRequest);
    } catch (error) {
      assert.isAbove(
        error.message.search('Balance sum mismatch'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should cooperativeSettle correctly', async () => {
    const cooperativeSettleRequestBytes = await getCooperativeSettleRequestBytes({
      channelId: channelId,
      seqNum: 2,  // need to be > 0 (default value of both state seqNums)
      settleAmounts: [50, 250]
    });
    const cooperativeSettleRequest = web3.utils.bytesToHex(cooperativeSettleRequestBytes);

    let tx = await instance.cooperativeSettle(cooperativeSettleRequest);
    const { event, args } = tx.logs[0];
    fs.appendFileSync(GAS_USED_LOG, 'cooperativeSettle(): ' + getCallGasUsed(tx) + '\n');

    const status = await instance.getChannelStatus(channelId);

    assert.equal(event, 'CooperativeSettle');
    assert.equal(args.channelId, channelId);
    assert.equal(args.settleBalance.toString(), [50, 250]);
    assert.equal(status, 3);
  });

  it('should intendSettle correctly when time is after last pay resolve deadline', async () => {
    // open a new channel
    await ethPool.approve(instance.address, 200, { from: peers[1] });
    const request = await getOpenChannelRequest({
      celerChannelAddress: instance.address,
      openDeadline: 100000000,  // make initializer hash different
      disputeTimeout: DISPUTE_TIMEOUT,
    });
    const openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);
    let tx = await instance.openChannel(openChannelRequest, { value: 100 });
    channelId = tx.logs[0].args.channelId.toString();

    const result = await getCoSignedIntendSettle(
      getPayHashListInfo,
      getSignedSimplexStateArrayBytes,
      [channelId, channelId],
      PEERS_PAY_HASH_LISTS_AMTS,
      [1, 1],  // seqNums
      [2, 2],  // lastPayResolveDeadlines
      [10, 20]  // transferAmounts
    );
    const signedSimplexStateArrayBytes = result.signedSimplexStateArrayBytes;
    const condPays = result.condPays;

    // ensure it passes the last pay resolve deadline
    let block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + 2, accounts[0]);

    // intend settle
    tx = await instance.intendSettle(signedSimplexStateArrayBytes);

    block = await web3.eth.getBlock('latest');
    const settleFinalizedTime = await instance.getSettleFinalizedTime(channelId);
    const expectedSettleFinalizedTime = DISPUTE_TIMEOUT + block.number;
    assert.equal(expectedSettleFinalizedTime.toString(), settleFinalizedTime.toString());

    const status = await instance.getChannelStatus(channelId);
    assert.equal(status, 2);

    let payHash;
    for (let i = 0; i < 2; i++) {  // for each simplex state
      for (j = 0; j < 2; j++) {  // for each pays in head PayHashList
        const logIndex = i * 2 + j;
        assert.equal(tx.logs[logIndex].event, 'LiquidateOnePay');
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

  it('should confirmSettle correctly when pay proof type is HashArray and time is after last pay resolve deadline', async () => {
    const settleFinalizedTime = await instance.getSettleFinalizedTime(channelId);
    await mineBlockUntil(settleFinalizedTime, accounts[0]);

    const tx = await instance.confirmSettle(
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
    // open a new channel
    await ethPool.approve(instance.address, 200, { from: peers[1] });
    const request = await getOpenChannelRequest({
      celerChannelAddress: instance.address,
      openDeadline: 100000001,  // make initializer hash different
      disputeTimeout: DISPUTE_TIMEOUT,
    });
    const openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);
    let tx = await instance.openChannel(openChannelRequest, { value: 100 });
    channelId = tx.logs[0].args.channelId.toString();

    singleSignedNullStateBytes = await getSignedSimplexStateArrayBytes({
      channelIds: [channelId],
      seqNums: [0],
      signers: [peers[0]]
    });

    // intend settle
    tx = await instance.intendSettle(singleSignedNullStateBytes);
    fs.appendFileSync(GAS_USED_LOG, 'intendSettle() with a null state: ' + getCallGasUsed(tx) + '\n');

    const block = await web3.eth.getBlock('latest');
    const settleFinalizedTime = await instance.getSettleFinalizedTime(channelId);
    const expectedSingleSettleFinalizedTime = DISPUTE_TIMEOUT + block.number;
    assert.equal(expectedSingleSettleFinalizedTime.toString(), settleFinalizedTime.toString());

    const status = await instance.getChannelStatus(channelId);
    assert.equal(status, 2);

    const { event, args } = tx.logs[0];
    assert.equal(event, 'IntendSettle');
    assert.equal(args.channelId, channelId);
    assert.equal(args.seqNums.toString(), [0, 0]);
  });

  it('should fail to intendSettle with 0 payment (null state) again', async () => {
    try {
      await instance.intendSettle(singleSignedNullStateBytes);
    } catch (error) {
      assert.isAbove(
        error.message.search('intendSettle before'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should confirmSettle correctly after 0-payment (null-state) intendSettle', async () => {
    const settleFinalizedTime = await instance.getSettleFinalizedTime(channelId);
    await mineBlockUntil(settleFinalizedTime, accounts[0]);

    let tx = await instance.confirmSettle(channelId, { from: accounts[2] });
    const status = await instance.getChannelStatus(channelId);
    const { event, args } = tx.logs[0];

    assert.equal(event, 'ConfirmSettle');
    assert.equal(args.settleBalance.toString(), [100, 200]);
    assert.equal(status, 3);
  });

  it('should intendSettle correctly with one non-null simplex state', async () => {
    // open a new channel
    await ethPool.approve(instance.address, 200, { from: peers[1] });
    const request = await getOpenChannelRequest({
      celerChannelAddress: instance.address,
      openDeadline: 100000002,  // make initializer hash different
      disputeTimeout: DISPUTE_TIMEOUT,
    });
    const openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);
    let tx = await instance.openChannel(openChannelRequest, { value: 100 });
    channelId = tx.logs[0].args.channelId.toString();

    const payHashListInfo = getPayHashListInfo({ payAmounts: [[1, 2]] });
    const signedSimplexStateArrayBytes = await getSignedSimplexStateArrayBytes({
      channelIds: [channelId],
      seqNums: [5],
      lastPayResolveDeadlines: [999999],
      payHashLists: [payHashListInfo.payHashListProtos[0]],
      transferAmounts: [10],
      peerFroms: [peers[0]]
    });

    // resolve the payments in head PayHashList
    for (let i = 0; i < payHashListInfo.payBytesArray[0].length; i++) {
      const requestBytes = getResolvePayByConditionsRequestBytes({
        condPayBytes: payHashListInfo.payBytesArray[0][i]
      });
      await payRegistry.resolvePaymentByConditions(requestBytes);
    }

    // let resolve timeout but not pass the last pay resolve deadline
    let block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + 6, accounts[0]);

    // intend settle
    tx = await instance.intendSettle(signedSimplexStateArrayBytes);
    fs.appendFileSync(GAS_USED_LOG, 'intendSettle() with one non-null simplex state with 2 payments: ' + getCallGasUsed(tx) + '\n');

    block = await web3.eth.getBlock('latest');
    const settleFinalizedTime = await instance.getSettleFinalizedTime(channelId);
    const expectedSingleSettleFinalizedTime = DISPUTE_TIMEOUT + block.number;
    assert.equal(expectedSingleSettleFinalizedTime.toString(), settleFinalizedTime.toString());

    const status = await instance.getChannelStatus(channelId);
    assert.equal(status, 2);

    const amounts = [1, 2];
    for (let i = 0; i < 2; i++) {  // for each pays in head PayHashList
      assert.equal(tx.logs[i].event, 'LiquidateOnePay');
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

    const tx = await instance.confirmSettle(channelId);
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
    await ethPool.approve(instance.address, 200 * 3, { from: peers[1] });
    for (let i = 0; i < 3; i++) {
      const request = await getOpenChannelRequest({
        celerChannelAddress: instance.address,
        openDeadline: 100000003 + i,  // make initializer hash different
        disputeTimeout: DISPUTE_TIMEOUT,
      });
      const openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);
      tx = await instance.openChannel(openChannelRequest, { value: 100 });
      uniqueChannelIds[i] = tx.logs[0].args.channelId.toString();
    }

    let channelIds = [uniqueChannelIds[0], uniqueChannelIds[0], uniqueChannelIds[1], uniqueChannelIds[2]];
    const sortIndeces = getSortIndeces(channelIds);
    channelIds = reorder(channelIds, sortIndeces);
    const peerFroms = reorder([peers[0], peers[1], peers[0], null], sortIndeces);
    // prepare for intendSettle
    let payHashListInfos = [
      // 1 pair of simplex states
      getPayHashListInfo({ payAmounts: [[1, 2]] }),
      getPayHashListInfo({ payAmounts: [[3, 4]] }),
      // 1 non-null simplex state
      getPayHashListInfo({ payAmounts: [[1, 2]] }),
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
      signers: reorder([null, null, null, peers[0]], sortIndeces)
    });

    // resolve the payments in all head PayHashLists
    for (let i = 0; i < payHashListInfos.length; i++) {
      if (payHashListInfos[i] == null) continue;
      for (j = 0; j < payHashListInfos[i].payBytesArray[0].length; j++) {
        const requestBytes = getResolvePayByConditionsRequestBytes({
          condPayBytes: payHashListInfos[i].payBytesArray[0][j]
        });
        await payRegistry.resolvePaymentByConditions(requestBytes);
      }
    }

    // let resolve timeout but not pass the last pay resolve deadline
    let block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + 6, accounts[0]);

    // intend settle
    tx = await instance.intendSettle(signedSimplexStateArrayBytes);

    block = await web3.eth.getBlock('latest');
    const expectedSettleFinalizedTime = DISPUTE_TIMEOUT + block.number;
    for (let i = 0; i < uniqueChannelIds.length; i++) {
      const settleFinalizedTime = await instance.getSettleFinalizedTime(uniqueChannelIds[i]);
      assert.equal(expectedSettleFinalizedTime, settleFinalizedTime);

      const status = await instance.getChannelStatus(uniqueChannelIds[i]);
      assert.equal(status, 2);
    }

    let payHash;
    let logIndex = 0;
    // for each simplex state
    for (let i = 0; i < channelIds.length; i++) {
      if (payHashListInfos[i] != null) {
        // for each pays in head PayHashList
        for (j = 0; j < payHashListInfos[i].payBytesArray[0].length; j++) {
          assert.equal(tx.logs[logIndex].event, 'LiquidateOnePay');
          assert.equal(tx.logs[logIndex].args.channelId, channelIds[i]);
          payHash = sha3(web3.utils.bytesToHex(payHashListInfos[i].payBytesArray[0][j]));
          assert.equal(tx.logs[logIndex].args.condPayHash, payHash);
          assert.equal(tx.logs[logIndex].args.peerFrom, peerFroms[i]);
          assert.equal(tx.logs[logIndex].args.amount.toString(), payAmounts[i][j]);
          logIndex++;
        }
      }
      if (i == channelIds.length - 1 || channelIds[i] != channelIds[i + 1]) {
        assert.equal(tx.logs[logIndex].event, 'IntendSettle');
        assert.equal(tx.logs[logIndex].args.channelId, channelIds[i]);
        assert.equal(tx.logs[logIndex].args.seqNums.toString(), seqNumsArray[i]);
        logIndex++;
      }
    }
  });

  it('should confirmSettle correctly with multiple cross-channel simplex states', async () => {
    let settleFinalizedTime = 0;
    for (let i = 0; i < uniqueChannelIds.length; i++) {
      const tmp = await instance.getSettleFinalizedTime(uniqueChannelIds[i]);
      settleFinalizedTime = Math.max(settleFinalizedTime, tmp);
    }
    await mineBlockUntil(settleFinalizedTime, accounts[0]);

    const expectedSettleBalances = [[114, 186], [67, 233], [100, 200]];
    for (let i = 0; i < uniqueChannelIds.length; i++) {
      let tx = await instance.confirmSettle(uniqueChannelIds[i]);
      const status = await instance.getChannelStatus(uniqueChannelIds[i]);
      const { event, args } = tx.logs[0];

      assert.equal(event, 'ConfirmSettle');
      assert.equal(args.settleBalance.toString(), expectedSettleBalances[i]);
      assert.equal(status, 3);
    }
  });

  it('should fail to intendWithdraw more funds than withdraw limit', async () => {
    // open a new channel and deposit some funds
    const request = await getOpenChannelRequest({
      celerChannelAddress: instance.address,
      disputeTimeout: DISPUTE_TIMEOUT,
      zeroTotalDeposit: true,
      openDeadline: 100000010,  // make initializer hash different      
    });
    const openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);
    const tx = await instance.openChannel(openChannelRequest);
    channelId = tx.logs[0].args.channelId.toString();

    await instance.deposit(channelId, peers[0], 0, { value: 50 });
    await instance.deposit(channelId, peers[1], 0, { value: 150 });

    try {
      await instance.intendWithdraw(channelId, 200, 0, { from: peers[0] });
    } catch (error) {
      assert.isAbove(
        error.message.search('Exceed withdraw limit'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');

    // balances = [50, 150]
  });

  it('should snapshotStates correctly and then intendWithdraw and confirmWithdraw correctly', async () => {
    // snapshotStates()
    payHashListInfo = getPayHashListInfo({ payAmounts: [[1, 2]] });
    signedSimplexStateArrayBytes = await getSignedSimplexStateArrayBytes({
      channelIds: [channelId],
      seqNums: [5],
      transferAmounts: [100],
      lastPayResolveDeadlines: [9999999],
      payHashLists: [payHashListInfo.payHashListProtos[0]],
      peerFroms: [peers[1]]
    });

    let tx = await instance.snapshotStates(signedSimplexStateArrayBytes);
    fs.appendFileSync(GAS_USED_LOG, 'snapshotStates() with one non-null simplex state: ' + getCallGasUsed(tx) + '\n');

    const status = await instance.getChannelStatus(channelId);
    assert.equal(status, 1);
    assert.equal(tx.logs[0].event, 'SnapshotStates');
    assert.equal(tx.logs[0].args.channelId, channelId);
    assert.equal(tx.logs[0].args.seqNums.toString(), [0, 5]);

    // intendWithdraw()
    tx = await instance.intendWithdraw(channelId, 100, 0, { from: peers[0] });
    assert.equal(tx.logs[0].event, 'IntendWithdraw');
    assert.equal(tx.logs[0].args.channelId, channelId);
    assert.equal(tx.logs[0].args.receiver, peers[0]);
    assert.equal(tx.logs[0].args.amount.toString(), 100);

    // confirmWithdraw()
    const block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + DISPUTE_TIMEOUT, accounts[0]);

    tx = await instance.confirmWithdraw(channelId, { from: accounts[9] });
    assert.equal(tx.logs[0].event, 'ConfirmWithdraw');
    assert.equal(tx.logs[0].args.channelId, channelId);
    assert.equal(tx.logs[0].args.withdrawalAmounts.toString(), [50, 50]);
    assert.equal(tx.logs[0].args.receiver, peers[0]);
    assert.equal(tx.logs[0].args.recipientChannelId, 0);
    assert.equal(tx.logs[0].args.balances.toString(), [0, 100]);

    const owedDeposit = await instance.getOwedDepositAmount.call(channelId, peers[0]);
    assert.equal(owedDeposit.toString(), '50');
    const owedDepositMap = await instance.getOwedDepositMap.call(channelId);
    assert.equal(owedDepositMap[1].toString(), [50, 0]);

    // balances = [0, 100]
    // owedDeposit = [50, 0]
  });

  it('should fail to intendWithdraw more funds than updated withdraw limit', async () => {
    try {
      await instance.intendWithdraw(channelId, 100, 0, { from: peers[0] });
    } catch (error) {
      assert.isAbove(
        error.message.search('Exceed withdraw limit'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should intendWithdraw correctly for funds within the updated withdraw limit', async () => {
    tx = await instance.intendWithdraw(channelId, 50, 0, { from: peers[0] });
    assert.equal(tx.logs[0].event, 'IntendWithdraw');
    assert.equal(tx.logs[0].args.channelId, channelId);
    assert.equal(tx.logs[0].args.receiver, peers[0]);
    assert.equal(tx.logs[0].args.amount.toString(), 50);

    // clear current withdraw intent for future tests
    await instance.vetoWithdraw(channelId, { from: peers[1] });
  });

  it('should fail to intendSettle with a smaller seqNum than snapshot', async () => {
    const payHashListInfo = getPayHashListInfo({ payAmounts: [[2, 4]] });
    const signedSimplexStateArrayBytes = await getSignedSimplexStateArrayBytes({
      channelIds: [channelId],
      seqNums: [4],
      transferAmounts: [10],
      lastPayResolveDeadlines: [1],
      payHashLists: [payHashListInfo.payHashListProtos[0]],
      peerFroms: [peers[1]]
    });

    try {
      await instance.intendSettle(signedSimplexStateArrayBytes);
    } catch (error) {
      assert.isAbove(
        error.message.search('seqNum error'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should intendSettle correctly with a same seqNum as snapshot', async () => {
    // resolve the payments in head PayHashList
    for (let i = 0; i < payHashListInfo.payBytesArray[0].length; i++) {
      const requestBytes = getResolvePayByConditionsRequestBytes({
        condPayBytes: payHashListInfo.payBytesArray[0][i]
      });
      await payRegistry.resolvePaymentByConditions(requestBytes);
    }

    // let resolve timeout but not pass the last pay resolve deadline
    let block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + 6, accounts[0]);

    // intend settle
    tx = await instance.intendSettle(signedSimplexStateArrayBytes);

    block = await web3.eth.getBlock('latest');
    const settleFinalizedTime = await instance.getSettleFinalizedTime(channelId);
    const expectedSingleSettleFinalizedTime = DISPUTE_TIMEOUT + block.number;
    assert.equal(expectedSingleSettleFinalizedTime.toString(), settleFinalizedTime.toString());

    const status = await instance.getChannelStatus(channelId);
    assert.equal(status, 2);

    const amounts = [1, 2];
    for (let i = 0; i < 2; i++) {  // for each pays in head PayHashList
      assert.equal(tx.logs[i].event, 'LiquidateOnePay');
      assert.equal(tx.logs[i].args.channelId, channelId);
      const payHash = sha3(web3.utils.bytesToHex(payHashListInfo.payBytesArray[0][i]));
      assert.equal(tx.logs[i].args.condPayHash, payHash);
      assert.equal(tx.logs[i].args.peerFrom, peers[1]);
      assert.equal(tx.logs[i].args.amount, amounts[i]);
    }

    assert.equal(tx.logs[2].event, 'IntendSettle');
    assert.equal(tx.logs[2].args.channelId, channelId);
    assert.equal(tx.logs[2].args.seqNums.toString(), [0, 5]);
  });

  it('should fail to intendWithdraw after intendSettle', async () => {
    try {
      await instance.intendWithdraw(channelId, 50, 0, { from: peers[0] });
    } catch (error) {
      assert.isAbove(
        error.message.search('Channel status error'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should fail to cooperativeWithdraw after intendSettle', async () => {
    const cooperativeWithdrawRequestBytes = await getCooperativeWithdrawRequestBytes({
      channelId: channelId,
      amount: 50,
      seqNum: coWithdrawSeqNum
    });
    const cooperativeWithdrawRequest = web3.utils.bytesToHex(cooperativeWithdrawRequestBytes);

    try {
      await instance.cooperativeWithdraw(cooperativeWithdrawRequest);
    } catch (error) {
      assert.isAbove(
        error.message.search('Channel status error'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });
});

// get the original indeces of a sorted array
function getSortIndeces(toSort) {
  let tmp = [];
  for (let i = 0; i < toSort.length; i++) {
    tmp[i] = [toSort[i], i];
  }
  tmp.sort(function (left, right) {
    return BigInt(left[0]) < BigInt(right[0]) ? -1 : 1;
  });
  let sortIndices = [];
  for (let i = 0; i < tmp.length; i++) {
    sortIndices.push(tmp[i][1]);
  }
  return sortIndices;
}

function reorder(toOrder, sortIndeces) {
  let result = [];
  for (let i = 0; i < toOrder.length; i++) {
    result[i] = toOrder[sortIndeces[i]];
  }
  return result;
}