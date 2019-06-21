pragma solidity ^0.5.0;

import "./lib/interface/ICelerWallet.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";

/**
 * @title CelerWallet contract
 * @notice A multi-owner, multi-token, operator-centric wallet designed for CelerChannel.
 *   This wallet can run independetly and doesn't rely on trust of any external contracts
 *   even CelerLedger to maximize its security.
 */
contract CelerWallet is ICelerWallet {
    using SafeMath for uint;
    using SafeERC20 for IERC20;

    enum MathOperation { Add, Sub }

    struct Wallet {
        // corresponding to peers in CelerLedger
        address[] owners;
        // corresponding to CelerLedger
        address operator;
        // adderss(0) for ETH
        mapping(address => uint) balances;
        address proposedOperator;
        mapping(address => bool) proposalVotes;
    }

    uint public walletNum;
    mapping(bytes32 => Wallet) private wallets;

    /**
     * @dev Throws if called by any account other than the wallet's operator
     * @param _walletId id of the wallet to be operated
     */
    modifier onlyOperator(bytes32 _walletId) {
        require(msg.sender == wallets[_walletId].operator, "msg.sender is not operator");
        _;
    }

    /**
     * @dev Throws if given address is not an owner of the wallet
     * @param _walletId id of the wallet to be operated
     * @param _addr address to be checked
     */
    modifier onlyOwner(bytes32 _walletId, address _addr) {
        require(_isWalletOwner(_walletId, _addr), "Given address is not wallet owner");
        _;
    }

    /**
     * @notice Create a new wallet
     * @param _owners owners of the wallet
     * @param _operator initial operator of the wallet
     * @param _nonce nonce given by caller to generate the wallet id
     * @return id of created wallet
     */
    function create(address[] memory _owners, address _operator, bytes32 _nonce) public returns(bytes32) {
        require(_operator != address(0), "New operator is address(0)");

        bytes32 walletId = keccak256(abi.encodePacked(address(this), msg.sender, _nonce));
        Wallet storage w = wallets[walletId];
        // wallet must be uninitialized
        require(w.operator == address(0), "Occupied wallet id");
        w.owners = _owners;
        w.operator = _operator;
        walletNum++;

        emit CreateWallet(walletId, _owners, _operator);
        return walletId;
    }

    /**
     * @notice Deposit ETH to a wallet
     * @param _walletId id of the wallet to deposit into
     */
    function depositETH(bytes32 _walletId) public payable {
        uint amount = msg.value;
        _updateBalance(_walletId, address(0), amount, MathOperation.Add);
        emit DepositToWallet(_walletId, address(0), amount);
    }

    /**
     * @notice Deposit ERC20 tokens to a wallet
     * @param _walletId id of the wallet to deposit into
     * @param _tokenAddress address of tokens to deposit
     * @param _from token payer
     * @param _amount deposit token amount
     */
    function depositERC20(
        bytes32 _walletId,
        address _tokenAddress,
        address _from,
        uint _amount
    )
        public
    {
        if (msg.sender == wallets[_walletId].operator) {
            require(
                _isWalletOwner(_walletId, _from) || _from == wallets[_walletId].operator,
                "Operator can only touch allowance from its owners or itself"
            );
        } else {
            require(
                _from == msg.sender,
                "Address other than operator can only touch allowance from itself"
            );
        }
        _updateBalance(_walletId, _tokenAddress, _amount, MathOperation.Add);
        emit DepositToWallet(_walletId, _tokenAddress, _amount);

        IERC20(_tokenAddress).safeTransferFrom(_from, address(this), _amount);
    }


    /**
     * @notice Withdraw funds to an address
     * @dev Since this withdraw() function uses direct transfer to send ETH, if CelerLedger
     *   allows non externally-owned account (EOA) to be a peer of the channel namely an owner
     *   of the wallet, CelerLedger should implement a withdraw pattern for ETH to avoid
     *   maliciously fund locking. Withdraw pattern reference:
     *   https://solidity.readthedocs.io/en/v0.5.9/common-patterns.html#withdrawal-from-contracts
     * @param _walletId id of the wallet to withdraw from
     * @param _tokenAddress address of tokens to withdraw
     * @param _receiver token receiver
     * @param _amount withdrawal token amount
     */
    function withdraw(
        bytes32 _walletId,
        address _tokenAddress,
        address _receiver,
        uint _amount
    )
        public
        onlyOperator(_walletId)
        onlyOwner(_walletId, _receiver)
    {
        _updateBalance(_walletId, _tokenAddress, _amount, MathOperation.Sub);
        emit WithdrawFromWallet(_walletId, _receiver, _tokenAddress, _amount);

        if (_tokenAddress == address(0)) {
            // convert from address to address payable
            // TODO: latest version of openzeppelin Address.sol provide this api toPayable()
            address payable receiver  = address(uint160(_receiver));
            receiver.transfer(_amount);
        } else {
            IERC20(_tokenAddress).safeTransfer(_receiver, _amount);
        }
    }

    /**
     * @notice Transfer funds from one wallet to another wallet with a same owner (as the receiver)
     * @dev from wallet and to wallet must have one common owner as the receiver or beneficiary
     *   of this transfer
     * @param _fromWalletId id of wallet to transfer funds from
     * @param _toWalletId id of wallet to transfer funds to
     * @param _tokenAddress address of tokens to transfer
     * @param _receiver beneficiary who transfers her funds from one wallet to another wallet
     * @param _amount transferred token amount
     */
    function transferToWallet(
        bytes32 _fromWalletId,
        bytes32 _toWalletId,
        address _tokenAddress,
        address _receiver,
        uint _amount
    )
        public
        onlyOperator(_fromWalletId)
        onlyOwner(_fromWalletId, _receiver)
        onlyOwner(_toWalletId, _receiver)
    {
        _updateBalance(_fromWalletId, _tokenAddress, _amount, MathOperation.Sub);
        _updateBalance(_toWalletId, _tokenAddress, _amount, MathOperation.Add);
        emit TransferToWallet(_fromWalletId, _toWalletId, _receiver, _tokenAddress, _amount);
    }

    /**
     * @notice Current operator transfers the operatorship of a wallet to the new operator
     * @param _walletId id of wallet to transfer the operatorship
     * @param _newOperator the new operator
     */
    function transferOperatorship(
        bytes32 _walletId,
        address _newOperator
    )
        public
        onlyOperator(_walletId)
    {
        require(_newOperator != address(0), "New operator is address(0)");

        Wallet storage w = wallets[_walletId];
        address oldOperator = w.operator;
        w.operator = _newOperator;
        emit UpdateOperator(_walletId, oldOperator, _newOperator);
    }

    /**
     * @notice Wallet owners propose and assign a new operator of their wallet
     * @dev it will assign a new operator if all owners propose the same new operator
     * @param _walletId id of wallet which owners propose new operator of
     * @param _newOperator the new operator proposal
     */
    function proposeNewOperator(
        bytes32 _walletId,
        address _newOperator
    )
        public
        onlyOwner(_walletId, msg.sender)
    {
        require(_newOperator != address(0), "New operator is address(0)");

        Wallet storage w = wallets[_walletId];
        if (_newOperator != w.proposedOperator) {
            _clearVotes(w);
            w.proposedOperator = _newOperator;
        }

        w.proposalVotes[msg.sender] = true;
        if (_checkAllVotes(w)) {
            address oldOperator = w.operator;
            w.operator = _newOperator;
            emit UpdateOperator(_walletId, oldOperator, _newOperator);
            _clearVotes(w);
        }
    }

    /**
     * @notice Get operator of a given wallet
     * @param _walletId id of the queried wallet
     * @return wallet's operator
     */
    function getOperator(bytes32 _walletId) public view returns(address) {
        return wallets[_walletId].operator;
    }

    /**
     * @notice Get balance of a given token in a given wallet
     * @param _walletId id of the queried wallet
     * @param _tokenAddress address of the queried token
     * @return amount of the given token in the wallet
     */
    function getBalance(bytes32 _walletId, address _tokenAddress) public view returns(uint) {
        return wallets[_walletId].balances[_tokenAddress];
    }

    /**
     * @notice Update balance record
     * @param _walletId id of wallet to update
     * @param _tokenAddress address of token to update
     * @param _amount update amount
     * @param _op update operation
     */
    function _updateBalance(
        bytes32 _walletId,
        address _tokenAddress,
        uint _amount,
        MathOperation _op
    )
        private
    {
        Wallet storage w = wallets[_walletId];
        if (_op == MathOperation.Add) {
            w.balances[_tokenAddress] = w.balances[_tokenAddress].add(_amount);
        } else if (_op == MathOperation.Sub) {
            w.balances[_tokenAddress] = w.balances[_tokenAddress].sub(_amount);
        } else {
            assert(false);
        }
    }

    /**
     * @notice Clear all votes of new operator proposals of the wallet
     * @param _w the wallet
     */
    function _clearVotes(Wallet storage _w) private {
        for (uint i = 0; i < _w.owners.length; i++) {
            _w.proposalVotes[_w.owners[i]] = false;
        }
    }

    /**
     * @notice Check if all owners have voted for the same new operator
     * @param _w the wallet
     * @return true if all owners have voted for a same operator; otherwise false
     */
    function _checkAllVotes(Wallet storage _w) private view returns(bool) {
        for (uint i = 0; i < _w.owners.length; i++) {
            if (_w.proposalVotes[_w.owners[i]] == false) {
                return false;
            }
        }
        return true;
    }

    /**
     * @notice Check if an address is an owner of a wallet
     * @param _walletId id of wallet to check
     * @param _addr address to check
     * @return true if this address is an owner of the wallet; otherwise false
     */
    function _isWalletOwner(bytes32 _walletId, address _addr) private view returns(bool) {
        Wallet storage w = wallets[_walletId];
        for (uint i = 0; i < w.owners.length; i++) {
            if (_addr == w.owners[i]) {
                return true;
            }
        }
        return false;
    }
}
