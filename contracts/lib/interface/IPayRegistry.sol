pragma solidity ^0.5.1;

/**
 * @title PayRegistry interface
 */
interface IPayRegistry {
    function calculatePayId(bytes32 _payHash, address _setter) external pure returns(bytes32);

    function setPayAmount(bytes32 _payHash, uint _amt) external;

    function setPayDeadline(bytes32 _payHash, uint _deadline) external;

    function setPayInfo(bytes32 _payHash, uint _amt, uint _deadline) external;

    function setPayAmounts(bytes32[] calldata _payHashes, uint[] calldata _amts) external;

    function setPayDeadlines(bytes32[] calldata _payHashes, uint[] calldata _deadlines) external;

    function setPayInfos(bytes32[] calldata _payHashes, uint[] calldata _amts, uint[] calldata _deadlines) external;

    function getPayAmounts(
        bytes32[] calldata _payIds,
        uint _lastPayResolveDeadline
    ) external view returns(uint[] memory);

    function getPayInfo(bytes32 _payId) external view returns(uint, uint);

    event PayInfoUpdate(bytes32 indexed payId, uint amount, uint resolveDeadline);
}
