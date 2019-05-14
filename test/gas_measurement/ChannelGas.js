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
  getCoSignedIntendSettle
} = utilities;

const CelerChannel = artifacts.require('CelerChannel');
const Resolver = artifacts.require('VirtContractResolver');
const EthPool = artifacts.require('EthPool');
const PayRegistry = artifacts.require('PayRegistry');

contract('Measure CelerChannel gas usage with fine granularity', async accounts => {
  const peers = getSortedArray([accounts[0], accounts[1]]);
  const clients = [accounts[8], accounts[9]];  // namely [src, dest]
  const DISPUTE_TIMEOUT = 999999999;
  const SNAPSHOT_STATES_LOG = 'gas_used_logs/fine_granularity/SnapshotStates.txt';
  const SETTLE_ONE_STATE_LOG = 'gas_used_logs/fine_granularity/IntendSettle-OneState.txt';
  const LIQUIDATE_PAYS_LOG = 'gas_used_logs/fine_granularity/LiquidatePays.txt';
  const SETTLE_TWO_STATES_LOG = 'gas_used_logs/fine_granularity/IntendSettle-TwoStates.txt';

  // contract enforce ascending order of addresses
  let instance;
  let ethPool;
  let channelId;
  let payRegistry;
  let intendSettleSeqNum = 1;

  let protoChainInstance;
  let getOpenChannelRequest;
  let getSignedSimplexStateArrayBytes;
  let getResolvePayByConditionsRequestBytes;
  let getPayHashListInfo;

  // data points for linear regression
  let snapshotStatesDP = [];
  let settleOneStateDP = [];
  let liquidatePaysDP = [];
  let settleTwoStatesDP = [];

  before(async () => {
    fs.writeFileSync(SNAPSHOT_STATES_LOG, '********** Gas Measurement of snapshotStates two states with multi pays **********\n\n');
    fs.appendFileSync(SNAPSHOT_STATES_LOG, 'pay number in head payHashList,\tused gas\n');

    fs.writeFileSync(SETTLE_ONE_STATE_LOG, '********** Gas Measurement of intendSettle() one state with multi pays **********\n\n');
    fs.appendFileSync(SETTLE_ONE_STATE_LOG, 'pay number in head payHashList,\tused gas\n');

    fs.writeFileSync(LIQUIDATE_PAYS_LOG, '********** Gas Measurement of liquidatePays() multi pays **********\n\n');
    fs.appendFileSync(LIQUIDATE_PAYS_LOG, 'pay number per following payHashList(i.e. except head payHashList),\tused gas\n');

    fs.writeFileSync(SETTLE_TWO_STATES_LOG, '********** Gas Measurement of intendSettle() two states with multi pays **********\n\n');
    fs.appendFileSync(SETTLE_TWO_STATES_LOG, 'pay number in head payHashList,\tused gas\n');

    const resolver = await Resolver.new();
    ethPool = await EthPool.new();
    payRegistry = await PayRegistry.new(resolver.address)
    instance = await CelerChannel.new(ethPool.address, payRegistry.address);

    protoChainInstance = await protoChainFactory(peers, clients);
    getOpenChannelRequest = protoChainInstance.getOpenChannelRequest;
    getCooperativeWithdrawRequestBytes = protoChainInstance.getCooperativeWithdrawRequestBytes;
    getSignedSimplexStateArrayBytes = protoChainInstance.getSignedSimplexStateArrayBytes;
    getCooperativeSettleRequestBytes = protoChainInstance.getCooperativeSettleRequestBytes;
    getResolvePayByConditionsRequestBytes = protoChainInstance.getResolvePayByConditionsRequestBytes;
    getPayHashListInfo = protoChainInstance.getPayHashListInfo;

    // open a new channel
    const request = await getOpenChannelRequest({
      celerChannelAddress: instance.address,
      openDeadline: 100000000,
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
    fs.appendFileSync(SNAPSHOT_STATES_LOG, 'Max pay number in head payHashList is: ' + maxPayNumPerList.toString() + '\n');
    fs.appendFileSync(SNAPSHOT_STATES_LOG, 'Coefficient of determination (R^2) is: ' + regressionResult.r2.toString() + '\n');

    regressionResult = regression.linear(settleOneStateDP);
    gradient = regressionResult.equation[0];
    yIntercept = regressionResult.equation[1];
    maxPayNumPerList = Math.floor((gasLimit - yIntercept) / gradient);
    fs.appendFileSync(SETTLE_ONE_STATE_LOG, '\nLinear regression result: gasUsed = ' + gradient.toString() + ' * payNumInHeadList + ' + yIntercept.toString() + '\n');
    fs.appendFileSync(SETTLE_ONE_STATE_LOG, 'Max pay number in head payHashList is: ' + maxPayNumPerList.toString() + '\n');
    fs.appendFileSync(SETTLE_ONE_STATE_LOG, 'Coefficient of determination (R^2) is: ' + regressionResult.r2.toString() + '\n');

    regressionResult = regression.linear(liquidatePaysDP);
    gradient = regressionResult.equation[0];
    yIntercept = regressionResult.equation[1];
    maxPayNumPerList = Math.floor((gasLimit - yIntercept) / gradient);
    fs.appendFileSync(LIQUIDATE_PAYS_LOG, '\nLinear regression result: gasUsed = ' + gradient.toString() + ' * payNumPerList + ' + yIntercept.toString() + '\n');
    fs.appendFileSync(LIQUIDATE_PAYS_LOG, 'Max pay number per following payHashList (i.e. except head payHashList) is: ' + maxPayNumPerList.toString() + '\n');
    fs.appendFileSync(LIQUIDATE_PAYS_LOG, 'Coefficient of determination (R^2) is: ' + regressionResult.r2.toString() + '\n');

    regressionResult = regression.linear(settleTwoStatesDP);
    gradient = regressionResult.equation[0];
    yIntercept = regressionResult.equation[1];
    maxPayNumPerList = Math.floor((gasLimit - yIntercept) / gradient);
    fs.appendFileSync(SETTLE_TWO_STATES_LOG, '\nLinear regression result: gasUsed = ' + gradient.toString() + ' * payNumInHeadList + ' + yIntercept.toString() + '\n');
    fs.appendFileSync(SETTLE_TWO_STATES_LOG, 'Max pay number in head payHashList is: ' + maxPayNumPerList.toString() + '\n');
    fs.appendFileSync(SETTLE_TWO_STATES_LOG, 'Coefficient of determination (R^2) is: ' + regressionResult.r2.toString() + '\n');
  });

  async function twoStatesSnapshotStates(payNumPerList) {
    let result;
    const payAmt = 10;

    it('measure snapshotStates two states with ' + payNumPerList.toString() + ' pays per state', async () => {
      const payListAmts = Array.apply(null, Array(payNumPerList)).map(function (x, i) { return payAmt; });
      result = await getCoSignedIntendSettle(
        getPayHashListInfo,
        getSignedSimplexStateArrayBytes,
        [channelId, channelId],
        [[payListAmts, [1, 2]], [payListAmts, [1, 2]]],  // only use head lists
        [intendSettleSeqNum, intendSettleSeqNum],
        [999999999, 999999999],  // lastPayResolveDeadlines
        [10, 10]  // transferAmounts
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

  async function oneStateIntendSettleAndLiquidatePays(payNumPerList) {
    let result;
    const payAmt = 10;

    it('measure intendSettle a single state with ' + payNumPerList.toString() + ' pays', async () => {
      const peerIndex = 0;  // only one state associated with peer 0
      const payListAmts = Array.apply(null, Array(payNumPerList)).map(function (x, i) { return payAmt; });
      result = await getCoSignedIntendSettle(
        getPayHashListInfo,
        getSignedSimplexStateArrayBytes,
        [channelId],
        [[payListAmts, payListAmts]],
        [intendSettleSeqNum],
        [999999999],  // lastPayResolveDeadlines
        [10]  // transferAmounts
      );

      const signedSimplexStateArrayBytes = result.signedSimplexStateArrayBytes;

      // resolve the payments in head PayHashList
      for (let payIndex = 0; payIndex < payNumPerList; payIndex++) {
        const requestBytes = getResolvePayByConditionsRequestBytes({
          condPayBytes: result.condPays[peerIndex][0][payIndex]
        });
        await payRegistry.resolvePaymentByConditions(requestBytes);
      }

      // let resolve timeout but not pass the last pay resolve deadline
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

      let payHash;
      for (let payIndex = 0; payIndex < payNumPerList; payIndex++) {  // for each pays in head PayHashList
        assert.equal(tx.logs[payIndex].event, 'LiquidateOnePay');
        assert.equal(tx.logs[payIndex].args.channelId, channelId);
        payHash = sha3(web3.utils.bytesToHex(result.condPays[peerIndex][0][payIndex]));
        assert.equal(tx.logs[payIndex].args.condPayHash, payHash);
        assert.equal(tx.logs[payIndex].args.peerFrom, peers[peerIndex]);
        assert.equal(tx.logs[payIndex].args.amount.toString(), payListAmts[payIndex]);
      }

      assert.equal(tx.logs[payNumPerList].event, 'IntendSettle');
      assert.equal(tx.logs[payNumPerList].args.channelId, channelId);
      assert.equal(tx.logs[payNumPerList].args.seqNums[0].toString(), intendSettleSeqNum.toString());
    });

    it('measure liquidatePays with ' + payNumPerList.toString() + ' pays', async () => {
      const peerIndex = 0;  // only one state associated with peer 0
      const listIndex = 1;  // only liquidate the next payHashList of head payHashList

      // resolve all remaining payments
      for (payIndex = 0; payIndex < result.condPays[peerIndex][listIndex].length; payIndex++) {
        const requestBytes = getResolvePayByConditionsRequestBytes({
          condPayBytes: result.condPays[peerIndex][listIndex][payIndex]
        });
        await payRegistry.resolvePaymentByConditions(requestBytes);
      }


      // let resolve timeout but not pass the last pay resolve deadline
      let block;
      block = await web3.eth.getBlock('latest');
      await mineBlockUntil(block.number + 6, accounts[0]);

      let payHash;
      let tx = await instance.liquidatePays(
        channelId,
        peers[peerIndex],
        result.payHashListBytesArrays[peerIndex][1]
      );

      for (payIndex = 0; payIndex < result.condPays[peerIndex][listIndex].length; payIndex++) {
        assert.equal(tx.logs[payIndex].event, 'LiquidateOnePay');
        assert.equal(tx.logs[payIndex].args.channelId, channelId);
        payHash = sha3(web3.utils.bytesToHex(
          result.condPays[peerIndex][listIndex][payIndex]
        ));
        assert.equal(tx.logs[payIndex].args.condPayHash, payHash);
        assert.equal(tx.logs[payIndex].args.peerFrom, peers[peerIndex]);
        assert.equal(tx.logs[payIndex].args.amount, payAmt);
      }

      const usedGas = getCallGasUsed(tx);
      liquidatePaysDP.push([payNumPerList, usedGas]);
      fs.appendFileSync(LIQUIDATE_PAYS_LOG, payNumPerList.toString() + '\t' + usedGas + '\n');
    });
  }

  async function twoStatesIntendSettle(payNumPerList) {
    let result;
    const payAmt = 10;

    it('measure intendSettle two states with ' + payNumPerList.toString() + ' pays per state', async () => {
      const payListAmts = Array.apply(null, Array(payNumPerList)).map(function (x, i) { return payAmt; });
      result = await getCoSignedIntendSettle(
        getPayHashListInfo,
        getSignedSimplexStateArrayBytes,
        [channelId, channelId],
        [[payListAmts, [1, 2]], [payListAmts, [1, 2]]],  // only use head lists
        [intendSettleSeqNum, intendSettleSeqNum],
        [999999999, 999999999],  // lastPayResolveDeadlines
        [10, 10]  // transferAmounts
      );

      const signedSimplexStateArrayBytes = result.signedSimplexStateArrayBytes;

      // resolve the payments in head PayHashList
      for (let peerIndex = 0; peerIndex < 2; peerIndex++) {
        for (let payIndex = 0; payIndex < payNumPerList; payIndex++) {
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

      let payHash;
      let logIndex = 0;
      for (let peerIndex = 0; peerIndex < 2; peerIndex++) {
        for (let payIndex = 0; payIndex < payNumPerList; payIndex++) {  // for each pays in head PayHashList
          assert.equal(tx.logs[logIndex].event, 'LiquidateOnePay');
          assert.equal(tx.logs[logIndex].args.channelId, channelId);
          payHash = sha3(web3.utils.bytesToHex(result.condPays[peerIndex][0][payIndex]));
          assert.equal(tx.logs[logIndex].args.condPayHash, payHash);
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

  // small measurement range
  const stepSmall = 10;
  const numSmall = 3;  // recommend 10 for finer granularity measurement
  const startSmall = 1;
  // large measurement range
  const stepLarge = 75;
  const numLarge = 2;  // recommend 5 for finer granularity measurement
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
    oneStateIntendSettleAndLiquidatePays(i * stepSmall + startSmall);
    twoStatesIntendSettle(i * stepSmall + startSmall);
  }
  for (let i = 0; i < numLarge; i++) {
    oneStateIntendSettleAndLiquidatePays(i * stepLarge + startLarge);
    twoStatesIntendSettle(i * stepLarge + startLarge);
  }
});