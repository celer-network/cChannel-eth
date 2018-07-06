pragma solidity ^0.4.21;

import "./external/openzeppelin-solidity/contracts/token/ERC827/ERC827Token.sol";

contract ERC827ExampleToken is ERC827Token {
    string public name = "ERC827ExampleToken";
    string public symbol = "EET827";
    uint8 public decimals = 2;
    uint public INITIAL_SUPPLY = 300000;

    function ERC827ExampleToken() public {
        totalSupply_ = INITIAL_SUPPLY;
        balances[msg.sender] = INITIAL_SUPPLY;
    }
}
