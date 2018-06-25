pragma solidity ^0.4.21;

interface DepositPoolInterface {
    function authorizedWithdraw(bytes _authWithdraw, bytes _signature) public;
}