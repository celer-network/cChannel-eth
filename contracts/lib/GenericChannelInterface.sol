pragma solidity ^0.4.21;

interface GenericChannelInterface {
    function deposit(uint _channelId, address _receipient) public payable;
    function depositERCToken(uint _channelId, address _receipient, uint _amount) public;
}