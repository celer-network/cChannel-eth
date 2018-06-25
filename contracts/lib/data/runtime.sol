pragma solidity ^0.4.0;

library _pb {

    enum WireType { Varint, Fixed64, LengthDelim, StartGroup, EndGroup, Fixed32 }

    // Decoders
    function _decode_uint32(uint p, bytes bs) internal constant returns (uint32, uint) {
      var (varint, sz) = _decode_varint(p, bs);
      return (uint32(varint), sz);
    }

    function _decode_uint64(uint p, bytes bs) internal constant returns (uint64, uint) {
      var (varint, sz) = _decode_varint(p, bs);
      return (uint64(varint), sz);
    }

    function _decode_string(uint p, bytes bs) internal constant returns (string, uint) {
      var (x, sz) = _decode_lendelim(p, bs);
      return (string(x), sz);
    }

    function _decode_bytes(uint p, bytes bs) internal constant returns (bytes, uint) {
      return _decode_lendelim(p, bs);
    }

    function _decode_key(uint p, bytes bs) internal constant returns (uint, WireType, uint) {
      var (x, n) = _decode_varint(p, bs);
      WireType typeId  = WireType(x & 7);
      uint fieldId = x / 8; //x >> 3;
      return (fieldId, typeId, n);
    }

    function _decode_varint(uint p, bytes bs) internal constant returns (uint, uint) {
      uint x = 0;
      uint sz = 0;
      assembly {
        let b := 0
        p     := add(bs, p)
        loop:
          b  := byte(0, mload(p))
          x  := or(x, mul(and(0x7f, b), exp(2, mul(7, sz))))
          sz := add(sz, 1)
          p  := add(p, 0x01)
          jumpi(loop, eq(0x80, and(b, 0x80)))
      }
      return (x, sz);
    }

    function _decode_varints(uint p, bytes bs) internal constant returns (int, uint) {
      var (u, sz) = _decode_varint(p, bs);
      int s;
      assembly {
        s := xor(div(u, 2), add(not(and(u, 1)), 1))
      }
      return (s, sz);
    }

    function _decode_uintf(uint p, bytes bs, uint sz) internal constant returns (uint, uint) {
      uint x = 0;
      assembly {
        let i := 0
        p     := add(bs, p)
        loop:
          jumpi(end, eq(i, sz))
          x := or(x, mul(byte(0, mload(p)), exp(2, mul(8, i))))
          p := add(p, 0x01)
          i := add(i, 1)
          jump(loop)
        end:
      }
      return (x, sz);
    }

    function _decode_lendelim(uint p, bytes bs) internal constant returns (bytes, uint) {
      var (len, sz) = _decode_varint(p, bs);
      bytes memory b = new bytes(len);
      assembly {
        let bptr  := add(b, 32)
        let count := 0
        p         := add(add(bs, p),sz)
        loop :
          jumpi(end, eq(count, len))
          mstore8(bptr, byte(0, mload(p)))
          p     := add(p, 1)
          bptr  := add(bptr, 1)
          count := add(count, 1)
          jump(loop)
        end:
      }
      return (b, sz+len);
    }

  // Soltype extensions

  function _decode_sol_bytesN_lower(uint8 n, uint p, bytes bs) internal constant returns (bytes32, uint) {
    uint r;
    var (len, sz) = _decode_varint(p, bs);
    if (len + sz != n + 3) revert();
    p += 3;
    assembly { r := mload(add(p,bs)) }
    for (uint i=n; i<32; i++)
      r /= 256;
    return (bytes32(r), n + 3);
  }
  function _decode_sol_bytesN(uint8 n, uint p, bytes bs) internal constant returns (bytes32, uint) {
    var (len, sz) = _decode_varint(p, bs);
    if (len + sz != n + 3) revert();
    p += 3;
    bytes32 acc;
    assembly {
      acc := mload(add(p, bs))
    }
    return (acc, n + 3);
  }

  function _decode_sol_address(uint p, bytes bs) internal constant returns (address, uint) {
    var (r, sz) = _decode_sol_bytesN_lower(20, p, bs);
    return (address(r), sz);
  }

  function _decode_sol_bool(uint p, bytes bs) internal constant returns (bool, uint) {
    var (r, sz) = _decode_sol_uintN(1, p, bs);
    if (r == 0) return (false, sz);
    return (true, sz);
  }

  function _decode_sol_uint(uint p, bytes bs) internal constant returns (uint, uint) {
    return _decode_sol_uint256(p, bs);
  }

  function _decode_sol_uintN(uint8 n, uint p, bytes bs) internal constant returns (uint, uint) {
    uint r;
    var (len, sz) = _decode_varint(p, bs);
    p += 3;
    assembly { r := mload(add(p,bs)) }
    r = r / (256**(32 - (len -2)));
 
    return (r, len + 1);
  }

  function _decode_sol_uint8(uint p, bytes bs) internal constant returns (uint8, uint) {
    var (r, sz) = _decode_sol_uintN(1, p, bs);
    return (uint8(r), sz);
  }

  function _decode_sol_uint256(uint p, bytes bs) internal constant returns (uint256, uint) {
    var (r, sz) = _decode_sol_uintN(32, p, bs);
    return (uint256(r), sz);
  }

  function _decode_sol_bytes32(uint p, bytes bs) internal constant returns (bytes32, uint) {
    return _decode_sol_bytesN(32, p, bs);
  }
}
