pragma solidity ^0.5.0;

/**
 * @title PayRegistry interface
 */
interface IPayRegistry {
    function resolvePaymentByConditions(bytes calldata _resolveRequest) external;

    function resolvePaymentByVouchedResult(bytes calldata _vouchedPayResult) external;

    event UpdatePayResult(bytes32 payHash, uint newAmount);
}