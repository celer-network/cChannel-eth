const Web3 = require('web3');
const web3 = new Web3(new Web3.providers.HttpProvider('http://localhost:8545'));

const fs = require('fs');

const utilities = require('./helper/utilities');
const {
  getDeployGasUsed,
  getCallGasUsed
} = utilities;

const EthPool = artifacts.require('EthPool');
const GAS_USED_LOG = 'gas_used_logs/EthPool.txt';

contract('EthPool', async accounts => {
  let instance;

  before(async () => {
    fs.writeFileSync(GAS_USED_LOG, '********** Gas Used in EthPool Tests **********\n\n');

    instance = await EthPool.new();
    fs.appendFileSync(GAS_USED_LOG, '***** Deploy Gas Used *****\n');
    let gasUsed = await getDeployGasUsed(instance);
    fs.appendFileSync(GAS_USED_LOG, 'EthPool Deploy Gas: ' + gasUsed + '\n');
    fs.appendFileSync(GAS_USED_LOG, '***** Function Calls Gas Used *****\n');
  });

  it('should deposit correctly', async () => {
    const tx = await instance.deposit(accounts[1], { value: 100 });
    const { event, args } = tx.logs[0];

    fs.appendFileSync(
      GAS_USED_LOG,
      'deposit(): ' + getCallGasUsed(tx) + '\n'
    );

    assert.equal(event, 'Deposit');
    assert.equal(args.receiver, accounts[1]);
    assert.equal(args.value.toString(), '100');
  });

  it('should fail to withdraw because of no deposit', async () => {
    try {
      await instance.withdraw(100, { from: accounts[0] });
    } catch (error) {
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should withdraw correctly', async () => {
    const tx = await instance.withdraw(100, { from: accounts[1] });
    const { event, args } = tx.logs[0];

    fs.appendFileSync(
      GAS_USED_LOG,
      'withdraw(): ' + getCallGasUsed(tx) + '\n'
    );

    assert.equal(event, 'Transfer');
    assert.equal(args.from, accounts[1]);
    assert.equal(args.to, accounts[1]);
    assert.equal(args.value.toString(), '100');
  });

  it('should approve correctly', async () => {
    const tx = await instance.approve(accounts[1], 200, { from: accounts[0] });
    const { event, args } = tx.logs[0];

    fs.appendFileSync(
      GAS_USED_LOG,
      'approve(): ' + getCallGasUsed(tx) + '\n'
    );

    assert.equal(event, 'Approval');
    assert.equal(args.owner, accounts[0]);
    assert.equal(args.spender, accounts[1]);
    assert.equal(args.value.toString(), '200');
  });

  it('should transferFrom correctly', async () => {
    const toAddress = "0x0000000000000000000000000000000123456789";
    // deposit first
    await instance.deposit(accounts[0], { value: 200 });

    const tx = await instance.transferFrom(
      accounts[0],  // owner
      toAddress,
      150,
      {
        from: accounts[1]  // spender
      }
    );

    fs.appendFileSync(
      GAS_USED_LOG,
      'transferFrom(): ' + getCallGasUsed(tx) + '\n'
    );

    assert.equal(tx.logs[0].event, 'Approval');
    assert.equal(tx.logs[0].args.owner, accounts[0]);
    assert.equal(tx.logs[0].args.spender, accounts[1]);
    assert.equal(tx.logs[0].args.value.toString(), '50');

    assert.equal(tx.logs[1].event, 'Transfer');
    assert.equal(tx.logs[1].args.from, accounts[0]);
    assert.equal(tx.logs[1].args.to, toAddress);
    assert.equal(tx.logs[1].args.value.toString(), '150');

    balance = await web3.eth.getBalance(toAddress);
    assert.equal(balance.toString(), '150');
  });

  it('should fail to transferFrom because approved amount is not enough', async () => {
    try {
      await instance.transferFrom(
        accounts[0],  // owner
        toAddress,
        100,
        {
          from: accounts[1]  // spender
        }
      );
    } catch (error) {
      return;
    }

    assert.fail('should have thrown before');
  });

  it('should increaseAllowance correctly', async () => {
    const tx = await instance.increaseAllowance(accounts[1], 50, { from: accounts[0] });
    const { event, args } = tx.logs[0];

    fs.appendFileSync(
      GAS_USED_LOG,
      'increaseAllowance(): ' + getCallGasUsed(tx) + '\n'
    );

    assert.equal(event, 'Approval');
    assert.equal(args.owner, accounts[0]);
    assert.equal(args.spender, accounts[1]);
    assert.equal(args.value.toString(), '100');
  });

  it('should decreaseAllowance correctly', async () => {
    const tx = await instance.decreaseAllowance(accounts[1], 80, { from: accounts[0] });
    const { event, args } = tx.logs[0];

    fs.appendFileSync(
      GAS_USED_LOG,
      'decreaseAllowance(): ' + getCallGasUsed(tx) + '\n'
    );

    assert.equal(event, 'Approval');
    assert.equal(args.owner, accounts[0]);
    assert.equal(args.spender, accounts[1]);
    assert.equal(args.value.toString(), '20');
  });
});
