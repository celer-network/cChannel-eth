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
  });


  contract('GenericConditionalChannel using ETH', async () => {
    it('should return correct channel information when openChannel', async () => {
      const withdrawalTimeout = [1, 1];
      const settleTimeoutIncrement = 10000;
      const receipt = await instance.openChannel(
        peers,
        withdrawalTimeout,
        settleTimeoutIncrement,
        '0x0',
        0  // 0 for TokenType.ETH
      );

      const { event, args } = receipt.logs[0];
      channelId = args.channelId.toString();

      assert.equal(event, 'OpenChannel');
      assert.equal(channelId, '1');
      assert.deepEqual(args.peers, peers);
      assert.equal(args.uintTokenType.toString(), '0'); // position '0' for ETH
      assert.equal(args.tokenContract, '0x0000000000000000000000000000000000000000');
    });

    it('should viewTokenContract and viewTokenType correctly', async () => {
      const tokenContract = await instance.viewTokenContract.call(channelId);
      const tokenType = await instance.viewTokenType.call(channelId);
      
      assert.equal(tokenContract, '0x0000000000000000000000000000000000000000');
      assert.equal(tokenType.toString(), '0'); // position '0' for ETH
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

    it('should cooperativeWithdraw correctly', async () => {
      const depositReceipt = await instance.deposit(channelId, peers[0], {
        value: '100'
      });

      const { event, args } = depositReceipt.logs[0];
  
      assert.equal(event, 'Deposit');
      assert.deepEqual(args.peers, peers);
      assert.equal(args.balances[0].toString(), '100');

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

      assert.equal(receipt.logs[0].event, 'CooperativeWithdraw');
      assert.equal(receipt.logs[0].args.channelId.toString(), channelId);
      assert.equal(receipt.logs[0].args.withdrawalAmount.toString(), '100');
      assert.equal(receipt.logs[0].args.receiver, peers[0]);
      assert.equal(receipt.logs[0].args.balance.toString(), '0');
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

      assert.equal(receipt.logs[0].event, 'IntendSettle');
    });
  
    it('should resolveConditionalStateTransition correctly', async () => {
      const conditionGroup = await web3.utils.bytesToHex(conditionGroupBytes);

      const receipt = await instance.resolveConditionalStateTransition(
        channelId,
        [],
        conditionGroup
      );

      assert.equal(receipt.logs[0].event, 'ResolveCondition');
    });

    it('should fail to confirmSettle', async () => {
      // peer 0 send 5 balance to peer 1, but peer 0 has 0 balance,
      // so confirm settle will fail
      const receipt = await instance.confirmSettle(channelId);

      assert.equal(receipt.logs[0].event, 'ConfirmSettleFail');
    });

    it('should confirmSettle correctly', async () => {
      const depositReceipt = await instance.deposit(channelId, peers[0], {
        value: web3.utils.toWei('5', 'ether')
      });

      const { event, args } = depositReceipt.logs[0];

      assert.equal(event, 'Deposit');
      assert.deepEqual(args.peers, peers);
      assert.equal(args.balances[0].toString(), '5000000000000000000');

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
      const confirmReceipt = await instance.confirmSettle(channelId);

      assert.equal(confirmReceipt.logs[0].event, 'ConfirmSettle');
    });

    it('should return correct channel information when authOpenChannel', async () => {
      await depositPool.deposit({
        from: peers[1],
        value: '200'
      });

      const withdrawalTimeout = [1, 1];
      const settleTimeoutIncrement = 10000;
      const authorizedWithdraw = await web3.utils.bytesToHex(
        authorizedWithdrawBytes
      );
      const otherSignature = await web3.utils.bytesToHex(
        authorizedWithdrawSignatureBytes
      );

      const receipt = await instance.authOpenChannel(
        withdrawalTimeout,
        settleTimeoutIncrement,
        authorizedWithdraw,
        otherSignature,
        {
          from: peers[0],
          value: '100'
        }
      );
      const { event, args } = receipt.logs[0];

      channelId = args.channelId.toString();

      assert.equal(event, 'OpenChannel');
      assert.equal(channelId, '2');
      assert.deepEqual(args.peers, peers);
      assert.equal(args.uintTokenType.toString(), '0'); // position '0' for ETH
      assert.equal(args.tokenContract, '0x0000000000000000000000000000000000000000');
    });

    it('should fail to cooperativeSettle', async () => {
      let receipt;
      let stateProof;
      let multiSignature;
      let stateProofBytes;
      let stateProofSignatureBytes;

      // it should return correct channelId when openChannel
      const withdrawalTimeout = [1, 1];
      const settleTimeoutIncrement = 10000;
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
      assert.equal(args.uintTokenType.toString(), '0'); // position '0' for ETH
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
    });
  
    it('should cooperativeSettle correctly', async () => {
      const depositReceipt = await instance.deposit(channelId, peers[0], {
        value: web3.utils.toWei('5', 'ether')
      });
  
      const { event, args } = depositReceipt.logs[0];
  
      assert.equal(event, 'Deposit');
      assert.deepEqual(args.peers, peers);
      assert.equal(args.balances[0].toString(), '5000000000000000000');

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

      assert.equal(receipt.logs[0].event, 'CooperativeSettle');
    });
  });


  contract('GenericConditionalChannel using ERC20', async () => {
    it('should return correct channel information when openChannel', async () => {
      const withdrawalTimeout = [1, 1];
      const settleTimeoutIncrement = 10000;
      const receipt = await instance.openChannel(
        peers,
        withdrawalTimeout,
        settleTimeoutIncrement,
        eRC20ExampleToken.address,
        1  // 1 for TokenType.ERC20
      );

      const { event, args } = receipt.logs[0];
      channelId = args.channelId.toString();
  
      assert.equal(event, 'OpenChannel');
      assert.equal(channelId, '4');
      assert.deepEqual(args.peers, peers);
      assert.equal(args.uintTokenType.toString(), '1'); // position '1' for ERC20
      assert.equal(args.tokenContract, eRC20ExampleToken.address);
    });

    it('should viewTokenContract and viewTokenType correctly', async () => {
      const tokenContract = await instance.viewTokenContract.call(channelId);
      const tokenType = await instance.viewTokenType.call(channelId);
      
      assert.equal(tokenContract, eRC20ExampleToken.address);
      assert.equal(tokenType.toString(), '1'); // position '1' for ERC20
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

    it('should cooperativeWithdraw correctly', async () => {
      // approve first
      await eRC20ExampleToken.approve(instance.address, 100);
      const depositReceipt = await instance.depositERCToken(channelId, peers[0], 100);
  
      const { event, args } = depositReceipt.logs[0];
  
      assert.equal(event, 'Deposit');
      assert.deepEqual(args.peers, peers);
      assert.equal(args.balances[0].toString(), '100');

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

      assert.equal(receipt.logs[0].event, 'CooperativeWithdraw');
      assert.equal(receipt.logs[0].args.channelId.toString(), channelId);
      assert.equal(receipt.logs[0].args.withdrawalAmount.toString(), '100');
      assert.equal(receipt.logs[0].args.receiver, peers[0]);
      assert.equal(receipt.logs[0].args.balance.toString(), '0');
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

      assert.equal(receipt.logs[0].event, 'IntendSettle');
    });
  
    it('should resolveConditionalStateTransition correctly', async () => {
      const conditionGroup = await web3.utils.bytesToHex(conditionGroupBytes);

      const receipt = await instance.resolveConditionalStateTransition(
        channelId,
        [],
        conditionGroup
      );

      assert.equal(receipt.logs[0].event, 'ResolveCondition');
    });

    it('should fail to confirmSettle', async () => {
      // peer 0 send 5 balance to peer 1, but peer 0 has 0 balance,
      // so confirm settle will fail
      const receipt = await instance.confirmSettle(channelId);

      assert.equal(receipt.logs[0].event, 'ConfirmSettleFail');
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
      assert.equal(args.balances[0].toString(), '100');
  
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
      const confirmReceipt = await instance.confirmSettle(channelId);
  
      assert.equal(confirmReceipt.logs[0].event, 'ConfirmSettle');
    });

    it('should fail to cooperativeSettle', async () => {
      let receipt;
      let stateProof;
      let multiSignature;
      let stateProofBytes;
      let stateProofSignatureBytes;

      // it should return correct channelId when openChannel
      const withdrawalTimeout = [1, 1];
      const settleTimeoutIncrement = 10000;
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
      assert.equal(channelId, '5');
      assert.deepEqual(args.peers, peers);
      assert.equal(args.uintTokenType.toString(), '1'); // position '1' for ERC20
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
    });
  
    it('should cooperativeSettle correctly', async () => {
      // approve first
      await eRC20ExampleToken.approve(instance.address, 100);
      const depositReceipt = await instance.depositERCToken(channelId, peers[0], 100);
  
      const { event, args } = depositReceipt.logs[0];
  
      assert.equal(event, 'Deposit');
      assert.deepEqual(args.peers, peers);
      assert.equal(args.balances[0].toString(), '100');

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

      assert.equal(receipt.logs[0].event, 'CooperativeSettle');
    });
  });

});
