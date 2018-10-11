'use strict';

var Web3 = require('web3');
var web3 = new Web3(new Web3.providers.HttpProvider('http://localhost:8545'));

const reg = artifacts.require('HTLRegistry');

contract('HTLRegistry', async accounts => {
  it('should return false when secret has not been registered', async () => {
    let instance = await reg.deployed();
    let r1 = await instance.isSatisfied.call(
      web3.utils.soliditySha3(web3.utils.toHex('0x01'))
    );
    assert(!r1);
  });

  it('should be able to resolve secret and check for finalization and satisification', async () => {
    let instance = await reg.deployed();
    const secret = web3.utils.toHex('0x01');

    const blockBefore = await web3.eth.getBlockNumber();
    const receipt = await instance.resolve(secret);
    const blockAfter = await web3.eth.getBlockNumber();
    
    const {event, args} = receipt.logs[0];
    assert.equal(event, 'SecretRegistry');
    assert.equal(args.secret, secret);
    assert.equal(args.secretHash, web3.utils.soliditySha3(secret));
    assert.isOk(blockBefore <= args.time && args.time <= blockAfter);

    let r1 = await instance.isSatisfied.call(
      web3.utils.soliditySha3(secret)
    );
    var block = await web3.eth.getBlockNumber();
    console.log(block);
    let r2 = await instance.isFinalized.call(
      web3.utils.soliditySha3(secret),
      block + 100
    );
    let r3 = await instance.isFinalized.call(
      web3.utils.soliditySha3(secret),
      block - 100
    );

    assert(r1);
    assert(r2);
    assert(!r3);
  });
});
