pragma solidity ^0.5.1;

import "../lib/interface/INumericCond.sol";

contract NumericCondMock is INumericCond {
    function isFinalized(bytes calldata _query) view external returns (bool) {
        return true;
    }

    function getOutcome(bytes calldata _query) view external returns (uint) {
        return _bytesToUint(_query);
    }

    function _bytesToUint(bytes memory _b) internal pure returns (uint) {
        if (_b.length == 0) {
            return 0;
        }

        uint v;
        assembly { v := mload(add(_b, 32)) }  // load all 32bytes to v
        v = v >> (8 * (32 - _b.length));  // only first _b.length is valid
        
        return v;
    }
}