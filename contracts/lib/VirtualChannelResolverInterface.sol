pragma solidity ^0.4.21;

interface VirtualChannelResolverInterface {
    function resolve(bytes32 _virtualAddr) external view returns (address);    
    function deploy(bytes code, uint nonce) external returns (bool);
}