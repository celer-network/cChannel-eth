pragma solidity ^0.5.1;

import "./lib/interface/IEthPool.sol";
import "./lib/interface/ICelerWallet.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";

/**
 * @title ETH Pool providing an ERC20 like interface
 * @notice Implementation of an ERC20 like pool for native ETH.
 * @dev Originally based on code of ERC20 by openzeppelin-solidity v2.1.2
 *   https://github.com/OpenZeppelin/openzeppelin-solidity/blob/v2.1.2/contracts/token/ERC20/ERC20.sol
 */ 
contract EthPool is IEthPool {
    using SafeMath for uint;

    mapping (address => uint) private balances;
    mapping (address => mapping (address => uint)) private allowed;
    
    // mock ERC20 details to enable etherscan-like tools to monitor EthPool correctly
    string public constant name = "EthInPool";
    string public constant symbol = "EthIP";
    uint8 public constant decimals = 18;

    /**
     * @notice Deposit ETH to ETH Pool
     * @param _receiver the address ETH is deposited to 
     */
    function deposit(address _receiver) public payable {
        require(_receiver != address(0), "Receiver address is 0");

        balances[_receiver] = balances[_receiver].add(msg.value);
        emit Deposit(_receiver, msg.value);
    }

    /**
     * @notice Withdraw ETH from ETH Pool
     * @param _value the amount of ETH to withdraw
     */
    function withdraw(uint _value) public {
        _transfer(msg.sender, msg.sender, _value);
    }

    /**
     * @notice Approve the passed address to spend the specified amount of ETH on behalf of msg.sender.
     * @dev Beware that changing an allowance with this method brings the risk that someone may use both the old
     *   and the new allowance by unfortunate transaction ordering. One possible solution to mitigate this
     *   race condition is to first reduce the spender's allowance to 0 and set the desired value afterwards:
     *   https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
     * @param _spender The address which will spend the funds.
     * @param _value The amount of ETH to be spent.
     */
    function approve(address _spender, uint _value) public returns (bool) {
        require(_spender != address(0), "Spender address is 0");

        allowed[msg.sender][_spender] = _value;
        emit Approval(msg.sender, _spender, _value);
        return true;
    }

    /**
     * @notice Transfer ETH from one address to another.
     * @dev Note that while this function emits an Approval event, this is not required as per the specification.
     * @param _from The address which you want to transfer ETH from
     * @param _to The address which you want to transfer to
     * @param _value the amount of ETH to be transferred
     */
    function transferFrom(address _from, address payable _to, uint _value) public returns (bool) {
        allowed[_from][msg.sender] = allowed[_from][msg.sender].sub(_value);
        emit Approval(_from, msg.sender, allowed[_from][msg.sender]);
        _transfer(_from, _to, _value);
        return true;
    }

    /**
     * @notice Transfer ETH from one address to a wallet in CelerWallet contract.
     * @param _from The address which you want to transfer ETH from
     * @param _walletAddr CelerWallet address which should have a depositETH(bytes32) payable API
     * @param _walletId id of the wallet you want to deposit ETH into
     * @param _value the amount of ETH to be transferred
     */
    function transferToCelerWallet(
        address _from,
        address _walletAddr,
        bytes32 _walletId,
        uint _value
    )
        external
        returns (bool)
    {
        allowed[_from][msg.sender] = allowed[_from][msg.sender].sub(_value);
        emit Approval(_from, msg.sender, allowed[_from][msg.sender]);
        balances[_from] = balances[_from].sub(_value);
        emit Transfer(_from, _walletAddr, _value);

        ICelerWallet wallet = ICelerWallet(_walletAddr);
        wallet.depositETH.value(_value)(_walletId);
        
        return true;
    }

    /**
     * @notice Increase the amount of ETH that an owner allowed to a spender.
     * @dev approve should be called when allowed[msg.sender][spender] == 0. To increment
     *   allowed value is better to use this function to avoid 2 calls (and wait until
     *   the first transaction is mined)
     *   From MonolithDAO Token.sol
     *   Emits an Approval event.
     * @param _spender The address which will spend the funds.
     * @param _addedValue The amount of ETH to increase the allowance by.
     */
    function increaseAllowance(address _spender, uint _addedValue) public returns (bool) {
        require(_spender != address(0), "Spender address is 0");

        allowed[msg.sender][_spender] = allowed[msg.sender][_spender].add(_addedValue);
        emit Approval(msg.sender, _spender, allowed[msg.sender][_spender]);
        return true;
    }

    /**
     * @notice Decrease the amount of ETH that an owner allowed to a spender.
     * @dev approve should be called when allowed[msg.sender][spender] == 0. To decrement
     *   allowed value is better to use this function to avoid 2 calls (and wait until
     *   the first transaction is mined)
     *   From MonolithDAO Token.sol
     *   Emits an Approval event.
     * @param _spender The address which will spend the funds.
     * @param _subtractedValue The amount of ETH to decrease the allowance by.
     */
    function decreaseAllowance(address _spender, uint _subtractedValue) public returns (bool) {
        require(_spender != address(0), "Spender address is 0");

        allowed[msg.sender][_spender] = allowed[msg.sender][_spender].sub(_subtractedValue);
        emit Approval(msg.sender, _spender, allowed[msg.sender][_spender]);
        return true;
    }

    /**
     * @notice Gets the balance of the specified address.
     * @param _owner The address to query the balance of.
     * @return An uint representing the amount owned by the passed address.
     */
    function balanceOf(address _owner) public view returns (uint) {
        return balances[_owner];
    }

    /**
     * @notice Function to check the amount of ETH that an owner allowed to a spender.
     * @param _owner address The address which owns the funds.
     * @param _spender address The address which will spend the funds.
     * @return A uint specifying the amount of ETH still available for the spender.
     */
    function allowance(address _owner, address _spender) public view returns (uint) {
        return allowed[_owner][_spender];
    }

    /**
     * @notice Transfer ETH for a specified addresses
     * @param _from The address to transfer from.
     * @param _to The address to transfer to.
     * @param _value The amount to be transferred.
     */
    function _transfer(address _from, address payable _to, uint _value) internal {
        require(_to != address(0), "To address is 0");

        balances[_from] = balances[_from].sub(_value);
        emit Transfer(_from, _to, _value);
        _to.transfer(_value);
    }
}
