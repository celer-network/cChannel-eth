pragma solidity ^0.5.0;

import "../lib/interface/ICelerWallet.sol";

contract WalletTestHelper {
    event NewWallet(bytes32 walletId);

    ICelerWallet wallet;

    constructor(address _celerWallet) public {
        wallet = ICelerWallet(_celerWallet);
    }

    function create(
        address[] memory _owners,
        address _operator,
        uint _nonce
    )
        public
    {
        bytes32 n = keccak256(abi.encodePacked(_nonce));
        bytes32 walletId = wallet.create(_owners, _operator, n);
        emit NewWallet(walletId);
    }
}