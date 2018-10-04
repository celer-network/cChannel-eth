const protobuf = require("protobufjs");

module.exports = async () =>
  protobuf.load(`${__dirname}/../../contracts/lib/data/proto/solidity.proto`)
    .then(function (root) {
      const address = root.lookupType("solidity.address");
      const bytes32 = root.lookupType("solidity.bytes32");
      const uint8 = root.lookupType("solidity.uint8");
      const uint256 = root.lookupType("solidity.uint256");

      return {
        address,
        bytes32,
        uint8,
        uint256
      }
    });