pragma solidity ^0.5.0;

import "./lib/data/PbChain2.sol";
import "./lib/data/PbEntity.sol";
import "./lib/IPayRegistry.sol";
import "./lib/IBooleanCond.sol";
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

    mapping(bytes32 => PayInfo) public PayInfoMap;
    IVirtContractResolver public resolver;

    /**
     * @notice Pay registry constructor
     * @param _virtResolver address of virtual resolver
     */
    constructor(address _virtResolver) public {
        resolver = IVirtContractResolver(_virtResolver);
    }

    /**
     * @notice Resolve a payment by onchain get its condition results
     * @param _resolveRequest bytes of PbEntity.ConditionalPay
     */
    function resolvePaymentByConditions(bytes memory _resolveRequest) public {
        PbChain2.ResolvePayByConditionsRequest memory resolveRequest = 
            PbChain2.decResolvePayByConditionsRequest(_resolveRequest);
        PbEntity.ConditionalPay memory pay = PbEntity.decConditionalPay(resolveRequest.condPay);
        require(block.number <= pay.resolveDeadline, 'Pay resolve deadline passed');

        bytes32 payHash = keccak256(abi.encodePacked(resolveRequest.condPay));
        require(
            PayInfoMap[payHash].resolveDeadline == 0 || 
                block.number <= PayInfoMap[payHash].resolveDeadline,
            'Resolve timeout'
        );

        // onchain resolve this payment and get result
        uint amount;
        PbEntity.TransferFunctionType funcType = pay.transferFunc.logicType;
        if (funcType == PbEntity.TransferFunctionType.BOOLEAN_AND) {
            amount = _calculateBooleanAndPayment(pay, resolveRequest.hashPreimages);
        } else if (funcType == PbEntity.TransferFunctionType.BOOLEAN_OR) {
            amount = _calculateBooleanOrPayment(pay, resolveRequest.hashPreimages);
        } else {
            // TODO: support more transfer function types
            assert(false);
        }
        require(amount <= pay.transferFunc.maxTransfer.receiver.amt);

        if (PayInfoMap[payHash].resolveDeadline > 0) {
            // resolveDeadline > 0 implies that this pay has been updated

            require(amount > PayInfoMap[payHash].amount);
        } else {
            PayInfoMap[payHash].resolveDeadline = Math.min(
                block.number.add(pay.resolveTimeout),
                pay.resolveDeadline
            );
        }
        PayInfoMap[payHash].amount = amount;
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

        require(block.number <= pay.resolveDeadline, 'Pay resolve deadline passed');
        require(
            payResult.amount <= pay.transferFunc.maxTransfer.receiver.amt,
            'Exceed max transfer amount'
        );

        // check signatures
        bytes32 hash = keccak256(abi.encodePacked(vouchedPayResult.condPayResult))
            .toEthSignedMessageHash();
        address recoveredSrc = hash.recover(vouchedPayResult.sigOfSrc);
        address recoveredDest = hash.recover(vouchedPayResult.sigOfDest);
        require(recoveredSrc == address(pay.src));
        require(recoveredDest == address(pay.dest));

        bytes32 payHash = keccak256(abi.encodePacked(payResult.condPay));
        if (PayInfoMap[payHash].resolveDeadline > 0) {
            require(
                block.number <= PayInfoMap[payHash].resolveDeadline,
                'Resolve timeout'
            );
            require(
                payResult.amount > PayInfoMap[payHash].amount, 
                'New amount is not larger'
            );
        } else {
            PayInfoMap[payHash].resolveDeadline = Math.min(
                block.number.add(pay.resolveTimeout),
                pay.resolveDeadline
            );
        }
        PayInfoMap[payHash].amount = payResult.amount;
        emit UpdatePayResult(payHash, payResult.amount);
    }

    /**
     * @notice Calculate the result amount of BooleanAnd payment
     * @param _pay conditional pay
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
        uint j;  // preimage counter
        for (uint i = 0; i < _pay.conditions.length; i++) {
            PbEntity.Condition memory cond = _pay.conditions[i];
            if (cond.conditionType == PbEntity.ConditionType.HASH_LOCK) {
                if (keccak256(abi.encodePacked(_preimages[j])) != cond.hashLock) {
                    return 0;
                }
                j++;
            } else if (
                cond.conditionType == PbEntity.ConditionType.DEPLOYED_CONTRACT || 
                cond.conditionType == PbEntity.ConditionType.VIRTUAL_CONTRACT
            ) {
                address addr = _getCondAddress(cond);

                IBooleanCond dependent = IBooleanCond(addr);
                require(dependent.isFinalized(cond.argsQueryFinalization));

                if (!dependent.getResult(cond.argsQueryResult)) {
                    return 0;
                }
            }
        }

        return _pay.transferFunc.maxTransfer.receiver.amt;
    }

    /**
     * @notice Calculate the result amount of BooleanOr payment
     * @param _pay conditional pay
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
        uint j;  // preimage counter
        for (uint i = 0; i < _pay.conditions.length; i++) {
            PbEntity.Condition memory cond = _pay.conditions[i];
            if (cond.conditionType == PbEntity.ConditionType.HASH_LOCK) {
                if (keccak256(abi.encodePacked(_preimages[j])) == cond.hashLock) {
                    return _pay.transferFunc.maxTransfer.receiver.amt;
                }
                j++;
            } else if (
                cond.conditionType == PbEntity.ConditionType.DEPLOYED_CONTRACT || 
                cond.conditionType == PbEntity.ConditionType.VIRTUAL_CONTRACT
            ) {
                address addr = _getCondAddress(cond);

                IBooleanCond dependent = IBooleanCond(addr);
                require(dependent.isFinalized(cond.argsQueryFinalization));

                if (dependent.getResult(cond.argsQueryResult)) {
                    return _pay.transferFunc.maxTransfer.receiver.amt;
                }
            }
        }

        return 0;
    }

    /**
     * @notice Get the contract address of the condition
     * @param _cond condition
     * @return contract address of the condition
     */
    function _getCondAddress(
        PbEntity.Condition memory _cond
    )
        internal
        view
        returns(address)
    {
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
}