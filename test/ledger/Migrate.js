const Web3 = require('web3');
const web3 = new Web3(new Web3.providers.HttpProvider('http://localhost:8545'));
const sha3 = web3.utils.keccak256;

const protoChainFactory = require('../helper/protoChainFactory');

const fs = require('fs');

const utilities = require('../helper/utilities');
const {
    mineBlockUntil,
    getSortedArray,
    getCoSignedIntendSettle,
    getCallGasUsed,
    calculatePayId
} = utilities;

const LedgerStruct = artifacts.require('LedgerStruct');
const LedgerOperation = artifacts.require('LedgerOperation');
const LedgerBalanceLimit = artifacts.require('LedgerBalanceLimit');
const LedgerMigrate = artifacts.require('LedgerMigrate');
const LedgerChannel = artifacts.require('LedgerChannel');

const CelerWallet = artifacts.require('CelerWallet');
const EthPool = artifacts.require('EthPool');
const CelerLedger = artifacts.require('CelerLedger');
const VirtResolver = artifacts.require('VirtContractResolver');
const ERC20ExampleToken = artifacts.require('ERC20ExampleToken');
const PayRegistry = artifacts.require('PayRegistry');
const PayResolver = artifacts.require('PayResolver');

contract('CelerLedger migration', async accounts => {
    const ETH_ADDR = '0x0000000000000000000000000000000000000000';
    const DISPUTE_TIMEOUT = 20;
    const GAS_USED_LOG = 'gas_used_logs/CelerLedger-Migrate.txt';
    // the meaning of the index: [peer index][pay hash list index][pay index]
    const PEERS_PAY_HASH_LISTS_AMTS = [[[1, 2]], [[3, 4]]];

    const peers = getSortedArray([accounts[0], accounts[1]]);
    const clients = [accounts[8], accounts[9]];  // namely [src, dest]

    let ledgerOld;
    let ledgerNew;
    let wallet;
    let ethPool;
    let payResolver;
    let channelId;
    let eRC20ExampleToken;
    let uniqueOpenDeadline = 5000000;  // make hash of each channelInitializer unique

    let protoChainInstance;
    let getOpenChannelRequest;
    let getSignedSimplexStateArrayBytes;
    let getResolvePayByConditionsRequestBytes;
    let getPayIdListInfo;
    let getMigrationRequest;

    before(async () => {
        fs.writeFileSync(GAS_USED_LOG, '********** Gas Used in CelerLedger-ETH Tests **********\n\n');
        fs.appendFileSync(GAS_USED_LOG, '***** Function Calls Gas Used *****\n');

        const virtResolver = await VirtResolver.new();
        ethPool = await EthPool.new();
        eRC20ExampleToken = await ERC20ExampleToken.new();
        payRegistry = await PayRegistry.new();
        payResolver = await PayResolver.new(payRegistry.address, virtResolver.address);
        wallet = await CelerWallet.new();

        // deploy and link libraries
        const ledgerStuctLib = await LedgerStruct.new();

        await LedgerChannel.link("LedgerStruct", ledgerStuctLib.address);
        const ledgerChannel = await LedgerChannel.new();

        await LedgerBalanceLimit.link("LedgerStruct", ledgerStuctLib.address);
        const ledgerBalanceLimit = await LedgerBalanceLimit.new();

        await LedgerOperation.link("LedgerStruct", ledgerStuctLib.address);
        await LedgerOperation.link("LedgerChannel", ledgerChannel.address);
        const ledgerOperation = await LedgerOperation.new();

        await LedgerMigrate.link("LedgerStruct", ledgerStuctLib.address);
        await LedgerMigrate.link("LedgerOperation", ledgerOperation.address);
        await LedgerMigrate.link("LedgerChannel", ledgerChannel.address);
        const ledgerMigrate = await LedgerMigrate.new();

        await CelerLedger.link("LedgerStruct", ledgerStuctLib.address);
        await CelerLedger.link("LedgerOperation", ledgerOperation.address);
        await CelerLedger.link("LedgerBalanceLimit", ledgerBalanceLimit.address);
        await CelerLedger.link("LedgerMigrate", ledgerMigrate.address);
        await CelerLedger.link("LedgerChannel", ledgerChannel.address);
        ledgerOld = await CelerLedger.new(
            ethPool.address,
            payRegistry.address,
            wallet.address
        );
        ledgerNew = await CelerLedger.new(
            ethPool.address,
            payRegistry.address,
            wallet.address
        );

        // disable balance limits for both ledger
        await ledgerOld.disableBalanceLimits();
        await ledgerNew.disableBalanceLimits();

        protoChainInstance = await protoChainFactory(peers, clients);
        getOpenChannelRequest = protoChainInstance.getOpenChannelRequest;
        getCooperativeWithdrawRequestBytes = protoChainInstance.getCooperativeWithdrawRequestBytes;
        getSignedSimplexStateArrayBytes = protoChainInstance.getSignedSimplexStateArrayBytes;
        getCooperativeSettleRequestBytes = protoChainInstance.getCooperativeSettleRequestBytes;
        getResolvePayByConditionsRequestBytes = protoChainInstance.getResolvePayByConditionsRequestBytes;
        getPayIdListInfo = protoChainInstance.getPayIdListInfo;
        getMigrationRequest = protoChainInstance.getMigrationRequest;

        // make sure peers deposit enough ETH in ETH pool
        await ethPool.deposit(peers[0], { value: 1000000000 });
        await ethPool.deposit(peers[1], { value: 1000000000 });

        // make sure peers have enough ERC20
        await eRC20ExampleToken.transfer(accounts[1], 1000000000);
    });

    describe('with ETH channel', async () => {
        beforeEach(async () => {
            // create a new channel with depositing some ETH
            await ethPool.approve(ledgerOld.address, 200, { from: peers[1] });

            const request = await getOpenChannelRequest({
                openDeadline: uniqueOpenDeadline++,
                disputeTimeout: DISPUTE_TIMEOUT
            });
            const openChannelRequest = web3.utils.bytesToHex(
                request.openChannelRequestBytes
            );

            const tx = await ledgerOld.openChannel(openChannelRequest, { value: 100 });
            const { event, args } = tx.logs[0];
            channelId = args.channelId.toString();

            assert.equal(event, 'OpenChannel');
            assert.equal(args.tokenType, 1); //  '1' for ETH
            assert.equal(args.tokenAddress, ETH_ADDR);
            assert.deepEqual(args.peerAddrs, peers);
            assert.equal(args.initialDeposits.toString(), [100, 200]);
        });

        it('should migrate an Operable ETH channel correctly', async () => {
            const usedGas = await migrationTest(channelId);
            fs.appendFileSync(GAS_USED_LOG, 'migrateChannelFrom() an Operable ETH channel: ' + usedGas + '\n');
        });

        it('should migrate an Settling ETH channel correctly', async () => {
            await migrateSettlingChannelTest(channelId);
        });
    });

    describe('with ERC20 channel', async () => {
        beforeEach(async () => {
            // create a new channel with depositing some ERC20 tokens
            await eRC20ExampleToken.approve(ledgerOld.address, 100, { from: peers[0] });
            await eRC20ExampleToken.approve(ledgerOld.address, 200, { from: peers[1] });

            const request = await getOpenChannelRequest({
                openDeadline: uniqueOpenDeadline++,
                CelerLedgerAddress: ledgerOld.address,
                disputeTimeout: DISPUTE_TIMEOUT,
                tokenAddress: eRC20ExampleToken.address,
                tokenType: 2  // '2' for ERC20
            });
            const openChannelRequest = web3.utils.bytesToHex(
                request.openChannelRequestBytes
            );

            const tx = await ledgerOld.openChannel(openChannelRequest);
            const { event, args } = tx.logs[0];
            channelId = args.channelId.toString();

            assert.equal(event, 'OpenChannel');
            assert.equal(args.tokenType, 2); //  2 for ERC20
            assert.equal(args.tokenAddress, eRC20ExampleToken.address);
            assert.deepEqual(args.peerAddrs, peers);
            assert.equal(args.initialDeposits.toString(), [100, 200]);
        });

        it('should migrate an Operable ERC20 channel correctly', async () => {
            const usedGas = await migrationTest(channelId);
            fs.appendFileSync(GAS_USED_LOG, 'migrateChannelFrom() an Operable ERC20 channel: ' + usedGas + '\n');
        });

        it('should migrate an Settling ERC20 channel correctly', async () => {
            await migrateSettlingChannelTest(channelId);
        });
    });

    async function migrateSettlingChannelTest(channelId) {
        const tokenAddr = await ledgerOld.getTokenContract(channelId);

        const settleBundle = await prepareIntendSettle(channelId);

        // intendSettle in old ledger
        await intendSettleTest(ledgerOld, channelId, settleBundle);

        // ledger migration
        const usedGas = await migrationTest(channelId);
        if (tokenAddr == ETH_ADDR) {
            fs.appendFileSync(GAS_USED_LOG, 'migrateChannelFrom() an Settling ETH channel: ' + usedGas + '\n');
        } else {
            fs.appendFileSync(GAS_USED_LOG, 'migrateChannelFrom() an Settling ERC20 channel: ' + usedGas + '\n');
        }

        // intendSettle in new ledger
        await intendSettleTest(ledgerNew, channelId, settleBundle);

        let walletBalance = await wallet.getBalance(channelId, tokenAddr);
        assert.equal(walletBalance.toString(), '300');

        // confirmSettle in new ledger
        const settleBalance = await confirmSettleTest(ledgerNew, channelId);

        // further checks
        walletBalance = await wallet.getBalance(channelId, tokenAddr);
        assert.equal(walletBalance.toString(), '0');
    }

    async function migrationTest(channelId) {
        const request = await getMigrationRequest({
            channelId: channelId,
            fromLedgerAddress: ledgerOld.address,
            toLedgerAddress: ledgerNew.address,
            migrationDeadline: 99999999
        });

        let tx = await ledgerNew.migrateChannelFrom(ledgerOld.address, request);

        // event from old ledger contract
        assert.equal(tx.logs[0].event, 'MigrateChannelTo');
        assert.equal(tx.logs[0].address, ledgerOld.address);
        assert.equal(tx.logs[0].args.channelId, channelId);
        assert.equal(tx.logs[0].args.newLedgerAddr, ledgerNew.address);
        // event from new ledger contract
        assert.equal(tx.logs[1].event, 'MigrateChannelFrom');
        assert.equal(tx.logs[1].address, ledgerNew.address);
        assert.equal(tx.logs[1].args.channelId, channelId);
        assert.equal(tx.logs[1].args.oldLedgerAddr, ledgerOld.address);

        // wallet contract
        const operator = await wallet.getOperator(channelId);
        assert.equal(operator, ledgerNew.address);

        // states of old ledger contract
        let status = await ledgerOld.getChannelStatus(channelId);
        assert.equal(status, 4);  // 4 for Migrated
        let migratedTo = await ledgerOld.getMigratedTo(channelId);
        assert.equal(migratedTo, ledgerNew.address);

        // states of new ledger contract
        status = await ledgerNew.getChannelStatus(channelId);
        assert.equal(status, 1);  // 1 for Operable
        const oldBalanceMap = await ledgerOld.getBalanceMap(channelId);
        const newBalanceMap = await ledgerNew.getBalanceMap(channelId);
        assert.deepEqual(oldBalanceMap, newBalanceMap);
        const oldTokenContract = await ledgerOld.getTokenContract(channelId);
        const newTokenContract = await ledgerNew.getTokenContract(channelId);
        assert.deepEqual(oldTokenContract, newTokenContract);
        const oldTokenType = await ledgerOld.getTokenType(channelId);
        const newTokenType = await ledgerNew.getTokenType(channelId);
        assert.deepEqual(oldTokenType, newTokenType);
        const oldCooperativeWithdrawSeqNum = await ledgerOld.getCooperativeWithdrawSeqNum(channelId);
        const newCooperativeWithdrawSeqNum = await ledgerNew.getCooperativeWithdrawSeqNum(channelId);
        assert.deepEqual(oldCooperativeWithdrawSeqNum, newCooperativeWithdrawSeqNum);
        const oldChannelMigrationArgs = await ledgerOld.getChannelMigrationArgs(channelId);
        const newChannelMigrationArgs = await ledgerNew.getChannelMigrationArgs(channelId);
        assert.deepEqual(oldChannelMigrationArgs, newChannelMigrationArgs);
        const oldPeersMigrationInfo = await ledgerOld.getPeersMigrationInfo(channelId);
        const newPeersMigrationInfo = await ledgerNew.getPeersMigrationInfo(channelId);
        assert.deepEqual(oldPeersMigrationInfo, newPeersMigrationInfo);

        return getCallGasUsed(tx);
    }

    async function prepareIntendSettle(channelId) {
        const settleBundle = await getCoSignedIntendSettle(
            getPayIdListInfo,
            getSignedSimplexStateArrayBytes,
            [channelId, channelId],
            PEERS_PAY_HASH_LISTS_AMTS,
            [1, 1],  // seqNums
            [999999999, 9999999999],  // lastPayResolveDeadlines
            [10, 20],  // transferAmounts
            payResolver.address  // payResolverAddr
        );

        // resolve the payments in head PayIdList for both peers
        for (let peerFrom = 0; peerFrom < 2; peerFrom++) {
            for (let i = 0; i < settleBundle.condPays[peerFrom][0].length; i++) {
                const requestBytes = getResolvePayByConditionsRequestBytes({
                    condPayBytes: settleBundle.condPays[peerFrom][0][i]
                });
                await payResolver.resolvePaymentByConditions(requestBytes);
            }
        }

        // pass onchain resolve deadline of all onchain resolved pays
        // but not pass the last pay resolve deadline
        let block = await web3.eth.getBlock('latest');
        await mineBlockUntil(block.number + 6, accounts[0]);

        return settleBundle;
    }

    async function intendSettleTest(instance, channelId, settleBundle) {
        const tx = await instance.intendSettle(settleBundle.signedSimplexStateArrayBytes);

        let block = await web3.eth.getBlock('latest');
        const settleFinalizedTime = await instance.getSettleFinalizedTime(channelId);
        const expectedSettleFinalizedTime = DISPUTE_TIMEOUT + block.number;
        assert.equal(expectedSettleFinalizedTime, settleFinalizedTime);

        const status = await instance.getChannelStatus(channelId);
        assert.equal(status, 2);

        const amounts = [1, 2, 3, 4];
        for (let i = 0; i < 2; i++) {  // for each simplex state
            for (j = 0; j < 2; j++) {  // for each pays in head PayIdList
                const logIndex = i * 2 + j;
                assert.equal(tx.logs[logIndex].event, 'ClearOnePay');
                assert.equal(tx.logs[logIndex].args.channelId, channelId);
                const payHash = sha3(web3.utils.bytesToHex(settleBundle.condPays[i][0][j]));
                const payId = calculatePayId(payHash, payResolver.address);
                assert.equal(tx.logs[logIndex].args.payId, payId);
                assert.equal(tx.logs[logIndex].args.peerFrom, peers[i]);
                assert.equal(tx.logs[logIndex].args.amount.toString(), amounts[logIndex]);
            }
        }

        assert.equal(tx.logs[4].event, 'IntendSettle');
        assert.equal(tx.logs[4].args.channelId, channelId);
        assert.equal(tx.logs[4].args.seqNums.toString(), [1, 1]);
    }

    async function confirmSettleTest(instance, channelId) {
        // pass settleFinalizedTime
        const settleFinalizedTime = await instance.getSettleFinalizedTime(channelId);
        await mineBlockUntil(settleFinalizedTime, accounts[0]);

        const tx = await instance.confirmSettle(channelId);
        const status = await instance.getChannelStatus(channelId);
        const { event, args } = tx.logs[0];

        assert.equal(event, 'ConfirmSettle');
        assert.equal(args.settleBalance.toString(), [114, 186]);
        assert.equal(status, 3);

        return args.settleBalance;
    }
});


/*
    // fail to migrate in expected failure conditions

    // malicious from ledger contract

    // malicious to ledger contract
*/
