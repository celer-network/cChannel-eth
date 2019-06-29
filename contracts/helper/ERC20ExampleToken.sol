// Based on https://github.com/OpenZeppelin/openzeppelin-solidity/blob/master/contracts/examples/SimpleToken.sol
pragma solidity ^0.5.1;

import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20Detailed.sol";

/**
 * @title SimpleToken
 * @notice Very simple ERC20 Token example, where all tokens are pre-assigned to the creator.
 * Note they can later distribute these tokens as they wish using `transfer` and other
 * `ERC20` functions.
 */
contract ERC20ExampleToken is ERC20, ERC20Detailed {
    uint8 public constant DECIMALS = 2;
    uint256 public constant INITIAL_SUPPLY = 300000;

    /**
     * @notice Constructor that gives msg.sender all of existing tokens.
     */
    constructor () public ERC20Detailed("ERC20ExampleToken", "EET20", DECIMALS) {
        _mint(msg.sender, INITIAL_SUPPLY);
    }
}