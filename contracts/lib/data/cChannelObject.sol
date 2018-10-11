pragma solidity ^0.4.0;
import "./runtime.sol";


library pbRpcAuthorizedWithdraw{
  //struct definition
  struct Data {   
    address[] peers;
    uint256[] values;
    address withdrawAddress;
    uint256[] withdrawalTimeout;
    uint256 settleTimeoutIncrement;
    address tokenContract;
    uint256 tokenType;             
  }                           
  // Decoder section                       
  function decode(bytes bs) internal constant returns (Data) {
    var (x,) = _decode(32, bs, bs.length);                       
    return x;                                                    
  }
  function decode(Data storage self, bytes bs) internal constant {
    var (x,) = _decode(32, bs, bs.length);                    
    store(x, self);                                           
  }                             
  // innter decoder                       
  function _decode(uint p, bytes bs, uint sz)                   
      internal constant returns (Data, uint) {             
    Data memory r;                                          
    uint[8] memory counters;                                  
    uint fieldId;                                               
    _pb.WireType wireType;                                      
    uint bytesRead;                                             
    uint offset = p;                                            
    while(p < offset+sz) {                                     
      (fieldId, wireType, bytesRead) = _pb._decode_key(p, bs);  
      p += bytesRead;                                           
      if (false) {}
      else if(fieldId == 1)       
          p += _read_peers(p, bs, nil(), counters);
      else if(fieldId == 2)       
          p += _read_values(p, bs, nil(), counters);
      else if(fieldId == 3)       
          p += _read_withdrawAddress(p, bs, r, counters);
      else if(fieldId == 4)       
          p += _read_withdrawalTimeout(p, bs, nil(), counters);
      else if(fieldId == 5)       
          p += _read_settleTimeoutIncrement(p, bs, r, counters);
      else if(fieldId == 6)       
          p += _read_tokenContract(p, bs, r, counters);
      else if(fieldId == 7)       
          p += _read_tokenType(p, bs, r, counters);
      else revert();                                              
    }                                                          
    p = offset;                                                 
    r.peers = new address[](counters[1]);
    r.values = new uint256[](counters[2]);
    r.withdrawalTimeout = new uint256[](counters[4]);
                                                    
    while(p < offset+sz) {                                     
      (fieldId, wireType, bytesRead) = _pb._decode_key(p, bs);  
      p += bytesRead;                                           
      if (false) {}
      else if(fieldId == 1)       
          p += _read_peers(p, bs, r, counters);
      else if(fieldId == 2)       
          p += _read_values(p, bs, r, counters);
      else if(fieldId == 3)       
          p += _read_withdrawAddress(p, bs, nil(), counters);
      else if(fieldId == 4)       
          p += _read_withdrawalTimeout(p, bs, r, counters);
      else if(fieldId == 5)       
          p += _read_settleTimeoutIncrement(p, bs, nil(), counters);
      else if(fieldId == 6)       
          p += _read_tokenContract(p, bs, nil(), counters);
      else if(fieldId == 7)       
          p += _read_tokenType(p, bs, nil(), counters);
      else revert();                                             
    }                                                          
    return (r, sz);                                             
  }                                                            
                            
  // field readers                       
  function _read_peers(uint p, bytes bs, Data r, uint[8] counters) internal constant returns (uint) {                            
    var (x, sz) = _pb._decode_sol_address(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[1] += 1;                                            
    } else {                                                         
      r.peers[ r.peers.length - counters[1] ] = x;                                         
      if(counters[1] > 0) counters[1] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
  function _read_values(uint p, bytes bs, Data r, uint[8] counters) internal constant returns (uint) {                            
    var (x, sz) = _pb._decode_sol_uint256(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[2] += 1;                                            
    } else {                                                         
      r.values[ r.values.length - counters[2] ] = x;                                         
      if(counters[2] > 0) counters[2] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
  function _read_withdrawAddress(uint p, bytes bs, Data r, uint[8] counters) internal constant returns (uint) {                            
    var (x, sz) = _pb._decode_sol_address(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[3] += 1;                                            
    } else {                                                         
      r.withdrawAddress = x;                                         
      if(counters[3] > 0) counters[3] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
  function _read_withdrawalTimeout(uint p, bytes bs, Data r, uint[8] counters) internal constant returns (uint) {                            
    var (x, sz) = _pb._decode_sol_uint256(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[4] += 1;                                            
    } else {                                                         
      r.withdrawalTimeout[ r.withdrawalTimeout.length - counters[4] ] = x;                                         
      if(counters[4] > 0) counters[4] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
  function _read_settleTimeoutIncrement(uint p, bytes bs, Data r, uint[8] counters) internal constant returns (uint) {                            
    var (x, sz) = _pb._decode_sol_uint256(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[5] += 1;                                            
    } else {                                                         
      r.settleTimeoutIncrement = x;                                         
      if(counters[5] > 0) counters[5] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
  function _read_tokenContract(uint p, bytes bs, Data r, uint[8] counters) internal constant returns (uint) {                            
    var (x, sz) = _pb._decode_sol_address(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[6] += 1;                                            
    } else {                                                         
      r.tokenContract = x;                                         
      if(counters[6] > 0) counters[6] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
  function _read_tokenType(uint p, bytes bs, Data r, uint[8] counters) internal constant returns (uint) {                            
    var (x, sz) = _pb._decode_sol_uint256(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[7] += 1;                                            
    } else {                                                         
      r.tokenType = x;                                         
      if(counters[7] > 0) counters[7] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
                            
  // struct decoder                       
                                      
            
  //store function                                                     
  function store(Data memory input, Data storage output) internal{
    output.peers = input.peers;                           
    output.values = input.values;                           
    output.withdrawAddress = input.withdrawAddress;                           
    output.withdrawalTimeout = input.withdrawalTimeout;                           
    output.settleTimeoutIncrement = input.settleTimeoutIncrement;                           
    output.tokenContract = input.tokenContract;                           
    output.tokenType = input.tokenType;                           
  }                                                                   
             
  //utility functions                                           
  function nil() internal constant returns (Data r) {        
    assembly { r := 0 }                                       
  }                                                            
  function isNil(Data x) internal constant returns (bool r) {
    assembly { r := iszero(x) }                               
  }                                                            
} 

library pbRpcStateProof{
  //struct definition
  struct Data {   
    uint256 nonce;
    bytes state;
    bytes32 pendingConditionRoot;
    uint256 stateChannelId;
    uint256 maxCondTimeout;             
  }                           
  // Decoder section                       
  function decode(bytes bs) internal constant returns (Data) {
    var (x,) = _decode(32, bs, bs.length);                       
    return x;                                                    
  }
  function decode(Data storage self, bytes bs) internal constant {
    var (x,) = _decode(32, bs, bs.length);                    
    store(x, self);                                           
  }                             
  // innter decoder                       
  function _decode(uint p, bytes bs, uint sz)                   
      internal constant returns (Data, uint) {             
    Data memory r;                                          
    uint[6] memory counters;                                  
    uint fieldId;                                               
    _pb.WireType wireType;                                      
    uint bytesRead;                                             
    uint offset = p;                                            
    while(p < offset+sz) {                                     
      (fieldId, wireType, bytesRead) = _pb._decode_key(p, bs);  
      p += bytesRead;                                           
      if (false) {}
      else if(fieldId == 1)       
          p += _read_nonce(p, bs, r, counters);
      else if(fieldId == 2)       
          p += _read_state(p, bs, r, counters);
      else if(fieldId == 3)       
          p += _read_pendingConditionRoot(p, bs, r, counters);
      else if(fieldId == 4)       
          p += _read_stateChannelId(p, bs, r, counters);
      else if(fieldId == 5)       
          p += _read_maxCondTimeout(p, bs, r, counters);
      else revert();                                              
    }                                                          
    p = offset;                                                 
                                                    
    while(p < offset+sz) {                                     
      (fieldId, wireType, bytesRead) = _pb._decode_key(p, bs);  
      p += bytesRead;                                           
      if (false) {}
      else if(fieldId == 1)       
          p += _read_nonce(p, bs, nil(), counters);
      else if(fieldId == 2)       
          p += _read_state(p, bs, nil(), counters);
      else if(fieldId == 3)       
          p += _read_pendingConditionRoot(p, bs, nil(), counters);
      else if(fieldId == 4)       
          p += _read_stateChannelId(p, bs, nil(), counters);
      else if(fieldId == 5)       
          p += _read_maxCondTimeout(p, bs, nil(), counters);
      else revert();                                             
    }                                                          
    return (r, sz);                                             
  }                                                            
                            
  // field readers                       
  function _read_nonce(uint p, bytes bs, Data r, uint[6] counters) internal constant returns (uint) {                            
    var (x, sz) = _pb._decode_sol_uint256(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[1] += 1;                                            
    } else {                                                         
      r.nonce = x;                                         
      if(counters[1] > 0) counters[1] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
  function _read_state(uint p, bytes bs, Data r, uint[6] counters) internal constant returns (uint) {                            
    var (x, sz) = _pb._decode_bytes(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[2] += 1;                                            
    } else {                                                         
      r.state = x;                                         
      if(counters[2] > 0) counters[2] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
  function _read_pendingConditionRoot(uint p, bytes bs, Data r, uint[6] counters) internal constant returns (uint) {                            
    var (x, sz) = _pb._decode_sol_bytes32(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[3] += 1;                                            
    } else {                                                         
      r.pendingConditionRoot = x;                                         
      if(counters[3] > 0) counters[3] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
  function _read_stateChannelId(uint p, bytes bs, Data r, uint[6] counters) internal constant returns (uint) {                            
    var (x, sz) = _pb._decode_sol_uint256(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[4] += 1;                                            
    } else {                                                         
      r.stateChannelId = x;                                         
      if(counters[4] > 0) counters[4] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
  function _read_maxCondTimeout(uint p, bytes bs, Data r, uint[6] counters) internal constant returns (uint) {                            
    var (x, sz) = _pb._decode_sol_uint256(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[5] += 1;                                            
    } else {                                                         
      r.maxCondTimeout = x;                                         
      if(counters[5] > 0) counters[5] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
                            
  // struct decoder                       
                                      
            
  //store function                                                     
  function store(Data memory input, Data storage output) internal{
    output.nonce = input.nonce;                           
    output.state = input.state;                           
    output.pendingConditionRoot = input.pendingConditionRoot;                           
    output.stateChannelId = input.stateChannelId;                           
    output.maxCondTimeout = input.maxCondTimeout;                           
  }                                                                   
             
  //utility functions                                           
  function nil() internal constant returns (Data r) {        
    assembly { r := 0 }                                       
  }                                                            
  function isNil(Data x) internal constant returns (bool r) {
    assembly { r := iszero(x) }                               
  }                                                            
} 

library pbRpcMultiSignature{
  //struct definition
  struct Data {   
    uint8[] v;
    bytes32[] r;
    bytes32[] s;             
  }                           
  // Decoder section                       
  function decode(bytes bs) internal constant returns (Data) {
    var (x,) = _decode(32, bs, bs.length);                       
    return x;                                                    
  }
  function decode(Data storage self, bytes bs) internal constant {
    var (x,) = _decode(32, bs, bs.length);                    
    store(x, self);                                           
  }                             
  // innter decoder                       
  function _decode(uint p, bytes bs, uint sz)                   
      internal constant returns (Data, uint) {             
    Data memory r;                                          
    uint[4] memory counters;                                  
    uint fieldId;                                               
    _pb.WireType wireType;                                      
    uint bytesRead;                                             
    uint offset = p;                                            
    while(p < offset+sz) {                                     
      (fieldId, wireType, bytesRead) = _pb._decode_key(p, bs);  
      p += bytesRead;                                           
      if (false) {}
      else if(fieldId == 1)       
          p += _read_v(p, bs, nil(), counters);
      else if(fieldId == 2)       
          p += _read_r(p, bs, nil(), counters);
      else if(fieldId == 3)       
          p += _read_s(p, bs, nil(), counters);
      else revert();                                              
    }                                                          
    p = offset;                                                 
    r.v = new uint8[](counters[1]);
    r.r = new bytes32[](counters[2]);
    r.s = new bytes32[](counters[3]);
                                                    
    while(p < offset+sz) {                                     
      (fieldId, wireType, bytesRead) = _pb._decode_key(p, bs);  
      p += bytesRead;                                           
      if (false) {}
      else if(fieldId == 1)       
          p += _read_v(p, bs, r, counters);
      else if(fieldId == 2)       
          p += _read_r(p, bs, r, counters);
      else if(fieldId == 3)       
          p += _read_s(p, bs, r, counters);
      else revert();                                             
    }                                                          
    return (r, sz);                                             
  }                                                            
                            
  // field readers                       
  function _read_v(uint p, bytes bs, Data r, uint[4] counters) internal constant returns (uint) {                            
    var (x, sz) = _pb._decode_sol_uint8(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[1] += 1;                                            
    } else {                                                         
      r.v[ r.v.length - counters[1] ] = x;                                         
      if(counters[1] > 0) counters[1] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
  function _read_r(uint p, bytes bs, Data r, uint[4] counters) internal constant returns (uint) {                            
    var (x, sz) = _pb._decode_sol_bytes32(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[2] += 1;                                            
    } else {                                                         
      r.r[ r.r.length - counters[2] ] = x;                                         
      if(counters[2] > 0) counters[2] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
  function _read_s(uint p, bytes bs, Data r, uint[4] counters) internal constant returns (uint) {                            
    var (x, sz) = _pb._decode_sol_bytes32(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[3] += 1;                                            
    } else {                                                         
      r.s[ r.s.length - counters[3] ] = x;                                         
      if(counters[3] > 0) counters[3] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
                            
  // struct decoder                       
                                      
            
  //store function                                                     
  function store(Data memory input, Data storage output) internal{
    output.v = input.v;                           
    output.r = input.r;                           
    output.s = input.s;                           
  }                                                                   
             
  //utility functions                                           
  function nil() internal constant returns (Data r) {        
    assembly { r := 0 }                                       
  }                                                            
  function isNil(Data x) internal constant returns (bool r) {
    assembly { r := iszero(x) }                               
  }                                                            
} 

library pbRpcStateDepositMapEntry{
  //struct definition
  struct Data {   
    address owner;
    uint256 stateDeposit;             
  }                           
  // Decoder section                       
  function decode(bytes bs) internal constant returns (Data) {
    var (x,) = _decode(32, bs, bs.length);                       
    return x;                                                    
  }
  function decode(Data storage self, bytes bs) internal constant {
    var (x,) = _decode(32, bs, bs.length);                    
    store(x, self);                                           
  }                             
  // innter decoder                       
  function _decode(uint p, bytes bs, uint sz)                   
      internal constant returns (Data, uint) {             
    Data memory r;                                          
    uint[3] memory counters;                                  
    uint fieldId;                                               
    _pb.WireType wireType;                                      
    uint bytesRead;                                             
    uint offset = p;                                            
    while(p < offset+sz) {                                     
      (fieldId, wireType, bytesRead) = _pb._decode_key(p, bs);  
      p += bytesRead;                                           
      if (false) {}
      else if(fieldId == 1)       
          p += _read_owner(p, bs, r, counters);
      else if(fieldId == 2)       
          p += _read_stateDeposit(p, bs, r, counters);
      else revert();                                              
    }                                                          
    p = offset;                                                 
                                                    
    while(p < offset+sz) {                                     
      (fieldId, wireType, bytesRead) = _pb._decode_key(p, bs);  
      p += bytesRead;                                           
      if (false) {}
      else if(fieldId == 1)       
          p += _read_owner(p, bs, nil(), counters);
      else if(fieldId == 2)       
          p += _read_stateDeposit(p, bs, nil(), counters);
      else revert();                                             
    }                                                          
    return (r, sz);                                             
  }                                                            
                            
  // field readers                       
  function _read_owner(uint p, bytes bs, Data r, uint[3] counters) internal constant returns (uint) {                            
    var (x, sz) = _pb._decode_sol_address(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[1] += 1;                                            
    } else {                                                         
      r.owner = x;                                         
      if(counters[1] > 0) counters[1] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
  function _read_stateDeposit(uint p, bytes bs, Data r, uint[3] counters) internal constant returns (uint) {                            
    var (x, sz) = _pb._decode_sol_uint256(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[2] += 1;                                            
    } else {                                                         
      r.stateDeposit = x;                                         
      if(counters[2] > 0) counters[2] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
                            
  // struct decoder                       
                                      
            
  //store function                                                     
  function store(Data memory input, Data storage output) internal{
    output.owner = input.owner;                           
    output.stateDeposit = input.stateDeposit;                           
  }                                                                   
             
  //utility functions                                           
  function nil() internal constant returns (Data r) {        
    assembly { r := 0 }                                       
  }                                                            
  function isNil(Data x) internal constant returns (bool r) {
    assembly { r := iszero(x) }                               
  }                                                            
} 

library pbRpcConditionGroup{
  //struct definition
  struct Data {   
    pbRpcCondition.Data[] conditions;
    uint32 logicType;
    pbRpcStateDepositMapEntry.Data[] stateDepositMap;
    bytes groupResolveLogic;             
  }                           
  // Decoder section                       
  function decode(bytes bs) internal constant returns (Data) {
    var (x,) = _decode(32, bs, bs.length);                       
    return x;                                                    
  }
  function decode(Data storage self, bytes bs) internal constant {
    var (x,) = _decode(32, bs, bs.length);                    
    store(x, self);                                           
  }                             
  // innter decoder                       
  function _decode(uint p, bytes bs, uint sz)                   
      internal constant returns (Data, uint) {             
    Data memory r;                                          
    uint[5] memory counters;                                  
    uint fieldId;                                               
    _pb.WireType wireType;                                      
    uint bytesRead;                                             
    uint offset = p;                                            
    while(p < offset+sz) {                                     
      (fieldId, wireType, bytesRead) = _pb._decode_key(p, bs);  
      p += bytesRead;                                           
      if (false) {}
      else if(fieldId == 1)       
          p += _read_conditions(p, bs, nil(), counters);
      else if(fieldId == 2)       
          p += _read_logicType(p, bs, r, counters);
      else if(fieldId == 3)       
          p += _read_stateDepositMap(p, bs, nil(), counters);
      else if(fieldId == 4)       
          p += _read_groupResolveLogic(p, bs, r, counters);
      else revert();                                              
    }                                                          
    p = offset;                                                 
    r.conditions = new pbRpcCondition.Data[](counters[1]);
    r.stateDepositMap = new pbRpcStateDepositMapEntry.Data[](counters[3]);
                                                    
    while(p < offset+sz) {                                     
      (fieldId, wireType, bytesRead) = _pb._decode_key(p, bs);  
      p += bytesRead;                                           
      if (false) {}
      else if(fieldId == 1)       
          p += _read_conditions(p, bs, r, counters);
      else if(fieldId == 2)       
          p += _read_logicType(p, bs, nil(), counters);
      else if(fieldId == 3)       
          p += _read_stateDepositMap(p, bs, r, counters);
      else if(fieldId == 4)       
          p += _read_groupResolveLogic(p, bs, nil(), counters);
      else revert();                                             
    }                                                          
    return (r, sz);                                             
  }                                                            
                            
  // field readers                       
  function _read_conditions(uint p, bytes bs, Data r, uint[5] counters) internal constant returns (uint) {                            
    var (x, sz) = _decode_rpc_Condition(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[1] += 1;                                            
    } else {                                                         
      r.conditions[ r.conditions.length - counters[1] ] = x;                                         
      if(counters[1] > 0) counters[1] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
  function _read_logicType(uint p, bytes bs, Data r, uint[5] counters) internal constant returns (uint) {                            
    var (x, sz) = _pb._decode_uint32(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[2] += 1;                                            
    } else {                                                         
      r.logicType = x;                                         
      if(counters[2] > 0) counters[2] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
  function _read_stateDepositMap(uint p, bytes bs, Data r, uint[5] counters) internal constant returns (uint) {                            
    var (x, sz) = _decode_rpc_StateDepositMapEntry(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[3] += 1;                                            
    } else {                                                         
      r.stateDepositMap[ r.stateDepositMap.length - counters[3] ] = x;                                         
      if(counters[3] > 0) counters[3] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
  function _read_groupResolveLogic(uint p, bytes bs, Data r, uint[5] counters) internal constant returns (uint) {                            
    var (x, sz) = _pb._decode_bytes(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[4] += 1;                                            
    } else {                                                         
      r.groupResolveLogic = x;                                         
      if(counters[4] > 0) counters[4] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
                            
  // struct decoder                       
  function _decode_rpc_Condition(uint p, bytes bs)            
      internal constant returns (pbRpcCondition.Data, uint) {    
    var (sz, bytesRead) = _pb._decode_varint(p, bs);   
    p += bytesRead;                                    
    var (r,) = pbRpcCondition._decode(p, bs, sz);               
    return (r, sz + bytesRead);                        
  }      
  function _decode_rpc_StateDepositMapEntry(uint p, bytes bs)            
      internal constant returns (pbRpcStateDepositMapEntry.Data, uint) {    
    var (sz, bytesRead) = _pb._decode_varint(p, bs);   
    p += bytesRead;                                    
    var (r,) = pbRpcStateDepositMapEntry._decode(p, bs, sz);               
    return (r, sz + bytesRead);                        
  }      
                                      
            
  //store function                                                     
  function store(Data memory input, Data storage output) internal{
    output.conditions.length = input.conditions.length;             
    for(uint i1=0; i1<input.conditions.length; i1++)       
      pbRpcCondition.store(input.conditions[i1], output.conditions[i1]); 
    output.logicType = input.logicType;                           
    output.stateDepositMap.length = input.stateDepositMap.length;             
    for(uint i3=0; i3<input.stateDepositMap.length; i3++)       
      pbRpcStateDepositMapEntry.store(input.stateDepositMap[i3], output.stateDepositMap[i3]); 
    output.groupResolveLogic = input.groupResolveLogic;                           
  }                                                                   
             
  //utility functions                                           
  function nil() internal constant returns (Data r) {        
    assembly { r := 0 }                                       
  }                                                            
  function isNil(Data x) internal constant returns (bool r) {
    assembly { r := iszero(x) }                               
  }                                                            
} 

library pbRpcCondition{
  //struct definition
  struct Data {   
    uint64 id;
    uint64 timeout;
    uint32 conditionType;
    bytes32 dependingContractAddress;
    uint32 addressType;
    bytes argsQueryFinalization;
    bytes argsQueryResult;             
  }                           
  // Decoder section                       
  function decode(bytes bs) internal constant returns (Data) {
    var (x,) = _decode(32, bs, bs.length);                       
    return x;                                                    
  }
  function decode(Data storage self, bytes bs) internal constant {
    var (x,) = _decode(32, bs, bs.length);                    
    store(x, self);                                           
  }                             
  // innter decoder                       
  function _decode(uint p, bytes bs, uint sz)                   
      internal constant returns (Data, uint) {             
    Data memory r;                                          
    uint[8] memory counters;                                  
    uint fieldId;                                               
    _pb.WireType wireType;                                      
    uint bytesRead;                                             
    uint offset = p;                                            
    while(p < offset+sz) {                                     
      (fieldId, wireType, bytesRead) = _pb._decode_key(p, bs);  
      p += bytesRead;                                           
      if (false) {}
      else if(fieldId == 1)       
          p += _read_id(p, bs, r, counters);
      else if(fieldId == 2)       
          p += _read_timeout(p, bs, r, counters);
      else if(fieldId == 3)       
          p += _read_conditionType(p, bs, r, counters);
      else if(fieldId == 4)       
          p += _read_dependingContractAddress(p, bs, r, counters);
      else if(fieldId == 5)       
          p += _read_addressType(p, bs, r, counters);
      else if(fieldId == 6)       
          p += _read_argsQueryFinalization(p, bs, r, counters);
      else if(fieldId == 7)       
          p += _read_argsQueryResult(p, bs, r, counters);
      else revert();                                              
    }                                                          
    p = offset;                                                 
                                                    
    while(p < offset+sz) {                                     
      (fieldId, wireType, bytesRead) = _pb._decode_key(p, bs);  
      p += bytesRead;                                           
      if (false) {}
      else if(fieldId == 1)       
          p += _read_id(p, bs, nil(), counters);
      else if(fieldId == 2)       
          p += _read_timeout(p, bs, nil(), counters);
      else if(fieldId == 3)       
          p += _read_conditionType(p, bs, nil(), counters);
      else if(fieldId == 4)       
          p += _read_dependingContractAddress(p, bs, nil(), counters);
      else if(fieldId == 5)       
          p += _read_addressType(p, bs, nil(), counters);
      else if(fieldId == 6)       
          p += _read_argsQueryFinalization(p, bs, nil(), counters);
      else if(fieldId == 7)       
          p += _read_argsQueryResult(p, bs, nil(), counters);
      else revert();                                             
    }                                                          
    return (r, sz);                                             
  }                                                            
                            
  // field readers                       
  function _read_id(uint p, bytes bs, Data r, uint[8] counters) internal constant returns (uint) {                            
    var (x, sz) = _pb._decode_uint64(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[1] += 1;                                            
    } else {                                                         
      r.id = x;                                         
      if(counters[1] > 0) counters[1] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
  function _read_timeout(uint p, bytes bs, Data r, uint[8] counters) internal constant returns (uint) {                            
    var (x, sz) = _pb._decode_uint64(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[2] += 1;                                            
    } else {                                                         
      r.timeout = x;                                         
      if(counters[2] > 0) counters[2] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
  function _read_conditionType(uint p, bytes bs, Data r, uint[8] counters) internal constant returns (uint) {                            
    var (x, sz) = _pb._decode_uint32(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[3] += 1;                                            
    } else {                                                         
      r.conditionType = x;                                         
      if(counters[3] > 0) counters[3] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
  function _read_dependingContractAddress(uint p, bytes bs, Data r, uint[8] counters) internal constant returns (uint) {                            
    var (x, sz) = _pb._decode_sol_bytes32(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[4] += 1;                                            
    } else {                                                         
      r.dependingContractAddress = x;                                         
      if(counters[4] > 0) counters[4] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
  function _read_addressType(uint p, bytes bs, Data r, uint[8] counters) internal constant returns (uint) {                            
    var (x, sz) = _pb._decode_uint32(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[5] += 1;                                            
    } else {                                                         
      r.addressType = x;                                         
      if(counters[5] > 0) counters[5] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
  function _read_argsQueryFinalization(uint p, bytes bs, Data r, uint[8] counters) internal constant returns (uint) {                            
    var (x, sz) = _pb._decode_bytes(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[6] += 1;                                            
    } else {                                                         
      r.argsQueryFinalization = x;                                         
      if(counters[6] > 0) counters[6] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
  function _read_argsQueryResult(uint p, bytes bs, Data r, uint[8] counters) internal constant returns (uint) {                            
    var (x, sz) = _pb._decode_bytes(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[7] += 1;                                            
    } else {                                                         
      r.argsQueryResult = x;                                         
      if(counters[7] > 0) counters[7] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
                            
  // struct decoder                       
                                      
            
  //store function                                                     
  function store(Data memory input, Data storage output) internal{
    output.id = input.id;                           
    output.timeout = input.timeout;                           
    output.conditionType = input.conditionType;                           
    output.dependingContractAddress = input.dependingContractAddress;                           
    output.addressType = input.addressType;                           
    output.argsQueryFinalization = input.argsQueryFinalization;                           
    output.argsQueryResult = input.argsQueryResult;                           
  }                                                                   
             
  //utility functions                                           
  function nil() internal constant returns (Data r) {        
    assembly { r := 0 }                                       
  }                                                            
  function isNil(Data x) internal constant returns (bool r) {
    assembly { r := iszero(x) }                               
  }                                                            
} 

library pbRpcTransferMapEntry{
  //struct definition
  struct Data {   
    address sender;
    address receiver;
    uint256 transferAmount;             
  }                           
  // Decoder section                       
  function decode(bytes bs) internal constant returns (Data) {
    var (x,) = _decode(32, bs, bs.length);                       
    return x;                                                    
  }
  function decode(Data storage self, bytes bs) internal constant {
    var (x,) = _decode(32, bs, bs.length);                    
    store(x, self);                                           
  }                             
  // innter decoder                       
  function _decode(uint p, bytes bs, uint sz)                   
      internal constant returns (Data, uint) {             
    Data memory r;                                          
    uint[4] memory counters;                                  
    uint fieldId;                                               
    _pb.WireType wireType;                                      
    uint bytesRead;                                             
    uint offset = p;                                            
    while(p < offset+sz) {                                     
      (fieldId, wireType, bytesRead) = _pb._decode_key(p, bs);  
      p += bytesRead;                                           
      if (false) {}
      else if(fieldId == 1)       
          p += _read_sender(p, bs, r, counters);
      else if(fieldId == 2)       
          p += _read_receiver(p, bs, r, counters);
      else if(fieldId == 3)       
          p += _read_transferAmount(p, bs, r, counters);
      else revert();                                              
    }                                                          
    p = offset;                                                 
                                                    
    while(p < offset+sz) {                                     
      (fieldId, wireType, bytesRead) = _pb._decode_key(p, bs);  
      p += bytesRead;                                           
      if (false) {}
      else if(fieldId == 1)       
          p += _read_sender(p, bs, nil(), counters);
      else if(fieldId == 2)       
          p += _read_receiver(p, bs, nil(), counters);
      else if(fieldId == 3)       
          p += _read_transferAmount(p, bs, nil(), counters);
      else revert();                                             
    }                                                          
    return (r, sz);                                             
  }                                                            
                            
  // field readers                       
  function _read_sender(uint p, bytes bs, Data r, uint[4] counters) internal constant returns (uint) {                            
    var (x, sz) = _pb._decode_sol_address(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[1] += 1;                                            
    } else {                                                         
      r.sender = x;                                         
      if(counters[1] > 0) counters[1] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
  function _read_receiver(uint p, bytes bs, Data r, uint[4] counters) internal constant returns (uint) {                            
    var (x, sz) = _pb._decode_sol_address(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[2] += 1;                                            
    } else {                                                         
      r.receiver = x;                                         
      if(counters[2] > 0) counters[2] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
  function _read_transferAmount(uint p, bytes bs, Data r, uint[4] counters) internal constant returns (uint) {                            
    var (x, sz) = _pb._decode_sol_uint256(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[3] += 1;                                            
    } else {                                                         
      r.transferAmount = x;                                         
      if(counters[3] > 0) counters[3] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
                            
  // struct decoder                       
                                      
            
  //store function                                                     
  function store(Data memory input, Data storage output) internal{
    output.sender = input.sender;                           
    output.receiver = input.receiver;                           
    output.transferAmount = input.transferAmount;                           
  }                                                                   
             
  //utility functions                                           
  function nil() internal constant returns (Data r) {        
    assembly { r := 0 }                                       
  }                                                            
  function isNil(Data x) internal constant returns (bool r) {
    assembly { r := iszero(x) }                               
  }                                                            
} 

library pbRpcPaymentChannelState{
  //struct definition
  struct Data {   
    pbRpcTransferMapEntry.Data[] transferMap;             
  }                           
  // Decoder section                       
  function decode(bytes bs) internal constant returns (Data) {
    var (x,) = _decode(32, bs, bs.length);                       
    return x;                                                    
  }
  function decode(Data storage self, bytes bs) internal constant {
    var (x,) = _decode(32, bs, bs.length);                    
    store(x, self);                                           
  }                             
  // innter decoder                       
  function _decode(uint p, bytes bs, uint sz)                   
      internal constant returns (Data, uint) {             
    Data memory r;                                          
    uint[2] memory counters;                                  
    uint fieldId;                                               
    _pb.WireType wireType;                                      
    uint bytesRead;                                             
    uint offset = p;                                            
    while(p < offset+sz) {                                     
      (fieldId, wireType, bytesRead) = _pb._decode_key(p, bs);  
      p += bytesRead;                                           
      if (false) {}
      else if(fieldId == 1)       
          p += _read_transferMap(p, bs, nil(), counters);
      else revert();                                              
    }                                                          
    p = offset;                                                 
    r.transferMap = new pbRpcTransferMapEntry.Data[](counters[1]);
                                                    
    while(p < offset+sz) {                                     
      (fieldId, wireType, bytesRead) = _pb._decode_key(p, bs);  
      p += bytesRead;                                           
      if (false) {}
      else if(fieldId == 1)       
          p += _read_transferMap(p, bs, r, counters);
      else revert();                                             
    }                                                          
    return (r, sz);                                             
  }                                                            
                            
  // field readers                       
  function _read_transferMap(uint p, bytes bs, Data r, uint[2] counters) internal constant returns (uint) {                            
    var (x, sz) = _decode_rpc_TransferMapEntry(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[1] += 1;                                            
    } else {                                                         
      r.transferMap[ r.transferMap.length - counters[1] ] = x;                                         
      if(counters[1] > 0) counters[1] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
                            
  // struct decoder                       
  function _decode_rpc_TransferMapEntry(uint p, bytes bs)            
      internal constant returns (pbRpcTransferMapEntry.Data, uint) {    
    var (sz, bytesRead) = _pb._decode_varint(p, bs);   
    p += bytesRead;                                    
    var (r,) = pbRpcTransferMapEntry._decode(p, bs, sz);               
    return (r, sz + bytesRead);                        
  }      
                                      
            
  //store function                                                     
  function store(Data memory input, Data storage output) internal{
    output.transferMap.length = input.transferMap.length;             
    for(uint i1=0; i1<input.transferMap.length; i1++)       
      pbRpcTransferMapEntry.store(input.transferMap[i1], output.transferMap[i1]); 
  }                                                                   
             
  //utility functions                                           
  function nil() internal constant returns (Data r) {        
    assembly { r := 0 }                                       
  }                                                            
  function isNil(Data x) internal constant returns (bool r) {
    assembly { r := iszero(x) }                               
  }                                                            
} 

library pbRpcPaymentBooleanAndResolveLogic{
  //struct definition
  struct Data {   
    pbRpcTransferMapEntry.Data[] updatedTransferMap;             
  }                           
  // Decoder section                       
  function decode(bytes bs) internal constant returns (Data) {
    var (x,) = _decode(32, bs, bs.length);                       
    return x;                                                    
  }
  function decode(Data storage self, bytes bs) internal constant {
    var (x,) = _decode(32, bs, bs.length);                    
    store(x, self);                                           
  }                             
  // innter decoder                       
  function _decode(uint p, bytes bs, uint sz)                   
      internal constant returns (Data, uint) {             
    Data memory r;                                          
    uint[2] memory counters;                                  
    uint fieldId;                                               
    _pb.WireType wireType;                                      
    uint bytesRead;                                             
    uint offset = p;                                            
    while(p < offset+sz) {                                     
      (fieldId, wireType, bytesRead) = _pb._decode_key(p, bs);  
      p += bytesRead;                                           
      if (false) {}
      else if(fieldId == 1)       
          p += _read_updatedTransferMap(p, bs, nil(), counters);
      else revert();                                              
    }                                                          
    p = offset;                                                 
    r.updatedTransferMap = new pbRpcTransferMapEntry.Data[](counters[1]);
                                                    
    while(p < offset+sz) {                                     
      (fieldId, wireType, bytesRead) = _pb._decode_key(p, bs);  
      p += bytesRead;                                           
      if (false) {}
      else if(fieldId == 1)       
          p += _read_updatedTransferMap(p, bs, r, counters);
      else revert();                                             
    }                                                          
    return (r, sz);                                             
  }                                                            
                            
  // field readers                       
  function _read_updatedTransferMap(uint p, bytes bs, Data r, uint[2] counters) internal constant returns (uint) {                            
    var (x, sz) = _decode_rpc_TransferMapEntry(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[1] += 1;                                            
    } else {                                                         
      r.updatedTransferMap[ r.updatedTransferMap.length - counters[1] ] = x;                                         
      if(counters[1] > 0) counters[1] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
                            
  // struct decoder                       
  function _decode_rpc_TransferMapEntry(uint p, bytes bs)            
      internal constant returns (pbRpcTransferMapEntry.Data, uint) {    
    var (sz, bytesRead) = _pb._decode_varint(p, bs);   
    p += bytesRead;                                    
    var (r,) = pbRpcTransferMapEntry._decode(p, bs, sz);               
    return (r, sz + bytesRead);                        
  }      
                                      
            
  //store function                                                     
  function store(Data memory input, Data storage output) internal{
    output.updatedTransferMap.length = input.updatedTransferMap.length;             
    for(uint i1=0; i1<input.updatedTransferMap.length; i1++)       
      pbRpcTransferMapEntry.store(input.updatedTransferMap[i1], output.updatedTransferMap[i1]); 
  }                                                                   
             
  //utility functions                                           
  function nil() internal constant returns (Data r) {        
    assembly { r := 0 }                                       
  }                                                            
  function isNil(Data x) internal constant returns (bool r) {
    assembly { r := iszero(x) }                               
  }                                                            
} 

library pbRpcCooperativeWithdrawProof{
  //struct definition
  struct Data {   
    uint256 nonce;
    uint256 stateChannelId;
    uint256 withdrawalAmount;
    address receiver;             
  }                           
  // Decoder section                       
  function decode(bytes bs) internal constant returns (Data) {
    var (x,) = _decode(32, bs, bs.length);                       
    return x;                                                    
  }
  function decode(Data storage self, bytes bs) internal constant {
    var (x,) = _decode(32, bs, bs.length);                    
    store(x, self);                                           
  }                             
  // innter decoder                       
  function _decode(uint p, bytes bs, uint sz)                   
      internal constant returns (Data, uint) {             
    Data memory r;                                          
    uint[5] memory counters;                                  
    uint fieldId;                                               
    _pb.WireType wireType;                                      
    uint bytesRead;                                             
    uint offset = p;                                            
    while(p < offset+sz) {                                     
      (fieldId, wireType, bytesRead) = _pb._decode_key(p, bs);  
      p += bytesRead;                                           
      if (false) {}
      else if(fieldId == 1)       
          p += _read_nonce(p, bs, r, counters);
      else if(fieldId == 2)       
          p += _read_stateChannelId(p, bs, r, counters);
      else if(fieldId == 3)       
          p += _read_withdrawalAmount(p, bs, r, counters);
      else if(fieldId == 4)       
          p += _read_receiver(p, bs, r, counters);
      else revert();                                              
    }                                                          
    p = offset;                                                 
                                                    
    while(p < offset+sz) {                                     
      (fieldId, wireType, bytesRead) = _pb._decode_key(p, bs);  
      p += bytesRead;                                           
      if (false) {}
      else if(fieldId == 1)       
          p += _read_nonce(p, bs, nil(), counters);
      else if(fieldId == 2)       
          p += _read_stateChannelId(p, bs, nil(), counters);
      else if(fieldId == 3)       
          p += _read_withdrawalAmount(p, bs, nil(), counters);
      else if(fieldId == 4)       
          p += _read_receiver(p, bs, nil(), counters);
      else revert();                                             
    }                                                          
    return (r, sz);                                             
  }                                                            
                            
  // field readers                       
  function _read_nonce(uint p, bytes bs, Data r, uint[5] counters) internal constant returns (uint) {                            
    var (x, sz) = _pb._decode_sol_uint256(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[1] += 1;                                            
    } else {                                                         
      r.nonce = x;                                         
      if(counters[1] > 0) counters[1] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
  function _read_stateChannelId(uint p, bytes bs, Data r, uint[5] counters) internal constant returns (uint) {                            
    var (x, sz) = _pb._decode_sol_uint256(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[2] += 1;                                            
    } else {                                                         
      r.stateChannelId = x;                                         
      if(counters[2] > 0) counters[2] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
  function _read_withdrawalAmount(uint p, bytes bs, Data r, uint[5] counters) internal constant returns (uint) {                            
    var (x, sz) = _pb._decode_sol_uint256(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[3] += 1;                                            
    } else {                                                         
      r.withdrawalAmount = x;                                         
      if(counters[3] > 0) counters[3] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
  function _read_receiver(uint p, bytes bs, Data r, uint[5] counters) internal constant returns (uint) {                            
    var (x, sz) = _pb._decode_sol_address(p, bs);                                  
    if(isNil(r)) {                                                  
      counters[4] += 1;                                            
    } else {                                                         
      r.receiver = x;                                         
      if(counters[4] > 0) counters[4] -= 1;                      
    }                                                                
    return sz;                                                       
  }                                                                 
                            
  // struct decoder                       
                                      
            
  //store function                                                     
  function store(Data memory input, Data storage output) internal{
    output.nonce = input.nonce;                           
    output.stateChannelId = input.stateChannelId;                           
    output.withdrawalAmount = input.withdrawalAmount;                           
    output.receiver = input.receiver;                           
  }                                                                   
             
  //utility functions                                           
  function nil() internal constant returns (Data r) {        
    assembly { r := 0 }                                       
  }                                                            
  function isNil(Data x) internal constant returns (bool r) {
    assembly { r := iszero(x) }                               
  }                                                            
} 
