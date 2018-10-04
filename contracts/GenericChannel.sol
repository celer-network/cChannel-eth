pragma solidity ^0.4.21;

import "./lib/external/openzeppelin-solidity/contracts/math/SafeMath.sol";
import "./lib/external/openzeppelin-solidity/contracts/MerkleProof.sol";
import "./lib/data/cChannelObject.sol";
import "./lib/BooleanCondInterface.sol";
import "./lib/GenericCondInterface.sol";
import "./lib/VirtualChannelResolverInterface.sol";
import "./lib/DepositPoolInterface.sol";
import "./lib/external/openzeppelin-solidity/contracts/AddressUtils.sol";
import "./lib/external/openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";


contract GenericConditionalChannel {
    using SafeMath for uint;
    using pbRpcAuthorizedWithdraw for pbRpcAuthorizedWithdraw.Data;
    using pbRpcMultiSignature for pbRpcMultiSignature.Data;
    using pbRpcStateProof for pbRpcStateProof.Data;
    using pbRpcPaymentBooleanAndResolveLogic for pbRpcPaymentBooleanAndResolveLogic.Data;
    using pbRpcConditionGroup for pbRpcConditionGroup.Data;
    using pbRpcCooperativeWithdrawProof for pbRpcCooperativeWithdrawProof.Data;
    using AddressUtils for address;

    enum ResolutionLogic { Generic, PaymentBooleanAnd, PaymentBooleanCircuit, StateUpdateBooleanCircuit }
    enum AddressType { Virtual, OnChain }
    enum TokenType { ETH, ERC20 }

    event OpenChannel(
        uint channelId,
        address[] peers,
        uint uintTokenType,
        address tokenContract
    );

    event Deposit(
        uint channelId,
        address[] peers,
        uint[] balances
    );

    event IntendSettle(
        uint channelId
    );

    event ResolveCondition(
        uint channelId
    );

    event ConfirmSettle(
        uint channelId
    );

    event ConfirmSettleFail(
        uint channelId
    );

    event CooperativeWithdraw(
        uint channelId,
        uint withdrawalAmount,
        address receiver,
        uint balance
    );

    event CooperativeSettle(
        uint channelId
    );

    event CooperativeSettleFail(
        uint channelId
    );

    struct WithdrawalIntent {
        uint amount;
        uint withdrawalTime;
        bool isDone;
    }

    struct Channel {
        uint settleTime;
        uint settleTimeoutIncrement;
        bool isFinalized;
        bool initialized;
        address[] sigCheckerArray;
        bytes32[] condCheckerArray;
        pbRpcStateProof.Data stateProof;
        address[] peers;
        mapping(address => bool) peerMap;
        mapping(address => uint) depositMap;
        mapping(address => uint) settleBalance;
        mapping(uint => bool) invalidNonce;
        mapping(address => WithdrawalIntent[]) withdrawalMap;
        mapping(address => uint) withdrawalTimeout;
        mapping(address => mapping(address => uint)) stateUpdateMap;
        mapping(address => bool) sigCheckerMap;
        mapping(bytes32 => bool) condCheckerMap;
        mapping(uint => bool) usedCooperativeWithdrawNonce;
        address tokenContract;
        TokenType tokenType;
    }

    uint public chainId;
    mapping(uint => Channel) private channelMap;
    uint public channelLength;
    VirtualChannelResolverInterface public resolver;
    DepositPoolInterface public depositPool;

    modifier onlyOpenChannel(uint _channelId) {
        require(channelMap[_channelId].initialized);
        require(!channelMap[_channelId].isFinalized);
        _;
    }

    constructor(
        uint _chainId,
        address _virtResolver,
        address _depositPool
    )
        public
    {
        chainId = _chainId;
        channelLength = 1;
        resolver = VirtualChannelResolverInterface(_virtResolver);
        depositPool = DepositPoolInterface(_depositPool);
    }

    function decideTokenType(uint _tokenType, address _tokenContract) internal returns(TokenType) {
        if (_tokenType == uint(TokenType.ETH)) {
            // If tokenContract is 0x0, it is just a simple ETH based channel
            require(_tokenContract == 0x0);

            return TokenType.ETH;
        } else if (_tokenType == uint(TokenType.ERC20)) {
            // Is non-0x0 check repeated?
            require(_tokenContract != 0x0);
            require(_tokenContract.isContract());

            return TokenType.ERC20;
        } else {
            assert(false);
        }
    }

    function openChannel (
        address[] _peers,
        uint[] _withdrawalTimeout,
        uint _settleTimeoutIncrement,
        address _tokenContract,
        uint _tokenType
    )
        public
    {
        require(_peers.length != 0);
        require(_peers.length == _withdrawalTimeout.length);

        Channel storage c = channelMap[channelLength];
        c.settleTimeoutIncrement = _settleTimeoutIncrement;
        c.initialized = true;
        c.tokenType = decideTokenType(_tokenType, _tokenContract);
        c.tokenContract = _tokenContract;

        // TODO: make it future-proof for unbounded loop
        for (uint i = 0; i < _peers.length; i++) {
            require(!c.peerMap[_peers[i]]);

            c.peerMap[_peers[i]] = true;
            c.peers.push(_peers[i]);
            c.withdrawalTimeout[_peers[i]] = _withdrawalTimeout[i];
        }

        emit OpenChannel(channelLength, _peers, uint(c.tokenType), c.tokenContract);
        channelLength = channelLength.add(1);
    }

    function authOpenChannel (
        uint[] _withdrawalTimeout,
        uint _settleTimeoutIncrement,
        bytes _authWithdraw,
        bytes _signature
    )
        public payable
    {
        pbRpcAuthorizedWithdraw.Data memory authWithdraw = pbRpcAuthorizedWithdraw.decode(_authWithdraw);
        
        require(authWithdraw.peers[0] == msg.sender);
        require(authWithdraw.values[0] == msg.value);

        // 0 for TokenType.ETH
        openChannel(authWithdraw.peers, _withdrawalTimeout, _settleTimeoutIncrement, 0x0, 0);
        depositPool.authorizedWithdraw(_authWithdraw, _signature);

        Channel storage c = channelMap[channelLength - 1];
        for (uint i = 0; i < authWithdraw.peers.length; i++) {
            c.depositMap[authWithdraw.peers[i]] = authWithdraw.values[i];
        }
        emit Deposit(channelLength - 1, authWithdraw.peers, authWithdraw.values);
    }

    function() public payable { }

    // TODO: is this function secure on the usage of memory/storage? Can this function be simplified?
    function viewTokenContract(uint _channelId) public view onlyOpenChannel(_channelId) returns(address) {
        Channel storage c = channelMap[_channelId];
        address tokenContract = c.tokenContract;
        return tokenContract;
    }

    // TODO: is this function secure on the usage of memory/storage? Can this function be simplified?
    function viewTokenType(uint _channelId) public view onlyOpenChannel(_channelId) returns(TokenType) {
        Channel storage c = channelMap[_channelId];
        TokenType tokenType = c.tokenType;
        return tokenType;
    }

    // ETH deposit
    function deposit(uint _channelId, address _receipient) public payable onlyOpenChannel(_channelId) {
        Channel storage c = channelMap[_channelId];
        require(c.peerMap[_receipient]);
        require(c.tokenType == TokenType.ETH);

        //enable dynamic deposit
        c.depositMap[_receipient] = c.depositMap[_receipient].add(msg.value);

        uint[] memory balances = new uint[](c.peers.length);
        for (uint i = 0; i < c.peers.length; i++) {
            balances[i] = c.depositMap[c.peers[i]];
        }
        emit Deposit(_channelId, c.peers, balances);
    }

    /**
     * ERC20 support for deposit
     * Removed ERC827 support because of this issue: https://github.com/OpenZeppelin/openzeppelin-solidity/issues/1044
     * TODO: overload deposit function.
     * Wait for truffle's support for function overloading: https://github.com/trufflesuite/truffle/issues/737
     * function deposit(uint _channelId, address _receipient, uint _amount) public {
     */
    function depositERCToken(uint _channelId, address _receipient, uint _amount) public onlyOpenChannel(_channelId) {
        Channel storage c = channelMap[_channelId];
        require(c.tokenType == TokenType.ERC20);
        require(c.peerMap[_receipient]);

        //enable dynamic deposit
        c.depositMap[_receipient] = c.depositMap[_receipient].add(_amount);

        uint[] memory balances = new uint[](c.peers.length);
        for (uint i = 0; i < c.peers.length; i++) {
            balances[i] = c.depositMap[c.peers[i]];
        }
        emit Deposit(_channelId, c.peers, balances);

        // get the tokens
        if (c.tokenType == TokenType.ERC20) {
            require(ERC20(c.tokenContract).transferFrom(msg.sender, address(this), _amount));
        } else {
            assert(false);
        }
    }

    function intendWithdraw(uint _channelId, uint _amount) public onlyOpenChannel(_channelId) {
        // There is no difference between ETH, ERC20 under this function

        Channel storage c = channelMap[_channelId];
        require(c.peerMap[msg.sender]);

        // enable dynamic withdrawal step one
        uint withdrawalTime = block.number + c.withdrawalTimeout[msg.sender];
        c.withdrawalMap[msg.sender].push(
            WithdrawalIntent(_amount, withdrawalTime, false)
        );
    }

    function confirmWithdraw(uint _channelId, uint _withdrawId) public onlyOpenChannel(_channelId) {
        Channel storage c = channelMap[_channelId];
        WithdrawalIntent storage w = c.withdrawalMap[msg.sender][_withdrawId];
        require(w.withdrawalTime != 0 && !w.isDone);
        require(w.withdrawalTime < block.number);

        c.depositMap[msg.sender] = c.depositMap[msg.sender].sub(w.amount);

        if (c.tokenType == TokenType.ETH) {
            // If it is an ETH based channel, we don't necessarily need to "wrap" ETH
            msg.sender.transfer(w.amount);
            return;
        } else if (c.tokenType == TokenType.ERC20) {
            // ERC20 support
            require(ERC20(c.tokenContract).transfer(msg.sender, w.amount));
            return;
        } else {
            assert(false);
        }
    }

    function cooperativeWithdraw(uint _channelId, bytes _cooperativeWithdrawProof, bytes _signature) public onlyOpenChannel(_channelId) {
        bytes32 h = keccak256(_cooperativeWithdrawProof);
        Channel storage c = channelMap[_channelId];

        pbRpcCooperativeWithdrawProof.Data memory candidateWithdrawProof = pbRpcCooperativeWithdrawProof.decode(_cooperativeWithdrawProof);
        require(!c.usedCooperativeWithdrawNonce[candidateWithdrawProof.nonce]);
        require(candidateWithdrawProof.stateChannelId == _channelId);

        address receiver = candidateWithdrawProof.receiver;
        require(c.peerMap[receiver]);
        
        // TODO: is this require necessary?
        require(receiver == msg.sender);

        pbRpcMultiSignature.Data memory sigs = pbRpcMultiSignature.decode(_signature);

        require(checkSignature(c, h, sigs));

        c.usedCooperativeWithdrawNonce[candidateWithdrawProof.nonce] = true;

        uint amount = candidateWithdrawProof.withdrawalAmount;

        c.depositMap[receiver] = c.depositMap[receiver].sub(amount);

        emit CooperativeWithdraw(_channelId, amount, receiver, c.depositMap[receiver]);

        if (c.tokenType == TokenType.ETH) {
            // If it is an ETH based channel, we don't necessarily need to "wrap" ETH
            receiver.transfer(amount);
            return;
        } else if (c.tokenType == TokenType.ERC20) {
            // ERC20 support
            require(ERC20(c.tokenContract).transfer(receiver, amount));
            return;
        } else {
            assert(false);
        }
    }

    function disputeWithdraw(uint _channelId, uint _withdrawId, bytes dispute) public {
        // TODO: implement dispute withdrawal without actually needing to close the channel
        assert(false);
    }

    function intendSettleStateProof(uint _channelId, bytes _stateProof, bytes _signature) public onlyOpenChannel(_channelId) {
        // TODO: we need to modify our client to not do this prefix thingy when signing
        // bytes memory prefix = "\x19Ethereum Signed Message:\n32";
        // bytes32 prefixedHash = keccak256(prefix, h);

        bytes32 h = keccak256(_stateProof);
        Channel storage c = channelMap[_channelId];

        pbRpcStateProof.Data memory candidateStateProof = pbRpcStateProof.decode(_stateProof);
        require(!c.invalidNonce[candidateStateProof.nonce]);
        require(candidateStateProof.stateChannelId == _channelId);
        require(candidateStateProof.nonce > c.stateProof.nonce);

        pbRpcMultiSignature.Data memory sigs = pbRpcMultiSignature.decode(_signature);

        require(checkSignature(c, h, sigs));
        // replace current state proof with candidate
        clearStateMap(c);
        clearCondCheckerHelper(c);
        c.stateProof = candidateStateProof;
        if (block.number > c.stateProof.maxCondTimeout) {
            c.settleTime = block.number + c.settleTimeoutIncrement;
        } else {
            c.settleTime = c.stateProof.maxCondTimeout + c.settleTimeoutIncrement;
        }

        updateState(c, c.stateProof.state);
        emit IntendSettle(_channelId);
    }

    function resolveConditionalStateTransition(uint _channelId, bytes32[] _proof, bytes _conditionGroup) public onlyOpenChannel(_channelId) {
        Channel storage c = channelMap[_channelId];
        require(block.number < c.settleTime);

        bytes32 h = keccak256(_conditionGroup);
        MerkleProof.verifyProof(_proof, c.stateProof.pendingConditionRoot, h);
        registerCond(c, h);
        pbRpcConditionGroup.Data memory condGroup = pbRpcConditionGroup.decode(_conditionGroup);

        if ((c.settleTime - block.number) < c.settleTimeoutIncrement) {
            c.settleTime = block.number + c.settleTimeoutIncrement;
        }

        if (condGroup.logicType == uint(ResolutionLogic.PaymentBooleanAnd)) {
            handlePaymentBooleanAnd(c, condGroup);
            emit ResolveCondition(_channelId);
            return;
        } else if (condGroup.logicType == uint(ResolutionLogic.Generic)) {
            handlePaymentGeneric(c, condGroup);
            emit ResolveCondition(_channelId);
            return;
        }

        // more precompiled and generic logic implemented here
        assert(false);
    }

    function confirmSettle(uint _channelId) public onlyOpenChannel(_channelId) {
        // This function should handle invalid state (multiple parties signed invalid states)
        Channel storage c = channelMap[_channelId];

        if (!(validateSettleBalance(c))) {
            emit ConfirmSettleFail(_channelId);
            return;
        }

        // TODO: is this repeated?
        if (!(validateSettleSumDepositSum(c, c.stateProof.nonce))) {
            emit ConfirmSettleFail(_channelId);
            return;
        }

        c.isFinalized = true;

        uint i;
        if (c.tokenType == TokenType.ETH) {
            emit ConfirmSettle(_channelId);

            for (i = 0; i < c.peers.length; i++) {
                c.peers[i].transfer(c.settleBalance[c.peers[i]]);
            }
            return;
        } else if (c.tokenType == TokenType.ERC20) {
            // ERC20 support
            emit ConfirmSettle(_channelId);
            
            ERC20 tokenContractERC20 = ERC20(c.tokenContract);
            for (i = 0; i < c.peers.length; i++) {
                require(tokenContractERC20.transfer(c.peers[i], c.settleBalance[c.peers[i]]));
            }
            return;
        } else {
            assert(false);
        }
    }

    function cooperativeSettle(uint _channelId, bytes _stateProof, bytes _signature, bytes _signatureOfSignature) public onlyOpenChannel(_channelId) {
        // TODO: we need to modify our client to not do this prefix thingy when signing
        // bytes memory prefix = "\x19Ethereum Signed Message:\n32";
        // bytes32 prefixedHash = keccak256(prefix, h);

        bytes32 hOfStateProof = keccak256(_stateProof);
        bytes32 hOfSignature = keccak256(_signature);
        Channel storage c = channelMap[_channelId];

        pbRpcStateProof.Data memory candidateStateProof = pbRpcStateProof.decode(_stateProof);
        require(!c.invalidNonce[candidateStateProof.nonce]);
        require(candidateStateProof.stateChannelId == _channelId);
        require(candidateStateProof.nonce > c.stateProof.nonce);
        require(candidateStateProof.pendingConditionRoot == 0x0);
        require(candidateStateProof.maxCondTimeout < block.number);

        pbRpcMultiSignature.Data memory sigs = pbRpcMultiSignature.decode(_signature);
        pbRpcMultiSignature.Data memory sigsOfSigs = pbRpcMultiSignature.decode(_signatureOfSignature);

        require(checkSignature(c, hOfStateProof, sigs));
        require(checkSignature(c, hOfSignature, sigsOfSigs));

        // TODO: should update c.stateProof.nonce?
        // c.stateProof = candidateStateProof;

        if (!(validateCooperativeSettleBalance(c, candidateStateProof))) {
            emit CooperativeSettleFail(_channelId);
            return;
        }

        // TODO: is this repeated?
        if (!(validateSettleSumDepositSum(c, candidateStateProof.nonce))) {
            emit CooperativeSettleFail(_channelId);
            return;
        }

        c.isFinalized = true;

        uint i;
        if (c.tokenType == TokenType.ETH) {
            emit CooperativeSettle(_channelId);

            for (i = 0; i < c.peers.length; i++) {
                c.peers[i].transfer(c.settleBalance[c.peers[i]]);
            }
            return;
        } else if (c.tokenType == TokenType.ERC20) {
            // ERC20 support
            emit CooperativeSettle(_channelId);
            
            ERC20 tokenContractERC20 = ERC20(c.tokenContract);
            for (i = 0; i < c.peers.length; i++) {
                require(tokenContractERC20.transfer(c.peers[i], c.settleBalance[c.peers[i]]));
            }
            return;
        } else {
            assert(false);
        }
    }

    function validateSettleBalance(Channel storage c) internal returns(bool) {
        uint i;
        uint j;

        for (i = 0; i < c.peers.length; i++) {
            c.settleBalance[c.peers[i]] = c.depositMap[c.peers[i]];
        }

        for (i = 0; i < c.peers.length; i++) {
            for (j = 0; j < c.peers.length; j++) {
                c.settleBalance[c.peers[j]] = c.settleBalance[c.peers[j]].add(c.stateUpdateMap[c.peers[i]][c.peers[j]]);
            }
        }

        for (i = 0; i < c.peers.length; i++) {
            for (j = 0; j < c.peers.length; j++) {
                if (c.settleBalance[c.peers[i]] < c.stateUpdateMap[c.peers[i]][c.peers[j]]) {
                    c.invalidNonce[c.stateProof.nonce] = true;
                    resetState(c);
                    return false;
                }

                c.settleBalance[c.peers[i]] = c.settleBalance[c.peers[i]].sub(c.stateUpdateMap[c.peers[i]][c.peers[j]]);
            }
        }

        return true;
    }

    function validateCooperativeSettleBalance(Channel storage c, pbRpcStateProof.Data memory stateProof) internal returns(bool) {
        //decode State Map
        pbRpcPaymentBooleanAndResolveLogic.Data memory stateArray;
        stateArray = pbRpcPaymentBooleanAndResolveLogic.decode(stateProof.state);

        uint i;
        for (i = 0; i < c.peers.length; i++) {
            c.settleBalance[c.peers[i]] = c.depositMap[c.peers[i]];
        }

        pbRpcTransferMapEntry.Data memory s;
        
        // first add balance to receivers
        for (i = 0; i < stateArray.updatedTransferMap.length; i++) {
            s = stateArray.updatedTransferMap[i];
            c.settleBalance[s.receiver] = c.settleBalance[s.receiver].add(s.transferAmount);
        }

        // then sub balance from senders
        for (i = 0; i < stateArray.updatedTransferMap.length; i++) {
            s = stateArray.updatedTransferMap[i];
            if (c.settleBalance[s.sender] < s.transferAmount) {
                c.invalidNonce[stateProof.nonce] = true;
                resetState(c);
                return false;
            }

            c.settleBalance[s.sender] = c.settleBalance[s.sender].sub(s.transferAmount);
        }

        return true;
    }

    function validateSettleSumDepositSum(Channel storage c, uint nonce) internal returns(bool) {
        uint sumState = 0;
        uint sumDeposit = 0;
        uint i;

        for (i = 0; i < c.peers.length; i++) {
            sumState = sumState.add(c.settleBalance[c.peers[i]]);
            sumDeposit = sumDeposit.add(c.depositMap[c.peers[i]]);
        }

        if (sumState != sumDeposit) {
            c.invalidNonce[nonce] = true;
            resetState(c);
            return false;
        }

        return true;
    }

    function clearSigCheckerHelper(Channel storage c) internal {
        for (uint i = 0; i < c.sigCheckerArray.length; i++) {
            delete c.sigCheckerMap[c.sigCheckerArray[i]];
        }

        delete c.sigCheckerArray;
    }

    function clearStateMap(Channel storage c) internal {
        for (uint i = 0; i < c.peers.length; i++) {
            for (uint j = 0; j < c.peers.length; j++) {
                delete c.stateUpdateMap[c.peers[i]][c.peers[j]];
            }   
        }

        for (i = 0; i < c.peers.length; i++) {
            delete c.withdrawalMap[c.peers[i]];
        }
    }

    function clearCondCheckerHelper(Channel storage c) internal {
        for (uint i = 0; i < c.condCheckerArray.length; i++) {
            delete c.condCheckerMap[c.condCheckerArray[i]];
        }

        delete c.condCheckerArray;
    }

    function resetState(Channel storage c) internal {
        delete c.stateProof;
        delete c.settleTime;
        clearSigCheckerHelper(c);
        clearStateMap(c);
        clearCondCheckerHelper(c);
    }

    function checkSignature(Channel storage c, bytes32 h, pbRpcMultiSignature.Data sigs) internal returns(bool) {
        require(c.peers.length == sigs.v.length);

        clearSigCheckerHelper(c);
        bytes32 hash = keccak256("\x19Ethereum Signed Message:\n32", h);

        // check signature
        for (uint i = 0; i < sigs.v.length; i++) {
            address addr = ecrecover(hash, sigs.v[i], sigs.r[i], sigs.s[i]);
            if (c.peerMap[addr] && !c.sigCheckerMap[addr]) {
                c.sigCheckerArray.push(addr);
                c.sigCheckerMap[addr] = true;
            } else {
                // signature checking failed
                return false;
            }
        }

        if (c.sigCheckerArray.length != c.peers.length) {
            return false;
        }

        return true;
    }

    function registerCond(Channel storage c, bytes32 h) internal {
        require(!c.condCheckerMap[h]);

        c.condCheckerMap[h] = true;
        c.condCheckerArray.push(h);
    }

    function updateState(Channel storage c, bytes memory state) internal {
        //decode State Map
        pbRpcPaymentBooleanAndResolveLogic.Data memory stateArray;
        stateArray = pbRpcPaymentBooleanAndResolveLogic.decode(state);

        for (uint i = 0; i < stateArray.updatedTransferMap.length; i++) {
            pbRpcTransferMapEntry.Data memory s = stateArray.updatedTransferMap[i];
            c.stateUpdateMap[s.sender][s.receiver] = c.stateUpdateMap[s.sender][s.receiver].add(s.transferAmount);
        }
    }

    function getCondAddress(pbRpcCondition.Data memory cond) internal returns(address addr) {
        // TODO: We need to optimize this: early settlement can be cooperative.
        require(cond.timeout < block.number);

        // Even if timeout has reached, we need to take into account that contract may not be deployed.
        // However, this is automatically handled for us
        // because calling a non-existent function will cause an revert.
        if (cond.addressType == uint(AddressType.Virtual)) {
            addr = resolver.resolve(cond.dependingContractAddress);
        } else if (cond.addressType == uint(AddressType.OnChain)) {
            addr = address(cond.dependingContractAddress);
        } else {
            assert(false);
        }
    }

    function handlePaymentBooleanAnd(Channel storage c, pbRpcConditionGroup.Data memory condGroup) internal {
        for (uint i = 0; i < condGroup.conditions.length; i++) {
            pbRpcCondition.Data memory cond = condGroup.conditions[i];
            address addr = getCondAddress(cond);

            BooleanCond dependent = BooleanCond(addr);
            require(
                dependent.isFinalized(cond.argsQueryFinalization, cond.timeout) &&
                dependent.isSatisfied(cond.argsQueryResult)
            );
        }

        // Every boolean condition in this ConditionGroup is both finalized ontime and also satisified
        // We need to parse the state update struct and update the stateUpdate accordingly.
        updateState(c, condGroup.groupResolveLogic);
    }

    function handlePaymentGeneric(Channel storage c, pbRpcConditionGroup.Data memory condGroup) internal {
        for (uint i = 0; i < condGroup.conditions.length; i++) {
            pbRpcCondition.Data memory cond = condGroup.conditions[i];
            address addr = getCondAddress(cond);

            GenericCond dependent = GenericCond(addr);
            require(dependent.isFinalized(cond.argsQueryFinalization, cond.timeout));

            // This requires solc@0.4.22 support to return bytes arrary across contracts
            bytes memory stateUpdate = dependent.getStateUpdate(cond.argsQueryResult);
            updateState(c, stateUpdate);
        }
    }
}
