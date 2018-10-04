const Web3 = require('web3');
const web3 = new Web3(new Web3.providers.HttpProvider('http://localhost:8545'));

const protoChainLoader = require('./protoChainLoader');
const solidityLoader = require('./solidityLoader');

const BooleanCondMock = artifacts.require('BooleanCondMock');

const calculateSignature = async (address, hash) => {
  const signature = await web3.eth.sign(hash, address);
  const r = web3.utils.hexToBytes(signature.slice(0, 66));
  const s = web3.utils.hexToBytes('0x' + signature.slice(66, 130));
  const v = web3.utils.hexToNumber('0x' + signature.slice(130, 132));

  return { r, s, v };
};

module.exports = async (peers, genericChannel) => {
  const protoChain = await protoChainLoader();
  const solidity = await solidityLoader();
  const {
    AuthorizedWithdraw,
    StateProof,
    MultiSignature,
    ConditionGroup,
    Condition,
    TransferMapEntry,
    PaymentBooleanAndResolveLogic,
    CooperativeWithdrawProof
  } = protoChain;

  const booleanCondMock = await BooleanCondMock.new();
  const paddingAddress = `0x${'0'.repeat(24)}${booleanCondMock.address.slice(
    2
  )}`;
  const condition = {
    id: 1,
    timeout: 5,
    dependingContractAddress: solidity.bytes32.create({
      data: web3.utils.hexToBytes(paddingAddress)
    }),
    addressType: 1
  };

  const transferMapEntry = {
    sender: solidity.address.create({
      data: web3.utils.hexToBytes(peers[0])
    }),
    receiver: solidity.address.create({
      data: web3.utils.hexToBytes(peers[1])
    }),
    transferAmount: solidity.uint256.create({ data: [5] })
  };

  const paymentBooleanAndResolveLogic = {
    updatedTransferMap: [TransferMapEntry.create(transferMapEntry)]
  };
  const paymentResolveLogicProto = PaymentBooleanAndResolveLogic.create(
    paymentBooleanAndResolveLogic
  );
  const paymentResolveLogicBytes = PaymentBooleanAndResolveLogic.encode(
    paymentResolveLogicProto
  )
    .finish()
    .toJSON().data;

  // TODO: state_deposit_map is not used
  const conditionGroup = {
    conditions: [Condition.create(condition)],
    logicType: 1,
    groupResolveLogic: paymentResolveLogicBytes
  };
  const conditionGroupProto = ConditionGroup.create(conditionGroup);
  const conditionGroupBytes = ConditionGroup.encode(conditionGroupProto)
    .finish()
    .toJSON().data;

  const conditionGroupHash = web3.utils.keccak256(
    web3.utils.bytesToHex(conditionGroupBytes)
  );

  const getStateProofBytes = ({ channelId = 1, nonce = 1 }) => {
    const stateProof = {
      nonce: solidity.uint256.create({ data: [nonce] }),
      state: [],
      pendingConditionRoot: solidity.bytes32.create({
        data: web3.utils.hexToBytes(conditionGroupHash)
      }),
      stateChannelId: solidity.uint256.create({ data: [channelId] }),
      maxCondTimeout: solidity.uint256.create({ data: [5] })
    };
    const stateProofProto = StateProof.create(stateProof);
    return StateProof.encode(stateProofProto)
      .finish()
      .toJSON().data;
  };

  const getCooperativeWithdrawProofBytes = ({ channelId = 1, nonce = 1, amount = 5, receiver = peers[0] }) => {
    const cooperativeWithdrawProof = {
      nonce: solidity.uint256.create({ data: [nonce] }),
      stateChannelId: solidity.uint256.create({ data: [channelId] }),
      withdrawalAmount: solidity.uint256.create({ data: [amount] }),
      receiver: solidity.address.create({
        data: web3.utils.hexToBytes(receiver)
      }),
    };
    const cooperativeWithdrawProofProto = CooperativeWithdrawProof.create(cooperativeWithdrawProof);
    return CooperativeWithdrawProof.encode(cooperativeWithdrawProofProto)
      .finish()
      .toJSON().data;
  };

  const getCooperativeStateProofBytes = ({ channelId = 1, nonce = 1 }) => {
    const stateProof = {
      nonce: solidity.uint256.create({ data: [nonce] }),
      state: paymentResolveLogicBytes,
      pendingConditionRoot: solidity.bytes32.create({ data: web3.utils.hexToBytes('0x0000000000000000000000000000000000000000000000000000000000000000') }),
      stateChannelId: solidity.uint256.create({ data: [channelId] }),
      maxCondTimeout: solidity.uint256.create({ data: [5] })
    };
    const stateProofProto = StateProof.create(stateProof);
    return StateProof.encode(stateProofProto)
      .finish()
      .toJSON().data;
  };

  const getAuthorizedWithdrawBytes = () => {
    const authorizedWithdraw = {
      peers: [
        solidity.address.create({
          data: web3.utils.hexToBytes(peers[0])
        }),
        solidity.address.create({
          data: web3.utils.hexToBytes(peers[1])
        })
      ],
      values: [
        solidity.uint256.create({ data: [100] }),
        solidity.uint256.create({ data: [200] })
      ],
      withdrawAddress: solidity.address.create({
        data: web3.utils.hexToBytes(genericChannel)
      }),
      nonce: solidity.uint256.create({ data: [1] })
    };

    const authorizedWithdrawProto = AuthorizedWithdraw.create(
      authorizedWithdraw
    );
    return AuthorizedWithdraw.encode(authorizedWithdrawProto)
      .finish()
      .toJSON().data;
  };

  const getAllSignatureBytes = async ({ messageBytes }) => {
    const messageHash = web3.utils.keccak256(
      web3.utils.bytesToHex(messageBytes)
    );

    const signature0 = await calculateSignature(peers[0], messageHash);
    const signature1 = await calculateSignature(peers[1], messageHash);
    const multiSignature = {
      v: [
        solidity.uint256.create({ data: [signature0.v] }),
        solidity.uint256.create({ data: [signature1.v] })
      ],
      r: [
        solidity.bytes32.create({ data: signature0.r }),
        solidity.bytes32.create({ data: signature1.r })
      ],
      s: [
        solidity.bytes32.create({ data: signature0.s }),
        solidity.bytes32.create({ data: signature1.s })
      ]
    };
    const multiSignatureProto = MultiSignature.create(multiSignature);

    return MultiSignature.encode(multiSignatureProto)
      .finish()
      .toJSON().data;
  };

  const stateProofBytes = getStateProofBytes({});
  const stateProofSignatureBytes = await getAllSignatureBytes({
    messageBytes: stateProofBytes
  });
  const cooperativeWithdrawProofBytes = getCooperativeWithdrawProofBytes({});
  const authorizedWithdrawBytes = getAuthorizedWithdrawBytes();
  const authorizedWithdrawSignatureBytes = await getAllSignatureBytes({
    messageBytes: authorizedWithdrawBytes
  });

  return {
    getAllSignatureBytes,
    getStateProofBytes,
    conditionGroupBytes,
    conditionGroupHash,
    stateProofBytes,
    stateProofSignatureBytes,
    getCooperativeWithdrawProofBytes,
    cooperativeWithdrawProofBytes,
    authorizedWithdrawBytes,
    getCooperativeStateProofBytes,
    authorizedWithdrawSignatureBytes
  };
};
