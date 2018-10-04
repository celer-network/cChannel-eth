pragma solidity ^0.4.21;

import "./lib/external/openzeppelin-solidity/contracts/math/SafeMath.sol";
import "./lib/data/cChannelObject.sol";


contract DepositPool {
    using SafeMath for uint;
    using pbRpcAuthorizedWithdraw for pbRpcAuthorizedWithdraw.Data;
    using pbRpcMultiSignature for pbRpcMultiSignature.Data;

    mapping(address => uint) private balances;
    mapping(bytes32 => bool) private usedMessageHash;

    // ETH deposit
    function deposit() public payable {
        balances[msg.sender] = balances[msg.sender].add(msg.value);
    }

    function withdraw(uint value) public {
        require(balances[msg.sender] >= value);

        balances[msg.sender] = balances[msg.sender].sub(value);
        msg.sender.transfer(value);
    }
    function authorizedWithdraw(bytes _authWithdraw, bytes _signature) public {
        pbRpcMultiSignature.Data memory sigs = pbRpcMultiSignature.decode(_signature);
        pbRpcAuthorizedWithdraw.Data memory authWithdraw = pbRpcAuthorizedWithdraw.decode(_authWithdraw);
        bytes32 h = keccak256(_authWithdraw);
        bytes32 hash = keccak256("\x19Ethereum Signed Message:\n32", h);

        require(!usedMessageHash[h]);

        require(authWithdraw.peers.length == sigs.v.length);

        usedMessageHash[h] = true;
        // peers[0] is authOpenChannel caller and pays directly
        for (uint i = 1; i < sigs.v.length; i++) {
            address addr = ecrecover(hash, sigs.v[i], sigs.r[i], sigs.s[i]);
            uint value = authWithdraw.values[i];
	    require(authWithdraw.peers[i] == addr);
	    require(balances[addr] >= value);
            if (value > 0) {
                balances[addr] = balances[addr].sub(value);
                authWithdraw.withdrawAddress.transfer(value);
            }
        }
    }
}
