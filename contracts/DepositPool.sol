pragma solidity ^0.4.21;

import "./lib/external/openzeppelin-solidity/contracts/math/SafeMath.sol";
import "./lib/data/cChannelObject.sol";
import "./lib/GenericChannelInterface.sol";
import "./lib/external/openzeppelin-solidity/contracts/AddressUtils.sol";
import "./lib/external/openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "./lib/external/openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";


contract DepositPool {
    using SafeMath for uint;
    using pbRpcAuthorizedWithdraw for pbRpcAuthorizedWithdraw.Data;
    using pbRpcMultiSignature for pbRpcMultiSignature.Data;
    using AddressUtils for address;
    using SafeERC20 for ERC20;

    enum TokenType { ETH, ERC20 }

    // user address => (token contract address => balance)
    mapping(address => mapping(address => uint)) private balances;
    mapping(bytes32 => bool) private usedMessageHash;
   
   // get balance of certain address
   function getRemainingBalance(address _addr, address _tokenContract) public view returns(uint) {
       return balances[_addr][_tokenContract];
   }

    // ETH deposit
    function deposit(address _receipient) public payable {
        require(_receipient != address(0));
        
        balances[_receipient][address(0)] = balances[_receipient][address(0)].add(msg.value);
    }

    /**
     * ERC token support for deposit
     * Only ERC20 support for now, more token types to be implemented...
     * TODO: overload deposit function.
     * Wait for truffle's support for function overloading: https://github.com/trufflesuite/truffle/issues/737
     */
    function depositERCToken (
        address _receipient,
        uint _amount,
        address _tokenContract,
        uint _tokenType
    ) 
        public
    {
        require(_receipient != address(0));
        require(_tokenContract != address(0));
        require(_tokenContract.isContract());
        require(_tokenType == uint(TokenType.ERC20));

        balances[_receipient][_tokenContract] = balances[_receipient][_tokenContract].add(_amount);

        // more token types to be added here...
        if (_tokenType == uint(TokenType.ERC20)) {
            ERC20(_tokenContract).safeTransferFrom(msg.sender, address(this), _amount);
            return;
        } else {
            assert(false);
        }
    }

    // ETH withdraw
    function withdraw(uint _amount) public {
        require(balances[msg.sender][address(0)] >= _amount);

        balances[msg.sender][address(0)] = balances[msg.sender][address(0)].sub(_amount);
        msg.sender.transfer(_amount);
    }

    /**
     * ERC token support for withdraw
     * Only ERC20 support for now, more token types to be implemented...
     * TODO: overload withdraw function.
     * Wait for truffle's support for function overloading: https://github.com/trufflesuite/truffle/issues/737
     */
    function withdrawERCToken (
        uint _amount,
        address _tokenContract,
        uint _tokenType
    )
        public
    {
        require(_tokenContract != address(0));
        require(_tokenContract.isContract());
        require(_tokenType == uint(TokenType.ERC20));
        require(balances[msg.sender][_tokenContract] >= _amount);

        balances[msg.sender][_tokenContract] = balances[msg.sender][_tokenContract].sub(_amount);

        // more token types to be added here...
        if (_tokenType == uint(TokenType.ERC20)) {
            ERC20(_tokenContract).safeTransfer(msg.sender, _amount);
            return;
        } else {
            assert(false);
        }
    }

    function authorizedWithdraw(bytes _authWithdraw, bytes _signature, uint _channelId) public {
        pbRpcMultiSignature.Data memory sigs = pbRpcMultiSignature.decode(_signature);
        pbRpcAuthorizedWithdraw.Data memory authWithdraw = pbRpcAuthorizedWithdraw.decode(_authWithdraw);
        bytes32 h = keccak256(_authWithdraw);
        bytes32 hash = keccak256("\x19Ethereum Signed Message:\n32", h);

        require(!usedMessageHash[h]);
        require(authWithdraw.peers.length == sigs.v.length);
        // only support ETH and ERC20 for now
        require(authWithdraw.tokenType == uint(TokenType.ETH) || authWithdraw.tokenType == uint(TokenType.ERC20));

        usedMessageHash[h] = true;
        // peers[0] is authOpenChannel caller and pays directly
        GenericChannelInterface genericChannel = GenericChannelInterface(authWithdraw.withdrawAddress);
        address tokenContract = authWithdraw.tokenContract;
        uint tokenType = authWithdraw.tokenType;
        for (uint i = 1; i < sigs.v.length; i++) {
            uint amount = authWithdraw.values[i];
            // These is no need to check an address if someone wants to withdraw nothing from it
            if (amount == 0) {
                continue;
            }

            address addr = ecrecover(hash, sigs.v[i], sigs.r[i], sigs.s[i]);            
            require(authWithdraw.peers[i] == addr);
            require(balances[addr][tokenContract] >= amount);

            balances[addr][tokenContract] = balances[addr][tokenContract].sub(amount);
            if (tokenType == uint(TokenType.ETH)) {
                // TODO: is it safe to transfer ETH in this way?
                genericChannel.deposit.value(amount)(_channelId, addr);
                return;
            } else if (tokenType == uint(TokenType.ERC20)) {
                ERC20(tokenContract).safeApprove(address(genericChannel), amount);
                genericChannel.depositERCToken(_channelId, addr, amount);
                return;
            } else {
                assert(false);
            }
        }
    }
}
