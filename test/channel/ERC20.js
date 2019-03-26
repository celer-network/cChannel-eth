// Only test ERC20 related cases. Other cases should be the same as ETH tests.

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
const ERC20ExampleToken = artifacts.require('ERC20ExampleToken');

const SETTLE_TIMEOUT = 20;

contract('CelerChannel using ERC20', async accounts => {
  const peers = getSortedArray([accounts[0], accounts[1]]);
  const clients = [accounts[8], accounts[9]];  // namely [src, dest]
  let instance;
  let channelId;
  let eRC20ExampleToken;

  let protoChainInstance;
  let getOpenChannelRequest;
  let getCooperativeWithdrawRequestBytes;
  let getSignedSimplexStateArrayBytes;
  let getCooperativeSettleRequestBytes;
  let getResolvePayByConditionsRequestBytes;
  let getPayHashListInfo;

  before(async () => {
    const resolver = await Resolver.new();
    eRC20ExampleToken = await ERC20ExampleToken.new();
    instance = await CelerChannel.new(
      accounts[9],  // no need for depositPool in an ERC20 channel, just put a random address
      resolver.address,
    );

    protoChainInstance = await protoChainFactory(peers, clients);
    getOpenChannelRequest = protoChainInstance.getOpenChannelRequest;
    getCooperativeWithdrawRequestBytes = protoChainInstance.getCooperativeWithdrawRequestBytes;
    getSignedSimplexStateArrayBytes = protoChainInstance.getSignedSimplexStateArrayBytes;
    getCooperativeSettleRequestBytes = protoChainInstance.getCooperativeSettleRequestBytes;
    getResolvePayByConditionsRequestBytes = protoChainInstance.getResolvePayByConditionsRequestBytes;
    getPayHashListInfo = protoChainInstance.getPayHashListInfo;

    // make sure both accounts have some tokens
    await eRC20ExampleToken.transfer(
      accounts[1],
      100000,
      {
        from: accounts[0]
      }
    );
  });

  it('should open a channel correctly when total deposit is zero', async () => {
    const request = await getOpenChannelRequest({
      CelerChannelAddress: instance.address,
      settleTimeout: SETTLE_TIMEOUT,
      zeroTotalDeposit: true,
      tokenType: 2,
      tokenAddress: eRC20ExampleToken.address
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
    assert.deepEqual(args.peers, peers);
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

  it('should deposit correctly', async () => {
    // approve first
    await eRC20ExampleToken.approve(
      instance.address,
      100,
      {
        from: peers[0]
      }
    );
    const tx = await instance.deposit(
      channelId,
      peers[0],
      100,
      {
        from: peers[0]
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

  it('should intendSettle correctly', async () => {
    globalResult = await prepareCoSignedIntendSettle(
      getPayHashListInfo,
      getSignedSimplexStateArrayBytes,
      [channelId, channelId]
    );
    const signedSimplexStateArrayBytes = globalResult.signedSimplexStateArrayBytes;
    // resolve the payments in head PayHashList
    for (peerIndex = 0; peerIndex < 2; ++peerIndex) {
      for (payIndex = 0; payIndex < globalResult.condPays[peerIndex][0].length; ++payIndex) {
        const requestBytes = getResolvePayByConditionsRequestBytes({
          condPayBytes: globalResult.condPays[peerIndex][0][payIndex]
        });
        await instance.resolvePaymentByConditions(requestBytes);
      }
    }

    // pass the resolve deadline but not the last pay resolve deadline
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
    for (i = 0; i < 2; i++) {  // for each simplex channel
      for (j = 0; j < globalResult.condPays[i][0].length; j++) {  // for each pays in PayHashList
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

  it('should liquidatePayment correctly', async () => {
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
    
    // pass the resolve deadline but not the last pay resolve deadline
    let block;
    block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + 6, accounts[0]);

    let tx;
    let payHash;
    const amounts = [[3, 4], [7, 8]];

    for (peerIndex = 0; peerIndex < 2; ++peerIndex) {  // for each simplex channel/peerFrom
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

  it('should confirmSettle correctly', async () => {
    await eRC20ExampleToken.approve(
      instance.address,
      100,
      {
        from: peers[1]
      }
    );
    await instance.deposit(
      channelId,
      peers[1],
      100,
      {
        from: peers[1]
      }
    );

    const settleFinalizedTime = await instance.getSettleFinalizedTime(channelId);
    await mineBlockUntil(settleFinalizedTime, accounts[0]);

    const tx = await instance.confirmSettle(channelId);
    const status = await instance.getChannelStatus(channelId);
    const { event, args } = tx.logs[0];

    assert.equal(event, 'ConfirmSettle');
    assert.equal(args.settleBalance.toString(), [126, 74]);
    assert.equal(status, 3);
  });

  it('should open a channel correctly when total deposit is larger than zero', async () => {
    await eRC20ExampleToken.approve(
      instance.address,
      100,
      {
        from: peers[0]
      }
    );
    await eRC20ExampleToken.approve(
      instance.address,
      200,
      {
        from: peers[1]
      }
    );

    const request = await getOpenChannelRequest({
      CelerChannelAddress: instance.address,
      settleTimeout: SETTLE_TIMEOUT,
      tokenAddress: eRC20ExampleToken.address,
      tokenType: 2  // '2' for ERC20
    });
    const openChannelRequest = web3.utils.bytesToHex(
      request.openChannelRequestBytes
    );

    const tx = await instance.openChannel(
      openChannelRequest,
      {
        from: peers[0]
      }
    );
    const { event, args } = tx.logs[0];
    channelId = args.channelId.toString();

    assert.equal(channelId, request.channelId);
    assert.equal(event, 'OpenChannel');
    assert.equal(args.tokenType, 2); //  2 for ERC20
    assert.equal(args.tokenAddress, eRC20ExampleToken.address);
    assert.deepEqual(args.peers, peers);
    assert.equal(args.balances.toString(), [100, 200]);
  });

  it('should cooperativeWithdraw correctly', async () => {
    const cooperativeWithdrawRequestBytes = await getCooperativeWithdrawRequestBytes({
      channelId: channelId,
      amount: 200
    });
    const cooperativeWithdrawRequest =
      web3.utils.bytesToHex(cooperativeWithdrawRequestBytes);

    const tx = await instance.cooperativeWithdraw(cooperativeWithdrawRequest);
    const { event, args } = tx.logs[0];

    assert.equal(event, 'CooperativeWithdraw');
    assert.equal(args.channelId, channelId);
    assert.equal(args.withdrawalAmounts.toString(), [100, 100]);
    assert.equal(args.receiver, peers[0]);
    assert.equal(args.balances.toString(), [0, 100]);
    assert.equal(args.seqNum, 1);
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

    const status = await instance.getChannelStatus(channelId);

    assert.equal(event, 'CooperativeSettle');
    assert.equal(args.channelId, channelId);
    assert.equal(args.settleBalance.toString(), [50, 50]);
    assert.equal(status, 3);
  });
});
