pragma solidity ^0.4.21;

import "./external/openzeppelin-solidity/contracts/token/ERC20/StandardToken.sol";

contract ERC20ExampleToken is StandardToken {
    string public name = "ERC20ExampleToken";
    string public symbol = "EET20";
    uint8 public decimals = 2;
    uint public INITIAL_SUPPLY = 300000;

    function ERC20ExampleToken() public {
        totalSupply_ = INITIAL_SUPPLY;
        balances[msg.sender] = INITIAL_SUPPLY;
    }
}
