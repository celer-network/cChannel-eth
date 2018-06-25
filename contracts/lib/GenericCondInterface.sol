pragma solidity ^0.4.21;

interface GenericCond {
    function isFinalized(bytes query, uint timeout) view external returns (bool);
    
    function getStateUpdate(bytes query) view external returns (bytes);
}