pragma solidity ^0.5.0;

/**
 * @title NumericCond interface
 */
interface INumericCond {
    function isFinalized(bytes calldata _query) external view returns (bool);
    
    function getResult(bytes calldata _query) external view returns (uint);
}