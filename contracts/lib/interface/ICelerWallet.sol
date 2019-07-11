pragma solidity ^0.5.1;

/**
 * @title CelerWallet interface
 */
interface ICelerWallet {
    function create(address[] calldata _owners, address _operator, bytes32 _nonce) external returns(bytes32);

    function depositETH(bytes32 _walletId) external payable;

    function depositERC20(bytes32 _walletId, address _tokenAddress, uint _amount) external;
    
    function withdraw(bytes32 _walletId, address _tokenAddress, address _receiver, uint _amount) external;

    function transferToWallet(bytes32 _fromWalletId, bytes32 _toWalletId, address _tokenAddress, address _receiver, uint _amount) external;

    function transferOperatorship(bytes32 _walletId, address _newOperator) external;

    function proposeNewOperator(bytes32 _walletId, address _newOperator) external;

    function drainToken(address _tokenAddress, address _receiver, uint _amount) external;

    function getWalletOwners(bytes32 _walletId) external view returns(address[] memory);

    function getOperator(bytes32 _walletId) external view returns(address);

    function getBalance(bytes32 _walletId, address _tokenAddress) external view returns(uint);

    function getProposedNewOperator(bytes32 _walletId) external view returns(address);

    function getProposalVote(bytes32 _walletId, address _owner) external view returns(bool);

    event CreateWallet(bytes32 indexed walletId, address[] indexed owners, address indexed operator);

    event DepositToWallet(bytes32 indexed walletId, address indexed tokenAddress, uint amount);

    event WithdrawFromWallet(bytes32 indexed walletId, address indexed tokenAddress, address indexed receiver, uint amount);

    event TransferToWallet(bytes32 indexed fromWalletId, bytes32 indexed toWalletId, address indexed tokenAddress, address receiver, uint amount);

    event ChangeOperator(bytes32 indexed walletId, address indexed oldOperator, address indexed newOperator);

    event ProposeNewOperator(bytes32 indexed walletId, address indexed newOperator, address indexed proposer);

    event DrainToken(address indexed tokenAddress, address indexed receiver, uint amount);
}
