pragma solidity ^0.5.1;

/**
 * @title VirtContractResolver interface
 */
interface IVirtContractResolver {
    function deploy(bytes calldata _code, uint _nonce) external returns (bool);
    
    function resolve(bytes32 _virtAddr) external view returns (address);

    event Deploy(bytes32 indexed virtAddr);
}
