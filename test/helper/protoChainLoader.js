const protobuf = require("protobufjs");
protobuf.common('google/protobuf/descriptor.proto', {})

module.exports = async () => {
  chain2 = await protobuf.load(`${__dirname}/../../contracts/lib/data/proto/chain2.proto`);
  entity = await protobuf.load(`${__dirname}/../../contracts/lib/data/proto/entity.proto`);

  const OpenChannelRequest = chain2.lookupType("chain2.OpenChannelRequest");
  const CooperativeWithdrawRequest = chain2.lookupType("chain2.CooperativeWithdrawRequest");
  const CooperativeSettleRequest = chain2.lookupType("chain2.CooperativeSettleRequest");
  const SignedSimplexState = chain2.lookupType("chain2.SignedSimplexState");
  const SignedSimplexStateArray = chain2.lookupType("chain2.SignedSimplexStateArray");
  const ResolvePayByConditionsRequest = chain2.lookupType("chain2.ResolvePayByConditionsRequest");

  const PaymentChannelInitializer = entity.lookupType("entity.PaymentChannelInitializer");
  const TokenDistribution = entity.lookupType("entity.TokenDistribution");
  const TokenInfo = entity.lookupType("entity.TokenInfo");
  const AccountAmtPair = entity.lookupType("entity.AccountAmtPair");
  const TokenTransfer = entity.lookupType("entity.TokenTransfer");
  const CooperativeWithdrawInfo = entity.lookupType("entity.CooperativeWithdrawInfo");
  const SimplexPaymentChannel = entity.lookupType("entity.SimplexPaymentChannel");
  const TransferFunction = entity.lookupType("entity.TransferFunction");
  const ConditionalPay = entity.lookupType("entity.ConditionalPay");
  const CondPayResult = entity.lookupType("entity.CondPayResult");
  const VouchedCondPayResult = entity.lookupType("entity.VouchedCondPayResult");
  const Condition = entity.lookupType("entity.Condition");
  const CooperativeSettleInfo = entity.lookupType("entity.CooperativeSettleInfo");
  const PayHashList = entity.lookupType("entity.PayHashList");

  return {
    // chain2
    OpenChannelRequest,
    CooperativeWithdrawRequest,
    CooperativeSettleRequest,
    ResolvePayByConditionsRequest,

    // entity
    PaymentChannelInitializer,
    TokenDistribution,
    TokenInfo,
    AccountAmtPair,
    TokenTransfer,
    CooperativeWithdrawInfo,
    SimplexPaymentChannel,
    SignedSimplexState,
    SignedSimplexStateArray,
    TransferFunction,
    ConditionalPay,
    CondPayResult,
    VouchedCondPayResult,
    Condition,
    CooperativeSettleInfo,
    PayHashList
  }
}
