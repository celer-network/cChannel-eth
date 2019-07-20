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
  getCallGasUsed,
  calculatePayId
} = utilities;

const PayRegistry = artifacts.require('PayRegistry');
const PayResolver = artifacts.require('PayResolver');
const VirtResolver = artifacts.require('VirtContractResolver');

const GAS_USED_LOG = 'gas_used_logs/PayResolver.txt';

contract('PayResolver', async accounts => {
  const peers = getSortedArray([accounts[0], accounts[1]]);
  const TRUE_PREIMAGE = '0x123456';
  const FALSE_PREIMAGE = '0x654321';
  const RESOLVE_TIMEOUT = 10;
  const RESOLVE_DEADLINE = 9999999;
  let payRegistry;
  let payResolver;
  let protoChainInstance;
  let getConditions;
  let getConditionalPayBytes;
  let getResolvePayByConditionsRequestBytes;
  let getVouchedCondPayResultBytes;

  before(async () => {
    fs.writeFileSync(GAS_USED_LOG, '********** Gas Used in PayRegistry Tests **********\n\n');

    const virtResolver = await VirtResolver.new();
    payRegistry = await PayRegistry.new();
    payResolver = await PayResolver.new(payRegistry.address, virtResolver.address);

    fs.appendFileSync(GAS_USED_LOG, '***** Deploy Gas Used *****\n');
    let gasUsed = await getDeployGasUsed(virtResolver);
    fs.appendFileSync(GAS_USED_LOG, 'VirtContractResolver Deploy Gas: ' + gasUsed + '\n');
    gasUsed = await getDeployGasUsed(payRegistry);
    fs.appendFileSync(GAS_USED_LOG, 'PayRegistry Deploy Gas: ' + gasUsed + '\n');
    gasUsed = await getDeployGasUsed(payResolver);
    fs.appendFileSync(GAS_USED_LOG, 'PayResolver Deploy Gas: ' + gasUsed + '\n\n');
    fs.appendFileSync(GAS_USED_LOG, '***** Function Calls Gas Used *****\n');

    protoChainInstance = await protoChainFactory(peers, [accounts[9], accounts[9]]);
    getConditions = protoChainInstance.getConditions;
    getConditionalPayBytes = protoChainInstance.getConditionalPayBytes;
    getResolvePayByConditionsRequestBytes = protoChainInstance.getResolvePayByConditionsRequestBytes;
    getVouchedCondPayResultBytes = protoChainInstance.getVouchedCondPayResultBytes;
  });

  it('should resolve pay by conditions correctly when the logic is BOOLEAN_AND and all contract conditions are true', async () => {
    const payBytes = getConditionalPayBytes({
      payTimestamp: Date.now(),
      paySrc: accounts[8],
      payDest: accounts[9],
      conditions: getConditions({ type: 3 }),
      logicType: 0, // BOOLEAN_AND
      maxAmount: 10,
      resolveDeadline: RESOLVE_DEADLINE,
      resolveTimeout: RESOLVE_TIMEOUT,
      payResolver: payResolver.address
    });
    const payHash = sha3(web3.utils.bytesToHex(payBytes));
    const requestBytes = getResolvePayByConditionsRequestBytes({
      condPayBytes: payBytes,
      hashPreimages: [web3.utils.hexToBytes(TRUE_PREIMAGE)]
    });

    const tx = await payResolver.resolvePaymentByConditions(requestBytes);
    const { event, args } = tx.logs[0];

    fs.appendFileSync(
      GAS_USED_LOG,
      'resolvePaymentByConditions(): ' + getCallGasUsed(tx) + '\n'
    );

    assert.equal(event, 'ResolvePayment');
    assert.equal(args.payId, calculatePayId(payHash, payResolver.address));
    assert.equal(args.amount.toString(), 10);
    assert.equal(args.resolveDeadline.toString(), tx.receipt.blockNumber);
  });

  it('should resolve pay by conditions correctly when the logic is BOOLEAN_AND and some contract conditions are false', async () => {
    const payBytes = getConditionalPayBytes({
      payTimestamp: Date.now(),
      paySrc: accounts[8],
      payDest: accounts[9],
      conditions: getConditions({ type: 1 }),
      logicType: 0, // BOOLEAN_AND
      maxAmount: 20,
      resolveDeadline: RESOLVE_DEADLINE,
      resolveTimeout: RESOLVE_TIMEOUT,
      payResolver: payResolver.address
    });
    const payHash = sha3(web3.utils.bytesToHex(payBytes));
    const requestBytes = getResolvePayByConditionsRequestBytes({
      condPayBytes: payBytes,
      hashPreimages: [web3.utils.hexToBytes(TRUE_PREIMAGE)]
    });

    const tx = await payResolver.resolvePaymentByConditions(requestBytes);
    const { event, args } = tx.logs[0];

    assert.equal(event, 'ResolvePayment');
    assert.equal(args.payId, calculatePayId(payHash, payResolver.address));
    assert.equal(args.amount.toString(), 0);
    assert.equal(args.resolveDeadline.toString(), tx.receipt.blockNumber + RESOLVE_TIMEOUT);
  });

  it('should resolve pay by conditions correctly when the logic is BOOLEAN_OR and some contract conditions are true', async () => {
    const payBytes = getConditionalPayBytes({
      payTimestamp: Date.now(),
      paySrc: accounts[8],
      payDest: accounts[9],
      conditions: getConditions({ type: 2 }),
      logicType: 1, // BOOLEAN_OR
      maxAmount: 30,
      resolveDeadline: RESOLVE_DEADLINE,
      resolveTimeout: RESOLVE_TIMEOUT,
      payResolver: payResolver.address
    });
    const payHash = sha3(web3.utils.bytesToHex(payBytes));
    const requestBytes = getResolvePayByConditionsRequestBytes({
      condPayBytes: payBytes,
      hashPreimages: [web3.utils.hexToBytes(TRUE_PREIMAGE)]
    });

    const tx = await payResolver.resolvePaymentByConditions(requestBytes);
    const { event, args } = tx.logs[0];

    assert.equal(event, 'ResolvePayment');
    assert.equal(args.payId, calculatePayId(payHash, payResolver.address));
    assert.equal(args.amount.toString(), 30);
    assert.equal(args.resolveDeadline.toString(), tx.receipt.blockNumber);
  });

  it('should resolve pay by conditions correctly when the logic is BOOLEAN_OR and all contract conditions are false', async () => {
    const payBytes = getConditionalPayBytes({
      payTimestamp: Date.now(),
      paySrc: accounts[8],
      payDest: accounts[9],
      conditions: getConditions({ type: 0 }),
      logicType: 1, // BOOLEAN_OR
      maxAmount: 30,
      resolveDeadline: RESOLVE_DEADLINE,
      resolveTimeout: RESOLVE_TIMEOUT,
      payResolver: payResolver.address
    });
    const payHash = sha3(web3.utils.bytesToHex(payBytes));
    const requestBytes = getResolvePayByConditionsRequestBytes({
      condPayBytes: payBytes,
      hashPreimages: [web3.utils.hexToBytes(TRUE_PREIMAGE)]
    });

    const tx = await payResolver.resolvePaymentByConditions(requestBytes);
    const { event, args } = tx.logs[0];

    assert.equal(event, 'ResolvePayment');
    assert.equal(args.payId, calculatePayId(payHash, payResolver.address));
    assert.equal(args.amount.toString(), 0);
    assert.equal(args.resolveDeadline.toString(), tx.receipt.blockNumber + RESOLVE_TIMEOUT);
  });

  it('should resolve pay by vouched result correctly', async () => {
    sharedPayBytes = getConditionalPayBytes({
      payTimestamp: 0,
      paySrc: accounts[8],
      payDest: accounts[9],
      conditions: getConditions({ type: 5 }),
      logicType: 3, // NUMERIC_ADD
      maxAmount: 100,
      resolveDeadline: RESOLVE_DEADLINE,
      resolveTimeout: RESOLVE_TIMEOUT,
      payResolver: payResolver.address
    });
    sharedPayHash = sha3(web3.utils.bytesToHex(sharedPayBytes));
    const vouchedCondPayResultBytes = await getVouchedCondPayResultBytes({
      condPay: sharedPayBytes,
      amount: 20,
      src: accounts[8],
      dest: accounts[9]
    });

    const tx = await payResolver.resolvePaymentByVouchedResult(vouchedCondPayResultBytes);
    const { event, args } = tx.logs[0];
    sharedResolveDeadline = tx.receipt.blockNumber + RESOLVE_TIMEOUT;

    fs.appendFileSync(GAS_USED_LOG, 'resolvePaymentByVouchedResult(): ' + getCallGasUsed(tx) + '\n');

    assert.equal(event, 'ResolvePayment');
    assert.equal(args.payId, calculatePayId(sharedPayHash, payResolver.address));
    assert.equal(args.amount.toString(), 20);
    assert.equal(args.resolveDeadline.toString(), sharedResolveDeadline);
  });

  it('should resolve pay by vouched result correctly when the new result is larger than the old result', async () => {
    const vouchedCondPayResultBytes = await getVouchedCondPayResultBytes({
      condPay: sharedPayBytes,
      amount: 25,
      src: accounts[8],
      dest: accounts[9]
    });

    const tx = await payResolver.resolvePaymentByVouchedResult(vouchedCondPayResultBytes);
    const { event, args } = tx.logs[0];

    assert.equal(event, 'ResolvePayment');
    assert.equal(args.payId, calculatePayId(sharedPayHash, payResolver.address));
    assert.equal(args.amount.toString(), 25);
    assert.equal(args.resolveDeadline.toString(), sharedResolveDeadline);
  });

  it('should resolve pay by conditions correctly when the new result is larger than the old result', async () => {
    const requestBytes = getResolvePayByConditionsRequestBytes({
      condPayBytes: sharedPayBytes,
      hashPreimages: [web3.utils.hexToBytes(TRUE_PREIMAGE)]
    });

    const tx = await payResolver.resolvePaymentByConditions(requestBytes);
    const { event, args } = tx.logs[0];

    assert.equal(event, 'ResolvePayment');
    assert.equal(args.payId, calculatePayId(sharedPayHash, payResolver.address));
    assert.equal(args.amount.toString(), 35);
    assert.equal(args.resolveDeadline.toString(), sharedResolveDeadline);
  });

  it('should fail to resolve pay by vouched result when the new result is smaller than the old result', async () => {
    const vouchedCondPayResultBytes = await getVouchedCondPayResultBytes({
      condPay: sharedPayBytes,
      amount: 30,
      src: accounts[8],
      dest: accounts[9]
    });

    try {
      await payResolver.resolvePaymentByVouchedResult(vouchedCondPayResultBytes);
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
      await payResolver.resolvePaymentByVouchedResult(vouchedCondPayResultBytes);
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
      conditions: getConditions({ type: 1 }),
      logicType: 0, // BOOLEAN_AND
      maxAmount: 10,
      resolveDeadline: 1,
      resolveTimeout: RESOLVE_TIMEOUT,
      payResolver: payResolver.address
    });
    const requestBytes = getResolvePayByConditionsRequestBytes({
      condPayBytes: payBytes,
      hashPreimages: [web3.utils.hexToBytes(TRUE_PREIMAGE)]
    });

    try {
      await payResolver.resolvePaymentByConditions(requestBytes);
    } catch (error) {
      assert.isAbove(
        error.message.search('Passed pay resolve deadline in condPay msg'),
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
      conditions: getConditions({ type: 1 }),
      logicType: 0, // BOOLEAN_AND
      maxAmount: 100,
      resolveDeadline: 1,
      resolveTimeout: RESOLVE_TIMEOUT,
      payResolver: payResolver.address
    });
    const vouchedCondPayResultBytes = await getVouchedCondPayResultBytes({
      condPay: payBytes,
      amount: 20,
      src: accounts[8],
      dest: accounts[9]
    });

    try {
      await payResolver.resolvePaymentByVouchedResult(vouchedCondPayResultBytes);
    } catch (error) {
      assert.isAbove(
        error.message.search('Passed pay resolve deadline in condPay msg'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should fail to resolve pay by vouched result after onchain resolve pay deadline', async () => {
    const payBytes = getConditionalPayBytes({
      payTimestamp: Date.now(),
      paySrc: accounts[8],
      payDest: accounts[9],
      conditions: getConditions({ type: 1 }),
      logicType: 0, // BOOLEAN_AND
      maxAmount: 100,
      resolveDeadline: RESOLVE_DEADLINE,
      resolveTimeout: RESOLVE_TIMEOUT,
      payResolver: payResolver.address
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

    await payResolver.resolvePaymentByVouchedResult(vouchedCondPayResultBytes0);
    const block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + 11, accounts[0]);

    try {
      await payResolver.resolvePaymentByVouchedResult(vouchedCondPayResultBytes1);
    } catch (error) {
      assert.isAbove(
        error.message.search('Passed onchain resolve pay deadline'),
        -1
      );
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should fail to resolve pay by conditions after onchain resolve pay deadline', async () => {
    const payBytes = getConditionalPayBytes({
      payTimestamp: Date.now(),
      paySrc: accounts[8],
      payDest: accounts[9],
      conditions: getConditions({ type: 1 }),
      logicType: 0, // BOOLEAN_AND
      maxAmount: 200,
      resolveDeadline: RESOLVE_DEADLINE,
      resolveTimeout: RESOLVE_TIMEOUT,
      payResolver: payResolver.address
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

    await payResolver.resolvePaymentByVouchedResult(vouchedCondPayResultBytes);
    const block = await web3.eth.getBlock('latest');
    await mineBlockUntil(block.number + 11, accounts[0]);

    try {
      await payResolver.resolvePaymentByConditions(requestBytes);
    } catch (error) {
      assert.isAbove(
        error.message.search('Passed onchain resolve pay deadline'),
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
      conditions: getConditions({ type: 4 }),
      logicType: 1, // BOOLEAN_OR
      maxAmount: 200,
      resolveDeadline: RESOLVE_DEADLINE,
      resolveTimeout: RESOLVE_TIMEOUT,
      payResolver: payResolver.address
    });

    const requestBytes = getResolvePayByConditionsRequestBytes({
      condPayBytes: payBytes,
      hashPreimages: [web3.utils.hexToBytes(TRUE_PREIMAGE), web3.utils.hexToBytes(FALSE_PREIMAGE)]
    });

    try {
      await payResolver.resolvePaymentByConditions(requestBytes);
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
      conditions: getConditions({ type: 5 }),
      logicType: 3, // NUMERIC_ADD
      maxAmount: 50,
      resolveDeadline: RESOLVE_DEADLINE,
      resolveTimeout: RESOLVE_TIMEOUT,
      payResolver: payResolver.address
    });
    const payHash = sha3(web3.utils.bytesToHex(payBytes));
    const requestBytes = getResolvePayByConditionsRequestBytes({
      condPayBytes: payBytes,
      hashPreimages: [web3.utils.hexToBytes(TRUE_PREIMAGE)]
    });

    const tx = await payResolver.resolvePaymentByConditions(requestBytes);
    const { event, args } = tx.logs[0];

    assert.equal(event, 'ResolvePayment');
    assert.equal(args.payId, calculatePayId(payHash, payResolver.address));
    assert.equal(args.amount.toString(), 35);
    assert.equal(args.resolveDeadline.toString(), tx.receipt.blockNumber + RESOLVE_TIMEOUT);
  });

  it('should resolve pay by conditions correctly when the logic is NUMERIC_MAX', async () => {
    const payBytes = getConditionalPayBytes({
      payTimestamp: Date.now(),
      paySrc: accounts[8],
      payDest: accounts[9],
      conditions: getConditions({ type: 5 }),
      logicType: 4, // NUMERIC_MAX
      maxAmount: 50,
      resolveDeadline: RESOLVE_DEADLINE,
      resolveTimeout: RESOLVE_TIMEOUT,
      payResolver: payResolver.address
    });
    const payHash = sha3(web3.utils.bytesToHex(payBytes));
    const requestBytes = getResolvePayByConditionsRequestBytes({
      condPayBytes: payBytes,
      hashPreimages: [web3.utils.hexToBytes(TRUE_PREIMAGE)]
    });

    const tx = await payResolver.resolvePaymentByConditions(requestBytes);
    const { event, args } = tx.logs[0];

    assert.equal(event, 'ResolvePayment');
    assert.equal(args.payId, calculatePayId(payHash, payResolver.address));
    assert.equal(args.amount.toString(), 25);
    assert.equal(args.resolveDeadline.toString(), tx.receipt.blockNumber + RESOLVE_TIMEOUT);
  });

  it('should resolve pay by conditions correctly when the logic is NUMERIC_MIN', async () => {
    const payBytes = getConditionalPayBytes({
      payTimestamp: Date.now(),
      paySrc: accounts[8],
      payDest: accounts[9],
      conditions: getConditions({ type: 5 }),
      logicType: 5, // NUMERIC_MIN
      maxAmount: 50,
      resolveDeadline: RESOLVE_DEADLINE,
      resolveTimeout: RESOLVE_TIMEOUT,
      payResolver: payResolver.address
    });
    const payHash = sha3(web3.utils.bytesToHex(payBytes));
    const requestBytes = getResolvePayByConditionsRequestBytes({
      condPayBytes: payBytes,
      hashPreimages: [web3.utils.hexToBytes(TRUE_PREIMAGE)]
    });

    const tx = await payResolver.resolvePaymentByConditions(requestBytes);
    const { event, args } = tx.logs[0];

    assert.equal(event, 'ResolvePayment');
    assert.equal(args.payId, calculatePayId(payHash, payResolver.address));
    assert.equal(args.amount.toString(), 10);
    assert.equal(args.resolveDeadline.toString(), tx.receipt.blockNumber + RESOLVE_TIMEOUT);
  });

  it('should resolve pay using max amount with any transfer logic as long as there are no contract conditions', async () => {
    const maxAmount = 50;
    for (let logicType = 0; logicType < 6; logicType++) {
      if (logicType == 2) {
        // BOOLEAN_CIRCUIT has not been implemented yet
        continue;
      }

      const payBytes = getConditionalPayBytes({
        payTimestamp: Date.now(),
        paySrc: accounts[8],
        payDest: accounts[9],
        conditions: getConditions({ type: 6 }),
        logicType: logicType,
        maxAmount: maxAmount,
        resolveDeadline: RESOLVE_DEADLINE,
        resolveTimeout: RESOLVE_TIMEOUT,
        payResolver: payResolver.address
      });
      const payHash = sha3(web3.utils.bytesToHex(payBytes));
      const requestBytes = getResolvePayByConditionsRequestBytes({
        condPayBytes: payBytes,
        hashPreimages: [web3.utils.hexToBytes(TRUE_PREIMAGE)]
      });

      const tx = await payResolver.resolvePaymentByConditions(requestBytes);
      const { event, args } = tx.logs[0];

      assert.equal(event, 'ResolvePayment');
      assert.equal(args.payId, calculatePayId(payHash, payResolver.address));
      assert.equal(args.amount.toString(), maxAmount);
      assert.equal(args.resolveDeadline.toString(), tx.receipt.blockNumber);
    }
  });

  it('should use current block number as onchain resolve deadline if updated amount = max', async () => {
    const payBytes = getConditionalPayBytes({
      payTimestamp: 0,
      paySrc: accounts[8],
      payDest: accounts[9],
      conditions: getConditions({ type: 5 }),
      logicType: 3, // NUMERIC_ADD
      maxAmount: 35,
      resolveDeadline: RESOLVE_DEADLINE,
      resolveTimeout: RESOLVE_TIMEOUT,
      payResolver: payResolver.address
    });

    // first resolving by vouched result
    payHash = sha3(web3.utils.bytesToHex(payBytes));
    const vouchedCondPayResultBytes = await getVouchedCondPayResultBytes({
      condPay: payBytes,
      amount: 20,
      src: accounts[8],
      dest: accounts[9]
    });

    let tx = await payResolver.resolvePaymentByVouchedResult(vouchedCondPayResultBytes);
    assert.equal(tx.logs[0].event, 'ResolvePayment');
    assert.equal(tx.logs[0].args.payId, calculatePayId(payHash, payResolver.address));
    assert.equal(tx.logs[0].args.amount.toString(), 20);
    assert.equal(tx.logs[0].args.resolveDeadline.toString(), tx.receipt.blockNumber + RESOLVE_TIMEOUT);

    // second resolving by conditions
    const requestBytes = getResolvePayByConditionsRequestBytes({
      condPayBytes: payBytes,
      hashPreimages: [web3.utils.hexToBytes(TRUE_PREIMAGE)]
    });

    tx = await payResolver.resolvePaymentByConditions(requestBytes);
    assert.equal(tx.logs[0].event, 'ResolvePayment');
    assert.equal(tx.logs[0].args.payId, calculatePayId(payHash, payResolver.address));
    assert.equal(tx.logs[0].args.amount.toString(), 35);
    assert.equal(tx.logs[0].args.resolveDeadline.toString(), tx.receipt.blockNumber);
  });
});
