pragma solidity ^0.5.1;

/**
 * @title PayResolver interface
 */
interface IPayResolver {
    function resolvePaymentByConditions(bytes calldata _resolvePayRequest) external;

    function resolvePaymentByVouchedResult(bytes calldata _vouchedPayResult) external;

    event ResolvePayment(bytes32 indexed payId, uint amount, uint resolveDeadline);
}
