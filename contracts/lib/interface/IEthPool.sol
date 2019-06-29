pragma solidity ^0.5.1;

/**
 * @title EthPool interface
 */
interface IEthPool {
    function deposit(address _receiver) external payable;

    function withdraw(uint _value) external;

    function approve(address _spender, uint _value) external returns (bool);

    function transferFrom(address _from, address payable _to, uint _value) external returns (bool);

    function transferToCelerWallet(address _from, address _walletAddr, bytes32 _walletId, uint _value) external returns (bool);

    function increaseAllowance(address _spender, uint _addedValue) external returns (bool);

    function decreaseAllowance(address _spender, uint _subtractedValue) external returns (bool);

    function balanceOf(address _owner) external view returns (uint);

    function allowance(address _owner, address _spender) external view returns (uint);

    event Deposit(address indexed receiver, uint value);
    
    // transfer from "from" account inside EthPool to real "to" address outside EthPool
    event Transfer(address indexed from, address indexed to, uint value);
    
    event Approval(address indexed owner, address indexed spender, uint value);
}
