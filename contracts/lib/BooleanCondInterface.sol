pragma solidity ^0.4.21;

interface BooleanCond {
    function isFinalized(bytes query, uint timeout) view external returns (bool);
    
    function isSatisfied(bytes query) view external returns (bool);
}