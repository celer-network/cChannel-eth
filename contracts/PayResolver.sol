pragma solidity ^0.5.1;

import "./lib/data/PbChain.sol";
import "./lib/data/PbEntity.sol";
import "./lib/interface/IPayRegistry.sol";
import "./lib/interface/IPayResolver.sol";
import "./lib/interface/IBooleanCond.sol";
import "./lib/interface/INumericCond.sol";
import "./lib/interface/IVirtContractResolver.sol";
import "openzeppelin-solidity/contracts/math/Math.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/cryptography/ECDSA.sol";

/**
 * @title Pay Resolver contract
 * @notice Payment resolver with different payment resolving logics.
 */
contract PayResolver is IPayResolver {
    using SafeMath for uint;
    using ECDSA for bytes32;

    IPayRegistry public payRegistry;
    IVirtContractResolver public virtResolver;

    /**
     * @notice Pay registry constructor
     * @param _registryAddr address of pay registry
     * @param _virtResolverAddr address of virtual contract resolver
     */
    constructor(address _registryAddr, address _virtResolverAddr) public {
        payRegistry = IPayRegistry(_registryAddr);
        virtResolver = IVirtContractResolver(_virtResolverAddr);
    }

    /**
     * @notice Resolve a payment by onchain getting its condition outcomes
     * @dev HASH_LOCK should only be used for establishing multi-hop payments,
     *   and is always required to be true for all transfer function logic types.
     *   a pay with no condition or only true HASH_LOCK conditions will use max transfer amount.
     *   The preimage order should align at the order of HASH_LOCK conditions in condition array.
     * @param _resolvePayRequest bytes of PbChain.ResolvePayByConditionsRequest
     */
    function resolvePaymentByConditions(bytes calldata _resolvePayRequest) external {
        PbChain.ResolvePayByConditionsRequest memory resolvePayRequest = 
            PbChain.decResolvePayByConditionsRequest(_resolvePayRequest);
        PbEntity.ConditionalPay memory pay = PbEntity.decConditionalPay(resolvePayRequest.condPay);

        // onchain resolve this payment and get result
        uint amount;
        PbEntity.TransferFunctionType funcType = pay.transferFunc.logicType;
        if (funcType == PbEntity.TransferFunctionType.BOOLEAN_AND) {
            amount = _calculateBooleanAndPayment(pay, resolvePayRequest.hashPreimages);
        } else if (funcType == PbEntity.TransferFunctionType.BOOLEAN_OR) {
            amount = _calculateBooleanOrPayment(pay, resolvePayRequest.hashPreimages);
        } else if (_isNumericLogic(funcType)) {
            amount = _calculateNumericLogicPayment(pay, resolvePayRequest.hashPreimages, funcType);
        } else {
            // TODO: support more transfer function types
            assert(false);
        }

        bytes32 payHash = keccak256(resolvePayRequest.condPay);
        _resolvePayment(pay, payHash, amount);
    }

    /**
     * @notice Resolve a payment by submitting an offchain vouched result
     * @param _vouchedPayResult bytes of PbEntity.VouchedCondPayResult
     */
    function resolvePaymentByVouchedResult(bytes calldata _vouchedPayResult) external {
        PbEntity.VouchedCondPayResult memory vouchedPayResult = 
            PbEntity.decVouchedCondPayResult(_vouchedPayResult);
        PbEntity.CondPayResult memory payResult = 
            PbEntity.decCondPayResult(vouchedPayResult.condPayResult);
        PbEntity.ConditionalPay memory pay = PbEntity.decConditionalPay(payResult.condPay);

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
        _resolvePayment(pay, payHash, payResult.amount);
    }

    /**
     * @notice Internal function of resolving a payment with given amount
     * @param _pay conditional pay
     * @param _payHash hash of serialized condPay
     * @param _amount payment amount to resolve
     */
    function _resolvePayment(
        PbEntity.ConditionalPay memory _pay,
        bytes32 _payHash,
        uint _amount
    )
        internal
    {
        uint blockNumber = block.number;
        require(blockNumber <= _pay.resolveDeadline, "Passed pay resolve deadline in condPay msg");

        bytes32 payId = _calculatePayId(_payHash, address(this));
        (uint currentAmt, uint currentDeadline) = payRegistry.getPayInfo(payId);

        // should never resolve a pay before or not reaching onchain resolve deadline
        require(
            currentDeadline == 0 || blockNumber <= currentDeadline,
            "Passed onchain resolve pay deadline"
        );

        if (currentDeadline > 0) {
            // currentDeadline > 0 implies that this pay has been updated
            // payment amount must be monotone increasing
            require(_amount > currentAmt, "New amount is not larger");

            if (_amount == _pay.transferFunc.maxTransfer.receiver.amt) {
                // set resolve deadline = current block number if amount = max
                payRegistry.setPayInfo(_payHash, _amount, blockNumber);
                emit ResolvePayment(payId, _amount, blockNumber);
            } else {
                // should not update the onchain resolve deadline if not max amount
                payRegistry.setPayAmount(_payHash, _amount);
                emit ResolvePayment(payId, _amount, currentDeadline);
            }
        } else {
            uint newDeadline;
            if (_amount == _pay.transferFunc.maxTransfer.receiver.amt) {
                newDeadline = blockNumber;
            } else {
                newDeadline = Math.min(
                    blockNumber.add(_pay.resolveTimeout),
                    _pay.resolveDeadline
                );
                // 0 is reserved for unresolved status of a payment
                require(newDeadline > 0, "New resolve deadline is 0");
            }

            payRegistry.setPayInfo(_payHash, _amount, newDeadline);
            emit ResolvePayment(payId, _amount, newDeadline);
        }
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
                require(dependent.isFinalized(cond.argsQueryFinalization), "Condition is not finalized");

                if (!dependent.getOutcome(cond.argsQueryOutcome)) {
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
                require(dependent.isFinalized(cond.argsQueryFinalization), "Condition is not finalized");

                hasContractCond = true;
                if (dependent.getOutcome(cond.argsQueryOutcome)) {
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
                require(dependent.isFinalized(cond.argsQueryFinalization), "Condition is not finalized");

                if (_funcType == PbEntity.TransferFunctionType.NUMERIC_ADD) {
                    amount = amount.add(dependent.getOutcome(cond.argsQueryOutcome));
                } else if (_funcType == PbEntity.TransferFunctionType.NUMERIC_MAX) {
                    amount = Math.max(amount, dependent.getOutcome(cond.argsQueryOutcome));
                } else if (_funcType == PbEntity.TransferFunctionType.NUMERIC_MIN) {
                    if (hasContractCond) {
                        amount = Math.min(amount, dependent.getOutcome(cond.argsQueryOutcome));
                    } else {
                        amount = dependent.getOutcome(cond.argsQueryOutcome);
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
            return virtResolver.resolve(_cond.virtualContractAddress);
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

    /**
     * @notice Calculate pay id
     * @param _payHash hash of serialized condPay
     * @param _setter payment info setter, i.e. pay resolver
     * @return calculated pay id
     */
    function _calculatePayId(bytes32 _payHash, address _setter) internal pure returns(bytes32) {
        return keccak256(abi.encodePacked(_payHash, _setter));
    }
}
