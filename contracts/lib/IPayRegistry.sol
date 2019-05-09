pragma solidity ^0.5.0;

/**
 * @title PayRegistry interface
 */
interface IPayRegistry {
    function getPayAmounts(
        bytes32[] calldata _payHashes,
        uint _lastPayResolveDeadline
    ) external view returns(uint[] memory);

    function resolvePaymentByConditions(bytes calldata _resolveRequest) external;

    function resolvePaymentByVouchedResult(bytes calldata _vouchedPayResult) external;

    event UpdatePayResult(bytes32 payHash, uint newAmount);
}