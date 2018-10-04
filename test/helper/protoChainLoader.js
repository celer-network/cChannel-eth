const protobuf = require("protobufjs");

module.exports = async () =>
  protobuf.load(`${__dirname}/../../contracts/lib/data/proto/chain.proto`)
    .then(function (root) {
      const AuthorizedWithdraw = root.lookupType("rpc.AuthorizedWithdraw");
      const StateProof = root.lookupType("rpc.StateProof");
      const MultiSignature = root.lookupType("rpc.MultiSignature");
      const StateDepositMapEntry = root.lookupType("rpc.StateDepositMapEntry");
      const ConditionGroup = root.lookupType("rpc.ConditionGroup");
      const Condition = root.lookupType("rpc.Condition");
      const TransferMapEntry = root.lookupType("rpc.TransferMapEntry");
      const PaymentChannelState = root.lookupType("rpc.PaymentChannelState");
      const PaymentBooleanAndResolveLogic = root.lookupType("rpc.PaymentBooleanAndResolveLogic");
      const CooperativeWithdrawProof = root.lookupType("rpc.CooperativeWithdrawProof");

      return {
        AuthorizedWithdraw,
        StateProof,
        MultiSignature,
        StateDepositMapEntry,
        ConditionGroup,
        Condition,
        TransferMapEntry,
        PaymentChannelState,
        PaymentBooleanAndResolveLogic,
        CooperativeWithdrawProof
      }
    });