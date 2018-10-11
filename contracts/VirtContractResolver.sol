pragma solidity ^0.4.21;

import "./lib/VirtualChannelResolverInterface.sol";

contract VirtContractResolver is VirtualChannelResolverInterface {
    event Deploy(
        bytes32 virtAddr
    );

    mapping(bytes32 => address) virtToRealMap;

    function resolve(bytes32 virt) view external returns(address) {
        require(virtToRealMap[virt] != 0x0);
        return virtToRealMap[virt];
    }

    function deploy(bytes _code, uint _nonce) external returns(bool) {
        bytes32 virtAddr = keccak256(_code, _nonce);
        bytes memory c = _code;
        require(virtToRealMap[virtAddr] == 0x0);
        address deployedAddress;
        assembly {
            deployedAddress := create(0, add(c, 0x20), mload(c))
        }

        virtToRealMap[virtAddr] = deployedAddress;
        emit Deploy(virtAddr);
        return true;
    }

}