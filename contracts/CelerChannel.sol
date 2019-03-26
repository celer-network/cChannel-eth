pragma solidity ^0.5.0;

import "./lib/data/PbChain2.sol";
import "./lib/data/PbEntity.sol";
import "./lib/ICelerChannel.sol";
import "./lib/IEthPool.sol";
import "./PayRegistry.sol";
import "openzeppelin-solidity/contracts/math/Math.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/cryptography/MerkleProof.sol";
import "openzeppelin-solidity/contracts/utils/Address.sol";
import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";
import "openzeppelin-solidity/contracts/cryptography/ECDSA.sol";

/**
 * @title Celer Channel contract
 * @notice Implementation of cChannel.
 * @dev see https://www.celer.network/tech.html
 */
contract CelerChannel is ICelerChannel, PayRegistry {
    using SafeMath for uint;
    using Address for address;
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    struct PeerState {
        uint seqNum;
        // balance sent out to the other peer of the channel, no need to record amtIn
        uint amtOut;
        bytes32 nextPayHashListHash;
        uint lastPayResolveDeadline;
    }

    struct PeerProfile {
        uint deposit;
        PeerState state;
    }

    // only support 2-peer channel for now
    struct Channel {
        // the time after which peers can confirmSettle and before which peers can intendSettle
        uint settleFinalizedTime;
        uint settleTimeout;
        PbEntity.TokenInfo token;
        ChannelStatus status;
        address payable[2] peers;
        mapping(address => PeerProfile) peerProfileMap;
        uint cooperativeWithdrawSeqNum;
    }

    mapping(uint64 => Channel) private channelMap;
    uint public channelNum = 0;
    IEthPool public ethPool;

    /**
     * @notice CelerChannel constructor
     * @param _ethPool address of ETH pool
     * @param _virtResolver address of virtual resolver for PayRegistry
     */
    constructor(address _ethPool, address _virtResolver)
        PayRegistry(_virtResolver) public
    {
        ethPool = IEthPool(_ethPool);
    }

    /**
     * @notice Payable fallback function to receive ETH from ethPool
     */
    function () external payable {
        require(msg.sender == address(ethPool));
    }

    /**
     * @notice Deposit ETH or ERC20 tokens into the channel
     * @dev total deposit amount = msg.value(must be 0 for ERC20) + _transferFromAmount
     * @param _channelId ID of the channel
     * @param _recipient address of the recipient
     * @param _transferFromAmount amount of funds to be transfered from EthPool for ETH
     *   or ERC20 contract for ERC20 tokens
     */
    function deposit(uint64 _channelId, address _recipient, uint _transferFromAmount) external payable {
        Channel storage c = channelMap[_channelId];
        require(c.status == ChannelStatus.Operable || c.status == ChannelStatus.Settling);
        require(_isPeer(c, _recipient));
        c.peerProfileMap[_recipient].deposit =
            c.peerProfileMap[_recipient].deposit.add(_transferFromAmount).add(msg.value);

        (address payable[2] memory peers, uint[2] memory balances) = getDepositMap(_channelId);
        emit Deposit(_channelId, peers, balances);

        if (_transferFromAmount > 0) {
            if (c.token.tokenType == PbEntity.TokenType.ETH) {
                // deposit from EthPool
                require(ethPool.transferFrom(msg.sender, address(this), _transferFromAmount));
            } else if (c.token.tokenType == PbEntity.TokenType.ERC20) {
                require(msg.value == 0);
                IERC20(c.token.tokenAddress).safeTransferFrom(msg.sender, address(this), _transferFromAmount);
            }
        }
    }

    /**
     * @notice Open a state channel through auth withdraw message
     * @param _openRequest bytes of open channel request message
     */
    function openChannel(bytes calldata _openRequest) external payable {
        PbChain2.OpenChannelRequest memory openRequest =
            PbChain2.decOpenChannelRequest(_openRequest);
        bytes32 hash = keccak256(abi.encodePacked(openRequest.channelInitializer, address(this)));
        uint64 channelId;
        assembly { channelId := hash }
        require(channelId != 0);  // 0 is reserved for non-channel indication
        Channel storage c = channelMap[channelId];
        require(c.status == ChannelStatus.Uninitialized, 'Occupied channel id');

        PbEntity.PaymentChannelInitializer memory channelInitializer =
            PbEntity.decPaymentChannelInitializer(openRequest.channelInitializer);

        // only support 2-peer channel for now
        require(channelInitializer.initDistribution.distribution.length == 2);
        require(block.number <= channelInitializer.openDeadline, 'Open deadline passed');

        PbEntity.TokenInfo memory token = channelInitializer.initDistribution.token;
        address payable[2] memory peers = [
            channelInitializer.initDistribution.distribution[0].account,
            channelInitializer.initDistribution.distribution[1].account
        ];

        // enforce ascending order of peers' addresses to simplify contract code
        require(peers[0] < peers[1]);

        c.settleTimeout = channelInitializer.settleTimeout;
        c.status = ChannelStatus.Operable;
        c.token = _validateTokenInfo(token);
        c.peers = peers;

        uint[2] memory amounts = [
            channelInitializer.initDistribution.distribution[0].amt,
            channelInitializer.initDistribution.distribution[1].amt
        ];
        c.peerProfileMap[peers[0]].deposit = amounts[0];
        c.peerProfileMap[peers[1]].deposit = amounts[1];
        emit OpenChannel(channelId, uint(token.tokenType), token.tokenAddress, peers, amounts);
        channelNum = channelNum.add(1);

        // if total deposit is 0, this is only a "plain" openChannel without any values,
        // and there is no need to check the signatures (and they can be NULL)
        if (amounts[0] == 0 && amounts[1] == 0) {
            require(msg.value == 0);
            return;
        }

        // if total deposit is larger than 0
        bytes32 h = keccak256(abi.encodePacked(openRequest.channelInitializer));
        require(_checkCoSignatures(c, h, openRequest.sigs));

        if (token.tokenType == PbEntity.TokenType.ETH) {
            require(msg.value == amounts[channelInitializer.msgValueRecipient]);
            // peer ID of non-msgValueRecipient
            uint pid = uint(1).sub(channelInitializer.msgValueRecipient);
            if (amounts[pid] > 0) {
                require(ethPool.transferFrom(peers[pid], address(this), amounts[pid]));
            }
        } else if (token.tokenType == PbEntity.TokenType.ERC20) {
            require(msg.value == 0);
            for (uint i = 0; i < peers.length; i++) {
                if (amounts[i] > 0) {
                    IERC20(token.tokenAddress).safeTransferFrom(peers[i], address(this), amounts[i]);
                }
            }
        } else {
            assert(false);
        }
    }

    /**
     * @notice Cooperatively withdraw specific amount of deposit
     * @param _cooperativeWithdrawRequest bytes of cooperative withdraw request message
     */
    function cooperativeWithdraw(bytes calldata _cooperativeWithdrawRequest) external {
        PbChain2.CooperativeWithdrawRequest memory cooperativeWithdrawRequest =
            PbChain2.decCooperativeWithdrawRequest(_cooperativeWithdrawRequest);
        PbEntity.CooperativeWithdrawInfo memory withdrawInfo =
            PbEntity.decCooperativeWithdrawInfo(cooperativeWithdrawRequest.withdrawInfo);
        Channel storage c = channelMap[withdrawInfo.channelId];

        require(c.status == ChannelStatus.Operable || c.status == ChannelStatus.Settling);
        bytes32 h = keccak256(abi.encodePacked(cooperativeWithdrawRequest.withdrawInfo));
        require(_checkCoSignatures(c, h, cooperativeWithdrawRequest.sigs));
        // require an increment of exactly 1 for seqNum of each cooperative withdraw request
        require(
            withdrawInfo.seqNum.sub(c.cooperativeWithdrawSeqNum) == 1,
            'seqNum should increase by 1'
        );
        require(block.number <= withdrawInfo.withdrawDeadline, 'Withdraw deadline passed');

        address payable receiver = withdrawInfo.withdraw.account;
        c.cooperativeWithdrawSeqNum = withdrawInfo.seqNum;
        uint amount = withdrawInfo.withdraw.amt;
        uint[2] memory withdrawalAmounts;

        // receiver ID. This implicitly requires _isPeer(c, receiver)
        uint rid = _getPeerIndex(c, receiver);
        if (c.peerProfileMap[receiver].deposit >= amount) {
            // only withdraw receiver's deposit
            withdrawalAmounts[rid] = amount;
            c.peerProfileMap[receiver].deposit = c.peerProfileMap[receiver].deposit.sub(amount);
        } else {
            // withdraw all receiver's deposit and withdraw the remaining from the other peer's
            uint remaining = amount.sub(c.peerProfileMap[receiver].deposit);
            withdrawalAmounts[rid] = c.peerProfileMap[receiver].deposit;
            c.peerProfileMap[receiver].deposit = 0;

            // non-receiver peer ID
            uint pid = uint(1).sub(rid);
            address peer = c.peers[pid];
            withdrawalAmounts[pid] = remaining;
            c.peerProfileMap[peer].deposit = c.peerProfileMap[peer].deposit.sub(remaining);
        }
        (, uint[2] memory balances) = getDepositMap(withdrawInfo.channelId);
        emit CooperativeWithdraw(
            withdrawInfo.channelId,
            withdrawalAmounts,
            receiver,
            balances,
            withdrawInfo.seqNum
        );

        _transfer(c, receiver, amount);
    }

    /**
     * @notice Intend to settle channel(s) with an array of signed simplex states
     * @dev simplex states in this array are not necessarily in the same channel,
         which means intendSettle natively supports multi-channel batch processing.
         A simplex state with non-zero seqNum (non-null state) must be co-signed by both peers,
         while a simplex state with seqNum=0 (null state) only needs to be signed by one peer.
         TODO: wait for Solidity support to replace SignedSimplexStateArray with bytes[].
     * @param _signedSimplexStateArray bytes of SignedSimplexStateArray message
     */
    function intendSettle(bytes calldata _signedSimplexStateArray) external {
        PbChain2.SignedSimplexStateArray memory signedSimplexStateArray =
            PbChain2.decSignedSimplexStateArray(_signedSimplexStateArray);
        uint simplexStatesNum = signedSimplexStateArray.signedSimplexStates.length;

        PbEntity.SimplexPaymentChannel memory simplexState =
            PbEntity.decSimplexPaymentChannel(signedSimplexStateArray.signedSimplexStates[0].simplexState);
        for (uint i = 0; i < simplexStatesNum; i++) {
            uint64 currentChannelId = simplexState.channelId;
            Channel storage c = channelMap[currentChannelId];
            require(c.status == ChannelStatus.Operable || c.status == ChannelStatus.Settling);
            // Should never intendSettle or not pass the settle finalized time
            // remove this msg due to out of gas during deployment
            // TODO: figure out how to save enough gas to add back this msg
            require(c.settleFinalizedTime == 0 || block.number < c.settleFinalizedTime);
            
            bytes32 stateHash = 
                keccak256(abi.encodePacked(signedSimplexStateArray.signedSimplexStates[i].simplexState));
            bytes[] memory sigs = signedSimplexStateArray.signedSimplexStates[i].sigs;

            if (simplexState.seqNum > 0) {  // non-null state
                require(_checkCoSignatures(c, stateHash, sigs));
                address peerFrom = simplexState.peerFrom;
                require(simplexState.seqNum > c.peerProfileMap[peerFrom].state.seqNum);

                // update simplexState-dependent fields
                c.peerProfileMap[peerFrom].state.seqNum = simplexState.seqNum;
                c.peerProfileMap[peerFrom].state.amtOut = simplexState.transferToPeer.receiver.amt;
                c.peerProfileMap[peerFrom].state.lastPayResolveDeadline =
                    simplexState.lastPayResolveDeadline;
                c.peerProfileMap[peerFrom].state.nextPayHashListHash =
                    simplexState.pendingPayHashes.nextListHash;
                _liquidatePays(currentChannelId, peerFrom, simplexState.pendingPayHashes.payHashes);
            } else if (simplexState.seqNum == 0) {  // null state
                require(c.settleFinalizedTime == 0);  // this implies both stored seqNums are 0
                require(sigs.length == 1);
                require(_checkSingleSignature(c, stateHash, sigs[0]));
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
                require(currentChannelId <= simplexState.channelId, 'channelIds are not ascending');
                if (currentChannelId < simplexState.channelId) {
                    _updateOverallStatesByIntendState(currentChannelId);
                }
            } else {
                assert(false);
            }
        }
    }

    /**
     * @notice Read payment result and add result to corresponding simplex payment channel
     * @param _channelId ID of the channel
     * @param _peerFrom address of the peer who send out funds
     * @param _payHashList bytes of a pay hash list
     */
    function liquidatePayment(
        uint64 _channelId,
        address _peerFrom,
        bytes calldata _payHashList
    )
        external
    {
        Channel storage c = channelMap[_channelId];
        require(c.status == ChannelStatus.Settling);
        require(_isPeer(c, _peerFrom));

        bytes32 listHash = keccak256(abi.encodePacked(_payHashList));
        require(c.peerProfileMap[_peerFrom].state.nextPayHashListHash == listHash);

        PbEntity.PayHashList memory payHashList = PbEntity.decPayHashList(_payHashList);
        c.peerProfileMap[_peerFrom].state.nextPayHashListHash = payHashList.nextListHash;
        _liquidatePays(_channelId, _peerFrom, payHashList.payHashes);
    }

    /**
     * @notice Confirm channel settlement
     * @dev This must be alled after settleFinalizedTime
     * @param _channelId ID of the channel
     */
    function confirmSettle(uint64 _channelId) external {
        Channel storage c = channelMap[_channelId];
        require(c.status == ChannelStatus.Settling);
        // require no new intendSettle can be called
        require(block.number >= c.settleFinalizedTime, 'Not reach settle finalized time');
        address payable[2] memory peers = c.peers;
        // require channel status of current intendSettle has been finalized,
        // namely all payments have already been either liquidated or expired
        require(
            (c.peerProfileMap[peers[0]].state.nextPayHashListHash == bytes32(0) ||
                block.number > c.peerProfileMap[peers[0]].state.lastPayResolveDeadline) &&
            (c.peerProfileMap[peers[1]].state.nextPayHashListHash == bytes32(0) ||
                block.number > c.peerProfileMap[peers[1]].state.lastPayResolveDeadline)
        );

        (bool validBalance, uint[2] memory settleBalance) = _validateSettleBalance(c);
        if (!validBalance) {
            _resetDuplexState(c);
            emit ConfirmSettleFail(_channelId);
            return;
        }

        c.status = ChannelStatus.Closed;
        emit ConfirmSettle(_channelId, settleBalance);

        // Withdrawal from Contracts pattern is needless here,
        // because peers need to sign which implies that they can't be contracts
        _transfer(c, peers[0], settleBalance[0]);
        _transfer(c, peers[1], settleBalance[1]);
    }

    /**
     * @notice Cooperatively settle the channel
     * @param _settleRequest bytes of cooperative settle request message
     */
    function cooperativeSettle(bytes calldata _settleRequest) external {
        PbChain2.CooperativeSettleRequest memory settleRequest =
            PbChain2.decCooperativeSettleRequest(_settleRequest);
        PbEntity.CooperativeSettleInfo memory settleInfo =
            PbEntity.decCooperativeSettleInfo(settleRequest.settleInfo);
        Channel storage c = channelMap[settleInfo.channelId];
        require(c.status == ChannelStatus.Operable || c.status == ChannelStatus.Settling);

        bytes32 h = keccak256(abi.encodePacked(settleRequest.settleInfo));
        require(_checkCoSignatures(c, h, settleRequest.sigs));

        address payable[2] memory peers = c.peers;
        require(settleInfo.seqNum > c.peerProfileMap[peers[0]].state.seqNum);
        require(settleInfo.seqNum > c.peerProfileMap[peers[1]].state.seqNum);
        require(settleInfo.settleDeadline >= block.number);
        // require distribution is consistent with the order of c.peers
        require(settleInfo.settleBalance[0].account == peers[0]);
        require(settleInfo.settleBalance[1].account == peers[1]);

        uint[2] memory settleBalance = [
            settleInfo.settleBalance[0].amt,
            settleInfo.settleBalance[1].amt
        ];
        uint depositSum = c.peerProfileMap[peers[0]].deposit + c.peerProfileMap[peers[1]].deposit;
        require(
            settleBalance[0] + settleBalance[1] == depositSum,
            'Balance sum doesn\'t match'
        );

        c.status = ChannelStatus.Closed;
        emit CooperativeSettle(settleInfo.channelId, settleBalance);

        _transfer(c, peers[0], settleBalance[0]);
        _transfer(c, peers[1], settleBalance[1]);
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
     * @notice Get deposit amount for the specific peer
     * @param _channelId ID of the channel to be viewed
     * @param _peer address of the peer
     * @return deposit amount
     */
    function getDepositAmount(uint64 _channelId, address _peer) public view returns(uint) {
        Channel storage c = channelMap[_channelId];
        return c.peerProfileMap[_peer].deposit;
    }

    /**
     * @notice Return one channel's depositMap
     * @dev Solidity can't directly return an array of struct for now
     * @param _channelId ID of the channel to be viewed
     * @return addresses of peers in the channel,
     *   and corresponding balances of the peers (with matched indexes)
     */
    function getDepositMap(uint64 _channelId) public view
        returns(address payable[2] memory, uint[2] memory)
    {
        Channel storage c = channelMap[_channelId];
        uint[2] memory balances = [
            c.peerProfileMap[c.peers[0]].deposit,
            c.peerProfileMap[c.peers[1]].deposit
        ];
        return (c.peers, balances);
    }

    /**
     * @notice Internally uniform function to transfer channel's funds out
     * @param _c the channel being used
     * @param _to the address to transfer to
     * @param _value the amount to be transferred
     */
    function _transfer(Channel storage _c, address payable _to, uint _value) internal {
        require(_to != address(0));
        if (_value == 0) { return; }

        if (_c.token.tokenType == PbEntity.TokenType.ETH) {
            _to.transfer(_value);
        } else if (_c.token.tokenType == PbEntity.TokenType.ERC20) {
            IERC20(_c.token.tokenAddress).safeTransfer(_to, _value);
        } else {
            assert(false);
        }
    }

    /**
     * @notice Clear the state of the channel
     * @param _c the channel
     */
    function _resetDuplexState(Channel storage _c) internal {
        delete _c.settleFinalizedTime;
        _c.status = ChannelStatus.Operable;
        delete _c.peerProfileMap[_c.peers[0]].state;
        delete _c.peerProfileMap[_c.peers[1]].state;
    }

    /**
     * @notice Liquidate payments by their hash array
     * @param _channelId the channel id
     * @param _peerFrom address of the peer who sends out funds,
     *   should check it is a peer before calling this function
     * @param _payHashes hash array of pays to liquidate
     */
    function _liquidatePays(
        uint64 _channelId,
        address _peerFrom,
        bytes32[] memory _payHashes
    )
        internal
    {
        Channel storage c = channelMap[_channelId];
        uint currentBlockNum = block.number;
        uint lastPayResolveDeadline = c.peerProfileMap[_peerFrom].state.lastPayResolveDeadline;
        uint totalAmtOut = 0;

        for (uint i = 0; i < _payHashes.length; i++) {
            bytes32 payHash = _payHashes[i];
            // pay result must have been unchangable
            if (PayInfoMap[payHash].resolveDeadline == 0) {
                require(
                    currentBlockNum > lastPayResolveDeadline,
                    'Should pass last pay resolve deadline if never resolved'
                );
            } else {
                require(
                    currentBlockNum > PayInfoMap[payHash].resolveDeadline,
                    'Should pass resolve deadline if resolved'
                );
            }
            uint amount = PayInfoMap[payHash].amount;
            totalAmtOut = totalAmtOut.add(amount);
            emit LiquidateCondPay(_channelId, payHash, _peerFrom, amount);
        }
        c.peerProfileMap[_peerFrom].state.amtOut =
            c.peerProfileMap[_peerFrom].state.amtOut.add(totalAmtOut);
    }

    /**
     * @notice Update overall states of a duplex channel
     * @param _channelId the channel id
     */
    function _updateOverallStatesByIntendState(uint64 _channelId) internal {
        Channel storage c = channelMap[_channelId];
        c.settleFinalizedTime = block.number.add(c.settleTimeout);
        c.status = ChannelStatus.Settling;

        address payable[2] memory peers = c.peers;
        uint[2] memory newSeqNums = [
            c.peerProfileMap[peers[0]].state.seqNum,
            c.peerProfileMap[peers[1]].state.seqNum
        ];
        emit IntendSettle(_channelId, newSeqNums);
    }

    /**
     * @notice Get peer's index
     * @param _c the channel
     * @param _peer address of peer
     * @return peer's index
     */
     function _getPeerIndex(Channel storage _c, address _peer) internal view returns(uint) {
        if (_peer == _c.peers[0]) {
            return 0;
        } else if (_peer == _c.peers[1]) {
            return 1;
        } else {
            assert(false);
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
        require(_sigs.length == 2);  // only support 2-peer channel for now

        // check signature
        bytes32 hash = _h.toEthSignedMessageHash();
        address addr;
        for (uint i = 0; i < _sigs.length; i++) {
            addr = hash.recover(_sigs[i]);
            // enforce the order of sigs consistent with ascending addresses
            if (addr != address(_c.peers[i])) {
                return false;
            }
        }

        return true;
    }

    /**
     * @notice Check if _addr is one of the peers in channel _c
     * @param _c the channel
     * @param _addr the address to check
     * @return is peer or not
     */
    function _isPeer(Channel storage _c, address _addr) internal view returns(bool) {
        return _addr == _c.peers[0] || _addr == _c.peers[1];
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
     * @param _c the channel
     * @return (balance is valid, settle balance)
     */
    function _validateSettleBalance(Channel storage _c)
        internal
        view
        returns(bool, uint[2] memory)
    {
        address payable[2] memory peers = _c.peers;
        PeerProfile[2] memory peerProfiles = [
            _c.peerProfileMap[peers[0]],
            _c.peerProfileMap[peers[1]]
        ];

        uint[2] memory settleBalance = [
            (peerProfiles[0].deposit).add(peerProfiles[1].state.amtOut),
            (peerProfiles[1].deposit).add(peerProfiles[0].state.amtOut)
        ];
        for (uint i = 0; i < 2; i++) {
            if (settleBalance[i] < peerProfiles[i].state.amtOut) {
                return (false, [uint(0), uint(0)]);
            }

            settleBalance[i] = settleBalance[i].sub(peerProfiles[i].state.amtOut);
        }

        return (true, settleBalance);
    }
}