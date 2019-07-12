pragma solidity ^0.5.1;

import "./LedgerStruct.sol";
import "./LedgerChannel.sol";
import "../interface/ICelerWallet.sol";
import "../data/PbChain.sol";
import "../data/PbEntity.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/utils/Address.sol";
import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";

/**
 * @title Ledger Operation Library
 * @notice CelerLedger library of basic ledger operations
 * @dev This library doesn't need "withdraw pattern" because both peers must be
 *   External Owned Accounts(EOA) since their signatures are required in openChannel.
 */
library LedgerOperation {
    using SafeMath for uint;
    using Address for address;
    using SafeERC20 for IERC20;
    using LedgerChannel for LedgerStruct.Channel;

    /**
     * @notice Open a state channel through auth withdraw message
     * @dev library function can't be payable but can read msg.value in caller's context
     * @param _self storage data of CelerLedger contract
     * @param _openRequest bytes of open channel request message
     */
    function openChannel(
        LedgerStruct.Ledger storage _self,
        bytes calldata _openRequest
    )
        external
    {
        PbChain.OpenChannelRequest memory openRequest =
            PbChain.decOpenChannelRequest(_openRequest);
        PbEntity.PaymentChannelInitializer memory channelInitializer =
            PbEntity.decPaymentChannelInitializer(openRequest.channelInitializer);
        require(channelInitializer.initDistribution.distribution.length == 2, "Wrong length");
        require(block.number <= channelInitializer.openDeadline, "Open deadline passed");
        
        PbEntity.TokenInfo memory token = channelInitializer.initDistribution.token;
        uint[2] memory amounts = [
            channelInitializer.initDistribution.distribution[0].amt,
            channelInitializer.initDistribution.distribution[1].amt
        ];
        address[2] memory peerAddrs = [
            channelInitializer.initDistribution.distribution[0].account,
            channelInitializer.initDistribution.distribution[1].account
        ];
        // enforce ascending order of peers' addresses to simplify contract code
        require(peerAddrs[0] < peerAddrs[1], "Peer addrs are not ascending");

        ICelerWallet celerWallet = _self.celerWallet;
        bytes32 h = keccak256(openRequest.channelInitializer);
        (
            bytes32 channelId,
            LedgerStruct.Channel storage c
        ) = _createWallet(_self, celerWallet, peerAddrs, h);

        c.disputeTimeout = channelInitializer.disputeTimeout;
        _updateChannelStatus(_self, c, LedgerStruct.ChannelStatus.Operable);
        c.token = _validateTokenInfo(token);
        c.peerProfiles[0].peerAddr = peerAddrs[0];
        c.peerProfiles[0].deposit = amounts[0];
        c.peerProfiles[1].peerAddr = peerAddrs[1];
        c.peerProfiles[1].deposit = amounts[1];

        require(c._checkCoSignatures(h, openRequest.sigs), "Check co-sigs failed");

        emit OpenChannel(channelId, uint(token.tokenType), token.tokenAddress, peerAddrs, amounts);

        uint amtSum = amounts[0].add(amounts[1]);
        // if total deposit is 0
        if (amtSum == 0) {
            require(msg.value == 0, "msg.value is not 0");
            return;
        }

        // if total deposit is larger than 0
        if (_self.balanceLimitsEnabled) {
            require(amtSum <= _self.balanceLimits[token.tokenAddress], "Balance exceeds limit");
        }

        if (token.tokenType == PbEntity.TokenType.ETH) {
            uint msgValueReceiver = channelInitializer.msgValueReceiver;
            require(msg.value == amounts[msgValueReceiver], "msg.value mismatch");
            if (amounts[msgValueReceiver] > 0) {
                celerWallet.depositETH.value(amounts[msgValueReceiver])(channelId);
            }

            // peer ID of non-msgValueReceiver
            uint pid = uint(1).sub(msgValueReceiver);
            if (amounts[pid] > 0) {
                _self.ethPool.transferToCelerWallet(
                    peerAddrs[pid],
                    address(celerWallet),
                    channelId,
                    amounts[pid]
                );
            }
        } else if (token.tokenType == PbEntity.TokenType.ERC20) {
            require(msg.value == 0, "msg.value is not 0");

            IERC20 erc20Token = IERC20(token.tokenAddress);
            for (uint i = 0; i < 2; i++) {
                if (amounts[i] == 0) { continue; }

                erc20Token.safeTransferFrom(peerAddrs[i], address(this), amounts[i]);
            }
            erc20Token.safeApprove(address(celerWallet), amtSum);
            celerWallet.depositERC20(channelId, address(erc20Token), amtSum);
        } else {
            assert(false);
        }
    }

    /**
     * @notice Deposit ETH or ERC20 tokens into the channel
     * @dev total deposit amount = msg.value(must be 0 for ERC20) + _transferFromAmount.
     *   library function can't be payable but can read msg.value in caller's context.
     * @param _self storage data of CelerLedger contract
     * @param _channelId ID of the channel
     * @param _receiver address of the receiver
     * @param _transferFromAmount amount of funds to be transfered from EthPool for ETH
     *   or ERC20 contract for ERC20 tokens
     */
    function deposit(
        LedgerStruct.Ledger storage _self,
        bytes32 _channelId,
        address _receiver,
        uint _transferFromAmount
    )
        external
    {
        uint msgValue = msg.value;
        // this implicitly require _receiver be a peer
        _addDeposit(_self, _channelId, _receiver, _transferFromAmount.add(msgValue));
        
        LedgerStruct.Channel storage c = _self.channelMap[_channelId];
        if (c.token.tokenType == PbEntity.TokenType.ETH) {
            if (msgValue > 0) {
                _self.celerWallet.depositETH.value(msgValue)(_channelId);
            }
            if (_transferFromAmount > 0) {
                _self.ethPool.transferToCelerWallet(
                    msg.sender,
                    address(_self.celerWallet),
                    _channelId,
                    _transferFromAmount
                );
            }
        } else if (c.token.tokenType == PbEntity.TokenType.ERC20) {
            require(msgValue == 0, "msg.value is not 0");

            IERC20 erc20Token = IERC20(c.token.tokenAddress);
            erc20Token.safeTransferFrom(msg.sender, address(this), _transferFromAmount);
            erc20Token.safeApprove(address(_self.celerWallet), _transferFromAmount);
            _self.celerWallet.depositERC20(_channelId, address(erc20Token), _transferFromAmount);
        } else {
            assert(false);
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
     * @param _self storage data of CelerLedger contract
     * @param _signedSimplexStateArray bytes of SignedSimplexStateArray message
     */
    function snapshotStates(
        LedgerStruct.Ledger storage _self,
        bytes calldata _signedSimplexStateArray
    )
        external
    {
        PbChain.SignedSimplexStateArray memory signedSimplexStateArray =
            PbChain.decSignedSimplexStateArray(_signedSimplexStateArray);
        uint simplexStatesNum = signedSimplexStateArray.signedSimplexStates.length;

        // snapshot each state
        PbEntity.SimplexPaymentChannel memory simplexState =
            PbEntity.decSimplexPaymentChannel(signedSimplexStateArray.signedSimplexStates[0].simplexState);
        for (uint i = 0; i < simplexStatesNum; i++) {
            bytes32 currentChannelId = simplexState.channelId;
            LedgerStruct.Channel storage c = _self.channelMap[currentChannelId];

            require(c.status == LedgerStruct.ChannelStatus.Operable, "Channel status error");

            bytes32 stateHash = keccak256(signedSimplexStateArray.signedSimplexStates[i].simplexState);
            bytes[] memory sigs = signedSimplexStateArray.signedSimplexStates[i].sigs;
            require(c._checkCoSignatures(stateHash, sigs), "Check co-sigs failed");
            uint peerFromId = c._getPeerId(simplexState.peerFrom);
            LedgerStruct.PeerState storage state = c.peerProfiles[peerFromId].state;
            require(simplexState.seqNum > state.seqNum, "seqNum error");

            // no need to update nextPayIdListHash and lastPayResolveDeadline for snapshot purpose
            state.seqNum = simplexState.seqNum;
            state.transferOut = simplexState.transferToPeer.receiver.amt;
            state.pendingPayOut = simplexState.totalPendingAmount;

            if (i == simplexStatesNum.sub(1)) {
                emit SnapshotStates(currentChannelId, c._getStateSeqNums());
            } else if (i < simplexStatesNum.sub(1)) {
                simplexState = PbEntity.decSimplexPaymentChannel(
                    signedSimplexStateArray.signedSimplexStates[i+1].simplexState
                );
                // enforce channelIds of simplex states are ascending
                require(currentChannelId <= simplexState.channelId, "Non-ascending channelIds");
                if (currentChannelId < simplexState.channelId) {
                    emit SnapshotStates(currentChannelId, c._getStateSeqNums());
                }
            } else {
                assert(false);
            }
        }
    }

    /**
     * @notice Intend to withdraw funds from channel
     * @dev only peers can call intendWithdraw
     * @param _self storage data of CelerLedger contract
     * @param _channelId ID of the channel
     * @param _amount amount of funds to withdraw
     * @param _recipientChannelId withdraw to receiver address if 0,
     *   otherwise deposit to receiver address in the recipient channel
     */
    function intendWithdraw(
        LedgerStruct.Ledger storage _self,
        bytes32 _channelId,
        uint _amount,
        bytes32 _recipientChannelId
    )
        external
    {
        LedgerStruct.Channel storage c = _self.channelMap[_channelId];
        LedgerStruct.PeerProfile[2] storage peerProfiles = c.peerProfiles;
        LedgerStruct.WithdrawIntent storage withdrawIntent = c.withdrawIntent;
        address receiver = msg.sender;
        require(c.status == LedgerStruct.ChannelStatus.Operable, "Channel status error");
        // withdrawIntent.receiver is address(0) if and only if there is no pending WithdrawIntent,
        // because withdrawIntent.receiver may only be set as msg.sender which can't be address(0).
        require(withdrawIntent.receiver == address(0), "Pending withdraw intent exists");

        // check withdraw limit
        // this implicitly requires receiver be a peer
        uint rid = c._getPeerId(receiver);
        uint pid = uint(1).sub(rid);
        uint withdrawLimit = peerProfiles[rid].deposit
            .add(peerProfiles[pid].state.transferOut)
            .sub(peerProfiles[rid].withdrawal)
            .sub(peerProfiles[rid].state.transferOut)
            .sub(peerProfiles[rid].state.pendingPayOut);
        require(_amount <= withdrawLimit, "Exceed withdraw limit");

        withdrawIntent.receiver = receiver;
        withdrawIntent.amount = _amount;
        withdrawIntent.requestTime = block.number;
        withdrawIntent.recipientChannelId = _recipientChannelId;

        emit IntendWithdraw(_channelId, receiver, _amount);
    }

    /**
     * @notice Confirm channel withdrawal
     * @dev anyone can confirm a withdrawal intent
     * @param _self storage data of CelerLedger contract
     * @param _channelId ID of the channel
     */
    function confirmWithdraw(
        LedgerStruct.Ledger storage _self,
        bytes32 _channelId
    )
        external
    {
        LedgerStruct.Channel storage c = _self.channelMap[_channelId];
        require(c.status == LedgerStruct.ChannelStatus.Operable, "Channel status error");
        require(c.withdrawIntent.receiver != address(0), "No pending withdraw intent");
        require(
            block.number >= c.withdrawIntent.requestTime.add(c.disputeTimeout),
            "Dispute not timeout"
        );

        address receiver = c.withdrawIntent.receiver;
        uint amount = c.withdrawIntent.amount;
        bytes32 recipientChannelId = c.withdrawIntent.recipientChannelId;
        delete c.withdrawIntent;

        // NOTE: for safety reasons, from offchain point of view, only one pending withdraw (including
        //   both cooperative ones and noncooperative ones) should be allowed at any given time.
        //   Also note that snapshotStates between an intendWithdraw and a confirmWithdraw won't update
        //   the withdraw limit calculated in the intendWithdraw.
        // TODO: move withdrawLimit check from intendWithdraw() to here to check withdraw limit
        //   with latest states. Yet there are no security issues because CelerWallet will check
        //   the total balance anyways.
        // this implicitly require receiver be a peer
        c._addWithdrawal(receiver, amount, false);
        
        (, uint[2] memory deposits, uint[2] memory withdrawals) = c.getBalanceMap();
        emit ConfirmWithdraw(_channelId, amount, receiver, recipientChannelId, deposits, withdrawals);

        _withdrawFunds(_self, _channelId, receiver, amount, recipientChannelId);
    }

    /**
     * @notice Veto current withdrawal intent
     * @dev only peers can veto a withdrawal intent;
     *   peers can veto a withdrawal intent even after (requestTime + disputeTimeout)
     * @param _self storage data of CelerLedger contract
     * @param _channelId ID of the channel
     */
    function vetoWithdraw(LedgerStruct.Ledger storage _self, bytes32 _channelId) external {
        LedgerStruct.Channel storage c = _self.channelMap[_channelId];
        require(c.status == LedgerStruct.ChannelStatus.Operable, "Channel status error");
        require(c.withdrawIntent.receiver != address(0), "No pending withdraw intent");
        require(c._isPeer(msg.sender), "msg.sender is not peer");

        delete c.withdrawIntent;

        emit VetoWithdraw(_channelId);
    }

    /**
     * @notice Cooperatively withdraw specific amount of balance
     * @param _self storage data of CelerLedger contract
     * @param _cooperativeWithdrawRequest bytes of cooperative withdraw request message
     */
    function cooperativeWithdraw(
        LedgerStruct.Ledger storage _self,
        bytes calldata _cooperativeWithdrawRequest
    )
        external
    {
        PbChain.CooperativeWithdrawRequest memory cooperativeWithdrawRequest =
            PbChain.decCooperativeWithdrawRequest(_cooperativeWithdrawRequest);
        PbEntity.CooperativeWithdrawInfo memory withdrawInfo =
            PbEntity.decCooperativeWithdrawInfo(cooperativeWithdrawRequest.withdrawInfo);
        bytes32 channelId = withdrawInfo.channelId;
        bytes32 recipientChannelId = withdrawInfo.recipientChannelId;
        LedgerStruct.Channel storage c = _self.channelMap[channelId];

        require(c.status == LedgerStruct.ChannelStatus.Operable, "Channel status error");
        bytes32 h = keccak256(cooperativeWithdrawRequest.withdrawInfo);
        require(
            c._checkCoSignatures(h, cooperativeWithdrawRequest.sigs),
            "Check co-sigs failed"
        );
        // require an increment of exactly 1 for seqNum of each cooperative withdraw request
        require(
            withdrawInfo.seqNum.sub(c.cooperativeWithdrawSeqNum) == 1,
            "seqNum error"
        );
        require(block.number <= withdrawInfo.withdrawDeadline, "Withdraw deadline passed");

        address receiver = withdrawInfo.withdraw.account;
        c.cooperativeWithdrawSeqNum = withdrawInfo.seqNum;
        uint amount = withdrawInfo.withdraw.amt;

        // this implicitly require receiver be a peer
        c._addWithdrawal(receiver, amount, true);

        (, uint[2] memory deposits, uint[2] memory withdrawals) = c.getBalanceMap();
        emit CooperativeWithdraw(
            channelId,
            amount,
            receiver,
            recipientChannelId,
            deposits,
            withdrawals,
            withdrawInfo.seqNum
        );

        _withdrawFunds(_self, channelId, receiver, amount, recipientChannelId);
    }

    /**
     * @notice Intend to settle channel(s) with an array of signed simplex states
     * @dev simplex states in this array are not necessarily in the same channel,
     *   which means intendSettle natively supports multi-channel batch processing.
     *   A simplex state with non-zero seqNum (non-null state) must be co-signed by both peers,
     *   while a simplex state with seqNum=0 (null state) only needs to be signed by one peer.
     *   TODO: wait for Solidity's support to replace SignedSimplexStateArray with bytes[].
     * @param _self storage data of CelerLedger contract
     * @param _signedSimplexStateArray bytes of SignedSimplexStateArray message
     */
    function intendSettle(
        LedgerStruct.Ledger storage _self,
        bytes calldata _signedSimplexStateArray
    )
        external
    {
        PbChain.SignedSimplexStateArray memory signedSimplexStateArray =
            PbChain.decSignedSimplexStateArray(_signedSimplexStateArray);
        uint simplexStatesNum = signedSimplexStateArray.signedSimplexStates.length;

        PbEntity.SimplexPaymentChannel memory simplexState =
            PbEntity.decSimplexPaymentChannel(signedSimplexStateArray.signedSimplexStates[0].simplexState);
        for (uint i = 0; i < simplexStatesNum; i++) {
            bytes32 currentChannelId = simplexState.channelId;
            LedgerStruct.Channel storage c = _self.channelMap[currentChannelId];
            require(
                c.status == LedgerStruct.ChannelStatus.Operable ||
                c.status == LedgerStruct.ChannelStatus.Settling,
                "Channel status error"
            );
            require(
                c.settleFinalizedTime == 0 || block.number < c.settleFinalizedTime,
                "Settle has already finalized"
            );
            
            bytes32 stateHash = keccak256(signedSimplexStateArray.signedSimplexStates[i].simplexState);
            bytes[] memory sigs = signedSimplexStateArray.signedSimplexStates[i].sigs;

            if (simplexState.seqNum > 0) {  // non-null state
                require(c._checkCoSignatures(stateHash, sigs), "Check co-sigs failed");
                uint peerFromId = c._getPeerId(simplexState.peerFrom);
                LedgerStruct.PeerState storage state = c.peerProfiles[peerFromId].state;
                // ensure each state can be intendSettle at most once
                if (c.status == LedgerStruct.ChannelStatus.Operable) {
                    // "==" is the case of cooperative on-chain checkpoint
                    require(simplexState.seqNum >= state.seqNum, "seqNum error");
                } else if (c.status == LedgerStruct.ChannelStatus.Settling) {
                    require(simplexState.seqNum > state.seqNum, "seqNum error");
                } else {
                    assert(false);
                }

                // update simplexState-dependent fields
                // no need to update pendingPayOut since channel settle process doesn't use it
                state.seqNum = simplexState.seqNum;
                state.transferOut = simplexState.transferToPeer.receiver.amt;
                state.nextPayIdListHash = simplexState.pendingPayIds.nextListHash;
                state.lastPayResolveDeadline = simplexState.lastPayResolveDeadline;
                _clearPays(_self, currentChannelId, peerFromId, simplexState.pendingPayIds.payIds);
            } else if (simplexState.seqNum == 0) {  // null state
                // this implies both stored seqNums are 0
                require(c.settleFinalizedTime == 0, "intendSettle before");
                require(
                    sigs.length == 1 && c._checkSingleSignature(stateHash, sigs[0]),
                    "Check sig failed"
                );
            } else {
                assert(false);
            }

            if (i == simplexStatesNum.sub(1)) {
                _updateOverallStatesByIntendState(_self, currentChannelId);
            } else if (i < simplexStatesNum.sub(1)) {
                simplexState = PbEntity.decSimplexPaymentChannel(
                    signedSimplexStateArray.signedSimplexStates[i+1].simplexState
                );
                // enforce channelIds of simplex states are ascending
                require(currentChannelId <= simplexState.channelId, "Non-ascending channelIds");
                if (currentChannelId < simplexState.channelId) {
                    _updateOverallStatesByIntendState(_self, currentChannelId);
                }
            } else {
                assert(false);
            }
        }
    }

    /**
     * @notice Read payment results and add results to corresponding simplex payment channel
     * @param _self storage data of CelerLedger contract
     * @param _channelId ID of the channel
     * @param _peerFrom address of the peer who send out funds
     * @param _payIdList bytes of a pay id list
     */
    function clearPays(
        LedgerStruct.Ledger storage _self,
        bytes32 _channelId,
        address _peerFrom,
        bytes calldata _payIdList
    )
        external
    {
        LedgerStruct.Channel storage c = _self.channelMap[_channelId];
        require(c.status == LedgerStruct.ChannelStatus.Settling, "Channel status error");
        uint peerFromId = c._getPeerId(_peerFrom);

        bytes32 listHash = keccak256(_payIdList);
        LedgerStruct.PeerState storage state = c.peerProfiles[peerFromId].state;
        require(state.nextPayIdListHash == listHash, "List hash mismatch");

        PbEntity.PayIdList memory payIdList = PbEntity.decPayIdList(_payIdList);
        state.nextPayIdListHash = payIdList.nextListHash;
        _clearPays(_self, _channelId, peerFromId, payIdList.payIds);
    }

    /**
     * @notice Confirm channel settlement
     * @dev This must be called after settleFinalizedTime
     * @param _self storage data of CelerLedger contract
     * @param _channelId ID of the channel
     */
    function confirmSettle(
        LedgerStruct.Ledger storage _self,
        bytes32 _channelId
    )
        external
    {
        LedgerStruct.Channel storage c = _self.channelMap[_channelId];
        LedgerStruct.PeerProfile[2] storage peerProfiles = c.peerProfiles;
        uint blockNumber = block.number;
        require(c.status == LedgerStruct.ChannelStatus.Settling, "Channel status error");
        // require no new intendSettle can be called
        require(blockNumber >= c.settleFinalizedTime, "Settle is not finalized");

        // require channel status of current intendSettle has been finalized,
        // namely all payments have already been either cleared or expired
        // Note: this lastPayResolveDeadline should use
        //   (the actual last resolve deadline of all pays + clearPays safe margin)
        //   to ensure that peers have enough time to clearPays before confirmSettle.
        //   However this only matters if there are multiple blocks of pending pay list
        //   i.e. the nextPayIdListHash after intendSettle is not bytes32(0).
        // TODO: add an additional clearSafeMargin param or change the semantics of
        //   lastPayResolveDeadline to also include clearPays safe margin and rename it.
        require(
            (peerProfiles[0].state.nextPayIdListHash == bytes32(0) ||
                blockNumber > peerProfiles[0].state.lastPayResolveDeadline) &&
            (peerProfiles[1].state.nextPayIdListHash == bytes32(0) ||
                blockNumber > peerProfiles[1].state.lastPayResolveDeadline),
            "Payments are not finalized"
        );

        (bool validBalance, uint[2] memory settleBalance) = c._validateSettleBalance();
        if (!validBalance) {
            _resetDuplexState(_self, c);
            emit ConfirmSettleFail(_channelId);
            return;
        }

        _updateChannelStatus(_self, c, LedgerStruct.ChannelStatus.Closed);

        emit ConfirmSettle(_channelId, settleBalance);

        // Withdrawal from Contracts pattern is needless here,
        // because peers need to sign messages which implies that they can't be contracts
        _batchTransferOut(
            _self,
            _channelId,
            c.token.tokenAddress,
            [peerProfiles[0].peerAddr, peerProfiles[1].peerAddr],
            settleBalance
        );
    }

    /**
     * @notice Cooperatively settle the channel
     * @param _self storage data of CelerLedger contract
     * @param _settleRequest bytes of cooperative settle request message
     */
    function cooperativeSettle(
        LedgerStruct.Ledger storage _self,
        bytes calldata _settleRequest
    )
        external
    {
        PbChain.CooperativeSettleRequest memory settleRequest =
            PbChain.decCooperativeSettleRequest(_settleRequest);
        PbEntity.CooperativeSettleInfo memory settleInfo =
            PbEntity.decCooperativeSettleInfo(settleRequest.settleInfo);
        bytes32 channelId = settleInfo.channelId;
        LedgerStruct.Channel storage c = _self.channelMap[channelId];
        require(
            c.status == LedgerStruct.ChannelStatus.Operable ||
            c.status == LedgerStruct.ChannelStatus.Settling,
            "Channel status error"
        );

        bytes32 h = keccak256(settleRequest.settleInfo);
        require(c._checkCoSignatures(h, settleRequest.sigs), "Check co-sigs failed");

        address[2] memory peerAddrs = [c.peerProfiles[0].peerAddr, c.peerProfiles[1].peerAddr];
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

        uint[2] memory settleBalance = [
            settleInfo.settleBalance[0].amt,
            settleInfo.settleBalance[1].amt
        ];
        require(settleBalance[0].add(settleBalance[1]) == c.getTotalBalance(), "Balance sum mismatch");

        _updateChannelStatus(_self, c, LedgerStruct.ChannelStatus.Closed);

        emit CooperativeSettle(channelId, settleBalance);

        _batchTransferOut(_self, channelId, c.token.tokenAddress, peerAddrs, settleBalance);
    }

    /**
     * @notice Return channel number of given status in this contract
     * @param _self storage data of CelerLedger contract
     * @param _channelStatus query channel status converted to uint
     * @return channel number of the status
     */
    function getChannelStatusNum(
        LedgerStruct.Ledger storage _self,
        uint _channelStatus
    )
        external
        view
        returns(uint)
    {
        return _self.channelStatusNums[_channelStatus];
    }

    /**
     * @notice Return EthPool used by this CelerLedger contract
     * @param _self storage data of CelerLedger contract
     * @return EthPool address
     */
    function getEthPool(LedgerStruct.Ledger storage _self) external view returns(address) {
        return address(_self.ethPool);
    }

    /**
     * @notice Return PayRegistry used by this CelerLedger contract
     * @param _self storage data of CelerLedger contract
     * @return PayRegistry address
     */
    function getPayRegistry(LedgerStruct.Ledger storage _self) external view returns(address) {
        return address(_self.payRegistry);
    }

    /**
     * @notice Return CelerWallet used by this CelerLedger contract
     * @param _self storage data of CelerLedger contract
     * @return CelerWallet address
     */
    function getCelerWallet(LedgerStruct.Ledger storage _self) external view returns(address) {
        return address(_self.celerWallet);
    }

    /**
     * @notice create a wallet for a new channel
     * @param _self storage data of CelerLedger contract
     * @param _w celer wallet
     * @param _peers peers of the new channel
     * @param _nonce nonce for creating the wallet
     * @return channel id, which is same as the created wallet id
     * @return storage pointer of the channel
     */
    function _createWallet(
        LedgerStruct.Ledger storage _self,
        ICelerWallet _w,
        address[2] memory _peers,
        bytes32 _nonce
    )
        internal
        returns(bytes32, LedgerStruct.Channel storage)
    {
        address[] memory owners = new address[](2);
        owners[0] = _peers[0];
        owners[1] = _peers[1];
        // it is safe to use abi.encodePacked() with only one dynamic variable
        // use walletId as channelId
        bytes32 channelId = _w.create(owners, address(this), _nonce);
        // 0 is reserved for non-channel indication
        require(channelId != bytes32(0), "channelId gets 0");
        LedgerStruct.Channel storage c = _self.channelMap[channelId];
        // No harm in having this check in case of keccak256 being broken 
        require(c.status == LedgerStruct.ChannelStatus.Uninitialized, "Occupied channelId");

        return (channelId, c);
    }

    /**
     * @notice Internal function to add deposit of a channel
     * @param _self storage data of CelerLedger contract
     * @param _channelId ID of the channel
     * @param _receiver address of the receiver
     * @param _amount the amount to be deposited
     */
    function _addDeposit(
        LedgerStruct.Ledger storage _self,
        bytes32 _channelId,
        address _receiver,
        uint _amount
    )
        internal
    {
        LedgerStruct.Channel storage c = _self.channelMap[_channelId];
        require(c.status == LedgerStruct.ChannelStatus.Operable, "Channel status error");

        // this implicitly require _receiver be a peer
        uint rid = c._getPeerId(_receiver);
        if (_self.balanceLimitsEnabled) {
            require(
                _amount.add(c.getTotalBalance()) <= _self.balanceLimits[c.token.tokenAddress],
                "Balance exceeds limit"
            );
        }

        c.peerProfiles[rid].deposit = c.peerProfiles[rid].deposit.add(_amount);

        (
            address[2] memory peerAddrs,
            uint[2] memory deposits,
            uint[2] memory withdrawals
        ) = c.getBalanceMap();
        emit Deposit(_channelId, peerAddrs, deposits, withdrawals);
    }

    /**
     * @notice Internal function to transfer funds out in batch
     * @param _self storage data of CelerLedger contract
     * @param _channelId ID of the channel
     * @param _tokenAddr address of tokens to be transferred out
     * @param _receivers the addresses of token receivers
     * @param _amounts the amounts to be transferred
     */
    function _batchTransferOut(
        LedgerStruct.Ledger storage _self,
        bytes32 _channelId,
        address _tokenAddr,
        address[2] memory _receivers,
        uint[2] memory _amounts
    )
        internal
    {
        for (uint i = 0; i < 2; i++) {
            if (_amounts[i] == 0) { continue; }

            _self.celerWallet.withdraw(_channelId, _tokenAddr, _receivers[i], _amounts[i]);
        }
    }

    /**
     * @notice Internal function to withdraw funds out of the channel
     * @param _self storage data of CelerLedger contract
     * @param _channelId ID of the channel
     * @param _receiver address of the receiver of the withdrawn funds
     * @param _amount the amount of the withdrawn funds
     * @param _recipientChannelId ID of the recipient channel
     */
    function _withdrawFunds(
        LedgerStruct.Ledger storage _self,
        bytes32 _channelId,
        address _receiver,
        uint _amount,
        bytes32 _recipientChannelId
    )
        internal
    {
        if (_amount == 0) { return; }

        LedgerStruct.Channel storage c = _self.channelMap[_channelId];
        if (_recipientChannelId == bytes32(0)) {
            _self.celerWallet.withdraw(_channelId, c.token.tokenAddress, _receiver, _amount);
        } else {
            LedgerStruct.Channel storage recipientChannel = _self.channelMap[_recipientChannelId];
            require(
                c.token.tokenType == recipientChannel.token.tokenType &&
                    c.token.tokenAddress == recipientChannel.token.tokenAddress,
                "Token mismatch of recipient channel"
            );
            _addDeposit(_self, _recipientChannelId, _receiver, _amount);

            // move funds from one channel's wallet to another channel's wallet
            _self.celerWallet.transferToWallet(
                _channelId,
                _recipientChannelId,
                c.token.tokenAddress,
                _receiver,
                _amount
            );
        }
    }

    /**
     * @notice Reset the state of the channel
     * @param _self storage data of CelerLedger contract
     * @param _c the channel
     */
    function _resetDuplexState(
        LedgerStruct.Ledger storage _self,
        LedgerStruct.Channel storage _c
    )
        internal
    {
        delete _c.settleFinalizedTime;
        _updateChannelStatus(_self, _c, LedgerStruct.ChannelStatus.Operable);
        delete _c.peerProfiles[0].state;
        delete _c.peerProfiles[1].state;
        // reset possibly remaining WithdrawIntent freezed by previous intendSettle()
        delete _c.withdrawIntent;
    }

    /**
     * @notice Clear payments by their hash array
     * @param _self storage data of CelerLedger contract
     * @param _channelId the channel ID
     * @param _peerId ID of the peer who sends out funds
     * @param _payIds array of pay ids to clear
     */
    function _clearPays(
        LedgerStruct.Ledger storage _self,
        bytes32 _channelId,
        uint _peerId,
        bytes32[] memory _payIds
    )
        internal
    {
        LedgerStruct.Channel storage c = _self.channelMap[_channelId];
        uint[] memory outAmts = _self.payRegistry.getPayAmounts(
            _payIds,
            c.peerProfiles[_peerId].state.lastPayResolveDeadline
        );

        uint totalAmtOut = 0;
        for (uint i = 0; i < outAmts.length; i++) {
            totalAmtOut = totalAmtOut.add(outAmts[i]);
            emit ClearOnePay(_channelId, _payIds[i], c.peerProfiles[_peerId].peerAddr, outAmts[i]);
        }
        c.peerProfiles[_peerId].state.transferOut =
            c.peerProfiles[_peerId].state.transferOut.add(totalAmtOut);
    }

    /**
     * @notice Update overall states of a duplex channel
     * @param _self storage data of CelerLedger contract
     * @param _channelId the channel ID
     */
    function _updateOverallStatesByIntendState(
        LedgerStruct.Ledger storage _self,
        bytes32 _channelId
    )
        internal
    {
        LedgerStruct.Channel storage c = _self.channelMap[_channelId];
        c.settleFinalizedTime = block.number.add(c.disputeTimeout);
        _updateChannelStatus(_self, c, LedgerStruct.ChannelStatus.Settling);

        emit IntendSettle(_channelId, c._getStateSeqNums());
    }

    /**
     * @notice Update status of a channel
     * @param _self storage data of CelerLedger contract
     * @param _c the channel
     * @param _newStatus new channel status
     */
    function _updateChannelStatus(
        LedgerStruct.Ledger storage _self,
        LedgerStruct.Channel storage _c,
        LedgerStruct.ChannelStatus _newStatus
    )
        internal
    {
        if (_c.status == _newStatus) {
            return;
        }

        // update counter of old status
        if (_c.status != LedgerStruct.ChannelStatus.Uninitialized) {
            _self.channelStatusNums[uint(_c.status)] = _self.channelStatusNums[uint(_c.status)].sub(1);
        }

        // update counter of new status
        _self.channelStatusNums[uint(_newStatus)] = _self.channelStatusNums[uint(_newStatus)].add(1);

        _c.status = _newStatus;
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

    event OpenChannel(
        bytes32 indexed channelId,
        uint tokenType,
        address indexed tokenAddress,
        // TODO: there is an issue of setting address[2] as indexed. Need to fix and make this indexed
        address[2] peerAddrs,
        uint[2] initialDeposits
    );

    // TODO: there is an issue of setting address[2] as indexed. Need to fix and make this indexed
    event Deposit(bytes32 indexed channelId, address[2] peerAddrs, uint[2] deposits, uint[2] withdrawals);

    event SnapshotStates(bytes32 indexed channelId, uint[2] seqNums);

    event IntendSettle(bytes32 indexed channelId, uint[2] seqNums);

    event ClearOnePay(bytes32 indexed channelId, bytes32 indexed payId, address indexed peerFrom, uint amount);

    event ConfirmSettle(bytes32 indexed channelId, uint[2] settleBalance);

    event ConfirmSettleFail(bytes32 indexed channelId);

    event IntendWithdraw(bytes32 indexed channelId, address indexed receiver, uint amount);

    event ConfirmWithdraw(
        bytes32 indexed channelId,
        uint withdrawnAmount,
        address indexed receiver,
        bytes32 indexed recipientChannelId,
        uint[2] deposits,
        uint[2] withdrawals
    );

    event VetoWithdraw(bytes32 indexed channelId);

    event CooperativeWithdraw(
        bytes32 indexed channelId,
        uint withdrawnAmount,
        address indexed receiver,
        bytes32 indexed recipientChannelId,
        uint[2] deposits,
        uint[2] withdrawals,
        uint seqNum
    );

    event CooperativeSettle(bytes32 indexed channelId, uint[2] settleBalance);
}
