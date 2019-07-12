pragma solidity ^0.5.1;

import "../interface/ICelerWallet.sol";
import "../interface/IEthPool.sol";
import "../interface/IPayRegistry.sol";
import "../data/PbEntity.sol";

/**
 * @title Ledger Struct Library
 * @notice CelerLedger library defining all used structs
 */
library LedgerStruct {
    enum ChannelStatus { Uninitialized, Operable, Settling, Closed, Migrated }

    struct PeerState {
        uint seqNum;
        // balance sent out to the other peer of the channel, no need to record amtIn
        uint transferOut;
        bytes32 nextPayIdListHash;
        uint lastPayResolveDeadline;
        uint pendingPayOut;
    }

    struct PeerProfile {
        address peerAddr;
        // the (monotone increasing) amount that this peer deposit into this channel
        uint deposit;
        // the (monotone increasing) amount that this peer withdraw from this channel
        uint withdrawal;
        PeerState state;
    }

    struct WithdrawIntent {
        address receiver;
        uint amount;
        uint requestTime;
        bytes32 recipientChannelId;
    }

    // Channel is a representation of the state channel between peers which puts the funds
    // in CelerWallet and is hosted by a CelerLedger. The status of a state channel can
    // be migrated from one CelerLedger instance to another CelerLedger instance with probably
    // different operation logic.
    struct Channel {
        // the time after which peers can confirmSettle and before which peers can intendSettle
        uint settleFinalizedTime;
        uint disputeTimeout;
        PbEntity.TokenInfo token;
        ChannelStatus status;
        // record the new CelerLedger address after channel migration
        address migratedTo;
        // only support 2-peer channel for now
        PeerProfile[2] peerProfiles;
        uint cooperativeWithdrawSeqNum;
        WithdrawIntent withdrawIntent;
    }

    // Ledger is a host to record and operate the activities of many state
    // channels with specific operation logic.
    struct Ledger {
        // ChannelStatus => number of channels
        mapping(uint => uint) channelStatusNums;
        IEthPool ethPool;
        IPayRegistry payRegistry;
        ICelerWallet celerWallet;
        // per-channel balance limits for different tokens
        mapping(address => uint) balanceLimits;
        // whether balance limits of all tokens have been enabled
        bool balanceLimitsEnabled;
        mapping(bytes32 => Channel) channelMap;
    }
}
