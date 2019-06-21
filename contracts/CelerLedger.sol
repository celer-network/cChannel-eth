pragma solidity ^0.5.0;

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
 */
contract CelerLedger is ICelerLedger, Ownable {
    using LedgerOperation for LedgerStruct.Ledger;
    using LedgerBalanceLimit for LedgerStruct.Ledger;
    using LedgerMigrate for LedgerStruct.Ledger;
    using LedgerChannel for LedgerStruct.Channel;

    LedgerStruct.Ledger private data;

    /**
     * @notice CelerChannel constructor
     * @param _ethPool address of ETH pool
     * @param _payRegistry address of PayRegistry
     */
    constructor(address _ethPool, address _payRegistry, address _celerWallet) public {
        data.ethPool = IEthPool(_ethPool);
        data.payRegistry = IPayRegistry(_payRegistry);
        data.celerWallet = ICelerWallet(_celerWallet);
        // enable deposit limits in default
        data.balanceLimitsEnabled = true;
    }

    /**
     * @notice Set the deposit limits of given tokens
     * @param _tokenAddrs addresses of the tokens (address(0) is for ETH)
     * @param _limits deposit limits of the tokens
     */
    function setBalanceLimits(
        address[] calldata _tokenAddrs,
        uint[] calldata _limits
    )
        external
        onlyOwner
    {
        data.setBalanceLimits(_tokenAddrs, _limits);
    }

    /**
     * @notice Disable deposit limits of all tokens
     */
    function disableBalanceLimits() external onlyOwner {
        data.disableBalanceLimits();
    }

    /**
     * @notice Enable deposit limits of all tokens
     */
    function enableBalanceLimits() external onlyOwner {
        data.enableBalanceLimits();
    }

    /**
     * @notice Open a state channel through auth withdraw message
     * @param _openRequest bytes of open channel request message
     */
    function openChannel(bytes calldata _openRequest) external payable {
        data.openChannel(_openRequest);
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
        data.deposit(_channelId, _receiver, _transferFromAmount);
    }

    /**
     * @notice Store signed simplex states on-chain as checkpoints
     * @dev simplex states in this array are not necessarily in the same channel,
     *   which means snapshotStates natively supports multi-channel batch processing.
     *   This function only updates seqNum, transferOut, pendingPayOut of each on-chain
     *   simplex state. It can't ensure that the pending pays will be liquidated during
     *   settling the channel, which requires users call intendSettle with the same state.
     *   TODO: wait for Solidity's support to replace SignedSimplexStateArray with bytes[].
     * @param _signedSimplexStateArray bytes of SignedSimplexStateArray message
     */
    function snapshotStates(bytes calldata _signedSimplexStateArray) external {
        data.snapshotStates(_signedSimplexStateArray);
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
        data.intendWithdraw(_channelId, _amount, _recipientChannelId);
    }

    /**
     * @notice Confirm channel withdrawal
     * @dev anyone can confirm a withdrawal intent
     * @param _channelId ID of the channel
     */
    function confirmWithdraw(bytes32 _channelId) external {
        data.confirmWithdraw(_channelId);
    }

    /**
     * @notice Veto current withdrawal intent
     * @dev only peers can veto a withdrawal intent;
     *   peers can veto a withdrawal intent even after (requestTime + disputeTimeout)
     * @param _channelId ID of the channel
     */
    function vetoWithdraw(bytes32 _channelId) external {
        data.vetoWithdraw(_channelId);
    }

    /**
     * @notice Cooperatively withdraw specific amount of deposit
     * @param _cooperativeWithdrawRequest bytes of cooperative withdraw request message
     */
    function cooperativeWithdraw(bytes calldata _cooperativeWithdrawRequest) external {
        data.cooperativeWithdraw(_cooperativeWithdrawRequest);
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
        data.intendSettle(_signedSimplexStateArray);
    }

    /**
     * @notice Read payment results and add results to corresponding simplex payment channel
     * @param _channelId ID of the channel
     * @param _peerFrom address of the peer who send out funds
     * @param _payIdList bytes of a pay hash list
     */
    function liquidatePays(
        bytes32 _channelId,
        address _peerFrom,
        bytes calldata _payIdList
    )
        external
    {
        data.liquidatePays(_channelId, _peerFrom, _payIdList);
    }

    /**
     * @notice Confirm channel settlement
     * @dev This must be alled after settleFinalizedTime
     * @param _channelId ID of the channel
     */
    function confirmSettle(bytes32 _channelId) external {
        data.confirmSettle(_channelId);
    }

    /**
     * @notice Cooperatively settle the channel
     * @param _settleRequest bytes of cooperative settle request message
     */
    function cooperativeSettle(bytes calldata _settleRequest) external {
        data.cooperativeSettle(_settleRequest);
    }

    /**
     * @notice Migrate a channel from this CelerLedger to a new CelerLedger
     * @param _migrationRequest bytes of migration request message
     * @return migrated channel id
     */
    function migrateChannelTo(bytes calldata _migrationRequest) external returns(bytes32) {
        return data.migrateChannelTo(_migrationRequest);
    }

    /**
     * @notice Migrate a channel from an old CelerLedger to this CelerLedger
     * @param _fromLedgerAddr the old ledger address to migrate from
     * @param _migrationRequest bytes of migration request message
     */
    function migrateChannelFrom(address _fromLedgerAddr, bytes calldata _migrationRequest) external {
        data.migrateChannelFrom(_fromLedgerAddr, _migrationRequest);
    }

    /**
     * @notice Get channel confirm settle open time
     * @param _channelId ID of the channel to be viewed
     * @return channel confirm settle open time
     */
    function getSettleFinalizedTime(bytes32 _channelId) public view returns(uint) {
        LedgerStruct.Channel storage c = data.channelMap[_channelId];
        return c.getSettleFinalizedTime();
    }

    /**
     * @notice Get channel token contract address
     * @param _channelId ID of the channel to be viewed
     * @return channel token contract address
     */
    function getTokenContract(bytes32 _channelId) public view returns(address) {
        LedgerStruct.Channel storage c = data.channelMap[_channelId];
        return c.getTokenContract();

    }

    /**
     * @notice Get channel token type
     * @param _channelId ID of the channel to be viewed
     * @return channel token type
     */
    function getTokenType(bytes32 _channelId) public view returns(PbEntity.TokenType) {
        LedgerStruct.Channel storage c = data.channelMap[_channelId];
        return c.getTokenType();
    }

    /**
     * @notice Get channel status
     * @param _channelId ID of the channel to be viewed
     * @return channel status
     */
    function getChannelStatus(bytes32 _channelId) public view returns(LedgerStruct.ChannelStatus) {
        LedgerStruct.Channel storage c = data.channelMap[_channelId];
        return c.getChannelStatus();
    }

    /**
     * @notice Get cooperative withdraw seqNum
     * @param _channelId ID of the channel to be viewed
     * @return cooperative withdraw seqNum
     */
    function getCooperativeWithdrawSeqNum(bytes32 _channelId) public view returns(uint) {
        LedgerStruct.Channel storage c = data.channelMap[_channelId];
        return c.getCooperativeWithdrawSeqNum();
    }

    /**
     * @notice Return one channel's total balance amount
     * @param _channelId ID of the channel to be viewed
     * @return channel's balance amount
     */
    function getTotalBalance(bytes32 _channelId) public view returns(uint) {
        LedgerStruct.Channel storage c = data.channelMap[_channelId];
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
        LedgerStruct.Channel storage c = data.channelMap[_channelId];
        return c.getBalanceMap();
    }

    /**
     * @notice Return channel level configs
     * @param _channelId ID of the channel to be viewed
     * @return channel dispute timeout
     * @return channel tokey type converted to uint
     * @return channel token address
     * @return sequence number of cooperative withdraw
     */
    function getChannelConfig(bytes32 _channelId) external view returns(uint, uint, address, uint) {
        LedgerStruct.Channel storage c = data.channelMap[_channelId];
        return c.getChannelConfig();
    }

    /**
     * @notice Return peers info of the channel
     * @param _channelId ID of the channel to be viewed
     * @return peers' addresses
     * @return peers' deposits
     * @return peers' owedDeposits
     * @return peers' state sequence numbers
     * @return peers' transferOut map
     * @return peers' pendingPayOut map
     */
    function getPeersInfo(bytes32 _channelId) external view returns(
        address[2] memory,
        uint[2] memory,
        uint[2] memory,
        uint[2] memory,
        uint[2] memory,
        uint[2] memory
    ) {
        LedgerStruct.Channel storage c = data.channelMap[_channelId];
        return c.getPeersInfo();
    }

    /**
     * @notice Return channel number of given status in this contract
     * @param _channelStatus query channel status converted to uint
     * @return channel number of the status
     */
    function getChannelStatusNum(uint _channelStatus) external view returns(uint) {
        return data.getChannelStatusNum(_channelStatus);
    }

    /**
     * @notice Return EthPool used by this CelerLedger contract
     * @return EthPool address
     */
    function getEthPool() external view returns(address) {
        return data.getEthPool();
    }

    /**
     * @notice Return PayRegistry used by this CelerLedger contract
     * @return PayRegistry address
     */
    function getPayRegistry() external view returns(address) {
        return data.getPayRegistry();
    }

    /**
     * @notice Return CelerWallet used by this CelerLedger contract
     * @return CelerWallet address
     */
    function getCelerWallet() external view returns(address) {
        return data.getCelerWallet();
    }

    /**
     * @notice Return deposit limit of given token
     * @param _tokenAddr query token address
     * @return token deposit limit
     */
    function getBalanceLimit(address _tokenAddr) external view returns(uint) {
        return data.getBalanceLimit(_tokenAddr);
    }

    /**
     * @notice Return balanceLimitsEnabled
     * @return balanceLimitsEnabled
     */
    function getBalanceLimitsEnabled() external view returns(bool) {
        return data.getBalanceLimitsEnabled();
    }
}
