pragma solidity ^0.5.1;

import "./lib/ledgerlib/LedgerStruct.sol";
import "./lib/ledgerlib/LedgerOperation.sol";
import "./lib/ledgerlib/LedgerBalanceLimit.sol";
import "./lib/ledgerlib/LedgerMigrate.sol";
import "./lib/ledgerlib/LedgerChannel.sol";
import "./lib/interface/ICelerWallet.sol";
import "./lib/interface/IEthPool.sol";
import "./lib/interface/IPayRegistry.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";

/**
 * @title CelerLedger wrapper contract
 * @notice A wrapper contract using libraries to provide CelerLedger's APIs.
 * @notice Ownable contract and LedgerBalanceLimit library should only be used
 *   in the initial stage of the mainnet operation for a very short period of
 *   time to limit the balance amount that can be deposit into each channel,
 *   so that any losses due to unknown bugs (if any) will be limited. The balance
 *   limits should be disabled and the owner account of CelerLedger should renounce
 *   its ownership after the system is stable and comprehensively audited.
 */
contract CelerLedger is ICelerLedger, Ownable {
    using LedgerOperation for LedgerStruct.Ledger;
    using LedgerBalanceLimit for LedgerStruct.Ledger;
    using LedgerMigrate for LedgerStruct.Ledger;
    using LedgerChannel for LedgerStruct.Channel;

    LedgerStruct.Ledger private ledger;

    /**
     * @notice CelerChannel constructor
     * @param _ethPool address of ETH pool
     * @param _payRegistry address of PayRegistry
     */
    constructor(address _ethPool, address _payRegistry, address _celerWallet) public {
        ledger.ethPool = IEthPool(_ethPool);
        ledger.payRegistry = IPayRegistry(_payRegistry);
        ledger.celerWallet = ICelerWallet(_celerWallet);
        // enable balance limits in default
        ledger.balanceLimitsEnabled = true;
    }

    /**
     * @notice Set the per-channel balance limits of given tokens
     * @param _tokenAddrs addresses of the tokens (address(0) is for ETH)
     * @param _limits balance limits of the tokens
     */
    function setBalanceLimits(
        address[] calldata _tokenAddrs,
        uint[] calldata _limits
    )
        external
        onlyOwner
    {
        ledger.setBalanceLimits(_tokenAddrs, _limits);
    }

    /**
     * @notice Disable balance limits of all tokens
     */
    function disableBalanceLimits() external onlyOwner {
        ledger.disableBalanceLimits();
    }

    /**
     * @notice Enable balance limits of all tokens
     */
    function enableBalanceLimits() external onlyOwner {
        ledger.enableBalanceLimits();
    }

    /**
     * @notice Open a state channel through auth withdraw message
     * @param _openRequest bytes of open channel request message
     */
    function openChannel(bytes calldata _openRequest) external payable {
        ledger.openChannel(_openRequest);
    }

    /**
     * @notice Deposit ETH or ERC20 tokens into the channel
     * @dev total deposit amount = msg.value(must be 0 for ERC20) + _transferFromAmount
     * @param _channelId ID of the channel
     * @param _receiver address of the receiver
     * @param _transferFromAmount amount of funds to be transfered from EthPool for ETH
     *   or ERC20 contract for ERC20 tokens
     */
    function deposit(
        bytes32 _channelId,
        address _receiver,
        uint _transferFromAmount
    )
        external payable
    {
        ledger.deposit(_channelId, _receiver, _transferFromAmount);
    }

    /**
     * @notice Deposit ETH via EthPool or ERC20 tokens into the channel
     * @dev do not support sending ETH in msg.value for function simplicity.
     *   Index in three arrays should match.
     * @param _channelIds IDs of the channels
     * @param _receivers addresses of the receivers
     * @param _transferFromAmounts amounts of funds to be transfered from EthPool for ETH
     *   or ERC20 contract for ERC20 tokens
     */
    function depositInBatch(
        bytes32[] calldata _channelIds,
        address[] calldata _receivers,
        uint[] calldata _transferFromAmounts
    )
        external
    {
        require(
            _channelIds.length == _receivers.length && _receivers.length == _transferFromAmounts.length,
            "Lengths do not match"
        );
        for (uint i = 0; i < _channelIds.length; i++) {
            ledger.deposit(_channelIds[i], _receivers[i], _transferFromAmounts[i]);
        }
    }

    /**
     * @notice Store signed simplex states on-chain as checkpoints
     * @dev simplex states in this array are not necessarily in the same channel,
     *   which means snapshotStates natively supports multi-channel batch processing.
     *   This function only updates seqNum, transferOut, pendingPayOut of each on-chain
     *   simplex state. It can't ensure that the pending pays will be cleared during
     *   settling the channel, which requires users call intendSettle with the same state.
     *   TODO: wait for Solidity's support to replace SignedSimplexStateArray with bytes[].
     * @param _signedSimplexStateArray bytes of SignedSimplexStateArray message
     */
    function snapshotStates(bytes calldata _signedSimplexStateArray) external {
        ledger.snapshotStates(_signedSimplexStateArray);
    }

    /**
     * @notice Intend to withdraw funds from channel
     * @dev only peers can call intendWithdraw
     * @param _channelId ID of the channel
     * @param _amount amount of funds to withdraw
     * @param _recipientChannelId withdraw to receiver address if 0,
     *   otherwise deposit to receiver address in the recipient channel
     */
    function intendWithdraw(bytes32 _channelId, uint _amount, bytes32 _recipientChannelId) external {
        ledger.intendWithdraw(_channelId, _amount, _recipientChannelId);
    }

    /**
     * @notice Confirm channel withdrawal
     * @dev anyone can confirm a withdrawal intent
     * @param _channelId ID of the channel
     */
    function confirmWithdraw(bytes32 _channelId) external {
        ledger.confirmWithdraw(_channelId);
    }

    /**
     * @notice Veto current withdrawal intent
     * @dev only peers can veto a withdrawal intent;
     *   peers can veto a withdrawal intent even after (requestTime + disputeTimeout)
     * @param _channelId ID of the channel
     */
    function vetoWithdraw(bytes32 _channelId) external {
        ledger.vetoWithdraw(_channelId);
    }

    /**
     * @notice Cooperatively withdraw specific amount of balance
     * @param _cooperativeWithdrawRequest bytes of cooperative withdraw request message
     */
    function cooperativeWithdraw(bytes calldata _cooperativeWithdrawRequest) external {
        ledger.cooperativeWithdraw(_cooperativeWithdrawRequest);
    }

    /**
     * @notice Intend to settle channel(s) with an array of signed simplex states
     * @dev simplex states in this array are not necessarily in the same channel,
     *   which means intendSettle natively supports multi-channel batch processing.
     *   A simplex state with non-zero seqNum (non-null state) must be co-signed by both peers,
     *   while a simplex state with seqNum=0 (null state) only needs to be signed by one peer.
     *   TODO: wait for Solidity's support to replace SignedSimplexStateArray with bytes[].
     * @param _signedSimplexStateArray bytes of SignedSimplexStateArray message
     */
    function intendSettle(bytes calldata _signedSimplexStateArray) external {
        ledger.intendSettle(_signedSimplexStateArray);
    }

    /**
     * @notice Read payment results and add results to corresponding simplex payment channel
     * @param _channelId ID of the channel
     * @param _peerFrom address of the peer who send out funds
     * @param _payIdList bytes of a pay hash list
     */
    function clearPays(
        bytes32 _channelId,
        address _peerFrom,
        bytes calldata _payIdList
    )
        external
    {
        ledger.clearPays(_channelId, _peerFrom, _payIdList);
    }

    /**
     * @notice Confirm channel settlement
     * @dev This must be called after settleFinalizedTime
     * @param _channelId ID of the channel
     */
    function confirmSettle(bytes32 _channelId) external {
        ledger.confirmSettle(_channelId);
    }

    /**
     * @notice Cooperatively settle the channel
     * @param _settleRequest bytes of cooperative settle request message
     */
    function cooperativeSettle(bytes calldata _settleRequest) external {
        ledger.cooperativeSettle(_settleRequest);
    }

    /**
     * @notice Migrate a channel from this CelerLedger to a new CelerLedger
     * @param _migrationRequest bytes of migration request message
     * @return migrated channel id
     */
    function migrateChannelTo(bytes calldata _migrationRequest) external returns(bytes32) {
        return ledger.migrateChannelTo(_migrationRequest);
    }

    /**
     * @notice Migrate a channel from an old CelerLedger to this CelerLedger
     * @param _fromLedgerAddr the old ledger address to migrate from
     * @param _migrationRequest bytes of migration request message
     */
    function migrateChannelFrom(address _fromLedgerAddr, bytes calldata _migrationRequest) external {
        ledger.migrateChannelFrom(_fromLedgerAddr, _migrationRequest);
    }

    /**
     * @notice Get channel confirm settle open time
     * @param _channelId ID of the channel to be viewed
     * @return channel confirm settle open time
     */
    function getSettleFinalizedTime(bytes32 _channelId) public view returns(uint) {
        LedgerStruct.Channel storage c = ledger.channelMap[_channelId];
        return c.getSettleFinalizedTime();
    }

    /**
     * @notice Get channel token contract address
     * @param _channelId ID of the channel to be viewed
     * @return channel token contract address
     */
    function getTokenContract(bytes32 _channelId) public view returns(address) {
        LedgerStruct.Channel storage c = ledger.channelMap[_channelId];
        return c.getTokenContract();

    }

    /**
     * @notice Get channel token type
     * @param _channelId ID of the channel to be viewed
     * @return channel token type
     */
    function getTokenType(bytes32 _channelId) public view returns(PbEntity.TokenType) {
        LedgerStruct.Channel storage c = ledger.channelMap[_channelId];
        return c.getTokenType();
    }

    /**
     * @notice Get channel status
     * @param _channelId ID of the channel to be viewed
     * @return channel status
     */
    function getChannelStatus(bytes32 _channelId) public view returns(LedgerStruct.ChannelStatus) {
        LedgerStruct.Channel storage c = ledger.channelMap[_channelId];
        return c.getChannelStatus();
    }

    /**
     * @notice Get cooperative withdraw seqNum
     * @param _channelId ID of the channel to be viewed
     * @return cooperative withdraw seqNum
     */
    function getCooperativeWithdrawSeqNum(bytes32 _channelId) public view returns(uint) {
        LedgerStruct.Channel storage c = ledger.channelMap[_channelId];
        return c.getCooperativeWithdrawSeqNum();
    }

    /**
     * @notice Return one channel's total balance amount
     * @param _channelId ID of the channel to be viewed
     * @return channel's balance amount
     */
    function getTotalBalance(bytes32 _channelId) public view returns(uint) {
        LedgerStruct.Channel storage c = ledger.channelMap[_channelId];
        return c.getTotalBalance();
    }

    /**
     * @notice Return one channel's balance info (depositMap and withdrawalMap)
     * @dev Solidity can't directly return an array of struct for now
     * @param _channelId ID of the channel to be viewed
     * @return addresses of peers in the channel
     * @return corresponding deposits of the peers (with matched index)
     * @return corresponding withdrawals of the peers (with matched index)
     */
    function getBalanceMap(bytes32 _channelId) public view
        returns(address[2] memory, uint[2] memory, uint[2] memory)
    {
        LedgerStruct.Channel storage c = ledger.channelMap[_channelId];
        return c.getBalanceMap();
    }

    /**
     * @notice Return channel-level migration arguments
     * @param _channelId ID of the channel to be viewed
     * @return channel dispute timeout
     * @return channel tokey type converted to uint
     * @return channel token address
     * @return sequence number of cooperative withdraw
     */
    function getChannelMigrationArgs(bytes32 _channelId) external view returns(uint, uint, address, uint) {
        LedgerStruct.Channel storage c = ledger.channelMap[_channelId];
        return c.getChannelMigrationArgs();
    }

    /**
     * @notice Return migration info of the peers in the channel
     * @param _channelId ID of the channel to be viewed
     * @return peers' addresses
     * @return peers' deposits
     * @return peers' withdrawals
     * @return peers' state sequence numbers
     * @return peers' transferOut map
     * @return peers' pendingPayOut map
     */
    function getPeersMigrationInfo(bytes32 _channelId) external view returns(
        address[2] memory,
        uint[2] memory,
        uint[2] memory,
        uint[2] memory,
        uint[2] memory,
        uint[2] memory
    ) {
        LedgerStruct.Channel storage c = ledger.channelMap[_channelId];
        return c.getPeersMigrationInfo();
    }

    /**
     * @notice Return channel's dispute timeout
     * @param _channelId ID of the channel to be viewed
     * @return channel's dispute timeout
     */
    function getDisputeTimeout(bytes32 _channelId) external view returns(uint) {
        LedgerStruct.Channel storage c = ledger.channelMap[_channelId];
        return c.getDisputeTimeout();
    }

    /**
     * @notice Return channel's migratedTo address
     * @param _channelId ID of the channel to be viewed
     * @return channel's migratedTo address
     */
    function getMigratedTo(bytes32 _channelId) external view returns(address) {
        LedgerStruct.Channel storage c = ledger.channelMap[_channelId];
        return c.getMigratedTo();
    }

    /**
     * @notice Return state seqNum map of a duplex channel
     * @param _channelId ID of the channel to be viewed
     * @return peers' addresses
     * @return two simplex state sequence numbers
     */
    function getStateSeqNumMap(bytes32 _channelId) external view returns(
        address[2] memory,
        uint[2] memory
    ) {
        LedgerStruct.Channel storage c = ledger.channelMap[_channelId];
        return c.getStateSeqNumMap();
    }

    /**
     * @notice Return transferOut map of a duplex channel
     * @param _channelId ID of the channel to be viewed
     * @return peers' addresses
     * @return transferOuts of two simplex channels
     */
    function getTransferOutMap(bytes32 _channelId) external view returns(
        address[2] memory,
        uint[2] memory
    ) {
        LedgerStruct.Channel storage c = ledger.channelMap[_channelId];
        return c.getTransferOutMap();
    }

    /**
     * @notice Return nextPayIdListHash map of a duplex channel
     * @param _channelId ID of the channel to be viewed
     * @return peers' addresses
     * @return nextPayIdListHashes of two simplex channels
     */
    function getNextPayIdListHashMap(bytes32 _channelId) external view returns(
        address[2] memory,
        bytes32[2] memory
    ) {
        LedgerStruct.Channel storage c = ledger.channelMap[_channelId];
        return c.getNextPayIdListHashMap();
    }

    /**
     * @notice Return lastPayResolveDeadline map of a duplex channel
     * @param _channelId ID of the channel to be viewed
     * @return peers' addresses
     * @return lastPayResolveDeadlines of two simplex channels
     */
    function getLastPayResolveDeadlineMap(bytes32 _channelId) external view returns(
        address[2] memory,
        uint[2] memory
    ) {
        LedgerStruct.Channel storage c = ledger.channelMap[_channelId];
        return c.getLastPayResolveDeadlineMap();
    }

    /**
     * @notice Return pendingPayOut map of a duplex channel
     * @param _channelId ID of the channel to be viewed
     * @return peers' addresses
     * @return pendingPayOuts of two simplex channels
     */
    function getPendingPayOutMap(bytes32 _channelId) external view returns(
        address[2] memory,
        uint[2] memory
    ) {
        LedgerStruct.Channel storage c = ledger.channelMap[_channelId];
        return c.getPendingPayOutMap();
    }

    /**
     * @notice Return the withdraw intent info of the channel
     * @param _channelId ID of the channel to be viewed
     * @return receiver of the withdraw intent
     * @return amount of the withdraw intent
     * @return requestTime of the withdraw intent
     * @return recipientChannelId of the withdraw intent
     */
    function getWithdrawIntent(bytes32 _channelId) external view returns(address, uint, uint, bytes32) {
        LedgerStruct.Channel storage c = ledger.channelMap[_channelId];
        return c.getWithdrawIntent();
    }

    /**
     * @notice Return channel number of given status in this contract
     * @param _channelStatus query channel status converted to uint
     * @return channel number of the status
     */
    function getChannelStatusNum(uint _channelStatus) external view returns(uint) {
        return ledger.getChannelStatusNum(_channelStatus);
    }

    /**
     * @notice Return EthPool used by this CelerLedger contract
     * @return EthPool address
     */
    function getEthPool() external view returns(address) {
        return ledger.getEthPool();
    }

    /**
     * @notice Return PayRegistry used by this CelerLedger contract
     * @return PayRegistry address
     */
    function getPayRegistry() external view returns(address) {
        return ledger.getPayRegistry();
    }

    /**
     * @notice Return CelerWallet used by this CelerLedger contract
     * @return CelerWallet address
     */
    function getCelerWallet() external view returns(address) {
        return ledger.getCelerWallet();
    }

    /**
     * @notice Return balance limit of given token
     * @param _tokenAddr query token address
     * @return token balance limit
     */
    function getBalanceLimit(address _tokenAddr) external view returns(uint) {
        return ledger.getBalanceLimit(_tokenAddr);
    }

    /**
     * @notice Return balanceLimitsEnabled
     * @return balanceLimitsEnabled
     */
    function getBalanceLimitsEnabled() external view returns(bool) {
        return ledger.getBalanceLimitsEnabled();
    }
}
