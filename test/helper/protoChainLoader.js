const protobuf = require("protobufjs");
protobuf.common('google/protobuf/descriptor.proto', {})

module.exports = async () => {
  chain = await protobuf.load(`${__dirname}/../../contracts/lib/data/proto/chain.proto`);
  entity = await protobuf.load(`${__dirname}/../../contracts/lib/data/proto/entity.proto`);

  const OpenChannelRequest = chain.lookupType("chain.OpenChannelRequest");
  const CooperativeWithdrawRequest = chain.lookupType("chain.CooperativeWithdrawRequest");
  const CooperativeSettleRequest = chain.lookupType("chain.CooperativeSettleRequest");
  const SignedSimplexState = chain.lookupType("chain.SignedSimplexState");
  const SignedSimplexStateArray = chain.lookupType("chain.SignedSimplexStateArray");
  const ResolvePayByConditionsRequest = chain.lookupType("chain.ResolvePayByConditionsRequest");

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
  const PayIdList = entity.lookupType("entity.PayIdList");

  return {
    // chain
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
    PayIdList
  }
}
