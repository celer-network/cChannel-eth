pragma solidity ^0.5.0;

/**
 * @title CelerWallet interface
 */
interface ICelerWallet {
    function create(address[] calldata _owners, address _operator, bytes32 _nonce) external returns(bytes32);

    function depositETH(bytes32 _walletId) external payable;

    function depositERC20(bytes32 _walletId, address _tokenAddress, address _from, uint _amount) external;
    
    function withdraw(bytes32 _walletId, address _tokenAddress, address _receiver, uint _amount) external;

    function transferToWallet(bytes32 _fromWalletId, bytes32 _toWalletId, address _tokenAddress, address _receiver, uint _amount) external;

    function transferOperatorship(bytes32 _walletId, address _newOperator) external;

    function proposeNewOperator(bytes32 _walletId, address _newOperator) external;

    function getOperator(bytes32 _walletId) external view returns(address);

    function getBalance(bytes32 _walletId, address _tokenAddress) external view returns(uint);

    event CreateWallet(bytes32 indexed walletId, address[] indexed owners, address indexed operator);

    event DepositToWallet(bytes32 indexed walletId, address indexed tokenAddress, uint amount);

    event WithdrawFromWallet(bytes32 indexed walletId, address indexed receiver, address indexed tokenAddress, uint amount);

    event TransferToWallet(bytes32 indexed fromWalletId, bytes32 indexed toWalletId, address receiver, address indexed tokenAddress, uint amount);

    event UpdateOperator(bytes32 indexed walletId, address indexed oldOperator, address indexed newOperator);
}
