const RouterRegistry = artifacts.require('RouterRegistry');

contract('RouterRegistry tests', (accounts) => {
    let instance;

    beforeEach(async () => {
        instance = await RouterRegistry.new();
    });

    it('should register the new address successfully', async () => {
        const tx = await instance.registerRouter({ from: accounts[0] });

        assert.equal(tx.logs[0].event, 'RouterUpdated');
        assert.equal(tx.logs[0].args.op, '0') // Add
        assert.equal(tx.logs[0].args.routerAddress, accounts[0]);
    });

    it('should fail to register the existing address', async () => {
        await instance.registerRouter({ from: accounts[1] });
        
        try {
            await instance.registerRouter({ from: accounts[1] });
        } catch(error) {
            assert.isAbove(error.message.search('Router address already exists'), -1);
            return;
        }

        assert.fail('should catch error before');
    });

    it('should deregister the existing address successfully', async () => {
        await instance.registerRouter({ from: accounts[1] });
        const tx = await instance.deregisterRouter({ from: accounts[1] });

        assert.equal(tx.logs[0].event, 'RouterUpdated');
        assert.equal(tx.logs[0].args.op, '1') // Remove
        assert.equal(tx.logs[0].args.routerAddress, accounts[1]);
    });

    it('should fail to deregister the new address', async () => {
        try {
            await instance.deregisterRouter({ from: accounts[2] });
        } catch(error) {
            assert.isAbove(error.message.search('Router address does not exist'), -1);
            return;
        }

        assert.fail('should catch error before');
    });

    it('should update the block number of existing address successfully', async () => {
        await instance.registerRouter({ from: accounts[4] });
        const tx = await instance.refreshRouter({ from: accounts[4] });

        assert.equal(tx.logs[0].event, 'RouterUpdated');
        assert.equal(tx.logs[0].args.op, '2') // Refresh
        assert.equal(tx.logs[0].args.routerAddress, accounts[4]);
    });

    it('should fail to update the block number of new address', async () => {
        try {
            await instance.refreshRouter({ from: accounts[5] });
        } catch(error) {
            assert.isAbove(error.message.search('Router address does not exist'), -1);
            return;
        }

        assert.fail('should catch error before');
    });

    it('should get the block number successfully', async () => {
        await instance.registerRouter({ from: accounts[0] });
        const addr = await instance.routerInfo( accounts[0], { from: accounts[0] })

        assert.notEqual(addr, 0, "Block numbers should not the same")
    });

    it('should get the default block number', async () => {
        await instance.registerRouter({ from: accounts[0] });
        const addr = await instance.routerInfo( accounts[1], { from: accounts[0] })

        assert.equal(addr, 0, "Block numbers should be the same")
    });
}); 