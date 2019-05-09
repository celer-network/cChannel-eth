const Web3 = require('web3');
const web3 = new Web3(new Web3.providers.HttpProvider('http://localhost:8545'));
const sha3 = web3.utils.keccak256;

const fs = require('fs');

const protoChainFactory = require('./helper/protoChainFactory');

const utilities = require('./helper/utilities');
const {
  mineBlockUntil,
  getSortedArray,
  getDeployGasUsed,
  getCallGasUsed
} = utilities;

const PayRegistry = artifacts.require('PayRegistry');
const Resolver = artifacts.require('VirtContractResolver');

const GAS_USED_LOG = 'gas_used_logs/PayRegistry.txt';

contract('PayRegistry', async accounts => {
  const peers = getSortedArray([accounts[0], accounts[1]]);
  const TRUE_PREIMAGE = '0x123456';
  const FALSE_PREIMAGE = '0x654321';
  let payRegistry;
  let protoChainInstance;
  let getConditions;
  let getConditionalPayBytes;
  let getResolvePayByConditionsRequestBytes;
  let getVouchedCondPayResultBytes;

  before(async () => {
    fs.writeFileSync(GAS_USED_LOG, '********** Gas Used in PayRegistry Tests **********\n\n');

    const resolver = await Resolver.new();
    payRegistry = await PayRegistry.new(resolver.address);
    
    fs.appendFileSync(GAS_USED_LOG, '***** Deploy Gas Used *****\n');
    let gasUsed = await getDeployGasUsed(resolver);
    fs.appendFileSync(GAS_USED_LOG, 'VirtContractResolver Deploy Gas: ' + gasUsed + '\n');
    gasUsed = await getDeployGasUsed(payRegistry);
    fs.appendFileSync(GAS_USED_LOG, 'PayRegistry Deploy Gas: ' + gasUsed + '\n\n');
    fs.appendFileSync(GAS_USED_LOG, '***** Function Calls Gas Used *****\n');

    protoChainInstance = await protoChainFactory(peers, [accounts[9], accounts[9]]);
    getConditions = protoChainInstance.getConditions;
    getConditionalPayBytes = protoChainInstance.getConditionalPayBytes;
    getResolvePayByConditionsRequestBytes = protoChainInstance.getResolvePayByConditionsRequestBytes;
    getVouchedCondPayResultBytes = protoChainInstance.getVouchedCondPayResultBytes;
  });

  it('should resolve pay by conditions correctly when the logic is BOOLEAN_AND and ' +
      'all contract conditions are true', async () => {
    const payBytes = getConditionalPayBytes({
      payTimestamp: Date.now(),
      paySrc: accounts[8],
      payDest: accounts[9],
      conditions: getConditions({type: 3}),
      logicType: 0, // BOOLEAN_AND
      maxAmount: 10,
      resolveDeadline: 999999,
      resolveTimeout: 10
    });
    const Pay = web3.utils.bytesToHex(payBytes);
    const payHash = sha3(Pay);
    const requestBytes = getResolvePayByConditionsRequestBytes({
      condPayBytes: payBytes,
      hashPreimages: [web3.utils.hexToBytes(TRUE_PREIMAGE)]
    });

    const tx = await payRegistry.resolvePaymentByConditions(requestBytes);
    const {event, args} = tx.logs[0];

    fs.appendFileSync(
      GAS_USED_LOG,
      'resolvePaymentByConditions(): ' + getCallGasUsed(tx) + '\n'
    );

    assert.equal(event, 'UpdatePayResult');
    assert.equal(args.payHash, payHash);
    assert.equal(args.newAmount.toString(), 10);
  });

  it('should resolve pay by conditions correctly when the logic is BOOLEAN_AND and ' +
      'some contract conditions are false', async () => {
    const payBytes = getConditionalPayBytes({
      payTimestamp: Date.now(),
      paySrc: accounts[8],
      payDest: accounts[9],
      conditions: getConditions({type: 1}),
      logicType: 0, // BOOLEAN_AND
      maxAmount: 20,
      resolveDeadline: 999999,
      resolveTimeout: 10
    });
    const Pay = web3.utils.bytesToHex(payBytes);
    const payHash = sha3(Pay);
    const requestBytes = getResolvePayByConditionsRequestBytes({
      condPayBytes: payBytes,
      hashPreimages: [web3.utils.hexToBytes(TRUE_PREIMAGE)]
    });

    const tx = await payRegistry.resolvePaymentByConditions(requestBytes);
    const {event, args} = tx.logs[0];
    assert.equal(event, 'UpdatePayResult');
    assert.equal(args.payHash, payHash);
    assert.equal(args.newAmount.toString(), 0);
  });

  it('should resolve pay by conditions correctly when the logic is BOOLEAN_OR and ' +
      'some contract conditions are true', async () => {
    const payBytes = getConditionalPayBytes({
      payTimestamp: Date.now(),
      paySrc: accounts[8],
      payDest: accounts[9],
      conditions: getConditions({type: 2}),
      logicType: 1, // BOOLEAN_OR
      maxAmount: 30,
      resolveDeadline: 999999,
      resolveTimeout: 10
    });
    const Pay = web3.utils.bytesToHex(payBytes);
    const payHash = sha3(Pay);
    const requestBytes = getResolvePayByConditionsRequestBytes({
      condPayBytes: payBytes,
      hashPreimages: [web3.utils.hexToBytes(TRUE_PREIMAGE)]
    });

    const tx = await payRegistry.resolvePaymentByConditions(requestBytes);
    const {event, args} = tx.logs[0];
    assert.equal(event, 'UpdatePayResult');
    assert.equal(args.payHash, payHash);
    assert.equal(args.newAmount.toString(), 30);
  });

  it('should resolve pay by conditions correctly when the logic is BOOLEAN_OR and ' +
      'all contract conditions are false', async () => {
    const payBytes = getConditionalPayBytes({
      payTimestamp: Date.now(),
      paySrc: accounts[8],
      payDest: accounts[9],
      conditions: getConditions({type: 0}),
      logicType: 1, // BOOLEAN_OR
      maxAmount: 30,
      resolveDeadline: 999999,
      resolveTimeout: 10
    });
    const Pay = web3.utils.bytesToHex(payBytes);
    const payHash = sha3(Pay);
    const requestBytes = getResolvePayByConditionsRequestBytes({
      condPayBytes: payBytes,
      hashPreimages: [web3.utils.hexToBytes(TRUE_PREIMAGE)]
    });

    const tx = await payRegistry.resolvePaymentByConditions(requestBytes);
    const {event, args} = tx.logs[0];
    assert.equal(event, 'UpdatePayResult');
    assert.equal(args.payHash, payHash);
    assert.equal(args.newAmount.toString(), 0);
  });

  it('should resolve pay by vouched result correctly', async () => {
    sharedPayBytes = getConditionalPayBytes({
      payTimestamp: 0,
      paySrc: accounts[8],
      payDest: accounts[9],
      conditions: getConditions({type: 3}),
      logicType: 0, // BOOLEAN_AND
      maxAmount: 100,
      resolveDeadline: 999999,
      resolveTimeout: 10
    });
    const Pay = web3.utils.bytesToHex(sharedPayBytes);
    sharedPayHash = sha3(Pay);
    const vouchedCondPayResultBytes = await getVouchedCondPayResultBytes({
      condPay: sharedPayBytes,
      amount: 20,
      src: accounts[8],
      dest: accounts[9]
    });

    const tx = await payRegistry.resolvePaymentByVouchedResult(vouchedCondPayResultBytes);
    const {event, args} = tx.logs[0];

    fs.appendFileSync(GAS_USED_LOG, 'resolvePaymentByVouchedResult(): ' + getCallGasUsed(tx) + '\n');

    assert.equal(event, 'UpdatePayResult');
    assert.equal(args.payHash, sharedPayHash);
    assert.equal(args.newAmount.toString(), 20);
  });

  it('should resolve pay by vouched result correctly ' +
      'when the new result is larger than the old result', async () => {
    const vouchedCondPayResultBytes = await getVouchedCondPayResultBytes({
      condPay: sharedPayBytes,
      amount: 50,
      src: accounts[8],
      dest: accounts[9]
    });

    const tx = await payRegistry.resolvePaymentByVouchedResult(vouchedCondPayResultBytes);
    const {event, args} = tx.logs[0];
    assert.equal(event, 'UpdatePayResult');
    assert.equal(args.payHash, sharedPayHash);
    assert.equal(args.newAmount.toString(), 50);
  });

  it('should resolve pay by conditions correctly ' +
      'when the new result is larger than the old result', async () => {
    const requestBytes = getResolvePayByConditionsRequestBytes({
      condPayBytes: sharedPayBytes,
      hashPreimages: [web3.utils.hexToBytes(TRUE_PREIMAGE)]
    });

    const tx = await payRegistry.resolvePaymentByConditions(requestBytes);
    const {event, args} = tx.logs[0];
    assert.equal(event, 'UpdatePayResult');
    assert.equal(args.payHash, sharedPayHash);
    assert.equal(args.newAmount.toString(), 100);
  });

  it('should fail to resolve pay by vouched result ' +
      'when the new result is smaller than the old result', async () => {
    const vouchedCondPayResultBytes = await getVouchedCondPayResultBytes({
      condPay: sharedPayBytes,
      amount: 50,
      src: accounts[8],
      dest: accounts[9]
    });

    try {
      await payRegistry.resolvePaymentByVouchedResult(vouchedCondPayResultBytes);
    } catch (error) {
      assert.isAbove(
        error.message.search('New amount is not larger'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should fail to resolve pay by vouched result when exceeding max amount', async () => {
    const vouchedCondPayResultBytes = await getVouchedCondPayResultBytes({
      condPay: sharedPayBytes,
      amount: 200,
      src: accounts[8],
      dest: accounts[9]
    });

    try {
      await payRegistry.resolvePaymentByVouchedResult(vouchedCondPayResultBytes);
    } catch (error) {
      assert.isAbove(
        error.message.search('Exceed max transfer amount'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should fail to resolve pay by conditions when deadline passed', async () => {
    const payBytes = getConditionalPayBytes({
      payTimestamp: Date.now(),
      paySrc: accounts[8],
      payDest: accounts[9],
      conditions: getConditions({type: 1}),
      logicType: 0, // BOOLEAN_AND
      maxAmount: 10,
      resolveDeadline: 1,
      resolveTimeout: 10
    });
    const requestBytes = getResolvePayByConditionsRequestBytes({
      condPayBytes: payBytes,
      hashPreimages: [web3.utils.hexToBytes(TRUE_PREIMAGE)]
    });

    try {
      await payRegistry.resolvePaymentByConditions(requestBytes);
    } catch (error) {
      assert.isAbove(
        error.message.search('Pay resolve deadline passed'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should fail to resolve pay by vouched result when deadline passed', async () => {
    const payBytes = getConditionalPayBytes({
      payTimestamp: Date.now(),
      paySrc: accounts[8],
      payDest: accounts[9],
      conditions: getConditions({type: 1}),
      logicType: 0, // BOOLEAN_AND
      maxAmount: 100,
      resolveDeadline: 1,
      resolveTimeout: 10
    });
    const vouchedCondPayResultBytes = await getVouchedCondPayResultBytes({
      condPay: payBytes,
      amount: 20,
      src: accounts[8],
      dest: accounts[9]
    });
  
    try {
      await payRegistry.resolvePaymentByVouchedResult(vouchedCondPayResultBytes);
    } catch (error) {
      assert.isAbove(
        error.message.search('Pay resolve deadline passed'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should fail to resolve pay by vouched result after resolve timeout', async () => {
    const payBytes = getConditionalPayBytes({
      payTimestamp: Date.now(),
      paySrc: accounts[8],
      payDest: accounts[9],
      conditions: getConditions({type: 1}),
      logicType: 0, // BOOLEAN_AND
      maxAmount: 100,
      resolveDeadline: 99999999,
      resolveTimeout: 10
    });

    const vouchedCondPayResultBytes0 = await getVouchedCondPayResultBytes({
      condPay: payBytes,
      amount: 20,
      src: accounts[8],
      dest: accounts[9]
    });
    const vouchedCondPayResultBytes1 = await getVouchedCondPayResultBytes({
      condPay: payBytes,
      amount: 30,
      src: accounts[8],
      dest: accounts[9]
    });

    await payRegistry.resolvePaymentByVouchedResult(vouchedCondPayResultBytes0);
    const block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + 11, accounts[0]);
  
    try {
      await payRegistry.resolvePaymentByVouchedResult(vouchedCondPayResultBytes1);
    } catch (error) {
      assert.isAbove(
        error.message.search('Resolve timeout'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should fail to resolve pay by conditions after resolve timeout', async () => {
    const payBytes = getConditionalPayBytes({
      payTimestamp: Date.now(),
      paySrc: accounts[8],
      payDest: accounts[9],
      conditions: getConditions({type: 1}),
      logicType: 0, // BOOLEAN_AND
      maxAmount: 200,
      resolveDeadline: 99999999,
      resolveTimeout: 10
    });

    const vouchedCondPayResultBytes = await getVouchedCondPayResultBytes({
      condPay: payBytes,
      amount: 20,
      src: accounts[8],
      dest: accounts[9]
    });
    const requestBytes = getResolvePayByConditionsRequestBytes({
      condPayBytes: payBytes,
      hashPreimages: [web3.utils.hexToBytes(TRUE_PREIMAGE)]
    });

    await payRegistry.resolvePaymentByVouchedResult(vouchedCondPayResultBytes);
    const block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + 11, accounts[0]);

    try {
      await payRegistry.resolvePaymentByConditions(requestBytes);
    } catch (error) {
      assert.isAbove(
        error.message.search('Resolve timeout'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should fail to resolve pay by conditions with a false HASH_LOCK condition', async () => {
    const payBytes = getConditionalPayBytes({
      payTimestamp: Date.now(),
      paySrc: accounts[8],
      payDest: accounts[9],
      conditions: getConditions({type: 4}),
      logicType: 1, // BOOLEAN_OR
      maxAmount: 200,
      resolveDeadline: 99999999,
      resolveTimeout: 10
    });

    const requestBytes = getResolvePayByConditionsRequestBytes({
      condPayBytes: payBytes,
      hashPreimages: [web3.utils.hexToBytes(TRUE_PREIMAGE), web3.utils.hexToBytes(FALSE_PREIMAGE)]
    });

    try {
      await payRegistry.resolvePaymentByConditions(requestBytes);
    } catch (error) {
      assert.isAbove(
        error.message.search('Wrong preimage'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should resolve pay by conditions correctly when the logic is NUMERIC_ADD', async () => {
    const payBytes = getConditionalPayBytes({
      payTimestamp: Date.now(),
      paySrc: accounts[8],
      payDest: accounts[9],
      conditions: getConditions({type: 5}),
      logicType: 3, // NUMERIC_ADD
      maxAmount: 50,
      resolveDeadline: 999999,
      resolveTimeout: 10
    });
    const Pay = web3.utils.bytesToHex(payBytes);
    const payHash = sha3(Pay);
    const requestBytes = getResolvePayByConditionsRequestBytes({
      condPayBytes: payBytes,
      hashPreimages: [web3.utils.hexToBytes(TRUE_PREIMAGE)]
    });

    const tx = await payRegistry.resolvePaymentByConditions(requestBytes);
    const {event, args} = tx.logs[0];
    assert.equal(event, 'UpdatePayResult');
    assert.equal(args.payHash, payHash);
    assert.equal(args.newAmount.toString(), 35);
  });

  it('should resolve pay by conditions correctly when the logic is NUMERIC_MAX', async () => {
    const payBytes = getConditionalPayBytes({
      payTimestamp: Date.now(),
      paySrc: accounts[8],
      payDest: accounts[9],
      conditions: getConditions({type: 5}),
      logicType: 4, // NUMERIC_MAX
      maxAmount: 50,
      resolveDeadline: 999999,
      resolveTimeout: 10
    });
    const Pay = web3.utils.bytesToHex(payBytes);
    const payHash = sha3(Pay);
    const requestBytes = getResolvePayByConditionsRequestBytes({
      condPayBytes: payBytes,
      hashPreimages: [web3.utils.hexToBytes(TRUE_PREIMAGE)]
    });

    const tx = await payRegistry.resolvePaymentByConditions(requestBytes);
    const {event, args} = tx.logs[0];
    assert.equal(event, 'UpdatePayResult');
    assert.equal(args.payHash, payHash);
    assert.equal(args.newAmount.toString(), 25);
  });

  it('should resolve pay by conditions correctly when the logic is NUMERIC_MIN', async () => {
    const payBytes = getConditionalPayBytes({
      payTimestamp: Date.now(),
      paySrc: accounts[8],
      payDest: accounts[9],
      conditions: getConditions({type: 5}),
      logicType: 5, // NUMERIC_MIN
      maxAmount: 50,
      resolveDeadline: 999999,
      resolveTimeout: 10
    });
    const Pay = web3.utils.bytesToHex(payBytes);
    const payHash = sha3(Pay);
    const requestBytes = getResolvePayByConditionsRequestBytes({
      condPayBytes: payBytes,
      hashPreimages: [web3.utils.hexToBytes(TRUE_PREIMAGE)]
    });

    const tx = await payRegistry.resolvePaymentByConditions(requestBytes);
    const {event, args} = tx.logs[0];
    assert.equal(event, 'UpdatePayResult');
    assert.equal(args.payHash, payHash);
    assert.equal(args.newAmount.toString(), 10);
  });

  it('should resolve pay using max amount with any transfer logic ' +
      'as long as there are no contract conditions', async () => {
    const maxAmount = 50;
    for (var logicType = 0; logicType < 6; logicType++) {
      if (logicType == 2) {
        // BOOLEAN_CIRCUIT has not been implemented yet
        continue;
      }
      
      const payBytes = getConditionalPayBytes({
        payTimestamp: Date.now(),
        paySrc: accounts[8],
        payDest: accounts[9],
        conditions: getConditions({type: 6}),
        logicType: logicType,
        maxAmount: maxAmount,
        resolveDeadline: 999999,
        resolveTimeout: 10
      });
      const Pay = web3.utils.bytesToHex(payBytes);
      const payHash = sha3(Pay);
      const requestBytes = getResolvePayByConditionsRequestBytes({
        condPayBytes: payBytes,
        hashPreimages: [web3.utils.hexToBytes(TRUE_PREIMAGE)]
      });
  
      const tx = await payRegistry.resolvePaymentByConditions(requestBytes);
      const {event, args} = tx.logs[0];
      assert.equal(event, 'UpdatePayResult');
      assert.equal(args.payHash, payHash);
      assert.equal(args.newAmount.toString(), maxAmount);
    }
  });
});
