pragma solidity ^0.5.0;

import "./lib/data/PbChain.sol";
import "./lib/data/PbEntity.sol";
import "./lib/IPayRegistry.sol";
import "./lib/IBooleanCond.sol";
import "./lib/INumericCond.sol";
import "./lib/IVirtContractResolver.sol";
import "openzeppelin-solidity/contracts/math/Math.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/cryptography/ECDSA.sol";

/**
 * @title Pay Registry contract
 * @notice Implementation of a global registry to record payment results.
 */
contract PayRegistry is IPayRegistry {
    using SafeMath for uint;
    using ECDSA for bytes32;

    struct PayInfo {
        uint amount;
        uint resolveDeadline;
    }

    mapping(bytes32 => PayInfo) public payInfoMap;
    IVirtContractResolver public resolver;

    /**
     * @notice Pay registry constructor
     * @param _virtResolver address of virtual resolver
     */
    constructor(address _virtResolver) public {
        resolver = IVirtContractResolver(_virtResolver);
    }

    /**
     * @notice Get the amounts of a list of queried pays
     * @dev pay results must have been unchangable before calling this function.
     * @param _payHashes hashes of queried pays
     * @param _lastPayResolveDeadline the last pay resolve deadline of all queried pays
     * @return queried pay amounts
     */
    function getPayAmounts(
        bytes32[] calldata _payHashes,
        uint _lastPayResolveDeadline
    )
        external view returns(uint[] memory)
    {
        uint[] memory amounts = new uint[](_payHashes.length);
        for (uint i = 0; i < _payHashes.length; i++) {
            if (payInfoMap[_payHashes[i]].resolveDeadline == 0) {
                // should pass last pay resolve deadline if never resolved
                require(block.number > _lastPayResolveDeadline, "Payment is not finalized");
            } else {
                // should pass resolve deadline if resolved
                require(
                    block.number > payInfoMap[_payHashes[i]].resolveDeadline,
                    "Payment is not finalized"
                );
            }
            amounts[i] = payInfoMap[_payHashes[i]].amount;
        }
        return amounts;
    }

    /**
     * @notice Resolve a payment by onchain get its condition results
     * @dev HASH_LOCK should only be used for establishing multi-hop payments,
     *   and is always required to be true for all transfer function logic types.
     *   a pay with no condition or only true HASH_LOCK conditions will use max transfer amount.
     *   The preimage order should align at the order of HASH_LOCK conditions in condition array.
     * @param _resolveRequest bytes of PbEntity.ConditionalPay
     */
    function resolvePaymentByConditions(bytes memory _resolveRequest) public {
        PbChain.ResolvePayByConditionsRequest memory resolveRequest = 
            PbChain.decResolvePayByConditionsRequest(_resolveRequest);
        PbEntity.ConditionalPay memory pay = PbEntity.decConditionalPay(resolveRequest.condPay);
        require(block.number <= pay.resolveDeadline, "Pay resolve deadline passed");

        bytes32 payHash = keccak256(resolveRequest.condPay);
        // should never resolve before or not reaching onchain resolve deadline
        require(
            payInfoMap[payHash].resolveDeadline == 0 ||
                block.number <= payInfoMap[payHash].resolveDeadline,
            "Resolve timeout"
        );

        // onchain resolve this payment and get result
        uint amount;
        PbEntity.TransferFunctionType funcType = pay.transferFunc.logicType;
        if (funcType == PbEntity.TransferFunctionType.BOOLEAN_AND) {
            amount = _calculateBooleanAndPayment(pay, resolveRequest.hashPreimages);
        } else if (funcType == PbEntity.TransferFunctionType.BOOLEAN_OR) {
            amount = _calculateBooleanOrPayment(pay, resolveRequest.hashPreimages);
        } else if (_isNumericLogic(funcType)) {
            amount = _calculateNumericLogicPayment(pay, resolveRequest.hashPreimages, funcType);
        } else {
            // TODO: support more transfer function types
            assert(false);
        }

        if (payInfoMap[payHash].resolveDeadline > 0) {
            // resolveDeadline > 0 implies that this pay has been updated

            require(amount > payInfoMap[payHash].amount, "New amount is not larger");
        } else {
            payInfoMap[payHash].resolveDeadline = Math.min(
                block.number.add(pay.resolveTimeout),
                pay.resolveDeadline
            );
        }
        payInfoMap[payHash].amount = amount;
        emit UpdatePayResult(payHash, amount);
    }

    /**
     * @notice Resolve a payment by submitting an offchain vouched result
     * @param _vouchedPayResult bytes of PbEntity.VouchedCondPayResult
     */
    function resolvePaymentByVouchedResult(bytes memory _vouchedPayResult) public {
        PbEntity.VouchedCondPayResult memory vouchedPayResult = 
            PbEntity.decVouchedCondPayResult(_vouchedPayResult);
        PbEntity.CondPayResult memory payResult = 
            PbEntity.decCondPayResult(vouchedPayResult.condPayResult);
        PbEntity.ConditionalPay memory pay = PbEntity.decConditionalPay(payResult.condPay);

        require(block.number <= pay.resolveDeadline, "Pay resolve deadline passed");
        require(
            payResult.amount <= pay.transferFunc.maxTransfer.receiver.amt,
            "Exceed max transfer amount"
        );

        // check signatures
        bytes32 hash = keccak256(vouchedPayResult.condPayResult).toEthSignedMessageHash();
        address recoveredSrc = hash.recover(vouchedPayResult.sigOfSrc);
        address recoveredDest = hash.recover(vouchedPayResult.sigOfDest);
        require(
            recoveredSrc == address(pay.src) && recoveredDest == address(pay.dest),
            "Check sigs failed"
        );

        bytes32 payHash = keccak256(payResult.condPay);
        if (payInfoMap[payHash].resolveDeadline > 0) {
            require(block.number <= payInfoMap[payHash].resolveDeadline, "Resolve timeout");
            require(payResult.amount > payInfoMap[payHash].amount, "New amount is not larger");
        } else {
            payInfoMap[payHash].resolveDeadline = Math.min(
                block.number.add(pay.resolveTimeout),
                pay.resolveDeadline
            );
        }
        payInfoMap[payHash].amount = payResult.amount;
        emit UpdatePayResult(payHash, payResult.amount);
    }

    /**
     * @notice Calculate the result amount of BooleanAnd payment
     * @param _pay conditional pay
     * @param _preimages preimages for hash lock conditions
     * @return pay amount
     */
    function _calculateBooleanAndPayment(
        PbEntity.ConditionalPay memory _pay,
        bytes[] memory _preimages
    )
        internal
        view
        returns(uint)
    {
        uint j = 0;
        bool hasFalseContractCond = false;
        for (uint i = 0; i < _pay.conditions.length; i++) {
            PbEntity.Condition memory cond = _pay.conditions[i];
            if (cond.conditionType == PbEntity.ConditionType.HASH_LOCK) {
                require(keccak256(_preimages[j]) == cond.hashLock, "Wrong preimage");
                j++;
            } else if (
                cond.conditionType == PbEntity.ConditionType.DEPLOYED_CONTRACT || 
                cond.conditionType == PbEntity.ConditionType.VIRTUAL_CONTRACT
            ) {
                address addr = _getCondAddress(cond);
                IBooleanCond dependent = IBooleanCond(addr);
                require(dependent.isFinalized(cond.argsQueryFinalization), "Cond is not finalized");

                if (!dependent.getResult(cond.argsQueryResult)) {
                    hasFalseContractCond = true;
                }
            } else {
                assert(false);
            }
        }

        if (hasFalseContractCond) {
            return 0;
        } else {
            return _pay.transferFunc.maxTransfer.receiver.amt;
        }
    }

    /**
     * @notice Calculate the result amount of BooleanOr payment
     * @param _pay conditional pay
     * @param _preimages preimages for hash lock conditions
     * @return pay amount
     */
    function _calculateBooleanOrPayment(
        PbEntity.ConditionalPay memory _pay,
        bytes[] memory _preimages
    )
        internal
        view
        returns(uint)
    {
        uint j = 0;
        // whether there are any contract based conditions, i.e. DEPLOYED_CONTRACT or VIRTUAL_CONTRACT
        bool hasContractCond = false;
        bool hasTrueContractCond = false;
        for (uint i = 0; i < _pay.conditions.length; i++) {
            PbEntity.Condition memory cond = _pay.conditions[i];
            if (cond.conditionType == PbEntity.ConditionType.HASH_LOCK) {
                require(keccak256(_preimages[j]) == cond.hashLock, "Wrong preimage");
                j++;
            } else if (
                cond.conditionType == PbEntity.ConditionType.DEPLOYED_CONTRACT || 
                cond.conditionType == PbEntity.ConditionType.VIRTUAL_CONTRACT
            ) {
                address addr = _getCondAddress(cond);
                IBooleanCond dependent = IBooleanCond(addr);
                require(dependent.isFinalized(cond.argsQueryFinalization), "Cond is not finalized");

                hasContractCond = true;
                if (dependent.getResult(cond.argsQueryResult)) {
                    hasTrueContractCond = true;
                }
            } else {
                assert(false);
            }
        }

        if (!hasContractCond || hasTrueContractCond) {
            return _pay.transferFunc.maxTransfer.receiver.amt;
        } else {
            return 0;
        }
    }

    /**
     * @notice Calculate the result amount of numeric logic payment,
     *   including NUMERIC_ADD, NUMERIC_MAX and NUMERIC_MIN
     * @param _pay conditional pay
     * @param _preimages preimages for hash lock conditions
     * @param _funcType transfer function type
     * @return pay amount
     */
    function _calculateNumericLogicPayment(
        PbEntity.ConditionalPay memory _pay,
        bytes[] memory _preimages,
        PbEntity.TransferFunctionType _funcType
    )
        internal
        view
        returns(uint)
    {
        uint amount = 0;
        uint j = 0;
        bool hasContractCond = false;
        for (uint i = 0; i < _pay.conditions.length; i++) {
            PbEntity.Condition memory cond = _pay.conditions[i];
            if (cond.conditionType == PbEntity.ConditionType.HASH_LOCK) {
                require(keccak256(_preimages[j]) == cond.hashLock, "Wrong preimage");
                j++;
            } else if (
                cond.conditionType == PbEntity.ConditionType.DEPLOYED_CONTRACT || 
                cond.conditionType == PbEntity.ConditionType.VIRTUAL_CONTRACT
            ) {
                address addr = _getCondAddress(cond);
                INumericCond dependent = INumericCond(addr);
                require(dependent.isFinalized(cond.argsQueryFinalization), "Cond is not finalized");

                if (_funcType == PbEntity.TransferFunctionType.NUMERIC_ADD) {
                    amount = amount.add(dependent.getResult(cond.argsQueryResult));
                } else if (_funcType == PbEntity.TransferFunctionType.NUMERIC_MAX) {
                    amount = Math.max(amount, dependent.getResult(cond.argsQueryResult));
                } else if (_funcType == PbEntity.TransferFunctionType.NUMERIC_MIN) {
                    if (hasContractCond) {
                        amount = Math.min(amount, dependent.getResult(cond.argsQueryResult));
                    } else {
                        amount = dependent.getResult(cond.argsQueryResult);
                    }
                } else {
                    assert(false);
                }
                
                hasContractCond = true;
            } else {
                assert(false);
            }
        }

        if (hasContractCond) {
            require(amount <= _pay.transferFunc.maxTransfer.receiver.amt, "Exceed max transfer amount");
            return amount;
        } else {
            return _pay.transferFunc.maxTransfer.receiver.amt;
        }
    }

    /**
     * @notice Get the contract address of the condition
     * @param _cond condition
     * @return contract address of the condition
     */
    function _getCondAddress(PbEntity.Condition memory _cond) internal view returns(address) {
        // We need to take into account that contract may not be deployed.
        // However, this is automatically handled for us
        // because calling a non-existent function will cause an revert.
        if (_cond.conditionType == PbEntity.ConditionType.DEPLOYED_CONTRACT) {
            return _cond.deployedContractAddress;
        } else if (_cond.conditionType == PbEntity.ConditionType.VIRTUAL_CONTRACT) {
            return resolver.resolve(_cond.virtualContractAddress);
        } else {
            assert(false);
        }
    }

    /**
     * @notice Check if a function type is numeric logic
     * @param _funcType transfer function type
     * @return true if it is a numeric logic, otherwise false
     */
    function _isNumericLogic(PbEntity.TransferFunctionType _funcType) internal pure returns(bool) {
        return _funcType == PbEntity.TransferFunctionType.NUMERIC_ADD ||
            _funcType == PbEntity.TransferFunctionType.NUMERIC_MAX ||
            _funcType == PbEntity.TransferFunctionType.NUMERIC_MIN;
    }
}
