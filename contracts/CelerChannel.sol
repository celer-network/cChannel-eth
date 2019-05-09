pragma solidity ^0.5.0;

import "./lib/data/PbChain.sol";
import "./lib/data/PbEntity.sol";
import "./lib/ICelerChannel.sol";
import "./lib/IEthPool.sol";
import "./lib/IPayRegistry.sol";
import "openzeppelin-solidity/contracts/math/Math.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/cryptography/MerkleProof.sol";
import "openzeppelin-solidity/contracts/utils/Address.sol";
import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";
import "openzeppelin-solidity/contracts/cryptography/ECDSA.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";

/**
 * @title Celer Channel contract
 * @notice Implementation of cChannel.
 * @dev see https://www.celer.network/tech.html
 */
contract CelerChannel is ICelerChannel, Ownable {
    using SafeMath for uint;
    using Address for address;
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    struct PeerState {
        uint seqNum;
        // balance sent out to the other peer of the channel, no need to record amtIn
        uint transferOut;
        bytes32 nextPayHashListHash;
        uint lastPayResolveDeadline;
    }

    struct PeerProfile {
        address payable peerAddr;
        uint deposit;
        // deposit owed to the other peer, caused by withdraw from peer's deposit
        uint owedDeposit;
        PeerState state;
    }

    struct WithdrawIntent {
        address payable receiver;
        uint amount;
        uint requestTime;
        uint64 recipientChannelId;
    }

    struct Channel {
        // the time after which peers can confirmSettle and before which peers can intendSettle
        uint settleFinalizedTime;
        uint disputeTimeout;
        PbEntity.TokenInfo token;
        ChannelStatus status;
        PeerProfile[PEERS_NUM] peerProfiles;
        uint cooperativeWithdrawSeqNum;
        WithdrawIntent withdrawIntent;
    }

    uint public channelNum = 0;
    IEthPool public ethPool;
    IPayRegistry public payRegistry;
    // per channel deposit limits for different tokens
    mapping(address => uint) public depositLimits;
    // whether deposit limits of all tokens have been enabled
    bool public depositLimitsEnabled = true;
    mapping(uint64 => Channel) private channelMap;
    // only support 2-peer channel for now
    uint constant private PEERS_NUM = 2;

    /**
     * @notice CelerChannel constructor
     * @param _ethPool address of ETH pool
     * @param _payRegistry address of PayRegistry
     */
    constructor(address _ethPool, address _payRegistry) public {
        ethPool = IEthPool(_ethPool);
        payRegistry = IPayRegistry(_payRegistry);
    }

    /**
     * @notice Payable fallback function to receive ETH from ethPool
     */
    function () external payable {
        require(msg.sender == address(ethPool), "Sender is not EthPool");
    }

    /**
     * @notice Set the deposit limits of given tokens
     * @param _tokenAddrs addresses of the tokens (address(0) is for ETH)
     * @param _limits deposit limits of the tokens
     */
    function setDepositLimits(address[] calldata _tokenAddrs, uint[] calldata _limits) external onlyOwner {
        require(_tokenAddrs.length == _limits.length);
        for (uint i = 0; i < _tokenAddrs.length; i++) {
            depositLimits[_tokenAddrs[i]] = _limits[i];
        }
    }

    /**
     * @notice Disable deposit limits of all tokens
     */
    function disableDepositLimits() external onlyOwner {
        depositLimitsEnabled = false;
    }

    /**
     * @notice Enable deposit limits of all tokens
     */
    function enableDepositLimits() external onlyOwner {
        depositLimitsEnabled = true;
    }

    /**
     * @notice Open a state channel through auth withdraw message
     * @param _openRequest bytes of open channel request message
     */
    function openChannel(bytes calldata _openRequest) external payable {
        PbChain.OpenChannelRequest memory openRequest =
            PbChain.decOpenChannelRequest(_openRequest);
        bytes32 hash = keccak256(abi.encodePacked(openRequest.channelInitializer, address(this)));
        uint64 channelId;
        assembly { channelId := hash }
        // 0 is reserved for non-channel indication
        require(channelId != 0, "channelId gets 0");
        Channel storage c = channelMap[channelId];
        require(c.status == ChannelStatus.Uninitialized, "Occupied channelId");

        PbEntity.PaymentChannelInitializer memory channelInitializer =
            PbEntity.decPaymentChannelInitializer(openRequest.channelInitializer);

        require(channelInitializer.initDistribution.distribution.length == PEERS_NUM);
        require(block.number <= channelInitializer.openDeadline, "Open deadline passed");

        PbEntity.TokenInfo memory token = channelInitializer.initDistribution.token;
        address payable[PEERS_NUM] memory peerAddrs = [
            channelInitializer.initDistribution.distribution[0].account,
            channelInitializer.initDistribution.distribution[1].account
        ];

        // enforce ascending order of peers' addresses to simplify contract code
        require(peerAddrs[0] < peerAddrs[1], "Peer addrs are not ascending");

        c.disputeTimeout = channelInitializer.disputeTimeout;
        c.status = ChannelStatus.Operable;
        c.token = _validateTokenInfo(token);

        uint[PEERS_NUM] memory amounts = [
            channelInitializer.initDistribution.distribution[0].amt,
            channelInitializer.initDistribution.distribution[1].amt
        ];
        c.peerProfiles[0].peerAddr = peerAddrs[0];
        c.peerProfiles[0].deposit = amounts[0];
        c.peerProfiles[1].peerAddr = peerAddrs[1];
        c.peerProfiles[1].deposit = amounts[1];
        
        channelNum = channelNum.add(1);

        emit OpenChannel(channelId, uint(token.tokenType), token.tokenAddress, peerAddrs, amounts);

        // if total deposit is 0, this is only a "plain" openChannel without any values,
        // and there is no need to check the signatures (and they can be NULL)
        if (amounts[0] == 0 && amounts[1] == 0) {
            require(msg.value == 0, "msg.value is not 0");
            return;
        }

        // if total deposit is larger than 0
        if (depositLimitsEnabled) {
            require(
                amounts[0].add(amounts[1]) <= depositLimits[token.tokenAddress],
                "Deposits exceed limit"
            );
        }
        bytes32 h = keccak256(openRequest.channelInitializer);
        require(_checkCoSignatures(c, h, openRequest.sigs), "Check co-sigs failed");

        if (token.tokenType == PbEntity.TokenType.ETH) {
            require(
                msg.value == amounts[channelInitializer.msgValueRecipient],
                "msg.value mismatch"
            );
            // peer ID of non-msgValueRecipient
            uint pid = uint(1).sub(channelInitializer.msgValueRecipient);
            if (amounts[pid] > 0) {
                require(
                    ethPool.transferFrom(peerAddrs[pid], address(this), amounts[pid]),
                    "transferFrom EthPool failed"
                );
            }
        } else if (token.tokenType == PbEntity.TokenType.ERC20) {
            require(msg.value == 0, "msg.value is not 0");
            for (uint i = 0; i < PEERS_NUM; i++) {
                if (amounts[i] > 0) {
                    IERC20(token.tokenAddress).safeTransferFrom(peerAddrs[i], address(this), amounts[i]);
                }
            }
        } else {
            assert(false);
        }
    }

    /**
     * @notice Deposit ETH or ERC20 tokens into the channel
     * @dev total deposit amount = msg.value(must be 0 for ERC20) + _transferFromAmount
     * @param _channelId ID of the channel
     * @param _recipient address of the recipient
     * @param _transferFromAmount amount of funds to be transfered from EthPool for ETH
     *   or ERC20 contract for ERC20 tokens
     */
    function deposit(
        uint64 _channelId,
        address _recipient,
        uint _transferFromAmount
    )
        external payable
    {
        _deposit(_channelId, _recipient, _transferFromAmount.add(msg.value));
        
        Channel storage c = channelMap[_channelId];
        if (_transferFromAmount > 0) {
            if (c.token.tokenType == PbEntity.TokenType.ETH) {
                require(
                    ethPool.transferFrom(msg.sender, address(this), _transferFromAmount),
                    "transferFrom EthPool failed"
                );
            } else if (c.token.tokenType == PbEntity.TokenType.ERC20) {
                require(msg.value == 0, "msg.value is not 0");
                IERC20(c.token.tokenAddress).safeTransferFrom(
                    msg.sender,
                    address(this),
                    _transferFromAmount
                );
            }
        }
    }

    /**
     * @notice Store signed simplex states on-chain as checkpoints
     * @dev simplex states in this array are not necessarily in the same channel,
     *   which means snapshotStates natively supports multi-channel batch processing.
     *   This function only updates seqNum and transferOut of each on-chain simplex state.
     *   TODO: wait for Solidity's support to replace SignedSimplexStateArray with bytes[].
     * @param _signedSimplexStateArray bytes of SignedSimplexStateArray message
     */
    function snapshotStates(bytes calldata _signedSimplexStateArray) external {
        PbChain.SignedSimplexStateArray memory signedSimplexStateArray =
            PbChain.decSignedSimplexStateArray(_signedSimplexStateArray);
        uint simplexStatesNum = signedSimplexStateArray.signedSimplexStates.length;

        // snapshot each state
        PbEntity.SimplexPaymentChannel memory simplexState =
            PbEntity.decSimplexPaymentChannel(signedSimplexStateArray.signedSimplexStates[0].simplexState);
        for (uint i = 0; i < simplexStatesNum; i++) {
            uint64 currentChannelId = simplexState.channelId;
            Channel storage c = channelMap[currentChannelId];

            require(c.status == ChannelStatus.Operable, "Channel status error");

            bytes32 stateHash = keccak256(signedSimplexStateArray.signedSimplexStates[i].simplexState);
            bytes[] memory sigs = signedSimplexStateArray.signedSimplexStates[i].sigs;
            require(_checkCoSignatures(c, stateHash, sigs), "Check co-sigs failed");
            uint peerFromId = _getPeerId(c, simplexState.peerFrom);
            require(
                simplexState.seqNum > c.peerProfiles[peerFromId].state.seqNum,
                "seqNum error"
            );

            // no need to update nextPayHashListHash and lastPayResolveDeadline for snapshot purpose
            c.peerProfiles[peerFromId].state.seqNum = simplexState.seqNum;
            c.peerProfiles[peerFromId].state.transferOut = simplexState.transferToPeer.receiver.amt;

            if (i == simplexStatesNum - 1) {
                emit SnapshotStates(currentChannelId, _getStateSeqNums(c));
            } else if (i < simplexStatesNum - 1) {
                simplexState = PbEntity.decSimplexPaymentChannel(
                    signedSimplexStateArray.signedSimplexStates[i+1].simplexState
                );
                // enforce channelIds of simplex states are ascending
                require(currentChannelId <= simplexState.channelId, "Non-ascending channelIds");
                if (currentChannelId < simplexState.channelId) {
                    emit SnapshotStates(currentChannelId, _getStateSeqNums(c));
                }
            } else {
                assert(false);
            }
        }
    }

    /**
     * @notice Intend to withdraw funds from channel
     * @dev only peers can call intendWithdraw
     * @param _channelId ID of the channel
     * @param _amount amount of funds to withdraw
     * @param _recipientChannelId withdraw to receiver address if 0,
     *   otherwise deposit to receiver address in the recipient channel
     */
    function intendWithdraw(uint64 _channelId, uint _amount, uint64 _recipientChannelId) external {
        Channel storage c = channelMap[_channelId];
        address payable receiver = msg.sender;
        require(c.status == ChannelStatus.Operable, "Channel status error");
        // withdrawIntent.receiver is address(0) if and only if there is no pending WithdrawIntent,
        // because withdrawIntent.receiver may only be set as msg.sender which can't be address(0).
        require(c.withdrawIntent.receiver == address(0), "Pending withdraw intent exists");

        // check withdraw limit
        // this implicitly requires receiver be a peer
        uint rid = _getPeerId(c, receiver);
        uint pid = uint(1).sub(rid);
        uint withdrawLimit = c.peerProfiles[rid].deposit
            .add(c.peerProfiles[pid].state.transferOut)
            .add(c.peerProfiles[pid].owedDeposit)
            .sub(c.peerProfiles[rid].state.transferOut)
            .sub(c.peerProfiles[rid].owedDeposit);
        require(_amount <= withdrawLimit, "Exceed withdraw limit");

        c.withdrawIntent.receiver = receiver;
        c.withdrawIntent.amount = _amount;
        c.withdrawIntent.requestTime = block.number;
        c.withdrawIntent.recipientChannelId = _recipientChannelId;

        emit IntendWithdraw(_channelId, receiver, _amount);
    }

    /**
     * @notice Confirm channel withdrawal
     * @dev anyone can confirm a withdrawal intent
     * @param _channelId ID of the channel
     */
    function confirmWithdraw(uint64 _channelId) external {
        Channel storage c = channelMap[_channelId];
        require(c.status == ChannelStatus.Operable, "Channel status error");
        require(c.withdrawIntent.receiver != address(0), "Withdraw receiver is 0");
        require(
            block.number >= c.withdrawIntent.requestTime.add(c.disputeTimeout),
            "Dispute not timeout"
        );

        address payable receiver = c.withdrawIntent.receiver;
        uint amount = c.withdrawIntent.amount;
        uint64 recipientChannelId = c.withdrawIntent.recipientChannelId;
        delete c.withdrawIntent;

        uint[PEERS_NUM] memory withdrawalAmounts = _updateDepositsByWithdraw(c, receiver, amount);
        
        (, uint[PEERS_NUM] memory balances) = getDepositMap(_channelId);
        emit ConfirmWithdraw(_channelId, withdrawalAmounts, receiver, recipientChannelId, balances);

        _withdrawFunds(c, receiver, amount, recipientChannelId);
    }

    /**
     * @notice Veto current withdrawal intent
     * @dev only peers can veto a withdrawal intent;
     *   peers can veto a withdrawal intent even after (requestTime + disputeTimeout)
     * @param _channelId ID of the channel
     */
    function vetoWithdraw(uint64 _channelId) external {
        Channel storage c = channelMap[_channelId];
        require(c.status == ChannelStatus.Operable, "Channel status error");
        require(c.withdrawIntent.receiver != address(0), "No pending withdraw intent");
        require(_isPeer(c, msg.sender), "msg.sender is not peer");

        delete c.withdrawIntent;

        emit VetoWithdraw(_channelId);
    }

    /**
     * @notice Cooperatively withdraw specific amount of deposit
     * @param _cooperativeWithdrawRequest bytes of cooperative withdraw request message
     */
    function cooperativeWithdraw(bytes calldata _cooperativeWithdrawRequest) external {
        PbChain.CooperativeWithdrawRequest memory cooperativeWithdrawRequest =
            PbChain.decCooperativeWithdrawRequest(_cooperativeWithdrawRequest);
        PbEntity.CooperativeWithdrawInfo memory withdrawInfo =
            PbEntity.decCooperativeWithdrawInfo(cooperativeWithdrawRequest.withdrawInfo);
        Channel storage c = channelMap[withdrawInfo.channelId];

        require(c.status == ChannelStatus.Operable, "Channel status error");
        bytes32 h = keccak256(cooperativeWithdrawRequest.withdrawInfo);
        require(
            _checkCoSignatures(c, h, cooperativeWithdrawRequest.sigs),
            "Check co-sigs failed"
        );
        // require an increment of exactly 1 for seqNum of each cooperative withdraw request
        require(
            withdrawInfo.seqNum.sub(c.cooperativeWithdrawSeqNum) == 1,
            "seqNum error"
        );
        require(block.number <= withdrawInfo.withdrawDeadline, "Withdraw deadline passed");

        address payable receiver = withdrawInfo.withdraw.account;
        c.cooperativeWithdrawSeqNum = withdrawInfo.seqNum;
        uint amount = withdrawInfo.withdraw.amt;

        uint[PEERS_NUM] memory withdrawalAmounts = _updateDepositsByWithdraw(c, receiver, amount);
        (, uint[PEERS_NUM] memory balances) = getDepositMap(withdrawInfo.channelId);
        emit CooperativeWithdraw(
            withdrawInfo.channelId,
            withdrawalAmounts,
            receiver,
            withdrawInfo.recipientChannelId,
            balances,
            withdrawInfo.seqNum
        );

        _withdrawFunds(c, receiver, amount, withdrawInfo.recipientChannelId);
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
        PbChain.SignedSimplexStateArray memory signedSimplexStateArray =
            PbChain.decSignedSimplexStateArray(_signedSimplexStateArray);
        uint simplexStatesNum = signedSimplexStateArray.signedSimplexStates.length;

        PbEntity.SimplexPaymentChannel memory simplexState =
            PbEntity.decSimplexPaymentChannel(signedSimplexStateArray.signedSimplexStates[0].simplexState);
        for (uint i = 0; i < simplexStatesNum; i++) {
            uint64 currentChannelId = simplexState.channelId;
            Channel storage c = channelMap[currentChannelId];
            require(
                c.status == ChannelStatus.Operable || c.status == ChannelStatus.Settling,
                "Channel status error"
            );
            require(
                c.settleFinalizedTime == 0 || block.number < c.settleFinalizedTime,
                "Settle has already finalized"
            );
            
            bytes32 stateHash = keccak256(signedSimplexStateArray.signedSimplexStates[i].simplexState);
            bytes[] memory sigs = signedSimplexStateArray.signedSimplexStates[i].sigs;

            if (simplexState.seqNum > 0) {  // non-null state
                require(_checkCoSignatures(c, stateHash, sigs), "Check co-sigs failed");
                uint peerFromId = _getPeerId(c, simplexState.peerFrom);
                // ensure each state can be intendSettle at most once
                if (c.status == ChannelStatus.Operable) {
                    // "==" is the case of cooperative on-chain checkpoint
                    require(
                        simplexState.seqNum >= c.peerProfiles[peerFromId].state.seqNum,
                        "seqNum error"
                    );
                } else if (c.status == ChannelStatus.Settling) {
                    require(
                        simplexState.seqNum > c.peerProfiles[peerFromId].state.seqNum,
                        "seqNum error"
                    );
                } else {
                    assert(false);
                }

                // update simplexState-dependent fields
                c.peerProfiles[peerFromId].state.seqNum = simplexState.seqNum;
                c.peerProfiles[peerFromId].state.transferOut = simplexState.transferToPeer.receiver.amt;
                c.peerProfiles[peerFromId].state.nextPayHashListHash =
                    simplexState.pendingPayHashes.nextListHash;
                c.peerProfiles[peerFromId].state.lastPayResolveDeadline =
                    simplexState.lastPayResolveDeadline;
                _liquidatePays(currentChannelId, peerFromId, simplexState.pendingPayHashes.payHashes);
            } else if (simplexState.seqNum == 0) {  // null state
                // this implies both stored seqNums are 0
                require(c.settleFinalizedTime == 0, "intendSettle before");
                require(
                    sigs.length == 1 && _checkSingleSignature(c, stateHash, sigs[0]),
                    "Check sig failed"
                );
            } else {
                assert(false);
            }

            if (i == simplexStatesNum - 1) {
                _updateOverallStatesByIntendState(currentChannelId);
            } else if (i < simplexStatesNum - 1) {
                simplexState = PbEntity.decSimplexPaymentChannel(
                    signedSimplexStateArray.signedSimplexStates[i+1].simplexState
                );
                // enforce channelIds of simplex states are ascending
                require(currentChannelId <= simplexState.channelId, "Non-ascending channelIds");
                if (currentChannelId < simplexState.channelId) {
                    _updateOverallStatesByIntendState(currentChannelId);
                }
            } else {
                assert(false);
            }
        }
    }

    /**
     * @notice Read payment results and add results to corresponding simplex payment channel
     * @param _channelId ID of the channel
     * @param _peerFrom address of the peer who send out funds
     * @param _payHashList bytes of a pay hash list
     */
    function liquidatePays(
        uint64 _channelId,
        address _peerFrom,
        bytes calldata _payHashList
    )
        external
    {
        Channel storage c = channelMap[_channelId];
        require(c.status == ChannelStatus.Settling, "Channel status error");
        uint peerFromId = _getPeerId(c, _peerFrom);

        bytes32 listHash = keccak256(_payHashList);
        require(
            c.peerProfiles[peerFromId].state.nextPayHashListHash == listHash,
            "List hash mismatch"
        );

        PbEntity.PayHashList memory payHashList = PbEntity.decPayHashList(_payHashList);
        c.peerProfiles[peerFromId].state.nextPayHashListHash = payHashList.nextListHash;
        _liquidatePays(_channelId, peerFromId, payHashList.payHashes);
    }

    /**
     * @notice Confirm channel settlement
     * @dev This must be alled after settleFinalizedTime
     * @param _channelId ID of the channel
     */
    function confirmSettle(uint64 _channelId) external {
        Channel storage c = channelMap[_channelId];
        require(c.status == ChannelStatus.Settling, "Channel status error");
        // require no new intendSettle can be called
        require(block.number >= c.settleFinalizedTime, "Settle is not finalized");

        // require channel status of current intendSettle has been finalized,
        // namely all payments have already been either liquidated or expired
        require(
            (c.peerProfiles[0].state.nextPayHashListHash == bytes32(0) ||
                block.number > c.peerProfiles[0].state.lastPayResolveDeadline) &&
            (c.peerProfiles[1].state.nextPayHashListHash == bytes32(0) ||
                block.number > c.peerProfiles[1].state.lastPayResolveDeadline),
            "Payments are not finalized"
        );

        (bool validBalance, uint[PEERS_NUM] memory settleBalance) = _validateSettleBalance(c);
        if (!validBalance) {
            _resetDuplexState(c);
            emit ConfirmSettleFail(_channelId);
            return;
        }

        c.status = ChannelStatus.Closed;

        emit ConfirmSettle(_channelId, settleBalance);

        // Withdrawal from Contracts pattern is needless here,
        // because peers need to sign messages which implies that they can't be contracts
        _transfer(c, c.peerProfiles[0].peerAddr, settleBalance[0]);
        _transfer(c, c.peerProfiles[1].peerAddr, settleBalance[1]);
    }

    /**
     * @notice Cooperatively settle the channel
     * @param _settleRequest bytes of cooperative settle request message
     */
    function cooperativeSettle(bytes calldata _settleRequest) external {
        PbChain.CooperativeSettleRequest memory settleRequest =
            PbChain.decCooperativeSettleRequest(_settleRequest);
        PbEntity.CooperativeSettleInfo memory settleInfo =
            PbEntity.decCooperativeSettleInfo(settleRequest.settleInfo);
        Channel storage c = channelMap[settleInfo.channelId];
        require(
            c.status == ChannelStatus.Operable || c.status == ChannelStatus.Settling,
            "Channel status error"
        );

        bytes32 h = keccak256(settleRequest.settleInfo);
        require(_checkCoSignatures(c, h, settleRequest.sigs), "Check co-sigs failed");

        address payable[PEERS_NUM] memory peerAddrs = [c.peerProfiles[0].peerAddr, c.peerProfiles[1].peerAddr];
        require(
            settleInfo.seqNum > c.peerProfiles[0].state.seqNum &&
                settleInfo.seqNum > c.peerProfiles[1].state.seqNum,
            "seqNum error"
        );
        require(settleInfo.settleDeadline >= block.number, "Settle deadline passed");
        // require distribution is consistent with the order of peerAddrs in channel
        require(
            settleInfo.settleBalance[0].account == peerAddrs[0] &&
                settleInfo.settleBalance[1].account == peerAddrs[1],
            "Settle accounts mismatch"
        );

        uint[PEERS_NUM] memory settleBalance = [
            settleInfo.settleBalance[0].amt,
            settleInfo.settleBalance[1].amt
        ];
        uint depositSum = c.peerProfiles[0].deposit + c.peerProfiles[1].deposit;
        require(settleBalance[0] + settleBalance[1] == depositSum, "Balance sum mismatch");

        c.status = ChannelStatus.Closed;
        
        emit CooperativeSettle(settleInfo.channelId, settleBalance);

        _transfer(c, peerAddrs[0], settleBalance[0]);
        _transfer(c, peerAddrs[1], settleBalance[1]);
    }

    /**
     * @notice Get channel confirm settle open time
     * @param _channelId ID of the channel to be viewed
     * @return channel confirm settle open time
     */
    function getSettleFinalizedTime(uint64 _channelId) public view returns(uint) {
        Channel storage c = channelMap[_channelId];
        return c.settleFinalizedTime;
    }

    /**
     * @notice Get channel token contract address
     * @param _channelId ID of the channel to be viewed
     * @return channel token contract address
     */
    function getTokenContract(uint64 _channelId) public view returns(address) {
        Channel storage c = channelMap[_channelId];
        return c.token.tokenAddress;
    }

    /**
     * @notice Get channel token type
     * @param _channelId ID of the channel to be viewed
     * @return channel token type
     */
    function getTokenType(uint64 _channelId) public view returns(PbEntity.TokenType) {
        Channel storage c = channelMap[_channelId];
        return c.token.tokenType;
    }

    /**
     * @notice Get channel status
     * @param _channelId ID of the channel to be viewed
     * @return channel status
     */
    function getChannelStatus(uint64 _channelId) public view returns(ChannelStatus) {
        Channel storage c = channelMap[_channelId];
        return c.status;
    }

    /**
     * @notice Get cooperative withdraw seqNum
     * @param _channelId ID of the channel to be viewed
     * @return cooperative withdraw seqNum
     */
    function getCooperativeWithdrawSeqNum(uint64 _channelId) public view returns(uint) {
        Channel storage c = channelMap[_channelId];
        return c.cooperativeWithdrawSeqNum;
    }

    /**
     * @notice Get deposit amount of the specific peer
     * @param _channelId ID of the channel to be viewed
     * @param _peer address of the peer
     * @return deposit amount
     */
    function getDepositAmount(uint64 _channelId, address _peer) public view returns(uint) {
        Channel storage c = channelMap[_channelId];
        uint peerId = _getPeerId(c, _peer);
        return c.peerProfiles[peerId].deposit;
    }

    /**
     * @notice Return one channel's depositMap
     * @dev Solidity can't directly return an array of struct for now
     * @param _channelId ID of the channel to be viewed
     * @return addresses of peers in the channel,
     *   and corresponding balances of the peers (with matched index)
     */
    function getDepositMap(uint64 _channelId) public view
        returns(address payable[PEERS_NUM] memory, uint[PEERS_NUM] memory)
    {
        Channel storage c = channelMap[_channelId];
        uint[PEERS_NUM] memory balances = [c.peerProfiles[0].deposit, c.peerProfiles[1].deposit];
        address payable[PEERS_NUM] memory peerAddrs = [c.peerProfiles[0].peerAddr, c.peerProfiles[1].peerAddr];
        return (peerAddrs, balances);
    }

    /**
     * @notice Get owed deposit amount of the specific peer
     * @param _channelId ID of the channel to be viewed
     * @param _peer address of the peer
     * @return owed deposit amount
     */
    function getOwedDepositAmount(uint64 _channelId, address _peer) public view returns(uint) {
        Channel storage c = channelMap[_channelId];
        uint peerId = _getPeerId(c, _peer);
        return c.peerProfiles[peerId].owedDeposit;
    }

    /**
     * @notice Return one channel's owed deposit map
     * @dev Solidity can't directly return an array of struct for now
     * @param _channelId ID of the channel to be viewed
     * @return addresses of peers in the channel,
     *   and corresponding owed deposits of the peers (with matched index)
     */
    function getOwedDepositMap(uint64 _channelId) public view
        returns(address payable[PEERS_NUM] memory, uint[PEERS_NUM] memory)
    {
        Channel storage c = channelMap[_channelId];
        uint[PEERS_NUM] memory owedDeposits = [c.peerProfiles[0].owedDeposit, c.peerProfiles[1].owedDeposit];
        address payable[PEERS_NUM] memory peerAddrs = [c.peerProfiles[0].peerAddr, c.peerProfiles[1].peerAddr];
        return (peerAddrs, owedDeposits);
    }

    /**
     * @notice Internally uniform function to transfer channel's funds out
     * @param _c the channel being used
     * @param _to the address to transfer to
     * @param _amount the amount to be transferred
     */
    function _transfer(Channel storage _c, address payable _to, uint _amount) internal {
        require(_to != address(0), "transfer to address is 0");
        if (_amount == 0) { return; }

        if (_c.token.tokenType == PbEntity.TokenType.ETH) {
            _to.transfer(_amount);
        } else if (_c.token.tokenType == PbEntity.TokenType.ERC20) {
            IERC20(_c.token.tokenAddress).safeTransfer(_to, _amount);
        } else {
            assert(false);
        }
    }

    /**
     * @notice Internal function to deposit funds to a channel
     * @param _channelId ID of the channel
     * @param _receiver address of the receiver
     * @param _amount the amount to be deposited
     */
    function _deposit(uint64 _channelId, address _receiver, uint _amount) internal {
        Channel storage c = channelMap[_channelId];
        require(
            c.status == ChannelStatus.Operable || c.status == ChannelStatus.Settling,
            "Channel status error"
        );

        uint rid = _getPeerId(c, _receiver);
        if (depositLimitsEnabled) {
            uint currentDepositSum =
                c.peerProfiles[rid].deposit.add(c.peerProfiles[uint(1).sub(rid)].deposit);
            require(
                _amount.add(currentDepositSum) <= depositLimits[c.token.tokenAddress],
                "Deposits exceed limit"
            );
        }

        c.peerProfiles[rid].deposit = c.peerProfiles[rid].deposit.add(_amount);

        (
            address payable[PEERS_NUM] memory peerAddrs,
            uint[PEERS_NUM] memory balances
        ) = getDepositMap(_channelId);
        emit Deposit(_channelId, peerAddrs, balances);
    }

    /**
     * @notice Internal function to withdraw funds out of the channel
     * @param _c the channel being withdrawn from
     * @param _receiver address of the receiver of the withdrawn funds
     * @param _amount the amount of the withdrawn funds
     * @param _recipientChannelId ID of the recipient channel
     */
    function _withdrawFunds(
        Channel storage _c,
        address payable _receiver,
        uint _amount,
        uint64 _recipientChannelId
    )
        internal
    {
        if (_recipientChannelId == 0) {
            _transfer(_c, _receiver, _amount);
        } else {
            Channel storage recipientChannel = channelMap[_recipientChannelId];
            require(
                _c.token.tokenType == recipientChannel.token.tokenType &&
                    _c.token.tokenAddress == recipientChannel.token.tokenAddress,
                "Token mismatch of recipient channel"
            );

            _deposit(_recipientChannelId, _receiver, _amount);
        }
    }

    /**
     * @notice Update deposits based on withdrawal request
     * @param _c the channel being used
     * @param _receiver the receiver of withdrawn funds
     * @param _amount the amount to withdrawn funds
     * @return withdrawal amounts aligned at peers' IDs in the channel
     */
    function _updateDepositsByWithdraw(
        Channel storage _c,
        address _receiver,
        uint _amount
    )
        internal returns(uint[PEERS_NUM] memory)
    {
        uint rid = _getPeerId(_c, _receiver);
        uint[PEERS_NUM] memory withdrawalAmounts;
        if (_c.peerProfiles[rid].deposit >= _amount) {
            // only withdraw receiver's deposit
            withdrawalAmounts[rid] = _amount;
            _c.peerProfiles[rid].deposit = _c.peerProfiles[rid].deposit.sub(_amount);
        } else {
            // withdraw all receiver's deposit and withdraw the remaining from the other peer's
            uint withdrawFromPeer = _amount.sub(_c.peerProfiles[rid].deposit);
            withdrawalAmounts[rid] = _c.peerProfiles[rid].deposit;
            _c.peerProfiles[rid].deposit = 0;
            _c.peerProfiles[rid].owedDeposit = _c.peerProfiles[rid].owedDeposit.add(withdrawFromPeer);

            // non-receiver peer ID
            uint pid = uint(1).sub(rid);
            withdrawalAmounts[pid] = withdrawFromPeer;
            _c.peerProfiles[pid].deposit = _c.peerProfiles[pid].deposit.sub(withdrawFromPeer);
        }

        return withdrawalAmounts;
    }

    /**
     * @notice Clear the state of the channel
     * @param _c the channel
     */
    function _resetDuplexState(Channel storage _c) internal {
        delete _c.settleFinalizedTime;
        _c.status = ChannelStatus.Operable;
        delete _c.peerProfiles[0].state;
        delete _c.peerProfiles[1].state;
        // reset possibly remaining WithdrawIntent freezed by previous intendSettle()
        delete _c.withdrawIntent;
    }

    /**
     * @notice Liquidate payments by their hash array
     * @param _channelId the channel ID
     * @param _peerId ID of the peer who sends out funds
     * @param _payHashes hash array of pays to liquidate
     */
    function _liquidatePays(
        uint64 _channelId,
        uint _peerId,
        bytes32[] memory _payHashes
    )
        internal
    {
        Channel storage c = channelMap[_channelId];
        uint[] memory outAmts = payRegistry.getPayAmounts(
            _payHashes,
            c.peerProfiles[_peerId].state.lastPayResolveDeadline
        );

        uint totalAmtOut = 0;
        for (uint i = 0; i < outAmts.length; i++) {
            totalAmtOut = totalAmtOut.add(outAmts[i]);
            emit LiquidateOnePay(_channelId, _payHashes[i], c.peerProfiles[_peerId].peerAddr, outAmts[i]);
        }
        c.peerProfiles[_peerId].state.transferOut =
            c.peerProfiles[_peerId].state.transferOut.add(totalAmtOut);
    }

    /**
     * @notice Update overall states of a duplex channel
     * @param _channelId the channel ID
     */
    function _updateOverallStatesByIntendState(uint64 _channelId) internal {
        Channel storage c = channelMap[_channelId];
        c.settleFinalizedTime = block.number.add(c.disputeTimeout);
        c.status = ChannelStatus.Settling;

        emit IntendSettle(_channelId, _getStateSeqNums(c));
    }

    /**
     * @notice Get the seqNums of two simplex channel states
     * @param _c the channel
     */
    function _getStateSeqNums(Channel storage _c) internal view returns(uint[PEERS_NUM] memory) {
        return [_c.peerProfiles[0].state.seqNum, _c.peerProfiles[1].state.seqNum];
    }

    /**
     * @notice Check if _addr is one of the peers in channel _c
     * @param _c the channel
     * @param _addr the address to check
     * @return is peer or not
     */
    function _isPeer(Channel storage _c, address _addr) internal view returns(bool) {
        return _addr == _c.peerProfiles[0].peerAddr || _addr == _c.peerProfiles[1].peerAddr;
    }

    /**
     * @notice Get peer's ID
     * @param _c the channel
     * @param _peer address of peer
     * @return peer's ID
     */
     function _getPeerId(Channel storage _c, address _peer) internal view returns(uint) {
        if (_peer == _c.peerProfiles[0].peerAddr) {
            return 0;
        } else if (_peer == _c.peerProfiles[1].peerAddr) {
            return 1;
        } else {
            require(false, "Nonexist peer");
        }
    }

    /**
     * @notice Check the correctness of one peer's signature
     * @param _c the channel
     * @param _h the hash of the message signed by the peer
     * @param _sig signature of the peer
     * @return message is signed by one of the peers or not
     */
    function _checkSingleSignature(
        Channel storage _c,
        bytes32 _h,
        bytes memory _sig
    )
        internal
        view
        returns(bool)
    {
        address addr = _h.toEthSignedMessageHash().recover(_sig);
        return _isPeer(_c, addr);
    }

    /**
     * @notice Check the correctness of the co-signatures
     * @param _c the channel
     * @param _h the hash of the message signed by the peers
     * @param _sigs signatures of the peers
     * @return message are signed by both peers or not
     */
    function _checkCoSignatures(
        Channel storage _c,
        bytes32 _h,
        bytes[] memory _sigs
    )
        internal
        view
        returns(bool)
    {
        if (_sigs.length != PEERS_NUM) {
            return false;
        }

        // check signature
        bytes32 hash = _h.toEthSignedMessageHash();
        address addr;
        for (uint i = 0; i < PEERS_NUM; i++) {
            addr = hash.recover(_sigs[i]);
            // enforce the order of sigs consistent with ascending addresses
            if (addr != _c.peerProfiles[i].peerAddr) {
                return false;
            }
        }

        return true;
    }

    /**
     * @notice Validate token info
     * @param _token token info to be validated
     * @return validated token info
     */
    function _validateTokenInfo(PbEntity.TokenInfo memory _token)
        internal
        view
        returns(PbEntity.TokenInfo memory)
    {
        if (_token.tokenType == PbEntity.TokenType.ETH) {
            require(_token.tokenAddress == address(0));
        } else if (_token.tokenType == PbEntity.TokenType.ERC20) {
            require(_token.tokenAddress != address(0));
            require(_token.tokenAddress.isContract());
        } else {
            assert(false);
        }

        return _token;
    }

    /**
     * @notice Validate channel final balance
     * @dev settleBalance = deposit + transferIn + peerOwesMe
     *   - transferOut - owedDeposit
     * @param _c the channel
     * @return (balance is valid, settle balance)
     */
    function _validateSettleBalance(Channel storage _c)
        internal
        view
        returns(bool, uint[PEERS_NUM] memory)
    {
        PeerProfile[PEERS_NUM] memory peerProfiles = _c.peerProfiles;
        uint[PEERS_NUM] memory settleBalance = [
            peerProfiles[0].deposit
                .add(peerProfiles[1].state.transferOut)
                .add(peerProfiles[1].owedDeposit),
            peerProfiles[1].deposit
                .add(peerProfiles[0].state.transferOut)
                .add(peerProfiles[0].owedDeposit)
        ];
        for (uint i = 0; i < PEERS_NUM; i++) {
            uint subAmt = peerProfiles[i].state.transferOut.add(peerProfiles[i].owedDeposit);

            if (settleBalance[i] < subAmt) {
                return (false, [uint(0), uint(0)]);
            }

            settleBalance[i] = settleBalance[i].sub(subAmt);
        }

        return (true, settleBalance);
    }
}
