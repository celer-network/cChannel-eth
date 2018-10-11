const Web3 = require('web3');
const web3 = new Web3(new Web3.providers.HttpProvider('http://localhost:8545'));

const protoChainFactory = require('./helper/protoChainFactory');

const GenericConditionalChannel = artifacts.require(
  'GenericConditionalChannel'
);
const Resolver = artifacts.require('VirtContractResolver');
const DepositPool = artifacts.require('DepositPool');
const ERC20ExampleToken = artifacts.require('ERC20ExampleToken');

contract('GenericConditionalChannel', async accounts => {
  const peers = [accounts[0], accounts[1]];
  const settleTimeoutIncrement = 20;
  let instance;
  let depositPool;
  let protoChainInstance;
  let channelId;
  let eRC20ExampleToken;

  let getAllSignatureBytes;
  let getStateProofBytes;
  let getCooperativeWithdrawProofBytes;
  let getCooperativeStateProofBytes;
  let conditionGroupBytes;
  let authorizedWithdrawBytes;
  let authorizedWithdrawSignatureBytes;
  let getAuthorizedWithdrawBytes;

  before(async () => {
    const resolver = await Resolver.deployed();
    depositPool = await DepositPool.deployed();
    eRC20ExampleToken = await ERC20ExampleToken.deployed();
    instance = await GenericConditionalChannel.new(
      0,
      resolver.address,
      depositPool.address,
    );
    protoChainInstance = await protoChainFactory(peers, instance.address);
    getAllSignatureBytes = protoChainInstance.getAllSignatureBytes;
    getStateProofBytes = protoChainInstance.getStateProofBytes;
    getCooperativeWithdrawProofBytes = protoChainInstance.getCooperativeWithdrawProofBytes;
    getCooperativeStateProofBytes = protoChainInstance.getCooperativeStateProofBytes;
    conditionGroupBytes = protoChainInstance.conditionGroupBytes;
    authorizedWithdrawBytes = protoChainInstance.authorizedWithdrawBytes;
    authorizedWithdrawSignatureBytes = protoChainInstance.authorizedWithdrawSignatureBytes;
    getAuthorizedWithdrawBytes = protoChainInstance.getAuthorizedWithdrawBytes;
  });


  contract('GenericConditionalChannel using ETH', async () => {
    it('should return Uninitialized status for an inexistent channel', async () => {
      const status = await instance.getChannelStatus(1);

      assert.equal(status.toString(), '0');
    });

    it('should return correct channel information when openChannel', async () => {
      const withdrawalTimeout = [1, 1];
      const receipt = await instance.openChannel(
        peers,
        withdrawalTimeout,
        settleTimeoutIncrement,
        '0x0',
        0  // 0 for TokenType.ETH
      );

      const { event, args } = receipt.logs[0];
      channelId = args.channelId.toString();
      const status = await instance.getChannelStatus(channelId);

      assert.equal(event, 'OpenChannel');
      assert.equal(channelId, '1');
      assert.deepEqual(args.peers, peers);
      assert.equal(args.uintTokenType.toString(), '0'); //  '0' for ETH
      assert.equal(args.tokenContract, '0x0000000000000000000000000000000000000000');
      let amount;
      for (i = 0; i < peers.length; ++i) {
        amount = await instance.getDepositAmount(1, peers[i]);
        assert.equal(amount.toString(), '0');
      }
      assert.equal(status.toString(), '1');
    });

    it('should getTokenContract and getTokenType correctly', async () => {
      const tokenContract = await instance.getTokenContract.call(channelId);
      const tokenType = await instance.getTokenType.call(channelId);
      
      assert.equal(tokenContract, '0x0000000000000000000000000000000000000000');
      assert.equal(tokenType.toString(), '0'); //  '0' for ETH
    });

    it('should fail to cooperativeWithdraw (because of no deposit)', async () => {
      const withdrawProofBytes = getCooperativeWithdrawProofBytes({ channelId: channelId, amount: 100 });
      const allSignatureBytes = await getAllSignatureBytes({
        messageBytes: withdrawProofBytes
      });

      const withdrawProof = await web3.utils.bytesToHex(withdrawProofBytes);
      const multiSignature = await web3.utils.bytesToHex(allSignatureBytes);

      let err = null;

      try {
        await instance.cooperativeWithdraw(
          channelId,
          withdrawProof,
          multiSignature
        );
      } catch (error) {
        err = error;
      }
      assert.isOk(err instanceof Error);
    });

    it('should deposit correctly', async () => {
      const receipt = await instance.deposit(channelId, peers[0], {
        value: '100'
      });

      const { event, args } = receipt.logs[0];
      const amount = await instance.getDepositAmount(channelId, peers[0]);
      const depositMap = await instance.getDepositMap(channelId);
      const channelPeers = depositMap[0];
      const channelBalances = depositMap[1];
  
      assert.equal(event, 'Deposit');
      assert.deepEqual(args.peers, peers);
      assert.equal(args.amounts[0].toString(), '100');
      assert.equal(args.amounts[1].toString(), '0');
      assert.equal(amount.toString(), '100');
      assert.deepEqual(channelPeers, peers);
      assert.equal(channelBalances[0].toString(), '100');
      assert.equal(channelBalances[1].toString(), '0');
    });

    it('should cooperativeWithdraw correctly', async () => {  
      const withdrawProofBytes = getCooperativeWithdrawProofBytes({ channelId: channelId, amount: 100 });
      const allSignatureBytes = await getAllSignatureBytes({
        messageBytes: withdrawProofBytes
      });

      const withdrawProof = await web3.utils.bytesToHex(withdrawProofBytes);
      const multiSignature = await web3.utils.bytesToHex(allSignatureBytes);

      const receipt = await instance.cooperativeWithdraw(
        channelId,
        withdrawProof,
        multiSignature
      );
      const { event, args } = receipt.logs[0];

      assert.equal(event, 'CooperativeWithdraw');
      assert.equal(args.channelId.toString(), channelId);
      assert.equal(args.withdrawalAmount.toString(), '100');
      assert.equal(args.receiver, peers[0]);
      assert.equal(args.balance.toString(), '0');
    });
  
    it('should intendSettleStateProof correctly', async () => {
      const stateProofBytes = getStateProofBytes({ channelId: channelId });
      const stateProofSignatureBytes = await getAllSignatureBytes({
        messageBytes: stateProofBytes
      });
      const stateProof = await web3.utils.bytesToHex(stateProofBytes);
      const multiSignature = await web3.utils.bytesToHex(
        stateProofSignatureBytes
      );

      const receipt = await instance.intendSettleStateProof(
        channelId,
        stateProof,
        multiSignature
      );
      const {event, args} = receipt.logs[0];
      const status = await instance.getChannelStatus(channelId);
      const block = await web3.eth.getBlock("latest");
      const settleTime = await instance.getChannelSettleTime(channelId);
      const expectedSettleTime = Math.max(5, block.number) + settleTimeoutIncrement;

      assert.equal(event, 'IntendSettle');
      assert.equal(args.channelId.toString(), channelId.toString());
      assert.equal(args.stateProofNonce.toString(), '1');
      assert.equal(status.toString(), '2');
      assert.isOk(expectedSettleTime - settleTime <= 1);
    });
  
    it('should resolveConditionalStateTransition correctly', async () => {
      const conditionGroup = await web3.utils.bytesToHex(conditionGroupBytes);

      const receipt = await instance.resolveConditionalStateTransition(
        channelId,
        [],
        conditionGroup
      );
      const {event, args} = receipt.logs[0]

      assert.equal(event, 'ResolveCondGroup');
      assert.equal(args.channelId.toString(), channelId.toString());
      assert.equal(args.condGroupHash, web3.utils.keccak256(conditionGroup));
    });

    it('should fail to ConfirmSettle or ConfirmSettleFail (revert) due to not reaching settleTime', async () => {
      let err = null;

      try {
        await instance.confirmSettle(channelId);
      } catch (error) {
        err = error;
      }
      const block = await web3.eth.getBlock("latest");
      const settleTime = await instance.getChannelSettleTime(channelId);
      assert.isOk(block.number <= settleTime);
      assert.isOk(err instanceof Error);
    });

    it('should ConfirmSettleFail due to lack of deposit', async () => {
      const settleTime = await instance.getChannelSettleTime(channelId);
      let block = await web3.eth.getBlock("latest");
      while(block.number <= settleTime) {
        block = await web3.eth.getBlock("latest");
      }

      const receipt = await instance.confirmSettle(channelId);
      const status = await instance.getChannelStatus(channelId);

      assert.equal(receipt.logs[0].event, 'ConfirmSettleFail');
      assert.equal(status.toString(), '1');
    });

    it('should confirmSettle correctly', async () => {
      const depositReceipt = await instance.deposit(channelId, peers[0], {
        value: web3.utils.toWei('5', 'ether')
      });

      const { event, args } = depositReceipt.logs[0];

      assert.equal(event, 'Deposit');
      assert.deepEqual(args.peers, peers);
      assert.equal(args.amounts[0].toString(), '5000000000000000000');
      assert.equal(args.amounts[1].toString(), '0');

      const stateProofBytes = getStateProofBytes({ channelId: channelId, nonce: 2 });
      const stateProofSignatureBytes = await getAllSignatureBytes({
        messageBytes: stateProofBytes
      });
      const stateProof = await web3.utils.bytesToHex(stateProofBytes);
      const multiSignature = await web3.utils.bytesToHex(
        stateProofSignatureBytes
      );
      await instance.intendSettleStateProof(
        channelId,
        stateProof,
        multiSignature
      );

      const conditionGroup = await web3.utils.bytesToHex(conditionGroupBytes);
      await instance.resolveConditionalStateTransition(
        channelId,
        [],
        conditionGroup
      );

      const settleTime = await instance.getChannelSettleTime(channelId);
      let block = await web3.eth.getBlock("latest");
      while(block.number <= settleTime) {
        block = await web3.eth.getBlock("latest");
      }

      const confirmReceipt = await instance.confirmSettle(channelId);
      const status = await instance.getChannelStatus(channelId);

      assert.equal(confirmReceipt.logs[0].event, 'ConfirmSettle');
      assert.equal(status.toString(), '3');
    });

    it('should return correct channel information when authOpenChannel', async () => {
      await depositPool.deposit(
        peers[1],
        {
          from: peers[1],
          value: '200'
        }
      );

      const authorizedWithdraw = await web3.utils.bytesToHex(
        authorizedWithdrawBytes
      );
      const allSignatures = await web3.utils.bytesToHex(
        authorizedWithdrawSignatureBytes
      );

      const receipt = await instance.authOpenChannel(
        authorizedWithdraw,
        allSignatures,
        {
          from: peers[0],
          value: '100'
        }
      );
      const eventZero = receipt.logs[0].event;
      const argsZero = receipt.logs[0].args;
      const eventOne = receipt.logs[1].event;
      const argsOne = receipt.logs[1].args;
      const eventTwo = receipt.logs[2].event;
      const argsTwo = receipt.logs[2].args;

      channelId = argsZero.channelId.toString();
      const status = await instance.getChannelStatus(channelId);

      assert.equal(channelId, '2');
      assert.equal(eventZero, 'OpenChannel');
      assert.deepEqual(argsZero.peers, peers);
      assert.equal(argsZero.uintTokenType.toString(), '0'); //  '0' for ETH
      assert.equal(argsZero.tokenContract, '0x0000000000000000000000000000000000000000');

      assert.equal(eventOne, 'Deposit');
      assert.equal(argsOne.channelId.toString(), channelId);
      assert.deepEqual(argsOne.peers, peers);
      assert.equal(argsOne.amounts[0].toString(), '100');
      assert.equal(argsOne.amounts[1].toString(), '0');
      
      assert.equal(eventTwo, 'Deposit');
      assert.equal(argsTwo.channelId.toString(), channelId);
      assert.deepEqual(argsTwo.peers, peers);
      assert.equal(argsTwo.amounts[0].toString(), '0');
      assert.equal(argsTwo.amounts[1].toString(), '200');
    });

    it('should CooperativeSettleFail', async () => {
      let receipt;
      let stateProof;
      let multiSignature;
      let stateProofBytes;
      let stateProofSignatureBytes;

      // it should return correct channelId when openChannel
      const withdrawalTimeout = [1, 1];
      receipt = await instance.openChannel(
        peers,
        withdrawalTimeout,
        settleTimeoutIncrement,
        '0x0',
        0  // 0 for TokenType.ETH
      );
  
      const { event, args } = receipt.logs[0];
      channelId = args.channelId.toString();
  
      assert.equal(event, 'OpenChannel');
      assert.equal(channelId, '3');
      assert.deepEqual(args.peers, peers);
      assert.equal(args.uintTokenType.toString(), '0'); //  '0' for ETH
      assert.equal(args.tokenContract, '0x0000000000000000000000000000000000000000');

      // it should intendSettleStateProof correctly
      stateProofBytes = getStateProofBytes({ channelId: channelId });
      stateProofSignatureBytes = await getAllSignatureBytes({
        messageBytes: stateProofBytes
      });
      stateProof = await web3.utils.bytesToHex(stateProofBytes);
      multiSignature = await web3.utils.bytesToHex(
        stateProofSignatureBytes
      );
  
      receipt = await instance.intendSettleStateProof(
        channelId,
        stateProof,
        multiSignature
      );

      assert.equal(receipt.logs[0].event, 'IntendSettle');
      assert.equal(receipt.logs[0].args.channelId.toString(), channelId.toString());
      assert.equal(receipt.logs[0].args.stateProofNonce.toString(), '1')

      // peer 0 send 5 balance to peer 1, but peer 0 has 0 balance,
      // so cooperative settle will fail
      stateProofBytes = getCooperativeStateProofBytes({ channelId: channelId, nonce: 2 });
      stateProofSignatureBytes = await getAllSignatureBytes({
        messageBytes: stateProofBytes
      });
      const signaturesOfSignaturesBytes = await getAllSignatureBytes({
        messageBytes: stateProofSignatureBytes
      });
      stateProof = await web3.utils.bytesToHex(stateProofBytes);
      multiSignature = await web3.utils.bytesToHex(stateProofSignatureBytes);
      const signaturesOfSignatures = await web3.utils.bytesToHex(signaturesOfSignaturesBytes);

      receipt = await instance.cooperativeSettle(
        channelId,
        stateProof,
        multiSignature,
        signaturesOfSignatures
      );

      assert.equal(receipt.logs[0].event, 'CooperativeSettleFail');
      
      const status = await instance.getChannelStatus(channelId);
      assert.equal(status.toString(), '1');
    });
  
    it('should cooperativeSettle correctly', async () => {
      const depositReceipt = await instance.deposit(channelId, peers[0], {
        value: web3.utils.toWei('5', 'ether')
      });
  
      const { event, args } = depositReceipt.logs[0];
  
      assert.equal(event, 'Deposit');
      assert.deepEqual(args.peers, peers);
      assert.equal(args.amounts[0].toString(), '5000000000000000000');
      assert.equal(args.amounts[1].toString(), '0');

      const stateProofBytes = getCooperativeStateProofBytes({ channelId: channelId, nonce: 3 });
      const stateProofSignatureBytes = await getAllSignatureBytes({
        messageBytes: stateProofBytes
      });
      const signaturesOfSignaturesBytes = await getAllSignatureBytes({
        messageBytes: stateProofSignatureBytes
      });
      const stateProof = await web3.utils.bytesToHex(stateProofBytes);
      const multiSignature = await web3.utils.bytesToHex(stateProofSignatureBytes);
      const signaturesOfSignatures = await web3.utils.bytesToHex(signaturesOfSignaturesBytes);

      const receipt = await instance.cooperativeSettle(
        channelId,
        stateProof,
        multiSignature,
        signaturesOfSignatures
      );

      const status = await instance.getChannelStatus(channelId);

      assert.equal(receipt.logs[0].event, 'CooperativeSettle');
      assert.equal(status.toString(), '3');
    });
  });


  contract('GenericConditionalChannel using ERC20', async () => {
    it('should return correct channel information when openChannel', async () => {
      const withdrawalTimeout = [1, 1];
      const receipt = await instance.openChannel(
        peers,
        withdrawalTimeout,
        settleTimeoutIncrement,
        eRC20ExampleToken.address,
        1  // '1' for ERC20
      );

      const { event, args } = receipt.logs[0];
      channelId = args.channelId.toString();
      const status = await instance.getChannelStatus(channelId);
  
      assert.equal(event, 'OpenChannel');
      assert.equal(channelId, '4');
      assert.deepEqual(args.peers, peers);
      assert.equal(args.uintTokenType.toString(), '1'); //  '1' for ERC20
      assert.equal(args.tokenContract, eRC20ExampleToken.address);
      let amount;
      for (i = 0; i < peers.length; ++i) {
        amount = await instance.getDepositAmount(4, peers[i]);
        assert.equal(amount.toString(), '0');
      }
      assert.equal(status.toString(), '1');
    });

    it('should getTokenContract and getTokenType correctly', async () => {
      const tokenContract = await instance.getTokenContract.call(channelId);
      const tokenType = await instance.getTokenType.call(channelId);
      
      assert.equal(tokenContract, eRC20ExampleToken.address);
      assert.equal(tokenType.toString(), '1'); //  '1' for ERC20
    });

    it('should fail to cooperativeWithdraw (because of no deposit)', async () => {
      const withdrawProofBytes = getCooperativeWithdrawProofBytes({ channelId: channelId, amount: 100 });
      const allSignatureBytes = await getAllSignatureBytes({
        messageBytes: withdrawProofBytes
      });

      const withdrawProof = await web3.utils.bytesToHex(withdrawProofBytes);
      const multiSignature = await web3.utils.bytesToHex(allSignatureBytes);

      let err = null;

      try {
        await instance.cooperativeWithdraw(
          channelId,
          withdrawProof,
          multiSignature
        );
      } catch (error) {
        err = error;
      }
      assert.isOk(err instanceof Error);
    });

    it('should deposit correctly', async () => {
      // approve first
      await eRC20ExampleToken.approve(instance.address, 100);
      const receipt = await instance.depositERCToken(channelId, peers[0], 100);
  
      const { event, args } = receipt.logs[0];
      const amount = await instance.getDepositAmount(channelId, peers[0]);
      const depositMap = await instance.getDepositMap(channelId);
      const channelPeers = depositMap[0];
      const channelBalances = depositMap[1];
      
      assert.equal(event, 'Deposit');
      assert.deepEqual(args.peers, peers);
      assert.equal(args.amounts[0].toString(), '100');
      assert.equal(args.amounts[1].toString(), '0');
      assert.equal(amount.toString(), '100');
      assert.deepEqual(channelPeers, peers);
      assert.equal(channelBalances[0].toString(), '100');
      assert.equal(channelBalances[1].toString(), '0');
    });
      
    it('should cooperativeWithdraw correctly', async () => {
      const withdrawProofBytes = getCooperativeWithdrawProofBytes({ channelId: channelId, amount: 100 });
      const allSignatureBytes = await getAllSignatureBytes({
        messageBytes: withdrawProofBytes
      });

      const withdrawProof = await web3.utils.bytesToHex(withdrawProofBytes);
      const multiSignature = await web3.utils.bytesToHex(allSignatureBytes);

      const receipt = await instance.cooperativeWithdraw(
        channelId,
        withdrawProof,
        multiSignature
      );
      const { event, args } = receipt.logs[0];

      assert.equal(event, 'CooperativeWithdraw');
      assert.equal(args.channelId.toString(), channelId);
      assert.equal(args.withdrawalAmount.toString(), '100');
      assert.equal(args.receiver, peers[0]);
      assert.equal(args.balance.toString(), '0');
    });
  
    it('should intendSettleStateProof correctly', async () => {
      const stateProofBytes = getStateProofBytes({ channelId: channelId });
      const stateProofSignatureBytes = await getAllSignatureBytes({
        messageBytes: stateProofBytes
      });
      const stateProof = await web3.utils.bytesToHex(stateProofBytes);
      const multiSignature = await web3.utils.bytesToHex(
        stateProofSignatureBytes
      );

      const receipt = await instance.intendSettleStateProof(
        channelId,
        stateProof,
        multiSignature
      );
      const {event, args} = receipt.logs[0];
      const status = await instance.getChannelStatus(channelId);
      const block = await web3.eth.getBlock("latest");
      const settleTime = await instance.getChannelSettleTime(channelId);
      const expectedSettleTime = Math.max(5, block.number) + settleTimeoutIncrement;

      assert.equal(event, 'IntendSettle');
      assert.equal(args.channelId.toString(), channelId.toString());
      assert.equal(args.stateProofNonce.toString(), '1');
      assert.equal(status.toString(), '2');
      assert.isOk(expectedSettleTime - settleTime <= 1);
    });
  
    it('should resolveConditionalStateTransition correctly', async () => {
      const conditionGroup = await web3.utils.bytesToHex(conditionGroupBytes);

      const receipt = await instance.resolveConditionalStateTransition(
        channelId,
        [],
        conditionGroup
      );
      const {event, args} = receipt.logs[0]

      assert.equal(event, 'ResolveCondGroup');
      assert.equal(args.channelId.toString(), channelId.toString());
      assert.equal(args.condGroupHash, web3.utils.keccak256(conditionGroup));
    });

    it('should fail to ConfirmSettle or ConfirmSettleFail (revert) due to not reaching settleTime', async () => {
      let err = null;

      try {
        await instance.confirmSettle(channelId);
      } catch (error) {
        err = error;
      }
      const block = await web3.eth.getBlock("latest");
      const settleTime = await instance.getChannelSettleTime(channelId);
      assert.isOk(block.number <= settleTime);
      assert.isOk(err instanceof Error);
    });

    it('should ConfirmSettleFail due to lack of deposit', async () => {
      const settleTime = await instance.getChannelSettleTime(channelId);
      let block = await web3.eth.getBlock("latest");
      while(block.number <= settleTime) {
        block = await web3.eth.getBlock("latest");
      }

      const receipt = await instance.confirmSettle(channelId);
      const status = await instance.getChannelStatus(channelId);

      assert.equal(receipt.logs[0].event, 'ConfirmSettleFail');
      assert.equal(status.toString(), '1');
    });

    it('should fail to deposit (approve holds less tokens than deposit)', async () => {
      let err = null;

      try {
        // approve first
        await eRC20ExampleToken.approve(instance.address, 50);
        await instance.depositERCToken(channelId, peers[0], 100);
      } catch (error) {
        err = error;
      }
      assert.isOk(err instanceof Error);
    });

    it('should confirmSettle correctly', async () => {
      // approve first
      await eRC20ExampleToken.approve(instance.address, 100);
      const depositReceipt = await instance.depositERCToken(channelId, peers[0], 100);
  
      const { event, args } = depositReceipt.logs[0];
  
      assert.equal(event, 'Deposit');
      assert.deepEqual(args.peers, peers);
      assert.equal(args.amounts[0].toString(), '100');
      assert.equal(args.amounts[1].toString(), '0');
  
      const stateProofBytes = getStateProofBytes({ channelId: channelId, nonce: 2 });
      const stateProofSignatureBytes = await getAllSignatureBytes({
        messageBytes: stateProofBytes
      });
      const stateProof = await web3.utils.bytesToHex(stateProofBytes);
      const multiSignature = await web3.utils.bytesToHex(
        stateProofSignatureBytes
      );
      await instance.intendSettleStateProof(
        channelId,
        stateProof,
        multiSignature
      );

      const conditionGroup = await web3.utils.bytesToHex(conditionGroupBytes);
      await instance.resolveConditionalStateTransition(
        channelId,
        [],
        conditionGroup
      );

      const settleTime = await instance.getChannelSettleTime(channelId);
      let block = await web3.eth.getBlock("latest");
      while(block.number <= settleTime) {
        block = await web3.eth.getBlock("latest");
      }

      const confirmReceipt = await instance.confirmSettle(channelId);
      const status = await instance.getChannelStatus(channelId);      
  
      assert.equal(confirmReceipt.logs[0].event, 'ConfirmSettle');
      assert.equal(status.toString(), '3');
    });

    it('should return correct channel information when authOpenChannel', async () => {
      await eRC20ExampleToken.approve(depositPool.address, 200);
      await depositPool.depositERCToken(
        peers[1],
        200,
        eRC20ExampleToken.address,
        1,  // '1' for ERC20
        {
          from: peers[0]
        }
      );

      const authorizedWithdrawBytesERCToken = await getAuthorizedWithdrawBytes({
        tokenContract: eRC20ExampleToken.address,
        tokenType: 1
      });
      const authorizedWithdraw = await web3.utils.bytesToHex(
        authorizedWithdrawBytesERCToken
      );
      const authorizedWithdrawSignatureBytesERCToken = await getAllSignatureBytes({
        messageBytes: authorizedWithdrawBytesERCToken
      });
      const allSignatures = await web3.utils.bytesToHex(
        authorizedWithdrawSignatureBytesERCToken
      );

      await eRC20ExampleToken.approve(instance.address, 100);
      const receipt = await instance.authOpenChannel(
        authorizedWithdraw,
        allSignatures,
        {
          from: peers[0]
        }
      );
      const eventZero = receipt.logs[0].event;
      const argsZero = receipt.logs[0].args;
      const eventOne = receipt.logs[1].event;
      const argsOne = receipt.logs[1].args;
      const eventTwo = receipt.logs[2].event;
      const argsTwo = receipt.logs[2].args;

      channelId = argsZero.channelId.toString();
      const status = await instance.getChannelStatus(channelId);

      assert.equal(channelId, '5');
      assert.equal(eventZero, 'OpenChannel');
      assert.deepEqual(argsZero.peers, peers);
      assert.equal(argsZero.uintTokenType.toString(), '1'); //  '1' for ERC20
      assert.equal(argsZero.tokenContract, eRC20ExampleToken.address);
      
      assert.equal(eventOne, 'Deposit');
      assert.equal(argsOne.channelId.toString(), channelId);
      assert.deepEqual(argsOne.peers, peers);
      assert.equal(argsOne.amounts[0].toString(), '100');
      assert.equal(argsOne.amounts[1].toString(), '0');
      
      assert.equal(eventTwo, 'Deposit');
      assert.equal(argsTwo.channelId.toString(), channelId);
      assert.deepEqual(argsTwo.peers, peers);
      assert.equal(argsTwo.amounts[0].toString(), '0');
      assert.equal(argsTwo.amounts[1].toString(), '200');
    });

    it('should CooperativeSettleFail', async () => {
      let receipt;
      let stateProof;
      let multiSignature;
      let stateProofBytes;
      let stateProofSignatureBytes;

      // it should return correct channelId when openChannel
      const withdrawalTimeout = [1, 1];
      receipt = await instance.openChannel(
        peers,
        withdrawalTimeout,
        settleTimeoutIncrement,
        eRC20ExampleToken.address,
        1  // 1 for TokenType.ERC20
      );
  
      const { event, args } = receipt.logs[0];
      channelId = args.channelId.toString();
  
      assert.equal(event, 'OpenChannel');
      assert.equal(channelId, '6');
      assert.deepEqual(args.peers, peers);
      assert.equal(args.uintTokenType.toString(), '1'); //  '1' for ERC20
      assert.equal(args.tokenContract, eRC20ExampleToken.address);

      // it should intendSettleStateProof correctly
      stateProofBytes = getStateProofBytes({ channelId: channelId });
      stateProofSignatureBytes = await getAllSignatureBytes({
        messageBytes: stateProofBytes
      });
      stateProof = await web3.utils.bytesToHex(stateProofBytes);
      multiSignature = await web3.utils.bytesToHex(stateProofSignatureBytes);
  
      receipt = await instance.intendSettleStateProof(
        channelId,
        stateProof,
        multiSignature
      );

      assert.equal(receipt.logs[0].event, 'IntendSettle');
      assert.equal(receipt.logs[0].args.channelId.toString(), channelId.toString());
      assert.equal(receipt.logs[0].args.stateProofNonce.toString(), '1')

      // peer 0 send 5 balance to peer 1, but peer 0 has 0 balance,
      // so cooperative settle will fail
      stateProofBytes = getCooperativeStateProofBytes({ channelId: channelId, nonce: 2 });
      stateProofSignatureBytes = await getAllSignatureBytes({
        messageBytes: stateProofBytes
      });
      const signaturesOfSignaturesBytes = await getAllSignatureBytes({
        messageBytes: stateProofSignatureBytes
      });
      stateProof = await web3.utils.bytesToHex(stateProofBytes);
      multiSignature = await web3.utils.bytesToHex(stateProofSignatureBytes);
      const signaturesOfSignatures = await web3.utils.bytesToHex(signaturesOfSignaturesBytes);

      receipt = await instance.cooperativeSettle(
        channelId,
        stateProof,
        multiSignature,
        signaturesOfSignatures
      );

      assert.equal(receipt.logs[0].event, 'CooperativeSettleFail');
      
      const status = await instance.getChannelStatus(channelId);
      assert.equal(status.toString(), '1');
    });
  
    it('should cooperativeSettle correctly', async () => {
      // approve first
      await eRC20ExampleToken.approve(instance.address, 100);
      const depositReceipt = await instance.depositERCToken(channelId, peers[0], 100);
  
      const { event, args } = depositReceipt.logs[0];
  
      assert.equal(event, 'Deposit');
      assert.deepEqual(args.peers, peers);
      assert.equal(args.amounts[0].toString(), '100');
      assert.equal(args.amounts[1].toString(), '0');

      const stateProofBytes = getCooperativeStateProofBytes({ channelId: channelId, nonce: 3 });
      const stateProofSignatureBytes = await getAllSignatureBytes({
        messageBytes: stateProofBytes
      });
      const signaturesOfSignaturesBytes = await getAllSignatureBytes({
        messageBytes: stateProofSignatureBytes
      });
      const stateProof = await web3.utils.bytesToHex(stateProofBytes);
      const multiSignature = await web3.utils.bytesToHex(stateProofSignatureBytes);
      const signaturesOfSignatures = await web3.utils.bytesToHex(signaturesOfSignaturesBytes);

      const receipt = await instance.cooperativeSettle(
        channelId,
        stateProof,
        multiSignature,
        signaturesOfSignatures
      );
      const status = await instance.getChannelStatus(channelId);

      assert.equal(receipt.logs[0].event, 'CooperativeSettle');
      assert.equal(status.toString(), '3');
    });
  });

});
