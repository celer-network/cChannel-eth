pragma solidity ^0.5.0;

import "./data/PbEntity.sol";

/**
 * @title CelerChannel interface
 */
interface ICelerChannel {
    enum ChannelStatus { Uninitialized, Operable, Settling, Closed }

    function () external payable;

    function deposit(uint64 _channelId, address _recipient, uint _amount) external payable;

    function openChannel(bytes calldata _openChannelRequest) external payable;
    
    function cooperativeWithdraw(bytes calldata _cooperativeWithdrawRequest) external;
    
    function intendSettle(bytes calldata _signedSimplexStateArray) external;
    
    function liquidatePayment(uint64 _channelId, address _peerFrom, bytes calldata _payHashList) external;
    
    function confirmSettle(uint64 _channelId) external;
    
    function cooperativeSettle(bytes calldata _settleRequest) external;

    function getSettleFinalizedTime(uint64 _channelId) external view returns(uint);

    function getTokenContract(uint64 _channelId) external view returns(address);

    function getTokenType(uint64 _channelId) external view returns(PbEntity.TokenType);

    function getChannelStatus(uint64 _channelId) external view returns(ChannelStatus);

    function getCooperativeWithdrawSeqNum(uint64 _channelId) external view returns(uint);

    function getDepositAmount(uint64 _channelId, address _peer) external view returns(uint);

    function getDepositMap(uint64 _channelId) external view returns(address payable[2] memory, uint[2] memory);

    event OpenChannel(
        uint64 channelId,
        uint tokenType,
        address tokenAddress,
        // this is because address[2] can't be directly converted to address payable[2]
        address payable[2] peers,
        uint[2] balances
    );

    event Deposit(uint64 channelId, address payable[2] peers, uint[2] balances);

    event IntendSettle(uint64 channelId, uint[2] seqNums);

    event LiquidateCondPay(uint64 channelId, bytes32 condPayHash, address peerFrom, uint amount);

    event ConfirmSettle(uint64 channelId, uint[2] settleBalance);

    event ConfirmSettleFail(uint64 channelId);

    event CooperativeWithdraw(
        uint64 channelId,
        uint[2] withdrawalAmounts,
        address receiver,
        uint[2] balances,
        uint seqNum
    );

    event CooperativeSettle(uint64 channelId, uint[2] settleBalance);
}