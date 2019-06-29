const CelerWallet = artifacts.require('CelerWallet');
const WalletTestHelper = artifacts.require('WalletTestHelper');
const ERC20ExampleToken = artifacts.require('ERC20ExampleToken');

contract('CelerWallet tests', async accounts => {
    let instance;
    let walletHelper;
    let walletId;
    let walletId2;
    let eRC20Token;
    const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

    before(async () => {
        eRC20Token = await ERC20ExampleToken.new();
        instance = await CelerWallet.new();
        walletHelper = await WalletTestHelper.new(instance.address);
    });

    it('should initialize pauser successfully', async () => {
        const isPauser = await instance.isPauser(accounts[0]);
        const isPaused = await instance.paused();

        assert.equal(isPauser, true);
        assert.equal(isPaused, false);
    });

    it('should fail to pause by a non-pauser', async () => {
        try {
            await instance.pause({ from: accounts[1] })
        } catch (error) {
            return;
        }

        assert.fail('should have thrown before');
    });

    it('should fail to drainToken when not paused', async () => {
        // create a wallet and deposit funds
        let tx = await walletHelper.create([accounts[2], accounts[3]], accounts[4], 0);
        walletId = tx.logs[0].args.walletId;
        instance.depositETH(walletId, { from: accounts[4], value: 100 });
        await eRC20Token.transfer(accounts[2], 100000, { from: accounts[0] });
        await eRC20Token.approve(instance.address, 100000, { from: accounts[2] });
        instance.depositERC20(walletId, eRC20Token.address, accounts[2], 200, { from: accounts[4] });

        tx = await walletHelper.create([accounts[2], accounts[3]], accounts[4], 1);
        walletId2 = tx.logs[0].args.walletId;

        let errNum = 0;
        try {
            await instance.drainToken(ZERO_ADDRESS, accounts[0], 100);
        } catch (error) {
            errNum++;
        }
        try {
            await instance.drainToken(eRC20Token.address, accounts[0], 200);
        } catch (error) {
            errNum++;
        }

        assert.equal(errNum.toString(), '2');
    });

    it('should pause successfully by pauser', async () => {
        const tx = await instance.pause();
        const { event, args } = tx.logs[0];

        assert.equal(event, 'Paused');
        assert.equal(args.account, accounts[0]);
    });

    it('should fail to operate when paused', async () => {
        let errNum = 0;

        try {
            await walletHelper.create([accounts[2], accounts[3]], accounts[4], 0);
        } catch (error) {
            // TODO: openzeppelin v2.1.2 doesn't have requrie msg. Need to upgrade it to use this check
            // assert.isAbove(error.message.search('Pausable: paused'), -1);
            errNum++;
        }
        try {
            await instance.depositETH(walletId, { from: account[4], value: 100 });
        } catch (error) {
            // TODO: openzeppelin v2.1.2 doesn't have requrie msg. Need to upgrade it to use this check
            // assert.isAbove(error.message.search('Pausable: paused'), -1);
            errNum++;
        }
        try {
            await instance.depositERC20(walletId, eRC20Token.address, accounts[2], 200, { from: accounts[4] });
        } catch (error) {
            // TODO: openzeppelin v2.1.2 doesn't have requrie msg. Need to upgrade it to use this check
            // assert.isAbove(error.message.search('Pausable: paused'), -1);
            errNum++;
        }
        try {
            await instance.withdraw(walletId, eRC20Token.address, accounts[2], 200, { from: accounts[4] });
        } catch (error) {
            // TODO: openzeppelin v2.1.2 doesn't have requrie msg. Need to upgrade it to use this check
            // assert.isAbove(error.message.search('Pausable: paused'), -1);
            errNum++;
        }
        try {
            await instance.transferToWallet(walletId, walletId2, eRC20Token.address, accounts[2], 200, { from: accounts[4] });
        } catch (error) {
            // TODO: openzeppelin v2.1.2 doesn't have requrie msg. Need to upgrade it to use this check
            // assert.isAbove(error.message.search('Pausable: paused'), -1);
            errNum++;
        }
        try {
            await instance.transferOperatorship(walletId, accounts[5], { from: accounts[4] });
        } catch (error) {
            // TODO: openzeppelin v2.1.2 doesn't have requrie msg. Need to upgrade it to use this check
            // assert.isAbove(error.message.search('Pausable: paused'), -1);
            errNum++;
        }

        assert.equal(errNum.toString(), '6');
    });

    it('should proposeNewOperator successfully even when paused', async () => {
        const tx = await instance.proposeNewOperator(walletId, accounts[5], { from: accounts[2] });
        const { event, args } = tx.logs[0];

        assert.equal(event, 'ProposeNewOperator');
        assert.equal(args.walletId, walletId);
        assert.equal(args.newOperator, accounts[5]);
        assert.equal(args.proposer, accounts[2]);
    });

    it('should drain tokens successfully when paused', async () => {
        const tx1 = await instance.drainToken(ZERO_ADDRESS, accounts[0], 100);
        assert.equal(tx1.logs[0].event, 'DrainToken');
        assert.equal(tx1.logs[0].args.tokenAddress, ZERO_ADDRESS);
        assert.equal(tx1.logs[0].args.receiver, accounts[0]);
        assert.equal(tx1.logs[0].args.amount.toString(), '100');

        const tx2 = await instance.drainToken(eRC20Token.address, accounts[1], 200);
        assert.equal(tx2.logs[0].event, 'DrainToken');
        assert.equal(tx2.logs[0].args.tokenAddress, eRC20Token.address);
        assert.equal(tx2.logs[0].args.receiver, accounts[1]);
        assert.equal(tx2.logs[0].args.amount.toString(), '200');
    });

    it('should renouncePauser successfully', async () => {
        const tx = await instance.renouncePauser();
        const { event, args } = tx.logs[0];
        const isPauser = await instance.isPauser(accounts[0]);

        assert.equal(event, 'PauserRemoved');
        assert.equal(args.account, accounts[0]);
        assert.equal(isPauser, false);
    });
});
