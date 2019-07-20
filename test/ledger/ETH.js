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
  getCallGasUsed,
  calculatePayId
} = utilities;

const LedgerStruct = artifacts.require('LedgerStruct');
const LedgerOperation = artifacts.require('LedgerOperation');
const LedgerBalanceLimit = artifacts.require('LedgerBalanceLimit');
const LedgerMigrate = artifacts.require('LedgerMigrate');
const LedgerChannel = artifacts.require('LedgerChannel');

const CelerWallet = artifacts.require('CelerWallet');
const CelerLedger = artifacts.require('CelerLedger');
const VirtResolver = artifacts.require('VirtContractResolver');
const EthPool = artifacts.require('EthPool');
const ERC20ExampleToken = artifacts.require('ERC20ExampleToken');
const PayRegistry = artifacts.require('PayRegistry');
const PayResolver = artifacts.require('PayResolver');

contract('CelerLedger using ETH', async accounts => {
  const ZERO_CHANNELID = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const ETH_ADDR = '0x0000000000000000000000000000000000000000';
  const ZERO_ADDR = ETH_ADDR;
  const DISPUTE_TIMEOUT = 20;
  const GAS_USED_LOG = 'gas_used_logs/CelerChannel-ETH.txt';
  // the meaning of the index: [peer index][pay hash list index][pay index]
  const PEERS_PAY_HASH_LISTS_AMTS = [[[1, 2], [3, 4]], [[5, 6], [7, 8]]];

  const peers = getSortedArray([accounts[0], accounts[1]]);
  const overlappedPeers = getSortedArray([peers[0], accounts[2]]);
  const differentPeers = getSortedArray([accounts[2], accounts[3]]);
  const clients = [accounts[8], accounts[9]];  // namely [src, dest]

  // contract enforce ascending order of addresses
  let instance;
  let celerWallet;
  let ethPool;
  let channelId;
  let payRegistry;
  let payResolver;
  let globalResult;
  let uniqueChannelIds = [];
  let coWithdrawSeqNum = 1;
  let uniqueOpenDeadline = 5000000;  // make hash of each channelInitializer unique

  let protoChainInstance;
  let getOpenChannelRequest;
  let getCooperativeWithdrawRequestBytes;
  let getSignedSimplexStateArrayBytes;
  let getCooperativeSettleRequestBytes;
  let getResolvePayByConditionsRequestBytes;
  let getPayIdListInfo;

  before(async () => {
    fs.writeFileSync(GAS_USED_LOG, '********** Gas Used in CelerLedger-ETH Tests **********\n\n');

    const virtResolver = await VirtResolver.new();
    ethPool = await EthPool.new();
    payRegistry = await PayRegistry.new()
    payResolver = await PayResolver.new(payRegistry.address, virtResolver.address)
    celerWallet = await CelerWallet.new();

    // deploy and link libraries
    const ledgerStuctLib = await LedgerStruct.new();

    await LedgerChannel.link("LedgerStruct", ledgerStuctLib.address);
    const ledgerChannel = await LedgerChannel.new();

    await LedgerBalanceLimit.link("LedgerStruct", ledgerStuctLib.address);
    const ledgerBalanceLimit = await LedgerBalanceLimit.new();

    await LedgerOperation.link("LedgerStruct", ledgerStuctLib.address);
    await LedgerOperation.link("LedgerChannel", ledgerChannel.address);
    const ledgerOperation = await LedgerOperation.new();

    await LedgerMigrate.link("LedgerStruct", ledgerStuctLib.address);
    await LedgerMigrate.link("LedgerOperation", ledgerOperation.address);
    await LedgerMigrate.link("LedgerChannel", ledgerChannel.address);
    const ledgerMigrate = await LedgerMigrate.new();

    await CelerLedger.link("LedgerStruct", ledgerStuctLib.address);
    await CelerLedger.link("LedgerOperation", ledgerOperation.address);
    await CelerLedger.link("LedgerBalanceLimit", ledgerBalanceLimit.address);
    await CelerLedger.link("LedgerMigrate", ledgerMigrate.address);
    await CelerLedger.link("LedgerChannel", ledgerChannel.address);
    instance = await CelerLedger.new(
      ethPool.address,
      payRegistry.address,
      celerWallet.address
    );

    fs.appendFileSync(GAS_USED_LOG, '***** Deploy Gas Used *****\n');
    let gasUsed = await getDeployGasUsed(virtResolver);
    fs.appendFileSync(GAS_USED_LOG, 'VirtContractResolver Deploy Gas: ' + gasUsed + '\n');
    gasUsed = await getDeployGasUsed(ethPool);
    fs.appendFileSync(GAS_USED_LOG, 'EthPool Deploy Gas: ' + gasUsed + '\n');
    gasUsed = await getDeployGasUsed(payRegistry);
    fs.appendFileSync(GAS_USED_LOG, 'PayRegistry Deploy Gas: ' + gasUsed + '\n');
    gasUsed = await getDeployGasUsed(payResolver);
    fs.appendFileSync(GAS_USED_LOG, 'PayResolver Deploy Gas: ' + gasUsed + '\n');
    gasUsed = await getDeployGasUsed(celerWallet);
    fs.appendFileSync(GAS_USED_LOG, 'CelerWallet Deploy Gas: ' + gasUsed + '\n');
    gasUsed = await getDeployGasUsed(instance);
    fs.appendFileSync(GAS_USED_LOG, 'CelerLedger Deploy Gas: ' + gasUsed + '\n\n');
    fs.appendFileSync(GAS_USED_LOG, '***** Function Calls Gas Used *****\n');

    protoChainInstance = await protoChainFactory(peers, clients);
    getOpenChannelRequest = protoChainInstance.getOpenChannelRequest;
    getCooperativeWithdrawRequestBytes = protoChainInstance.getCooperativeWithdrawRequestBytes;
    getSignedSimplexStateArrayBytes = protoChainInstance.getSignedSimplexStateArrayBytes;
    getCooperativeSettleRequestBytes = protoChainInstance.getCooperativeSettleRequestBytes;
    getResolvePayByConditionsRequestBytes = protoChainInstance.getResolvePayByConditionsRequestBytes;
    getPayIdListInfo = protoChainInstance.getPayIdListInfo;

    // make sure peers deposit enough ETH in ETH pool
    await ethPool.deposit(peers[0], { value: 1000000000 });
    await ethPool.deposit(peers[1], { value: 1000000000 });
  });

  it('should return Uninitialized status for an inexistent channel', async () => {
    const status = await instance.getChannelStatus(
      "0x0000000000000000000000000000000000000000000000000000000000000123"  // a random channelId
    );

    assert.equal(status, 0);
  });

  it('should fail to open a channel after openDeadline', async () => {
    const request = await getOpenChannelRequest({
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
      openDeadline: uniqueOpenDeadline++,
      disputeTimeout: DISPUTE_TIMEOUT
    });
    const openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);

    try {
      await instance.openChannel(openChannelRequest);
    } catch (error) {
      assert.isAbove(
        error.message.search('Balance exceeds limit'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should open a channel correctly when total deposit is zero', async () => {
    const request = await getOpenChannelRequest({
      openDeadline: uniqueOpenDeadline++,
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
    // TODO: calculate the channelId (by wallet info) and test again
    // assert.equal(channelId, request.channelId);
    assert.equal(args.tokenType, 1); //  1 for ETH
    assert.equal(args.tokenAddress, ETH_ADDR);
    assert.deepEqual(args.peerAddrs, peers);
    assert.equal(args.initialDeposits.toString(), [0, 0]);
    assert.equal(status, 1);
  });

  it('should fail to open a channel again with the same channel id', async () => {
    const request = await getOpenChannelRequest({
      openDeadline: uniqueOpenDeadline - 1,
      disputeTimeout: DISPUTE_TIMEOUT,
      zeroTotalDeposit: true
    });
    const openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);

    try {
      await instance.openChannel(openChannelRequest);
    } catch (error) {
      assert.isAbove(
        error.message.search('Occupied wallet id'),
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
      openDeadline: uniqueOpenDeadline++,
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
    // assert.equal(differentPeersChannelId, request.channelId);
    assert.equal(args.tokenType, 1); //  1 for ETH
    assert.equal(args.tokenAddress, ETH_ADDR);
    assert.deepEqual(args.peerAddrs, differentPeers);
    assert.equal(args.initialDeposits.toString(), [0, 0]);
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
        error.message.search('Balance exceeds limit'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should fail to set deposit limits if not owner', async () => {
    try {
      await instance.setBalanceLimits([ETH_ADDR], [1000000], { from: accounts[1] });
    } catch (error) {
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should set deposit limits correctly', async () => {
    const limit = 1000000;
    const tx = await instance.setBalanceLimits([ETH_ADDR], [limit], { from: accounts[0] });
    fs.appendFileSync(GAS_USED_LOG, 'setBalanceLimits(): ' + getCallGasUsed(tx) + '\n');

    const balanceLimit = await instance.getBalanceLimit.call(ETH_ADDR);
    assert.equal(limit.toString(), balanceLimit.toString());
  });

  it('should open a channel with funds correctly after setting deposit limit', async () => {
    await ethPool.approve(instance.address, 200, { from: peers[1] });

    const request = await getOpenChannelRequest({
      openDeadline: uniqueOpenDeadline++,
      disputeTimeout: DISPUTE_TIMEOUT
    });
    const openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);

    const tx = await instance.openChannel(openChannelRequest, { value: 100 });
    const { event, args } = tx.logs[0];
    channelIdTmp = args.channelId.toString();

    // assert.equal(channelIdTmp, request.channelId);
    assert.equal(event, 'OpenChannel');
    assert.equal(args.tokenType, 1); //  '1' for ETH
    assert.equal(args.tokenAddress, ETH_ADDR);
    assert.deepEqual(args.peerAddrs, peers);
    assert.equal(args.initialDeposits.toString(), [100, 200]);
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
    const balanceAmt = await instance.getTotalBalance(channelId);
    const balanceMap = await instance.getBalanceMap(channelId);
    const channelPeers = balanceMap[0];
    const deposits = balanceMap[1];
    const withdrawals = balanceMap[2];

    assert.equal(event, 'Deposit');
    assert.deepEqual(args.peerAddrs, peers);
    assert.equal(args.deposits.toString(), [50, 0]);
    assert.equal(args.withdrawals.toString(), [0, 0]);
    assert.equal(balanceAmt, 50);
    assert.deepEqual(channelPeers, peers);
    assert.equal(deposits.toString(), [50, 0]);
    assert.equal(withdrawals.toString(), [0, 0]);
  });

  it('should fail to deposit when the new deposit sum exceeds the deposit limit', async () => {
    await instance.setBalanceLimits([ETH_ADDR], [60], { from: accounts[0] });

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
      if (error.message.search('Balance exceeds limit') > -1) {
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
      if (error.message.search('Balance exceeds limit') > -1) {
        errorCounter++;
      }
    }

    assert.equal(errorCounter, 2);
  });

  it('should fail to disable all deposit limits if not owner', async () => {
    try {
      await instance.disableBalanceLimits({ from: accounts[1] });
    } catch (error) {
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should disable all deposit limits correctly', async () => {
    const tx = await instance.disableBalanceLimits({ from: accounts[0] });
    fs.appendFileSync(GAS_USED_LOG, 'disableBalanceLimits(): ' + getCallGasUsed(tx) + '\n');

    const balanceLimitsEnabled = await instance.getBalanceLimitsEnabled.call();
    assert.equal(balanceLimitsEnabled, false);
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
    const balanceAmt = await instance.getTotalBalance(channelId);
    const balanceMap = await instance.getBalanceMap(channelId);
    const channelPeers = balanceMap[0];
    const deposits = balanceMap[1];
    const withdrawals = balanceMap[2];

    assert.equal(event, 'Deposit');
    assert.deepEqual(args.peerAddrs, peers);
    assert.equal(args.deposits.toString(), [100, 0]);
    assert.equal(args.withdrawals.toString(), [0, 0]);
    assert.equal(balanceAmt, 100);
    assert.deepEqual(channelPeers, peers);
    assert.equal(deposits.toString(), [100, 0]);
    assert.equal(withdrawals.toString(), [0, 0]);
  });

  it('should fail to enable all deposit limits if not owner', async () => {
    try {
      await instance.enableBalanceLimits({ from: accounts[1] });
    } catch (error) {
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should enable all deposit limits correctly', async () => {
    const tx = await instance.enableBalanceLimits({ from: accounts[0] });
    fs.appendFileSync(GAS_USED_LOG, 'enableBalanceLimits(): ' + getCallGasUsed(tx) + '\n');

    const balanceLimitsEnabled = await instance.getBalanceLimitsEnabled.call();
    const limit = await instance.getBalanceLimit.call(ETH_ADDR);
    assert.equal(balanceLimitsEnabled, true);
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
        error.message.search('Balance exceeds limit'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should deposit via EthPool correctly', async () => {
    await instance.disableBalanceLimits({ from: accounts[0] });
    await ethPool.approve(instance.address, 100, { from: peers[0] });
    const tx = await instance.deposit(channelId, peers[0], 100, { from: peers[0] });
    fs.appendFileSync(GAS_USED_LOG, 'deposit() via EthPool: ' + getCallGasUsed(tx) + '\n');

    const { event, args } = tx.logs[0];
    const balanceAmt = await instance.getTotalBalance(channelId);
    const balanceMap = await instance.getBalanceMap(channelId);
    const channelPeers = balanceMap[0];
    const deposits = balanceMap[1];
    const withdrawals = balanceMap[2];

    assert.equal(event, 'Deposit');
    assert.deepEqual(args.peerAddrs, peers);
    assert.equal(args.deposits.toString(), [200, 0]);
    assert.equal(args.withdrawals.toString(), [0, 0]);
    assert.equal(balanceAmt, 200);
    assert.deepEqual(channelPeers, peers);
    assert.equal(deposits.toString(), [200, 0]);
    assert.equal(withdrawals.toString(), [0, 0]);
  });

  it('should intendWithdraw correctly', async () => {
    const tx = await instance.intendWithdraw(channelId, 200, ZERO_CHANNELID, { from: peers[0] });
    const { event, args } = tx.logs[0];
    fs.appendFileSync(GAS_USED_LOG, 'intendWithdraw(): ' + getCallGasUsed(tx) + '\n');

    assert.equal(event, 'IntendWithdraw');
    assert.equal(args.channelId, channelId);
    assert.equal(args.receiver, peers[0]);
    assert.equal(args.amount.toString(), 200);
  });

  it('should fail to intendWithdraw when there is a pending WithdrawIntent', async () => {
    try {
      await instance.intendWithdraw(channelId, 200, ZERO_CHANNELID, { from: peers[0] });
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
    const withdrawIntent = await instance.getWithdrawIntent(channelId);

    assert.equal(event, 'VetoWithdraw');
    assert.equal(args.channelId, channelId);
    assert.equal(withdrawIntent[0], ZERO_ADDR);
  });

  it('should fail to confirmWithdraw after vetoWithdraw', async () => {
    const block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + DISPUTE_TIMEOUT, accounts[0]);

    try {
      await instance.confirmWithdraw(channelId, { from: accounts[9] });
    } catch (error) {
      assert.isAbove(
        error.message.search('No pending withdraw intent'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should confirmWithdraw correctly', async () => {
    await instance.intendWithdraw(channelId, 200, ZERO_CHANNELID, { from: peers[0] });

    const block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + DISPUTE_TIMEOUT, accounts[0]);

    const tx = await instance.confirmWithdraw(channelId, { from: accounts[9] });
    const { event, args } = tx.logs[0];
    fs.appendFileSync(GAS_USED_LOG, 'confirmWithdraw(): ' + getCallGasUsed(tx) + '\n');

    assert.equal(event, 'ConfirmWithdraw');
    assert.equal(args.channelId, channelId);
    assert.equal(args.withdrawnAmount.toString(), 200);
    assert.equal(args.receiver, peers[0]);
    assert.equal(args.recipientChannelId, ZERO_CHANNELID);
    assert.equal(args.deposits.toString(), [200, 0]);
    assert.equal(args.withdrawals.toString(), [200, 0]);
  });

  it('should fail to confirmWithdraw again after confirmWithdraw', async () => {
    try {
      await instance.confirmWithdraw(channelId, { from: accounts[9] });
    } catch (error) {
      assert.isAbove(
        error.message.search('No pending withdraw intent'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should fail to intendWithdraw and confirmWithdraw from an ETH channel to an ERC20 channel', async () => {
    // deposit for this and following tests
    await instance.deposit(channelId, peers[0], 0, { value: 200 });

    const eRC20ExampleToken = await ERC20ExampleToken.new();
    const request = await getOpenChannelRequest({
      openDeadline: uniqueOpenDeadline++,
      disputeTimeout: DISPUTE_TIMEOUT,
      zeroTotalDeposit: true,
      tokenType: 2,
      tokenAddress: eRC20ExampleToken.address,
      channelPeers: peers
    });
    const openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);
    const tx = await instance.openChannel(openChannelRequest);
    eRC20ChannelId = tx.logs[0].args.channelId.toString();

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
  });

  it('should intendWithdraw and confirmWithdraw to another channel correctly', async () => {
    // open another channel with an overlapped peer
    const request = await getOpenChannelRequest({
      openDeadline: uniqueOpenDeadline++,
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
    assert.equal(tx.logs[0].args.withdrawnAmount.toString(), 200);
    assert.equal(tx.logs[0].args.receiver, peers[0]);
    assert.equal(tx.logs[0].args.recipientChannelId, overlappedPeersChannelId);
    assert.equal(tx.logs[0].args.deposits.toString(), [400, 0]);
    assert.equal(tx.logs[0].args.withdrawals.toString(), [400, 0]);

    let expectedDeposits;
    if (overlappedPeers[0] == peers[0]) {
      expectedDeposits = [200, 0];
    } else {
      expectedDeposits = [0, 200];
    }
    assert.equal(tx.logs[1].event, 'Deposit');
    assert.equal(tx.logs[1].args.channelId, overlappedPeersChannelId);
    assert.deepEqual(tx.logs[1].args.peerAddrs, overlappedPeers);
    assert.equal(tx.logs[1].args.deposits.toString(), expectedDeposits);
    assert.equal(tx.logs[1].args.withdrawals.toString(), [0, 0]);

    const balanceAmt = await instance.getTotalBalance(overlappedPeersChannelId);
    const balanceMap = await instance.getBalanceMap(overlappedPeersChannelId);
    const channelPeers = balanceMap[0];
    const deposits = balanceMap[1];
    const withdrawals = balanceMap[2];

    assert.equal(balanceAmt.toString(), 200);
    assert.deepEqual(channelPeers, overlappedPeers);
    assert.equal(deposits.toString(), expectedDeposits);
    assert.equal(withdrawals.toString(), [0, 0]);

    // deposit for future tests
    await instance.deposit(channelId, peers[0], 0, { value: 200 });
  });

  it('should fail to cooperativeWithdraw after withdraw deadline', async () => {
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
    assert.equal(args.withdrawnAmount.toString(), 200);
    assert.equal(args.receiver, peers[0]);
    assert.equal(args.recipientChannelId, ZERO_CHANNELID);
    assert.equal(args.deposits.toString(), [600, 0]);
    assert.equal(args.withdrawals.toString(), [600, 0]);
    assert.equal(args.seqNum, coWithdrawSeqNum - 1);
  });

  it('should fail to cooperativeWithdraw when using an unexpected seqNum', async () => {
    // deposit only used in this test
    await instance.deposit(channelId, peers[0], 0, { value: 10 });

    let cooperativeWithdrawRequestBytes;
    let cooperativeWithdrawRequest;
    let flag = false;

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
    assert.equal(args.withdrawnAmount.toString(), 10);
    assert.equal(args.receiver, peers[0]);
    assert.equal(args.recipientChannelId, ZERO_CHANNELID);
    assert.equal(args.deposits.toString(), [610, 0]);
    assert.equal(args.withdrawals.toString(), [610, 0]);
    assert.equal(args.seqNum, coWithdrawSeqNum - 1);
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
    const balanceAmt = await instance.getTotalBalance(channelId);
    const balanceMap = await instance.getBalanceMap(channelId);
    const channelPeers = balanceMap[0];
    const deposits = balanceMap[1];
    const withdrawals = balanceMap[2];

    assert.equal(event, 'CooperativeWithdraw');
    assert.equal(args.channelId, channelId);
    assert.equal(args.withdrawnAmount.toString(), 200);
    assert.equal(args.receiver, peers[0]);
    assert.equal(args.recipientChannelId, ZERO_CHANNELID);
    assert.equal(args.deposits.toString(), [770, 40]);
    assert.equal(args.withdrawals.toString(), [810, 0]);
    assert.equal(args.seqNum, coWithdrawSeqNum - 1);
    assert.equal(balanceAmt.toString(), 0);
    assert.deepEqual(channelPeers, peers);
    assert.equal(deposits.toString(), [770, 40]);
    assert.equal(withdrawals.toString(), [810, 0]);
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
    assert.equal(tx.logs[0].args.withdrawnAmount.toString(), 200);
    assert.equal(tx.logs[0].args.receiver, peers[0]);
    assert.equal(tx.logs[0].args.recipientChannelId, overlappedPeersChannelId);
    assert.equal(tx.logs[0].args.deposits.toString(), [970, 40]);
    assert.equal(tx.logs[0].args.withdrawals.toString(), [1010, 0]);
    assert.equal(tx.logs[0].args.seqNum, 4);

    let expectedDeposits;
    if (overlappedPeers[0] == peers[0]) {
      expectedDeposits = [400, 0];
    } else {
      expectedDeposits = [0, 400];
    }
    assert.equal(tx.logs[1].event, 'Deposit');
    assert.equal(tx.logs[1].args.channelId, overlappedPeersChannelId);
    assert.deepEqual(tx.logs[1].args.peerAddrs, overlappedPeers);
    assert.equal(tx.logs[1].args.deposits.toString(), expectedDeposits);
    assert.equal(tx.logs[1].args.withdrawals.toString(), [0, 0]);

    const balanceAmt = await instance.getTotalBalance(overlappedPeersChannelId);
    const balanceMap = await instance.getBalanceMap(overlappedPeersChannelId);
    const channelPeers = balanceMap[0];
    const deposits = balanceMap[1];
    const withdrawals = balanceMap[2];

    assert.equal(balanceAmt.toString(), 400);
    assert.deepEqual(channelPeers, overlappedPeers);
    assert.equal(deposits.toString(), expectedDeposits);
    assert.equal(withdrawals.toString(), [0, 0]);

    // deposit for future tests
    await instance.deposit(channelId, peers[0], 0, { value: 100 });
  });

  it('should fail to cooperativeWithdraw to another channel without such a receiver', async () => {
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
      assert.equal(args.withdrawnAmount.toString(), 100);

      return;
    }

    assert.fail('should have thrown before');
  });

  it('should fail to intendSettle when some pays in head list are not finalized before last pay resolve deadline', async () => {
    globalResult = await getCoSignedIntendSettle(
      getPayIdListInfo,
      getSignedSimplexStateArrayBytes,
      [channelId, channelId],
      PEERS_PAY_HASH_LISTS_AMTS,
      [1, 1],  // seqNums
      [999999999, 9999999999],  // lastPayResolveDeadlines
      [10, 20],  // transferAmounts
      payResolver.address  // payResolverAddr
    );
    const signedSimplexStateArrayBytes = globalResult.signedSimplexStateArrayBytes;

    // resolve only one payment
    const requestBytes = getResolvePayByConditionsRequestBytes({
      condPayBytes: globalResult.condPays[0][0][0]
    });
    await payResolver.resolvePaymentByConditions(requestBytes);

    // pass onchain resolve deadline of all onchain resolved pays
    // but not pass the last pay resolve deadline
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

    // resolve the payments in head PayIdList
    // the head list of peerFrom 0. Already resolved the first payment in last test case
    for (let i = 1; i < globalResult.condPays[0][0].length; i++) {
      const requestBytes = getResolvePayByConditionsRequestBytes({
        condPayBytes: globalResult.condPays[0][0][i]
      });
      await payResolver.resolvePaymentByConditions(requestBytes);
    }
    // the head list of peerFrom 1
    for (let i = 0; i < globalResult.condPays[1][0].length; i++) {
      const requestBytes = getResolvePayByConditionsRequestBytes({
        condPayBytes: globalResult.condPays[1][0][i]
      });
      await payResolver.resolvePaymentByConditions(requestBytes);
    }

    // pass onchain resolve deadline of all onchain resolved pays
    // but not pass the last pay resolve deadline
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

    const amounts = [1, 2, 5, 6];
    for (let i = 0; i < 2; i++) {  // for each simplex state
      for (j = 0; j < 2; j++) {  // for each pays in head PayIdList
        const logIndex = i * 2 + j;
        assert.equal(tx.logs[logIndex].event, 'ClearOnePay');
        assert.equal(tx.logs[logIndex].args.channelId, channelId);
        const payHash = sha3(web3.utils.bytesToHex(globalResult.condPays[i][0][j]));
        const payId = calculatePayId(payHash, payResolver.address);
        assert.equal(tx.logs[logIndex].args.payId, payId);
        assert.equal(tx.logs[logIndex].args.peerFrom, peers[i]);
        assert.equal(tx.logs[logIndex].args.amount.toString(), amounts[logIndex]);
      }
    }

    assert.equal(tx.logs[4].event, 'IntendSettle');
    assert.equal(tx.logs[4].args.channelId, channelId);
    assert.equal(tx.logs[4].args.seqNums.toString(), [1, 1]);

    const peersMigrationInfo = await instance.getPeersMigrationInfo(channelId);
    // updated transferOut map with cleared pays in the head PayIdList
    assert.equal(peersMigrationInfo[4].toString(), [10 + 1 + 2, 20 + 5 + 6]);
    // updated pendingPayOut map without cleared pays in the head PayIdList
    assert.equal(peersMigrationInfo[5].toString(), [3 + 4, 7 + 8]);
  });

  it('should fail to clearPays when payments are not finalized before last pay resolve deadline', async () => {
    try {
      await instance.clearPays(
        channelId,
        peers[0],
        globalResult.payIdListBytesArrays[0][1]
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

  it('should clearPays correctly when payments are finalized', async () => {
    // resolve all remaining payments
    for (peerIndex = 0; peerIndex < 2; peerIndex++) {
      for (listIndex = 1; listIndex < globalResult.condPays[peerIndex].length; listIndex++) {
        for (payIndex = 0; payIndex < globalResult.condPays[peerIndex][listIndex].length; payIndex++) {
          const requestBytes = getResolvePayByConditionsRequestBytes({
            condPayBytes: globalResult.condPays[peerIndex][listIndex][payIndex]
          });
          await payResolver.resolvePaymentByConditions(requestBytes);
        }
      }
    }

    // pass onchain resolve deadline of all onchain resolved pays
    // but not pass the last pay resolve deadline
    let block;
    block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + 6, accounts[0]);

    let tx;
    const amounts = [[3, 4], [7, 8]];

    for (peerIndex = 0; peerIndex < 2; peerIndex++) {  // for each simplex state
      tx = await instance.clearPays(
        channelId,
        peers[peerIndex],
        globalResult.payIdListBytesArrays[peerIndex][1]
      );
      let count = 0;
      for (listIndex = 1; listIndex < globalResult.condPays[peerIndex].length; listIndex++) {
        for (payIndex = 0; payIndex < globalResult.condPays[peerIndex][listIndex].length; payIndex++) {
          assert.equal(tx.logs[count].event, 'ClearOnePay');
          assert.equal(tx.logs[count].args.channelId, channelId);
          const payHash = sha3(web3.utils.bytesToHex(
            globalResult.condPays[peerIndex][listIndex][payIndex]
          ));
          const payId = calculatePayId(payHash, payResolver.address);
          assert.equal(tx.logs[count].args.payId, payId);
          assert.equal(tx.logs[count].args.peerFrom, peers[peerIndex]);
          assert.equal(tx.logs[count].args.amount, amounts[peerIndex][count]);
          count++;
        }
      }
    }
    fs.appendFileSync(GAS_USED_LOG, 'clearPays() with 2 payments: ' + getCallGasUsed(tx) + '\n');
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
    const settleFinalizedTime = await instance.getSettleFinalizedTime(channelId);
    await mineBlockUntil(settleFinalizedTime, accounts[0]);

    const tx = await instance.confirmSettle(channelId);
    const status = await instance.getChannelStatus(channelId);
    let balanceMap = await instance.getBalanceMap(channelId);
    let deposits = balanceMap[1];
    let withdrawals = balanceMap[2];

    assert.equal(tx.logs[0].event, 'ConfirmSettleFail');
    assert.equal(status, 1);
    assert.equal(deposits.toString(), [1070, 40]);
    assert.equal(withdrawals.toString(), [1110, 0]);

    //  update balances to [100, 100] to make future settle balance correct
    await instance.deposit(channelId, peers[0], 0, { value: 100 });
    await instance.deposit(channelId, peers[1], 0, { value: 100 });
    balanceMap = await instance.getBalanceMap(channelId);
    deposits = balanceMap[1];
    withdrawals = balanceMap[2];
    assert.equal(deposits.toString(), [1170, 140]);
    assert.equal(withdrawals.toString(), [1110, 0]);
  });

  it('should clearPays correctly after settleFinalizedTime', async () => {
    const signedSimplexStateArrayBytes = globalResult.signedSimplexStateArrayBytes;
    await instance.intendSettle(signedSimplexStateArrayBytes);

    // pass after settleFinalizedTime
    const settleFinalizedTime = await instance.getSettleFinalizedTime(channelId);
    await mineBlockUntil(settleFinalizedTime, accounts[0]);

    let tx;
    const amounts = [[3, 4], [7, 8]];

    for (peerIndex = 0; peerIndex < 2; peerIndex++) {  // for each simplex state
      tx = await instance.clearPays(
        channelId,
        peers[peerIndex],
        globalResult.payIdListBytesArrays[peerIndex][1]
      );
      let count = 0;
      for (listIndex = 1; listIndex < globalResult.condPays[peerIndex].length; listIndex++) {
        for (payIndex = 0; payIndex < globalResult.condPays[peerIndex][listIndex].length; payIndex++) {
          assert.equal(tx.logs[count].event, 'ClearOnePay');
          assert.equal(tx.logs[count].args.channelId, channelId);
          const payHash = sha3(web3.utils.bytesToHex(
            globalResult.condPays[peerIndex][listIndex][payIndex]
          ));
          const payId = calculatePayId(payHash, payResolver.address);
          assert.equal(tx.logs[count].args.payId, payId);
          assert.equal(tx.logs[count].args.peerFrom, peers[peerIndex]);
          assert.equal(tx.logs[count].args.amount, amounts[peerIndex][count]);
          count++;
        }
      }
    }
  });

  it('should fail to intendSettle after settleFinalizedTime', async () => {
    const result = await getCoSignedIntendSettle(
      getPayIdListInfo,
      getSignedSimplexStateArrayBytes,
      [channelId, channelId],
      PEERS_PAY_HASH_LISTS_AMTS,
      [5, 5],  // seqNums
      [999999999, 9999999999],  // lastPayResolveDeadlines
      [10, 20],  // transferAmounts
      payResolver.address  // payResolverAddr
    );
    const signedSimplexStateArrayBytes = result.signedSimplexStateArrayBytes;
    // resolve the payments in head PayIdList
    for (peerIndex = 0; peerIndex < 2; peerIndex++) {
      for (payIndex = 0; payIndex < result.condPays[peerIndex][0].length; payIndex++) {
        const requestBytes = getResolvePayByConditionsRequestBytes({
          condPayBytes: result.condPays[peerIndex][0][payIndex]
        });
        await payResolver.resolvePaymentByConditions(requestBytes);
      }
    }

    // pass onchain resolve deadline of all onchain resolved pays
    // but not pass the last pay resolve deadline
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
  });

  it('should confirmSettle correctly', async () => {
    let tx = await instance.confirmSettle(
      channelId,
      { from: accounts[2] }  // let peers not pay for gas
    );
    fs.appendFileSync(GAS_USED_LOG, 'confirmSettle(): ' + getCallGasUsed(tx) + '\n');
    const status = await instance.getChannelStatus(channelId);
    const { event, args } = tx.logs[0];

    assert.equal(event, 'ConfirmSettle');
    assert.equal(args.settleBalance.toString(), [86, 114]);
    assert.equal(status, 3);
  });

  it('should open a channel correctly when total deposit is larger than zero', async () => {
    await ethPool.approve(instance.address, 200, { from: peers[1] });

    const request = await getOpenChannelRequest({
      openDeadline: uniqueOpenDeadline++,
      disputeTimeout: DISPUTE_TIMEOUT
    });
    const openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);

    const tx = await instance.openChannel(openChannelRequest, { value: 100 });
    const { event, args } = tx.logs[0];
    fs.appendFileSync(GAS_USED_LOG, 'openChannel() using EthPool and msg.value: ' + getCallGasUsed(tx) + '\n');
    channelId = args.channelId.toString();

    // assert.equal(channelId, request.channelId);
    assert.equal(event, 'OpenChannel');
    assert.equal(args.tokenType, 1); //  '1' for ETH
    assert.equal(args.tokenAddress, ETH_ADDR);
    assert.deepEqual(args.peerAddrs, peers);
    assert.equal(args.initialDeposits.toString(), [100, 200]);
  });

  it('should open a channel correctly when total deposit is larger than zero, and msgValueReceiver is 1, and caller is not peers', async () => {
    await ethPool.approve(instance.address, 100, { from: peers[0] });

    const request = await getOpenChannelRequest({
      openDeadline: uniqueOpenDeadline++,
      disputeTimeout: DISPUTE_TIMEOUT,
      msgValueReceiver: 1
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

    // assert.equal(channelId, request.channelId);
    assert.equal(event, 'OpenChannel');
    assert.equal(args.tokenType, 1); //  '1' for ETH
    assert.equal(args.tokenAddress, ETH_ADDR);
    assert.deepEqual(args.peerAddrs, peers);
    assert.equal(args.initialDeposits.toString(), [100, 200]);
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
      openDeadline: uniqueOpenDeadline++,
      disputeTimeout: DISPUTE_TIMEOUT
    });
    const openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);
    let tx = await instance.openChannel(openChannelRequest, { value: 100 });
    channelId = tx.logs[0].args.channelId.toString();

    const result = await getCoSignedIntendSettle(
      getPayIdListInfo,
      getSignedSimplexStateArrayBytes,
      [channelId, channelId],
      PEERS_PAY_HASH_LISTS_AMTS,
      [1, 1],  // seqNums
      [2, 2],  // lastPayResolveDeadlines
      [10, 20],  // transferAmounts
      payResolver.address  // payResolverAddr
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

    for (let i = 0; i < 2; i++) {  // for each simplex state
      for (j = 0; j < 2; j++) {  // for each pays in head PayIdList
        const logIndex = i * 2 + j;
        assert.equal(tx.logs[logIndex].event, 'ClearOnePay');
        // assert.equal(tx.logs[logIndex].args.channelId, request.channelId);
        const payHash = sha3(web3.utils.bytesToHex(condPays[i][0][j]));
        const payId = calculatePayId(payHash, payResolver.address);
        assert.equal(tx.logs[logIndex].args.payId, payId);
        assert.equal(tx.logs[logIndex].args.peerFrom, peers[i]);
        assert.equal(tx.logs[logIndex].args.amount, 0);
      }
    }

    assert.equal(tx.logs[4].event, 'IntendSettle');
    assert.equal(tx.logs[4].args.channelId, channelId);
    assert.equal(tx.logs[4].args.seqNums.toString(), [1, 1]);

    const peersMigrationInfo = await instance.getPeersMigrationInfo(channelId);
    // updated transferOut map with cleared pays in the head PayIdList
    assert.equal(peersMigrationInfo[4].toString(), [10, 20]);
    // updated pendingPayOut map without cleared pays in the head PayIdList
    assert.equal(peersMigrationInfo[5].toString(), [1 + 2 + 3 + 4, 5 + 6 + 7 + 8]);
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
      openDeadline: uniqueOpenDeadline++,
      disputeTimeout: DISPUTE_TIMEOUT
    });
    const openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);
    let tx = await instance.openChannel(openChannelRequest, { value: 100 });
    channelId = tx.logs[0].args.channelId.toString();

    singleSignedNullStateBytes = await getSignedSimplexStateArrayBytes({
      channelIds: [channelId],
      seqNums: [0],
      signers: [peers[0]],
      totalPendingAmounts: [0]
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

    const peersMigrationInfo = await instance.getPeersMigrationInfo(channelId);
    // updated transferOut map with cleared pays in the head PayIdList
    assert.equal(peersMigrationInfo[4].toString(), [0, 0]);
    // updated pendingPayOut map without cleared pays in the head PayIdList
    assert.equal(peersMigrationInfo[5].toString(), [0, 0]);
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
      openDeadline: uniqueOpenDeadline++,
      disputeTimeout: DISPUTE_TIMEOUT
    });
    const openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);
    let tx = await instance.openChannel(openChannelRequest, { value: 100 });
    channelId = tx.logs[0].args.channelId.toString();

    const payIdListInfo = getPayIdListInfo({
      payAmounts: [[1, 2]],
      payResolverAddr: payResolver.address
    });
    const signedSimplexStateArrayBytes = await getSignedSimplexStateArrayBytes({
      channelIds: [channelId],
      seqNums: [5],
      lastPayResolveDeadlines: [999999],
      payIdLists: [payIdListInfo.payIdListProtos[0]],
      transferAmounts: [10],
      peerFroms: [peers[0]],
      totalPendingAmounts: [payIdListInfo.totalPendingAmount]
    });

    // resolve the payments in head PayIdList
    for (let i = 0; i < payIdListInfo.payBytesArray[0].length; i++) {
      const requestBytes = getResolvePayByConditionsRequestBytes({
        condPayBytes: payIdListInfo.payBytesArray[0][i]
      });
      await payResolver.resolvePaymentByConditions(requestBytes);
    }

    // pass onchain resolve deadline of all onchain resolved pays
    // but not pass the last pay resolve deadline
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
    for (let i = 0; i < 2; i++) {  // for each pays in head PayIdList
      assert.equal(tx.logs[i].event, 'ClearOnePay');
      assert.equal(tx.logs[i].args.channelId, channelId);
      const payHash = sha3(web3.utils.bytesToHex(payIdListInfo.payBytesArray[0][i]));
      const payId = calculatePayId(payHash, payResolver.address);
      assert.equal(tx.logs[i].args.payId, payId);
      assert.equal(tx.logs[i].args.peerFrom, peers[0]);
      assert.equal(tx.logs[i].args.amount, amounts[i]);
    }

    assert.equal(tx.logs[2].event, 'IntendSettle');
    assert.equal(tx.logs[2].args.channelId, channelId);
    assert.equal(tx.logs[2].args.seqNums.toString(), [5, 0]);

    const peersMigrationInfo = await instance.getPeersMigrationInfo(channelId);
    // updated transferOut map with cleared pays in the head PayIdList
    assert.equal(peersMigrationInfo[4].toString(), [10 + 1 + 2, 0]);
    // updated pendingPayOut map without cleared pays in the head PayIdList
    assert.equal(peersMigrationInfo[5].toString(), [0, 0]);
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
        openDeadline: uniqueOpenDeadline++,
        disputeTimeout: DISPUTE_TIMEOUT
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
    let payIdListInfos = [
      // 1 pair of simplex states
      getPayIdListInfo({ payAmounts: [[1, 2]], payResolverAddr: payResolver.address }),
      getPayIdListInfo({ payAmounts: [[3, 4]], payResolverAddr: payResolver.address }),
      // 1 non-null simplex state
      getPayIdListInfo({ payAmounts: [[1, 2]], payResolverAddr: payResolver.address }),
      // 1 null simplex state doesn't need payIdList, keep this as null
      null
    ];
    const payAmounts = reorder([[1, 2], [3, 4], [1, 2], [0, 0]], sortIndeces);
    payIdListInfos = reorder(payIdListInfos, sortIndeces);
    let payIdLists = [];
    for (let i = 0; i < 4; i++) {
      if (payIdListInfos[i] == null) {
        payIdLists[i] = null;
      } else {
        payIdLists[i] = payIdListInfos[i].payIdListProtos[0];
      }
    }
    const seqNums = reorder([1, 1, 5, 0], sortIndeces);
    const seqNumsArray = reorder([[1, 1], [1, 1], [5, 0], [0, 0]], sortIndeces);

    const signedSimplexStateArrayBytes = await getSignedSimplexStateArrayBytes({
      channelIds: channelIds,
      seqNums: seqNums,
      transferAmounts: reorder([10, 20, 30, null], sortIndeces),
      lastPayResolveDeadlines: reorder([999999, 999999, 999999, null], sortIndeces),
      payIdLists: payIdLists,
      peerFroms: peerFroms,
      signers: reorder([null, null, null, peers[0]], sortIndeces),
      totalPendingAmounts: [
        payAmounts[0][0] + payAmounts[0][1],
        payAmounts[1][0] + payAmounts[1][1],
        payAmounts[2][0] + payAmounts[2][1],
        payAmounts[3][0] + payAmounts[3][1]
      ]
    });

    // resolve the payments in all head PayIdLists
    for (let i = 0; i < payIdListInfos.length; i++) {
      if (payIdListInfos[i] == null) continue;
      for (j = 0; j < payIdListInfos[i].payBytesArray[0].length; j++) {
        const requestBytes = getResolvePayByConditionsRequestBytes({
          condPayBytes: payIdListInfos[i].payBytesArray[0][j]
        });
        await payResolver.resolvePaymentByConditions(requestBytes);
      }
    }

    // pass onchain resolve deadline of all onchain resolved pays
    // but not pass the last pay resolve deadline
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

    let logIndex = 0;
    // for each simplex state
    for (let i = 0; i < channelIds.length; i++) {
      if (payIdListInfos[i] != null) {
        // for each pays in head PayIdList
        for (j = 0; j < payIdListInfos[i].payBytesArray[0].length; j++) {
          assert.equal(tx.logs[logIndex].event, 'ClearOnePay');
          assert.equal(tx.logs[logIndex].args.channelId, channelIds[i]);
          const payHash = sha3(web3.utils.bytesToHex(payIdListInfos[i].payBytesArray[0][j]));
          const payId = calculatePayId(payHash, payResolver.address);
          assert.equal(tx.logs[logIndex].args.payId, payId);
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

  it('should fail to confirmWithdraw more funds than withdraw limit', async () => {
    // open a new channel and deposit some funds
    const request = await getOpenChannelRequest({
      openDeadline: uniqueOpenDeadline++,
      disputeTimeout: DISPUTE_TIMEOUT,
      zeroTotalDeposit: true
    });
    const openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);
    const tx = await instance.openChannel(openChannelRequest);
    channelId = tx.logs[0].args.channelId.toString();

    await instance.deposit(channelId, peers[0], 0, { value: 50 });
    await instance.deposit(channelId, peers[1], 0, { value: 150 });

    await instance.intendWithdraw(channelId, 200, ZERO_CHANNELID, { from: peers[0] });
    const block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + DISPUTE_TIMEOUT, accounts[0]);

    try {
      await instance.confirmWithdraw(channelId, { from: peers[0] });
    } catch (error) {
      assert.isAbove(
        error.message.search('Exceed withdraw limit'),
        -1
      );

      // veto the withdraw intent of this test for future tests
      await instance.vetoWithdraw(channelId, { from: peers[0] });
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should snapshotStates correctly and then intendWithdraw and confirmWithdraw correctly', async () => {
    // snapshotStates()
    payIdListInfo = getPayIdListInfo({
      payAmounts: [[1, 2]],
      payResolverAddr: payResolver.address
    });
    signedSimplexStateArrayBytes = await getSignedSimplexStateArrayBytes({
      channelIds: [channelId],
      seqNums: [5],
      transferAmounts: [100],
      lastPayResolveDeadlines: [9999999],
      payIdLists: [payIdListInfo.payIdListProtos[0]],
      peerFroms: [peers[1]],
      totalPendingAmounts: [payIdListInfo.totalPendingAmount]
    });

    let tx = await instance.snapshotStates(signedSimplexStateArrayBytes);
    fs.appendFileSync(GAS_USED_LOG, 'snapshotStates() with one non-null simplex state: ' + getCallGasUsed(tx) + '\n');

    const status = await instance.getChannelStatus(channelId);
    assert.equal(status, 1);
    assert.equal(tx.logs[0].event, 'SnapshotStates');
    assert.equal(tx.logs[0].args.channelId, channelId);
    assert.equal(tx.logs[0].args.seqNums.toString(), [0, 5]);

    // intendWithdraw()
    tx = await instance.intendWithdraw(channelId, 100, ZERO_CHANNELID, { from: peers[0] });
    assert.equal(tx.logs[0].event, 'IntendWithdraw');
    assert.equal(tx.logs[0].args.channelId, channelId);
    assert.equal(tx.logs[0].args.receiver, peers[0]);
    assert.equal(tx.logs[0].args.amount.toString(), 100);

    // confirmWithdraw()
    const block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + DISPUTE_TIMEOUT, accounts[0]);

    tx = await instance.confirmWithdraw(channelId, { from: accounts[9] });
    const balanceAmt = await instance.getTotalBalance(channelId);
    const balanceMap = await instance.getBalanceMap(channelId);
    const channelPeers = balanceMap[0];
    const deposits = balanceMap[1];
    const withdrawals = balanceMap[2];

    assert.equal(tx.logs[0].event, 'ConfirmWithdraw');
    assert.equal(tx.logs[0].args.channelId, channelId);
    assert.equal(tx.logs[0].args.withdrawnAmount.toString(), 100);
    assert.equal(tx.logs[0].args.receiver, peers[0]);
    assert.equal(tx.logs[0].args.recipientChannelId, ZERO_CHANNELID);
    assert.equal(tx.logs[0].args.deposits.toString(), [50, 150]);
    assert.equal(tx.logs[0].args.withdrawals.toString(), [100, 0]);
    assert.equal(balanceAmt.toString(), 100);
    assert.deepEqual(channelPeers, peers);
    assert.equal(deposits.toString(), [50, 150]);
    assert.equal(withdrawals.toString(), [100, 0]);
  });

  it('should fail to confirmWithdraw more funds than updated withdraw limit', async () => {
    await instance.intendWithdraw(channelId, 100, ZERO_CHANNELID, { from: peers[0] });
    const block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + DISPUTE_TIMEOUT, accounts[0]);

    try {
      await instance.confirmWithdraw(channelId, { from: peers[0] });
    } catch (error) {
      assert.isAbove(
        error.message.search('Exceed withdraw limit'),
        -1
      );

      // veto the withdraw intent of this test
      await instance.vetoWithdraw(channelId, { from: peers[0] });
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should confirmWithdraw correctly for funds within the updated withdraw limit', async () => {
    await instance.intendWithdraw(channelId, 50, ZERO_CHANNELID, { from: peers[0] });
    const block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + DISPUTE_TIMEOUT, accounts[0]);

    const tx = await instance.confirmWithdraw(channelId, { from: peers[0] });
    assert.equal(tx.logs[0].event, 'ConfirmWithdraw');
    assert.equal(tx.logs[0].args.channelId, channelId);
    assert.equal(tx.logs[0].args.withdrawnAmount.toString(), 50);
    assert.equal(tx.logs[0].args.receiver, peers[0]);
    assert.equal(tx.logs[0].args.recipientChannelId, ZERO_CHANNELID);
    assert.equal(tx.logs[0].args.deposits.toString(), [50, 150]);
    assert.equal(tx.logs[0].args.withdrawals.toString(), [150, 0]);
  });

  it('should fail to intendSettle with a smaller seqNum than snapshot', async () => {
    const payIdListInfo = getPayIdListInfo({
      payAmounts: [[2, 4]],
      payResolverAddr: payResolver.address
    });
    const localSignedSimplexStateArrayBytes = await getSignedSimplexStateArrayBytes({
      channelIds: [channelId],
      seqNums: [4],
      transferAmounts: [10],
      lastPayResolveDeadlines: [1],
      payIdLists: [payIdListInfo.payIdListProtos[0]],
      peerFroms: [peers[1]],
      totalPendingAmounts: [payIdListInfo.totalPendingAmount]
    });

    try {
      await instance.intendSettle(localSignedSimplexStateArrayBytes);
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
    // resolve the payments in head PayIdList
    for (let i = 0; i < payIdListInfo.payBytesArray[0].length; i++) {
      const requestBytes = getResolvePayByConditionsRequestBytes({
        condPayBytes: payIdListInfo.payBytesArray[0][i]
      });
      await payResolver.resolvePaymentByConditions(requestBytes);
    }

    // pass onchain resolve deadline of all onchain resolved pays
    // but not pass the last pay resolve deadline
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
    for (let i = 0; i < 2; i++) {  // for each pays in head PayIdList
      assert.equal(tx.logs[i].event, 'ClearOnePay');
      assert.equal(tx.logs[i].args.channelId, channelId);
      const payHash = sha3(web3.utils.bytesToHex(payIdListInfo.payBytesArray[0][i]));
      const payId = calculatePayId(payHash, payResolver.address);
      assert.equal(tx.logs[i].args.payId, payId);
      assert.equal(tx.logs[i].args.peerFrom, peers[1]);
      assert.equal(tx.logs[i].args.amount, amounts[i]);
    }

    assert.equal(tx.logs[2].event, 'IntendSettle');
    assert.equal(tx.logs[2].args.channelId, channelId);
    assert.equal(tx.logs[2].args.seqNums.toString(), [0, 5]);

    const peersMigrationInfo = await instance.getPeersMigrationInfo(channelId);
    // updated transferOut map with cleared pays in the head PayIdList
    assert.equal(peersMigrationInfo[4].toString(), [0, 100 + 1 + 2]);
    // updated pendingPayOut map without cleared pays in the head PayIdList
    assert.equal(peersMigrationInfo[5].toString(), [0, 0]);
  });

  it('should fail to intendWithdraw after intendSettle', async () => {
    try {
      await instance.intendWithdraw(channelId, 50, ZERO_CHANNELID, { from: peers[0] });
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

  it('should deposit in batch successfully', async () => {
    // deposit into two ETH channels and three ERC20 channels (two different ERC20 tokens) from a non-peer address
    let request;
    let openChannelRequest;
    let tx;
    let channelIds = [];
    const depositAccount = accounts[9];

    // open two ETH channels
    for (let i = 0; i < 2; i++) {
      request = await getOpenChannelRequest({
        openDeadline: uniqueOpenDeadline++,
        disputeTimeout: DISPUTE_TIMEOUT,
        zeroTotalDeposit: true,
        channelPeers: peers
      });
      openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);
      tx = await instance.openChannel(openChannelRequest);
      channelIds.push(tx.logs[0].args.channelId.toString());
    }
    // open two ERC20 channels with same ERC20 token
    const eRC20Token1 = await ERC20ExampleToken.new();
    for (let i = 0; i < 2; i++) {
      const request = await getOpenChannelRequest({
        openDeadline: uniqueOpenDeadline++,
        disputeTimeout: DISPUTE_TIMEOUT,
        zeroTotalDeposit: true,
        tokenType: 2,
        tokenAddress: eRC20Token1.address,
        channelPeers: peers
      });
      openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);
      tx = await instance.openChannel(openChannelRequest);
      channelIds.push(tx.logs[0].args.channelId.toString());
    }
    // open another ERC20 channels with a new ERC20 token
    const eRC20Token2 = await ERC20ExampleToken.new();
    request = await getOpenChannelRequest({
      openDeadline: uniqueOpenDeadline++,
      disputeTimeout: DISPUTE_TIMEOUT,
      zeroTotalDeposit: true,
      tokenType: 2,
      tokenAddress: eRC20Token2.address,
      channelPeers: peers
    });
    openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);
    tx = await instance.openChannel(openChannelRequest);
    channelIds.push(tx.logs[0].args.channelId.toString());

    // a non-peer address approve to ledger address
    await instance.disableBalanceLimits();
    await ethPool.deposit(depositAccount, { value: 100000 })
    await ethPool.approve(instance.address, 100000, { from: depositAccount });
    await eRC20Token1.transfer(depositAccount, 100000, { from: accounts[0] });
    await eRC20Token1.approve(instance.address, 100000, { from: depositAccount });
    await eRC20Token2.transfer(depositAccount, 100000, { from: accounts[0] });
    await eRC20Token2.approve(instance.address, 100000, { from: depositAccount });
    let receivers = [peers[0], peers[1], peers[0], peers[1], peers[0]];
    let amounts = [100, 200, 300, 400, 500];

    tx = await instance.depositInBatch(channelIds, receivers, amounts, { from: depositAccount });
    fs.appendFileSync(GAS_USED_LOG, 'depositInBatch() with 5 deposits: ' + getCallGasUsed(tx) + '\n');
    for (let i = 0; i < 5; i++) {
      assert.equal(tx.logs[i].event, 'Deposit');
      assert.deepEqual(tx.logs[i].args.peerAddrs, peers);
      let expectedDeposits;
      if (peers[0] == receivers[i]) {
        expectedDeposits = [amounts[i], 0];
      } else {
        expectedDeposits = [0, amounts[i]];
      }
      assert.equal(tx.logs[i].args.deposits.toString(), expectedDeposits);
      assert.equal(tx.logs[i].args.withdrawals.toString(), [0, 0]);
    }
  });

  it('should fail to confirmWithdraw after withdraw limit is updated by cooperativeWithdraw', async () => {
    // open a new channel and deposit some funds
    const request = await getOpenChannelRequest({
      openDeadline: uniqueOpenDeadline++,
      disputeTimeout: DISPUTE_TIMEOUT,
      zeroTotalDeposit: true
    });
    const openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);
    const tx = await instance.openChannel(openChannelRequest);
    channelId = tx.logs[0].args.channelId.toString();

    await instance.deposit(channelId, peers[0], 0, { value: 50 });
    await instance.deposit(channelId, peers[1], 0, { value: 150 });

    await instance.intendWithdraw(channelId, 45, ZERO_CHANNELID, { from: peers[0] });
    const block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + DISPUTE_TIMEOUT, accounts[0]);

    // cooperativeWithdraw 10 to peer 0
    const cooperativeWithdrawRequestBytes = await getCooperativeWithdrawRequestBytes({
      channelId: channelId,
      amount: 10
    });
    const cooperativeWithdrawRequest =
      web3.utils.bytesToHex(cooperativeWithdrawRequestBytes);
    await instance.cooperativeWithdraw(cooperativeWithdrawRequest);

    try {
      await instance.confirmWithdraw(channelId, { from: peers[0] });
    } catch (error) {
      assert.isAbove(
        error.message.search('Exceed withdraw limit'),
        -1
      );

      // veto the withdraw intent of this test for future tests
      await instance.vetoWithdraw(channelId, { from: peers[0] });
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should fail to confirmWithdraw after withdraw limit is updated by snapshotStates with its own state', async () => {
    // open a new channel and deposit some funds
    const request = await getOpenChannelRequest({
      openDeadline: uniqueOpenDeadline++,
      disputeTimeout: DISPUTE_TIMEOUT,
      zeroTotalDeposit: true
    });
    const openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);
    const tx = await instance.openChannel(openChannelRequest);
    channelId = tx.logs[0].args.channelId.toString();

    await instance.deposit(channelId, peers[0], 0, { value: 50 });
    await instance.deposit(channelId, peers[1], 0, { value: 150 });

    await instance.intendWithdraw(channelId, 35, ZERO_CHANNELID, { from: peers[0] });
    const block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + DISPUTE_TIMEOUT, accounts[0]);

    // snapshotStates: peer 0 transfers out 10; pending amount 10
    payIdListInfo = getPayIdListInfo({
      payAmounts: [[5, 5]],
      payResolverAddr: payResolver.address
    });
    signedSimplexStateArrayBytes = await getSignedSimplexStateArrayBytes({
      channelIds: [channelId],
      seqNums: [5],
      transferAmounts: [10],
      lastPayResolveDeadlines: [9999999],
      payIdLists: [payIdListInfo.payIdListProtos[0]],
      peerFroms: [peers[0]],
      totalPendingAmounts: [payIdListInfo.totalPendingAmount]
    });
    await instance.snapshotStates(signedSimplexStateArrayBytes);

    try {
      await instance.confirmWithdraw(channelId, { from: peers[0] });
    } catch (error) {
      assert.isAbove(
        error.message.search('Exceed withdraw limit'),
        -1
      );

      // veto the withdraw intent of this test for future tests
      await instance.vetoWithdraw(channelId, { from: peers[0] });
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should confirmWithdraw successfully after withdraw limit is updated by snapshotStates with peer\'s state', async () => {
    // open a new channel and deposit some funds
    const request = await getOpenChannelRequest({
      openDeadline: uniqueOpenDeadline++,
      disputeTimeout: DISPUTE_TIMEOUT,
      zeroTotalDeposit: true
    });
    const openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);
    let tx = await instance.openChannel(openChannelRequest);
    channelId = tx.logs[0].args.channelId.toString();

    await instance.deposit(channelId, peers[0], 0, { value: 50 });
    await instance.deposit(channelId, peers[1], 0, { value: 150 });

    await instance.intendWithdraw(channelId, 60, ZERO_CHANNELID, { from: peers[0] });
    const block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + DISPUTE_TIMEOUT, accounts[0]);

    // snapshotStates: peer 0 transfers out 10; pending amount 10
    payIdListInfo = getPayIdListInfo({
      payAmounts: [[1, 2]],
      payResolverAddr: payResolver.address
    });
    signedSimplexStateArrayBytes = await getSignedSimplexStateArrayBytes({
      channelIds: [channelId],
      seqNums: [5],
      transferAmounts: [10],
      lastPayResolveDeadlines: [9999999],
      payIdLists: [payIdListInfo.payIdListProtos[0]],
      peerFroms: [peers[1]],
      totalPendingAmounts: [payIdListInfo.totalPendingAmount]
    });
    await instance.snapshotStates(signedSimplexStateArrayBytes);

    tx = await instance.confirmWithdraw(channelId, { from: accounts[9] });
    const { event, args } = tx.logs[0];

    assert.equal(event, 'ConfirmWithdraw');
    assert.equal(args.channelId, channelId);
    assert.equal(args.withdrawnAmount.toString(), 60);
    assert.equal(args.receiver, peers[0]);
    assert.equal(args.recipientChannelId, ZERO_CHANNELID);
    assert.equal(args.deposits.toString(), [50, 150]);
    assert.equal(args.withdrawals.toString(), [60, 0]);
  });

  it('should fail to confirmWithdraw amount including peer\'s totalPendingAmount after withdraw limit is updated by snapshotStates with peer\'s state', async () => {
    // open a new channel and deposit some funds
    const request = await getOpenChannelRequest({
      openDeadline: uniqueOpenDeadline++,
      disputeTimeout: DISPUTE_TIMEOUT,
      zeroTotalDeposit: true
    });
    const openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);
    const tx = await instance.openChannel(openChannelRequest);
    channelId = tx.logs[0].args.channelId.toString();

    await instance.deposit(channelId, peers[0], 0, { value: 50 });
    await instance.deposit(channelId, peers[1], 0, { value: 150 });

    await instance.intendWithdraw(channelId, 65, ZERO_CHANNELID, { from: peers[0] });
    const block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + DISPUTE_TIMEOUT, accounts[0]);

    // snapshotStates: peer 0 transfers out 10; pending amount 10
    payIdListInfo = getPayIdListInfo({
      payAmounts: [[5, 5]],
      payResolverAddr: payResolver.address
    });
    signedSimplexStateArrayBytes = await getSignedSimplexStateArrayBytes({
      channelIds: [channelId],
      seqNums: [5],
      transferAmounts: [10],
      lastPayResolveDeadlines: [9999999],
      payIdLists: [payIdListInfo.payIdListProtos[0]],
      peerFroms: [peers[1]],
      totalPendingAmounts: [payIdListInfo.totalPendingAmount]
    });
    await instance.snapshotStates(signedSimplexStateArrayBytes);

    try {
      await instance.confirmWithdraw(channelId, { from: peers[0] });
    } catch (error) {
      assert.isAbove(
        error.message.search('Exceed withdraw limit'),
        -1
      );

      // veto the withdraw intent of this test for future tests
      await instance.vetoWithdraw(channelId, { from: peers[0] });
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should update the pendingPayOut to 0 correctly when intendSettle a state with only one pay id list', async () => {
    // open a new channel
    await ethPool.approve(instance.address, 200, { from: peers[1] });
    const request = await getOpenChannelRequest({
      openDeadline: uniqueOpenDeadline++,
      disputeTimeout: DISPUTE_TIMEOUT
    });
    const openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);
    let tx = await instance.openChannel(openChannelRequest, { value: 100 });
    channelId = tx.logs[0].args.channelId.toString();

    const payIdListInfo = getPayIdListInfo({
      payAmounts: [[1, 2]],
      payResolverAddr: payResolver.address,
      payConditions: [[false, false]]
    });
    const signedSimplexStateArrayBytes = await getSignedSimplexStateArrayBytes({
      channelIds: [channelId],
      seqNums: [5],
      lastPayResolveDeadlines: [999999],
      payIdLists: [payIdListInfo.payIdListProtos[0]],
      transferAmounts: [10],
      peerFroms: [peers[0]],
      totalPendingAmounts: [payIdListInfo.totalPendingAmount]
    });

    // resolve the payments in head PayIdList
    for (let i = 0; i < payIdListInfo.payBytesArray[0].length; i++) {
      const requestBytes = getResolvePayByConditionsRequestBytes({
        condPayBytes: payIdListInfo.payBytesArray[0][i]
      });
      await payResolver.resolvePaymentByConditions(requestBytes);
    }

    // pass onchain resolve deadline of all onchain resolved pays
    // but not pass the last pay resolve deadline
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

    for (let i = 0; i < 2; i++) {  // for each pays in head PayIdList
      assert.equal(tx.logs[i].event, 'ClearOnePay');
      assert.equal(tx.logs[i].args.channelId, channelId);
      const payHash = sha3(web3.utils.bytesToHex(payIdListInfo.payBytesArray[0][i]));
      const payId = calculatePayId(payHash, payResolver.address);
      assert.equal(tx.logs[i].args.payId, payId);
      assert.equal(tx.logs[i].args.peerFrom, peers[0]);
      assert.equal(tx.logs[i].args.amount, 0);
    }

    assert.equal(tx.logs[2].event, 'IntendSettle');
    assert.equal(tx.logs[2].args.channelId, channelId);
    assert.equal(tx.logs[2].args.seqNums.toString(), [5, 0]);

    const peersMigrationInfo = await instance.getPeersMigrationInfo(channelId);
    // updated transferOut map with cleared pays in the head PayIdList
    assert.equal(peersMigrationInfo[4].toString(), [10, 0]);
    // updated pendingPayOut map without cleared pays in the head PayIdList
    assert.equal(peersMigrationInfo[5].toString(), [0, 0]);
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
