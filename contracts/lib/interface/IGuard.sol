pragma solidity ^0.5.0;

interface IGuard {
    function deposit(uint _amount, bytes calldata _sidechainAddr) external;

    function subscribe(uint _amount) external;

    // function uploadCheckpoints(uint[] calldata _cpNumbers, bytes32[] calldata _checkpoints) external;

    // function punish(uint _cpNumber, bytes calldata _blockNumber, bytes calldata _headersProofBytes, bytes calldata _txIndex, bytes calldata _receiptsProofBytes) external;

    // function intendWithdraw(uint _amount) external;

    // function withdraw(uint _cpNumber, bytes calldata _blockNumber, bytes calldata _headersProofBytes, bytes calldata _txIndex, bytes calldata _receiptsProofBytes) external;

    event Deposit(address guardianEthAddr, bytes guardianSidechainAddr, uint newDeposit, uint totalDeposit);

    event Subscription(address consumer, uint amount, uint subscriptionExpiration);

    // event IntendWithdraw(address guardianEthAddr, uint amount);
}