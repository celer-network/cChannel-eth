const Web3 = require('web3');
const web3 = new Web3(new Web3.providers.HttpProvider('http://localhost:8545'));
const sha3 = web3.utils.keccak256;

const protoChainFactory = require('../helper/protoChainFactory');

const fs = require('fs');

const regression = require('regression');

const utilities = require('../helper/utilities');
const {
  mineBlockUntil,
  getSortedArray,
  getCallGasUsed,
  getCoSignedIntendSettle,
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
const PayRegistry = artifacts.require('PayRegistry');
const PayResolver = artifacts.require('PayResolver');
const ERC20ExampleToken = artifacts.require('ERC20ExampleToken');

contract('Measure CelerChannel gas usage with fine granularity', async accounts => {
  const peers = getSortedArray([accounts[0], accounts[1]]);
  const clients = [accounts[8], accounts[9]];  // namely [src, dest]
  const DISPUTE_TIMEOUT = 999999999;
  const SNAPSHOT_STATES_LOG = 'gas_used_logs/fine_granularity/SnapshotStates.txt';
  const SETTLE_ONE_STATE_LOG = 'gas_used_logs/fine_granularity/IntendSettle-OneState.txt';
  const CLEAR_PAYS_LOG = 'gas_used_logs/fine_granularity/ClearPays.txt';
  const SETTLE_TWO_STATES_LOG = 'gas_used_logs/fine_granularity/IntendSettle-TwoStates.txt';
  const DEPOSIT_ETH_IN_BATCH_LOG = 'gas_used_logs/fine_granularity/DepositEthInBatch.txt';
  const DEPOSIT_ERC20_IN_BATCH_LOG = 'gas_used_logs/fine_granularity/DepositERC20InBatch.txt';

  // contract enforce ascending order of addresses
  let instance;
  let ethPool;
  let channelId;
  let payRegistry;
  let payResolver;
  let intendSettleSeqNum = 1;
  let uniqueOpenDeadline = 100000000;

  let protoChainInstance;
  let getOpenChannelRequest;
  let getSignedSimplexStateArrayBytes;
  let getResolvePayByConditionsRequestBytes;
  let getPayIdListInfo;

  // data points for linear regression
  let snapshotStatesDP = [];
  let settleOneStateDP = [];
  let clearPaysDP = [];
  let settleTwoStatesDP = [];
  let depositEthDP = [];
  let depositERC20DP = [];

  before(async () => {
    fs.writeFileSync(SNAPSHOT_STATES_LOG, '********** Gas Measurement of snapshotStates two states with multi pays **********\n\n');
    fs.appendFileSync(SNAPSHOT_STATES_LOG, 'pay number in head payIdList,\tused gas\n');

    fs.writeFileSync(SETTLE_ONE_STATE_LOG, '********** Gas Measurement of intendSettle() one state with multi pays **********\n\n');
    fs.appendFileSync(SETTLE_ONE_STATE_LOG, 'pay number in head payIdList,\tused gas\n');

    fs.writeFileSync(CLEAR_PAYS_LOG, '********** Gas Measurement of clearPays() multi pays **********\n\n');
    fs.appendFileSync(CLEAR_PAYS_LOG, 'pay number per following payIdList(i.e. except head payIdList),\tused gas\n');

    fs.writeFileSync(SETTLE_TWO_STATES_LOG, '********** Gas Measurement of intendSettle() two states with multi pays **********\n\n');
    fs.appendFileSync(SETTLE_TWO_STATES_LOG, 'pay number in head payIdList,\tused gas\n');

    fs.writeFileSync(DEPOSIT_ETH_IN_BATCH_LOG, '********** Gas Measurement of depositInBatch() **********\n\n');
    fs.appendFileSync(DEPOSIT_ETH_IN_BATCH_LOG, 'batch size,\tused gas\n');

    fs.writeFileSync(DEPOSIT_ERC20_IN_BATCH_LOG, '********** Gas Measurement of depositInBatch() **********\n\n');
    fs.appendFileSync(DEPOSIT_ERC20_IN_BATCH_LOG, 'batch size,\tused gas\n');

    const virtResolver = await VirtResolver.new();
    ethPool = await EthPool.new();
    payRegistry = await PayRegistry.new();
    payResolver = await PayResolver.new(payRegistry.address, virtResolver.address);
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

    protoChainInstance = await protoChainFactory(peers, clients);
    getOpenChannelRequest = protoChainInstance.getOpenChannelRequest;
    getSignedSimplexStateArrayBytes = protoChainInstance.getSignedSimplexStateArrayBytes;
    getResolvePayByConditionsRequestBytes = protoChainInstance.getResolvePayByConditionsRequestBytes;
    getPayIdListInfo = protoChainInstance.getPayIdListInfo;

    // open a new channel
    const request = await getOpenChannelRequest({
      CelerLedgerAddress: instance.address,
      openDeadline: uniqueOpenDeadline++,
      disputeTimeout: DISPUTE_TIMEOUT,
      zeroTotalDeposit: true
    });
    const openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);
    const tx = await instance.openChannel(openChannelRequest);
    const { event, args } = tx.logs[0];
    channelId = args.channelId.toString();
  });

  beforeEach(async () => {
    intendSettleSeqNum++
  });

  after(() => {
    // calculate linear regression and max payNumPerList
    const gasLimit = 8000000;  // current gas limit on mainnet

    let regressionResult = regression.linear(snapshotStatesDP);
    let gradient = regressionResult.equation[0];
    let yIntercept = regressionResult.equation[1];
    let maxPayNumPerList = Math.floor((gasLimit - yIntercept) / gradient);
    fs.appendFileSync(SNAPSHOT_STATES_LOG, '\nLinear regression result: gasUsed = ' + gradient.toString() + ' * payNumInHeadList + ' + yIntercept.toString() + '\n');
    fs.appendFileSync(SNAPSHOT_STATES_LOG, 'Max pay number in head payIdList is: ' + maxPayNumPerList.toString() + '\n');
    fs.appendFileSync(SNAPSHOT_STATES_LOG, 'Coefficient of determination (R^2) is: ' + regressionResult.r2.toString() + '\n');

    regressionResult = regression.linear(settleOneStateDP);
    gradient = regressionResult.equation[0];
    yIntercept = regressionResult.equation[1];
    maxPayNumPerList = Math.floor((gasLimit - yIntercept) / gradient);
    fs.appendFileSync(SETTLE_ONE_STATE_LOG, '\nLinear regression result: gasUsed = ' + gradient.toString() + ' * payNumInHeadList + ' + yIntercept.toString() + '\n');
    fs.appendFileSync(SETTLE_ONE_STATE_LOG, 'Max pay number in head payIdList is: ' + maxPayNumPerList.toString() + '\n');
    fs.appendFileSync(SETTLE_ONE_STATE_LOG, 'Coefficient of determination (R^2) is: ' + regressionResult.r2.toString() + '\n');

    regressionResult = regression.linear(clearPaysDP);
    gradient = regressionResult.equation[0];
    yIntercept = regressionResult.equation[1];
    maxPayNumPerList = Math.floor((gasLimit - yIntercept) / gradient);
    fs.appendFileSync(CLEAR_PAYS_LOG, '\nLinear regression result: gasUsed = ' + gradient.toString() + ' * payNumPerList + ' + yIntercept.toString() + '\n');
    fs.appendFileSync(CLEAR_PAYS_LOG, 'Max pay number per following payIdList (i.e. except head payIdList) is: ' + maxPayNumPerList.toString() + '\n');
    fs.appendFileSync(CLEAR_PAYS_LOG, 'Coefficient of determination (R^2) is: ' + regressionResult.r2.toString() + '\n');

    regressionResult = regression.linear(settleTwoStatesDP);
    gradient = regressionResult.equation[0];
    yIntercept = regressionResult.equation[1];
    maxPayNumPerList = Math.floor((gasLimit - yIntercept) / gradient);
    fs.appendFileSync(SETTLE_TWO_STATES_LOG, '\nLinear regression result: gasUsed = ' + gradient.toString() + ' * payNumInHeadList + ' + yIntercept.toString() + '\n');
    fs.appendFileSync(SETTLE_TWO_STATES_LOG, 'Max pay number in head payIdList is: ' + maxPayNumPerList.toString() + '\n');
    fs.appendFileSync(SETTLE_TWO_STATES_LOG, 'Coefficient of determination (R^2) is: ' + regressionResult.r2.toString() + '\n');

    regressionResult = regression.linear(depositEthDP);
    gradient = regressionResult.equation[0];
    yIntercept = regressionResult.equation[1];
    maxPayNumPerList = Math.floor((gasLimit - yIntercept) / gradient);
    fs.appendFileSync(DEPOSIT_ETH_IN_BATCH_LOG, '\nLinear regression result: gasUsed = ' + gradient.toString() + ' * batchSize + ' + yIntercept.toString() + '\n');
    fs.appendFileSync(DEPOSIT_ETH_IN_BATCH_LOG, 'Max batch size of deposit ETH in batch is: ' + maxPayNumPerList.toString() + '\n');
    fs.appendFileSync(DEPOSIT_ETH_IN_BATCH_LOG, 'Coefficient of determination (R^2) is: ' + regressionResult.r2.toString() + '\n');

    regressionResult = regression.linear(depositERC20DP);
    gradient = regressionResult.equation[0];
    yIntercept = regressionResult.equation[1];
    maxPayNumPerList = Math.floor((gasLimit - yIntercept) / gradient);
    fs.appendFileSync(DEPOSIT_ERC20_IN_BATCH_LOG, '\nLinear regression result: gasUsed = ' + gradient.toString() + ' * batchSize + ' + yIntercept.toString() + '\n');
    fs.appendFileSync(DEPOSIT_ERC20_IN_BATCH_LOG, 'Max batch size of deposit ERC20 in batch is: ' + maxPayNumPerList.toString() + '\n');
    fs.appendFileSync(DEPOSIT_ERC20_IN_BATCH_LOG, 'Coefficient of determination (R^2) is: ' + regressionResult.r2.toString() + '\n');
  });

  async function twoStatesSnapshotStates(payNumPerList) {
    let result;
    const payAmt = 10;

    it('measure snapshotStates two states with ' + payNumPerList.toString() + ' pays per state', async () => {
      const payListAmts = Array.apply(null, Array(payNumPerList)).map(function (x, i) { return payAmt; });
      result = await getCoSignedIntendSettle(
        getPayIdListInfo,
        getSignedSimplexStateArrayBytes,
        [channelId, channelId],
        [[payListAmts, [1, 2]], [payListAmts, [1, 2]]],  // only use head lists
        [intendSettleSeqNum, intendSettleSeqNum],
        [999999999, 999999999],  // lastPayResolveDeadlines
        [10, 10],  // transferAmounts
        payResolver.address  // payResolverAddr
      );

      let tx = await instance.snapshotStates(result.signedSimplexStateArrayBytes);
      const usedGas = getCallGasUsed(tx);
      snapshotStatesDP.push([payNumPerList, usedGas]);
      fs.appendFileSync(SNAPSHOT_STATES_LOG, payNumPerList.toString() + '\t' + usedGas + '\n');

      const status = await instance.getChannelStatus(channelId);
      assert.equal(status, 1);
      assert.equal(tx.logs[0].event, 'SnapshotStates');
      assert.equal(tx.logs[0].args.channelId, channelId);
      assert.equal(tx.logs[0].args.seqNums.toString(), [intendSettleSeqNum, intendSettleSeqNum]);
    });
  }

  async function oneStateIntendSettleAndClearPays(payNumPerList) {
    let result;
    const payAmt = 10;

    it('measure intendSettle a single state with ' + payNumPerList.toString() + ' pays', async () => {
      const peerIndex = 0;  // only one state associated with peer 0
      const payListAmts = Array.apply(null, Array(payNumPerList)).map(function (x, i) { return payAmt; });
      result = await getCoSignedIntendSettle(
        getPayIdListInfo,
        getSignedSimplexStateArrayBytes,
        [channelId],
        [[payListAmts, payListAmts]],
        [intendSettleSeqNum],
        [999999999],  // lastPayResolveDeadlines
        [10],  // transferAmounts
        payResolver.address  // payResolverAddr
      );

      const signedSimplexStateArrayBytes = result.signedSimplexStateArrayBytes;

      // resolve the payments in head PayIdList
      for (let payIndex = 0; payIndex < payNumPerList; payIndex++) {
        const requestBytes = getResolvePayByConditionsRequestBytes({
          condPayBytes: result.condPays[peerIndex][0][payIndex]
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
      const usedGas = getCallGasUsed(tx);
      settleOneStateDP.push([payNumPerList, usedGas]);
      fs.appendFileSync(SETTLE_ONE_STATE_LOG, payNumPerList.toString() + '\t' + usedGas + '\n');

      block = await web3.eth.getBlock('latest');
      const settleFinalizedTime = await instance.getSettleFinalizedTime(channelId);
      const expectedSettleFinalizedTime = DISPUTE_TIMEOUT + block.number;
      assert.equal(expectedSettleFinalizedTime, settleFinalizedTime);

      const status = await instance.getChannelStatus(channelId);
      assert.equal(status, 2);

      for (let payIndex = 0; payIndex < payNumPerList; payIndex++) {  // for each pays in head PayIdList
        assert.equal(tx.logs[payIndex].event, 'ClearOnePay');
        assert.equal(tx.logs[payIndex].args.channelId, channelId);
        const payHash = sha3(web3.utils.bytesToHex(result.condPays[peerIndex][0][payIndex]));
        const payId = calculatePayId(payHash, payResolver.address);
        assert.equal(tx.logs[payIndex].args.payId, payId);
        assert.equal(tx.logs[payIndex].args.peerFrom, peers[peerIndex]);
        assert.equal(tx.logs[payIndex].args.amount.toString(), payListAmts[payIndex]);
      }

      assert.equal(tx.logs[payNumPerList].event, 'IntendSettle');
      assert.equal(tx.logs[payNumPerList].args.channelId, channelId);
      assert.equal(tx.logs[payNumPerList].args.seqNums[0].toString(), intendSettleSeqNum.toString());
    });

    it('measure clearPays with ' + payNumPerList.toString() + ' pays', async () => {
      const peerIndex = 0;  // only one state associated with peer 0
      const listIndex = 1;  // only clear the next payIdList of head payIdList

      // resolve all remaining payments
      for (payIndex = 0; payIndex < result.condPays[peerIndex][listIndex].length; payIndex++) {
        const requestBytes = getResolvePayByConditionsRequestBytes({
          condPayBytes: result.condPays[peerIndex][listIndex][payIndex]
        });
        await payResolver.resolvePaymentByConditions(requestBytes);
      }


      // pass onchain resolve deadline of all onchain resolved pays
      // but not pass the last pay resolve deadline
      let block;
      block = await web3.eth.getBlock('latest');
      await mineBlockUntil(block.number + 6, accounts[0]);

      let payHash;
      let tx = await instance.clearPays(
        channelId,
        peers[peerIndex],
        result.payIdListBytesArrays[peerIndex][1]
      );

      for (payIndex = 0; payIndex < result.condPays[peerIndex][listIndex].length; payIndex++) {
        assert.equal(tx.logs[payIndex].event, 'ClearOnePay');
        assert.equal(tx.logs[payIndex].args.channelId, channelId);
        payHash = sha3(web3.utils.bytesToHex(
          result.condPays[peerIndex][listIndex][payIndex]
        ));
        const payId = calculatePayId(payHash, payResolver.address);
        assert.equal(tx.logs[payIndex].args.payId, payId);
        assert.equal(tx.logs[payIndex].args.peerFrom, peers[peerIndex]);
        assert.equal(tx.logs[payIndex].args.amount, payAmt);
      }

      const usedGas = getCallGasUsed(tx);
      clearPaysDP.push([payNumPerList, usedGas]);
      fs.appendFileSync(CLEAR_PAYS_LOG, payNumPerList.toString() + '\t' + usedGas + '\n');
    });
  }

  async function twoStatesIntendSettle(payNumPerList) {
    let result;
    const payAmt = 10;

    it('measure intendSettle two states with ' + payNumPerList.toString() + ' pays per state', async () => {
      const payListAmts = Array.apply(null, Array(payNumPerList)).map(function (x, i) { return payAmt; });
      result = await getCoSignedIntendSettle(
        getPayIdListInfo,
        getSignedSimplexStateArrayBytes,
        [channelId, channelId],
        [[payListAmts, [1, 2]], [payListAmts, [1, 2]]],  // only use head lists
        [intendSettleSeqNum, intendSettleSeqNum],
        [999999999, 999999999],  // lastPayResolveDeadlines
        [10, 10],  // transferAmounts
        payResolver.address  // payResolverAddr
      );

      const signedSimplexStateArrayBytes = result.signedSimplexStateArrayBytes;

      // resolve the payments in head PayIdList
      for (let peerIndex = 0; peerIndex < 2; peerIndex++) {
        for (let payIndex = 0; payIndex < payNumPerList; payIndex++) {
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
      const tx = await instance.intendSettle(signedSimplexStateArrayBytes);
      const usedGas = getCallGasUsed(tx);
      settleTwoStatesDP.push([payNumPerList, usedGas]);
      fs.appendFileSync(SETTLE_TWO_STATES_LOG, payNumPerList.toString() + '\t' + usedGas + '\n');

      block = await web3.eth.getBlock('latest');
      const settleFinalizedTime = await instance.getSettleFinalizedTime(channelId);
      const expectedSettleFinalizedTime = DISPUTE_TIMEOUT + block.number;
      assert.equal(expectedSettleFinalizedTime, settleFinalizedTime);

      const status = await instance.getChannelStatus(channelId);
      assert.equal(status, 2);

      let logIndex = 0;
      for (let peerIndex = 0; peerIndex < 2; peerIndex++) {
        for (let payIndex = 0; payIndex < payNumPerList; payIndex++) {  // for each pays in head PayIdList
          assert.equal(tx.logs[logIndex].event, 'ClearOnePay');
          assert.equal(tx.logs[logIndex].args.channelId, channelId);
          const payHash = sha3(web3.utils.bytesToHex(result.condPays[peerIndex][0][payIndex]));
          const payId = calculatePayId(payHash, payResolver.address);
          assert.equal(tx.logs[logIndex].args.payId, payId);
          assert.equal(tx.logs[logIndex].args.peerFrom, peers[peerIndex]);
          assert.equal(tx.logs[logIndex].args.amount.toString(), payListAmts[payIndex]);
          logIndex++;
        }
      }

      assert.equal(tx.logs[logIndex].event, 'IntendSettle');
      assert.equal(tx.logs[logIndex].args.channelId, channelId);
      assert.equal(tx.logs[logIndex].args.seqNums.toString(), [intendSettleSeqNum, intendSettleSeqNum]);
    });
  }

  async function depositInBatch(batchSize) {
    it('measure deposit ETH in batch with batch size of ' + batchSize.toString(), async () => {
      let request;
      let openChannelRequest;
      let tx;
      let channelIds = [];
      let receivers = [];
      let amounts = [];
      const depositAccount = accounts[9];
      const depositAmount = 1;

      // open Eth channels
      for (let i = 0; i < batchSize; i++) {
        request = await getOpenChannelRequest({
          openDeadline: uniqueOpenDeadline++,
          disputeTimeout: DISPUTE_TIMEOUT,
          zeroTotalDeposit: true,
          channelPeers: peers
        });
        openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);
        tx = await instance.openChannel(openChannelRequest);
        channelIds.push(tx.logs[0].args.channelId.toString());
        receivers.push(peers[0]);
        amounts.push(depositAmount);
      }

      // a non-peer address approve to ledger address
      await instance.disableBalanceLimits();
      await ethPool.deposit(depositAccount, { value: 100000 })
      await ethPool.approve(instance.address, 100000, { from: depositAccount });

      tx = await instance.depositInBatch(channelIds, receivers, amounts, { from: depositAccount });
      const usedGas = getCallGasUsed(tx);
      depositEthDP.push([batchSize, usedGas]);
      fs.appendFileSync(DEPOSIT_ETH_IN_BATCH_LOG, batchSize.toString() + '\t' + usedGas + '\n');

      for (let i = 0; i < batchSize; i++) {
        assert.equal(tx.logs[i].event, 'Deposit');
        assert.deepEqual(tx.logs[i].args.peerAddrs, peers);
        assert.equal(tx.logs[i].args.deposits.toString(), [1, 0]);
        assert.equal(tx.logs[i].args.withdrawals.toString(), [0, 0]);
      }
    });

    it('measure deposit ERC20 in batch with batch size of ' + batchSize.toString(), async () => {
      let request;
      let openChannelRequest;
      let tx;
      let channelIds = [];
      let receivers = [];
      let amounts = [];
      const depositAccount = accounts[9];
      const depositAmount = 1;
      const eRC20 = await ERC20ExampleToken.new();

      // open ERC20 channels
      for (let i = 0; i < batchSize; i++) {
        request = await getOpenChannelRequest({
          openDeadline: uniqueOpenDeadline++,
          disputeTimeout: DISPUTE_TIMEOUT,
          zeroTotalDeposit: true,
          tokenType: 2,
          tokenAddress: eRC20.address,
          channelPeers: peers
        });
        openChannelRequest = web3.utils.bytesToHex(request.openChannelRequestBytes);
        tx = await instance.openChannel(openChannelRequest);
        channelIds.push(tx.logs[0].args.channelId.toString());
        receivers.push(peers[0]);
        amounts.push(depositAmount);
      }

      // a non-peer address approve to ledger address
      await instance.disableBalanceLimits();
      await eRC20.transfer(depositAccount, 100000, { from: accounts[0] });
      await eRC20.approve(instance.address, 100000, { from: depositAccount });

      tx = await instance.depositInBatch(channelIds, receivers, amounts, { from: depositAccount });
      const usedGas = getCallGasUsed(tx);
      depositERC20DP.push([batchSize, usedGas]);
      fs.appendFileSync(DEPOSIT_ERC20_IN_BATCH_LOG, batchSize.toString() + '\t' + usedGas + '\n');

      for (let i = 0; i < batchSize; i++) {
        assert.equal(tx.logs[i].event, 'Deposit');
        assert.deepEqual(tx.logs[i].args.peerAddrs, peers);
        assert.equal(tx.logs[i].args.deposits.toString(), [1, 0]);
        assert.equal(tx.logs[i].args.withdrawals.toString(), [0, 0]);
      }
    });
  }

  // small measurement range
  const stepSmall = 10;
  const numSmall = 3;  // use 10 for fine granularity measurement
  const startSmall = 1;
  // large measurement range
  const stepLarge = 75;
  const numLarge = 0;  // use 5 for fine granularity measurement
  const startLarge = stepSmall * numSmall + startSmall;

  // Operable channel status
  for (let i = 0; i < numSmall; i++) {
    twoStatesSnapshotStates(i * stepSmall + startSmall);
  }
  for (let i = 0; i < numLarge; i++) {
    twoStatesSnapshotStates(i * stepLarge + startLarge);
  }

  // Settling channel status
  for (let i = 0; i < numSmall; i++) {
    oneStateIntendSettleAndClearPays(i * stepSmall + startSmall);
    twoStatesIntendSettle(i * stepSmall + startSmall);
  }
  for (let i = 0; i < numLarge; i++) {
    oneStateIntendSettleAndClearPays(i * stepLarge + startLarge);
    twoStatesIntendSettle(i * stepLarge + startLarge);
  }

  // depositInBatch
  const bound = 15;  // use 45 for fine granularity measurement
  for (let i = 1; i < bound; i += 10) {
    depositInBatch(i);
  }
});
