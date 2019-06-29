pragma solidity ^0.5.1;

import "./LedgerStruct.sol";
import "../interface/ICelerLedger.sol";
import "../data/PbEntity.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/cryptography/ECDSA.sol";

/**
 * @title Ledger Channel Library
 * @notice CelerLedger library about Channel struct
 * @dev this can be included in LedgerOperation to save some gas,
 *   however, keep this for now for clearness.
 */
library LedgerChannel {
    using SafeMath for uint;
    using ECDSA for bytes32;

    /**
     * @notice Get channel confirm settle open time
     * @param _c the channel being used
     * @return channel confirm settle open time
     */
    function getSettleFinalizedTime(LedgerStruct.Channel storage _c) public view returns(uint) {
        return _c.settleFinalizedTime;
    }

    /**
     * @notice Get channel token contract address
     * @param _c the channel being used
     * @return channel token contract address
     */
    function getTokenContract(LedgerStruct.Channel storage _c) public view returns(address) {
        return _c.token.tokenAddress;
    }

    /**
     * @notice Get channel token type
     * @param _c the channel being used
     * @return channel token type
     */
    function getTokenType(LedgerStruct.Channel storage _c) public view returns(PbEntity.TokenType) {
        return _c.token.tokenType;
    }

    /**
     * @notice Get channel status
     * @param _c the channel being used
     * @return channel status
     */
    function getChannelStatus(
        LedgerStruct.Channel storage _c
    )
        public
        view
        returns(LedgerStruct.ChannelStatus)
    {
        return _c.status;
    }

    /**
     * @notice Get cooperative withdraw seqNum
     * @param _c the channel being used
     * @return cooperative withdraw seqNum
     */
    function getCooperativeWithdrawSeqNum(LedgerStruct.Channel storage _c) public view returns(uint) {
        return _c.cooperativeWithdrawSeqNum;
    }

    /**
     * @notice Return one channel's total balance amount
     * @param _c the channel
     * @return channel's balance amount
     */
    function getTotalBalance(LedgerStruct.Channel storage _c) public view returns(uint) {
        uint balance = _c.peerProfiles[0].deposit
            .add(_c.peerProfiles[1].deposit)
            .sub(_c.peerProfiles[0].withdrawal)
            .sub(_c.peerProfiles[1].withdrawal);
        return balance;
    }

    /**
     * @notice Return one channel's balance info (depositMap and withdrawalMap)
     * @dev Solidity can't directly return an array of struct for now
     * @param _c the channel
     * @return addresses of peers in the channel
     * @return corresponding deposits of the peers (with matched index)
     * @return corresponding withdrawals of the peers (with matched index)
     */
    function getBalanceMap(LedgerStruct.Channel storage _c) public view
        returns(address[2] memory, uint[2] memory, uint[2] memory)
    {
        address[2] memory peerAddrs = [_c.peerProfiles[0].peerAddr, _c.peerProfiles[1].peerAddr];
        uint[2] memory deposits = [_c.peerProfiles[0].deposit, _c.peerProfiles[1].deposit];
        uint[2] memory withdrawals = [_c.peerProfiles[0].withdrawal, _c.peerProfiles[1].withdrawal];
        return (peerAddrs, deposits, withdrawals);
    }

    /**
     * @notice Return channel-level migration arguments
     * @param _c the channel to be viewed
     * @return channel dispute timeout
     * @return channel tokey type converted to uint
     * @return channel token address
     * @return sequence number of cooperative withdraw
     * @dev related to Ledger Migration
     */
    function getChannelMigrationArgs(
        LedgerStruct.Channel storage _c
    )
        external
        view
        returns(uint, uint, address, uint)
    {
        return (
            _c.disputeTimeout,
            uint(_c.token.tokenType),
            _c.token.tokenAddress,
            _c.cooperativeWithdrawSeqNum
        );
    }

    /**
     * @notice Return migration info of the peers in the channel
     * @param _c the channel to be viewed
     * @return peers' addresses
     * @return peers' deposits
     * @return peers' withdrawals
     * @return peers' state sequence numbers
     * @return peers' transferOut map
     * @return peers' pendingPayOut map
     * @dev related to Ledger Migration
     */
    function getPeersMigrationInfo(
        LedgerStruct.Channel storage _c
    )
        external
        view
        returns(
        address[2] memory,
        uint[2] memory,
        uint[2] memory,
        uint[2] memory,
        uint[2] memory,
        uint[2] memory
    )
    {
        LedgerStruct.PeerProfile[2] memory peerProfiles = _c.peerProfiles;
        return (
            [peerProfiles[0].peerAddr, peerProfiles[1].peerAddr],
            [peerProfiles[0].deposit, peerProfiles[1].deposit],
            [peerProfiles[0].withdrawal, peerProfiles[1].withdrawal],
            [peerProfiles[0].state.seqNum, peerProfiles[1].state.seqNum],
            [peerProfiles[0].state.transferOut, peerProfiles[1].state.transferOut],
            [peerProfiles[0].state.pendingPayOut, peerProfiles[1].state.pendingPayOut]
        );
    }

    /**
     * @notice Return channel's dispute timeout
     * @param _c the channel to be viewed
     * @return channel's dispute timeout
     */
    function getDisputeTimeout(LedgerStruct.Channel storage _c) external view returns(uint) {
        return _c.disputeTimeout;
    }

    /**
     * @notice Return channel's migratedTo address
     * @param _c the channel to be viewed
     * @return channel's migratedTo address
     */
    function getMigratedTo(LedgerStruct.Channel storage _c) external view returns(address) {
        return _c.migratedTo;
    }

    /**
     * @notice Return state seqNum map of a duplex channel
     * @param _c the channel to be viewed
     * @return peers' addresses
     * @return two simplex state sequence numbers
     */
    function getStateSeqNumMap(
        LedgerStruct.Channel storage _c
    )
        external
        view
        returns(address[2] memory, uint[2] memory)
    {
        LedgerStruct.PeerProfile[2] memory peerProfiles = _c.peerProfiles;
        return (
            [peerProfiles[0].peerAddr, peerProfiles[1].peerAddr],
            [peerProfiles[0].state.seqNum, peerProfiles[1].state.seqNum]
        );
    }

    /**
     * @notice Return transferOut map of a duplex channel
     * @param _c the channel to be viewed
     * @return peers' addresses
     * @return transferOuts of two simplex channels
     */
    function getTransferOutMap(
        LedgerStruct.Channel storage _c
    )
        external
        view
        returns(address[2] memory, uint[2] memory)
    {
        LedgerStruct.PeerProfile[2] memory peerProfiles = _c.peerProfiles;
        return (
            [peerProfiles[0].peerAddr, peerProfiles[1].peerAddr],
            [peerProfiles[0].state.transferOut, peerProfiles[1].state.transferOut]
        );
    }

    /**
     * @notice Return nextPayIdListHash map of a duplex channel
     * @param _c the channel to be viewed
     * @return peers' addresses
     * @return nextPayIdListHashes of two simplex channels
     */
    function getNextPayIdListHashMap(
        LedgerStruct.Channel storage _c
    )
        external
        view
        returns(address[2] memory, bytes32[2] memory)
    {
        LedgerStruct.PeerProfile[2] memory peerProfiles = _c.peerProfiles;
        return (
            [peerProfiles[0].peerAddr, peerProfiles[1].peerAddr],
            [peerProfiles[0].state.nextPayIdListHash, peerProfiles[1].state.nextPayIdListHash]
        );
    }

    /**
     * @notice Return lastPayResolveDeadline map of a duplex channel
     * @param _c the channel to be viewed
     * @return peers' addresses
     * @return lastPayResolveDeadlines of two simplex channels
     */
    function getLastPayResolveDeadlineMap(
        LedgerStruct.Channel storage _c
    )
        external
        view
        returns(address[2] memory, uint[2] memory)
    {
        LedgerStruct.PeerProfile[2] memory peerProfiles = _c.peerProfiles;
        return (
            [peerProfiles[0].peerAddr, peerProfiles[1].peerAddr],
            [peerProfiles[0].state.lastPayResolveDeadline, peerProfiles[1].state.lastPayResolveDeadline]
        );
    }

    /**
     * @notice Return pendingPayOut map of a duplex channel
     * @param _c the channel to be viewed
     * @return peers' addresses
     * @return pendingPayOuts of two simplex channels
     */
    function getPendingPayOutMap(
        LedgerStruct.Channel storage _c
    )
        external
        view
        returns(address[2] memory, uint[2] memory)
    {
        LedgerStruct.PeerProfile[2] memory peerProfiles = _c.peerProfiles;
        return (
            [peerProfiles[0].peerAddr, peerProfiles[1].peerAddr],
            [peerProfiles[0].state.pendingPayOut, peerProfiles[1].state.pendingPayOut]
        );
    }

    /**
     * @notice Return the withdraw intent info of the channel
     * @param _c the channel to be viewed
     * @return receiver of the withdraw intent
     * @return amount of the withdraw intent
     * @return requestTime of the withdraw intent
     * @return recipientChannelId of the withdraw intent
     */
    function getWithdrawIntent(
        LedgerStruct.Channel storage _c
    )
        external
        view
        returns(address, uint, uint, bytes32)
    {
        LedgerStruct.WithdrawIntent memory withdrawIntent = _c.withdrawIntent;
        return (
            withdrawIntent.receiver,
            withdrawIntent.amount,
            withdrawIntent.requestTime,
            withdrawIntent.recipientChannelId
        );
    }

    /**
     * @notice Import channel migration arguments from old CelerLedger contract
     * @param _c the channel to be viewed
     * @param _fromLedgerAddr old ledger address to import channel config from
     * @param _channelId ID of the channel to be viewed
     * @dev related to Ledger Migration
     */
    function _importChannelMigrationArgs(
        LedgerStruct.Channel storage _c,
        address payable _fromLedgerAddr,
        bytes32 _channelId
    )
        internal
    {
        uint tokenType;
        (
            _c.disputeTimeout,
            tokenType,
            _c.token.tokenAddress,
            _c.cooperativeWithdrawSeqNum
        ) = ICelerLedger(_fromLedgerAddr).getChannelMigrationArgs(_channelId);
        _c.token.tokenType = PbEntity.TokenType(tokenType);
    }

    /**
     * @notice import channel peers' migration info from old CelerLedger contract
     * @param _c the channel to be viewed
     * @param _fromLedgerAddr old ledger address to import channel config from
     * @param _channelId ID of the channel to be viewed
     * @dev related to Ledger Migration
     */
    function _importPeersMigrationInfo(
        LedgerStruct.Channel storage _c,
        address payable _fromLedgerAddr,
        bytes32 _channelId
    )
        internal
    {
        (
            address[2] memory peersAddrs,
            uint[2] memory deposits,
            uint[2] memory withdrawals,
            uint[2] memory seqNums,
            uint[2] memory transferOuts,
            uint[2] memory pendingPayOuts
        ) = ICelerLedger(_fromLedgerAddr).getPeersMigrationInfo(_channelId);

        for (uint i = 0; i < 2; i++) {
            LedgerStruct.PeerProfile storage peerProfile = _c.peerProfiles[i];
            peerProfile.peerAddr = peersAddrs[i];
            peerProfile.deposit = deposits[i];
            peerProfile.withdrawal = withdrawals[i];
            peerProfile.state.seqNum = seqNums[i];
            peerProfile.state.transferOut = transferOuts[i];
            peerProfile.state.pendingPayOut = pendingPayOuts[i];
        }
    }

    /**
     * @notice Get the seqNums of two simplex channel states
     * @param _c the channel
     */
    function _getStateSeqNums(LedgerStruct.Channel storage _c) internal view returns(uint[2] memory) {
        return [_c.peerProfiles[0].state.seqNum, _c.peerProfiles[1].state.seqNum];
    }

    /**
     * @notice Check if _addr is one of the peers in channel _c
     * @param _c the channel
     * @param _addr the address to check
     * @return is peer or not
     */
    function _isPeer(LedgerStruct.Channel storage _c, address _addr) internal view returns(bool) {
        return _addr == _c.peerProfiles[0].peerAddr || _addr == _c.peerProfiles[1].peerAddr;
    }

    /**
     * @notice Get peer's ID
     * @param _c the channel
     * @param _peer address of peer
     * @return peer's ID
     */
     function _getPeerId(LedgerStruct.Channel storage _c, address _peer) internal view returns(uint) {
        if (_peer == _c.peerProfiles[0].peerAddr) {
            return 0;
        } else if (_peer == _c.peerProfiles[1].peerAddr) {
            return 1;
        } else {
            revert("Nonexist peer");
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
        LedgerStruct.Channel storage _c,
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
        LedgerStruct.Channel storage _c,
        bytes32 _h,
        bytes[] memory _sigs
    )
        internal
        view
        returns(bool)
    {
        if (_sigs.length != 2) {
            return false;
        }

        // check signature
        bytes32 hash = _h.toEthSignedMessageHash();
        address addr;
        for (uint i = 0; i < 2; i++) {
            addr = hash.recover(_sigs[i]);
            // enforce the order of sigs consistent with ascending addresses
            if (addr != _c.peerProfiles[i].peerAddr) {
                return false;
            }
        }

        return true;
    }

    /**
     * @notice Validate channel final balance
     * @dev settleBalance = deposit - withdrawal + transferIn - transferOut
     * @param _c the channel
     * @return (balance is valid, settle balance)
     */
    function _validateSettleBalance(LedgerStruct.Channel storage _c)
        internal
        view
        returns(bool, uint[2] memory)
    {
        LedgerStruct.PeerProfile[2] memory peerProfiles = _c.peerProfiles;
        uint[2] memory settleBalance = [
            peerProfiles[0].deposit.add(peerProfiles[1].state.transferOut),
            peerProfiles[1].deposit.add(peerProfiles[0].state.transferOut)
        ];
        for (uint i = 0; i < 2; i++) {
            uint subAmt = peerProfiles[i].state.transferOut.add(peerProfiles[i].withdrawal);
            if (settleBalance[i] < subAmt) {
                return (false, [uint(0), uint(0)]);
            }

            settleBalance[i] = settleBalance[i].sub(subAmt);
        }

        return (true, settleBalance);
    }

    /**
     * @notice Update record of one peer's withdrawal amount
     * @param _c the channel
     * @param _receiver receiver of this new withdrawal
     * @param _amount amount of this new withdrawal
     * @param _checkBalance check the balance if this is true
     */
    function _addWithdrawal(
        LedgerStruct.Channel storage _c,
        address _receiver,
        uint _amount,
        bool _checkBalance
    )
        internal
    {
        // this implicitly require receiver be a peer
        uint rid = _getPeerId(_c, _receiver);
        _c.peerProfiles[rid].withdrawal = _c.peerProfiles[rid].withdrawal.add(_amount);
        if (_checkBalance) {
            require(getTotalBalance(_c) >= 0);
        }
    }
}
