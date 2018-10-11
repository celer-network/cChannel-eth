pragma solidity ^0.4.21;

import "./lib/BooleanCondInterface.sol";

contract HTLRegistry is BooleanCond {

    mapping(bytes32 => uint) secretTimeMap;

    event SecretRegistry(
        bytes secret,
        bytes32 secretHash,
        uint time
    );

    // function toBytes32(bytes data) internal returns (bytes32) {
    //     uint val;
    //     for (uint i = 0; i < 32; i++)  {
    //         val *= 256;
    //         if (i < data.length)
    //             val |= uint8(data[i]);
    //     }
    //     return bytes32(val);
    // }

    function bytesToBytes32(bytes memory source) internal returns (bytes32 result) {
        if (source.length == 0) {
            return 0x0;
        }

        assembly {
            result := mload(add(source, 32))
        }
    }

    function isFinalized(bytes query, uint timeout) view external returns (bool) {
        require(query.length == 32);
        bytes32 r = bytesToBytes32(query);
        if((secretTimeMap[r] != 0) && (secretTimeMap[r] < timeout)) {
            return true;
        }

        return false;
    }
    
    function isSatisfied(bytes query) view external returns (bool) {
        require(query.length == 32);
        bytes32 r = bytesToBytes32(query);
        return(secretTimeMap[r] != 0);
    }   

    function resolve(bytes secret) external {
        bytes32 h = keccak256(secret);
        require(secretTimeMap[h] == 0);
        secretTimeMap[h] = block.number;
        emit SecretRegistry(secret, h, secretTimeMap[h]);
    }   

}