const Web3 = require('web3');
const web3 = new Web3(new Web3.providers.HttpProvider('http://localhost:8545'));
const sha3 = web3.utils.keccak256;

const protoChainLoader = require('./protoChainLoader');
const { signMessage } = require('./sign');

const utilities = require('./utilities');
const { calculatePayId, uint2bytes } = utilities;

const BooleanCondMock = artifacts.require('BooleanCondMock');
const NumericCondMock = artifacts.require('NumericCondMock');

const TRUE_PREIMAGE = '0x123456';

// calculate the signature of given address on given hash
const calculateSignature = async (address, hash) => {
  // can't directly use web3.eth.sign() because of this issue:
  // https://github.com/OpenZeppelin/openzeppelin-solidity/pull/1622
  const sigHex = await signMessage(address, hash);
  const sigBytes = web3.utils.hexToBytes(sigHex);
  return sigBytes;
};

module.exports = async (peers, clients) => {
  const protoChain = await protoChainLoader();
  const {
    OpenChannelRequest,
    CooperativeWithdrawRequest,
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
    CooperativeSettleRequest,
    ResolvePayByConditionsRequest,
    PayIdList,
    ChannelMigrationRequest,
    ChannelMigrationInfo
  } = protoChain;

  /********** constant vars **********/
  const booleanCondMock = await BooleanCondMock.new();
  const numericCondMock = await NumericCondMock.new();

  const conditionDeployedFalse = {
    conditionType: 1,
    deployedContractAddress: web3.utils.hexToBytes(booleanCondMock.address),
    argsQueryOutcome: [0]
  };

  const conditionDeployedTrue = {
    conditionType: 1,
    deployedContractAddress: web3.utils.hexToBytes(booleanCondMock.address),
    argsQueryOutcome: [1]
  };

  const getConditionDeployedNumeric = (amount) => {
    // amount should be a uint8 number
    return {
      conditionType: 1,
      deployedContractAddress: web3.utils.hexToBytes(numericCondMock.address),
      argsQueryOutcome: [amount]
    }
  }

  const conditionHashLock = {
    conditionType: 0,
    hashLock: web3.utils.hexToBytes(sha3(web3.utils.hexToBytes(TRUE_PREIMAGE)))
  }

  // TODO: add VIRTUAL_CONTRACT conditions and tests

  /********** external API **********/
  // get the list of PayIdList bytes and the list of PayBytes array in a simplex state
  const getPayIdListInfo = ({
    payAmounts,  // an array of pay amount list of linked pay id list; from head to tail
    payResolverAddr,
    payConditions = null
  }) => {
    // 1-d array of PayIdList proto
    let payIdListProtos = [];
    // 1-d array of PayIdList bytes, for clearing pays in CelerLedger
    let payIdListBytesArray = [];
    // 2-d array of pay bytes in list of PayIdList of a simplex channel, 
    // for resolving pays with PayRegistry.
    // Index is consistent with payAmounts.
    let payBytesArray = [];
    // total pending amount in payAmounts/this state
    let totalPendingAmount = 0;

    for (let i = 0; i < payAmounts.length; i++) {
      payBytesArray[i] = []
    }

    for (let i = payAmounts.length - 1; i >= 0; i--) {
      let payIds = [];
      for (j = 0; j < payAmounts[i].length; j++) {
        totalPendingAmount += payAmounts[i][j];
        let conditions;
        if (payConditions == null) {
          // use true condition by default
          conditions = [Condition.create(conditionDeployedTrue)];
        } else {
          if (payConditions[i][j]) {
            conditions = [Condition.create(conditionDeployedTrue)];
          } else {
            conditions = [Condition.create(conditionDeployedFalse)];
          }
        }
        payBytesArray[i][j] = getConditionalPayBytes({
          payTimestamp: Math.floor(Math.random() * 10000000000),
          paySrc: clients[i],
          payDest: clients[1 - i],
          conditions: conditions,
          maxAmount: payAmounts[i][j],
          payResolver: payResolverAddr
        });
        payIds[j] = web3.utils.hexToBytes(
          calculatePayId(sha3(payBytesArray[i][j]), payResolverAddr)
        );
      }

      // assemble PayIdList
      let payIdList;
      if (i == payAmounts.length - 1) {
        payIdList = { payIds: payIds };
      } else {
        payIdList = {
          payIds: payIds,
          nextListHash: web3.utils.hexToBytes(sha3(payIdListBytesArray[i + 1]))
        }
      }
      payIdListProtos[i] = PayIdList.create(payIdList);
      payIdListBytesArray[i] = PayIdList.encode(payIdListProtos[i])
        .finish()
        .toJSON().data;
    }
    return {
      payIdListProtos: payIdListProtos,
      payBytesArray: payBytesArray,
      payIdListBytesArray: payIdListBytesArray,
      totalPendingAmount: totalPendingAmount
    }
  }

  // get bytes of vouched cond pay result
  const getVouchedCondPayResultBytes = async ({
    condPay,
    amount,
    src,
    dest
  }) => {
    const condPayResult = {
      condPay: condPay,
      amount: uint2bytes(amount)
    }
    const condPayResultProto = CondPayResult.create(condPayResult);
    const condPayResultBytes = CondPayResult.encode(condPayResultProto)
      .finish()
      .toJSON().data;
    const condPayResultHash = sha3(
      web3.utils.bytesToHex(condPayResultBytes)
    );
    const sigOfSrc = await calculateSignature(src, condPayResultHash);
    const sigOfDest = await calculateSignature(dest, condPayResultHash);

    const vouchedCondPayResult = {
      condPayResult: condPayResultBytes,
      sigOfSrc: sigOfSrc,
      sigOfDest: sigOfDest
    }
    const vouchedCondPayResultProto = VouchedCondPayResult.create(vouchedCondPayResult);
    return VouchedCondPayResult.encode(vouchedCondPayResultProto)
      .finish()
      .toJSON().data;
  }

  // shortcut function to get an array of condition protos
  const getConditions = ({
    type
  }) => {
    switch (type) {
      case 0:  // [conditionHashLock, conditionDeployedFalse, conditionDeployedFalse]
        return [
          Condition.create(conditionHashLock),
          Condition.create(conditionDeployedFalse),
          Condition.create(conditionDeployedFalse)
        ];
      case 1:  // [conditionHashLock, conditionDeployedFalse, conditionDeployedTrue]
        return [
          Condition.create(conditionHashLock),
          Condition.create(conditionDeployedFalse),
          Condition.create(conditionDeployedTrue)
        ];
      case 2:  // [conditionHashLock, conditionDeployedTrue, conditionDeployedFalse]
        return [
          Condition.create(conditionHashLock),
          Condition.create(conditionDeployedTrue),
          Condition.create(conditionDeployedFalse)
        ];
      case 3:  // [conditionHashLock, conditionDeployedTrue, conditionDeployedTrue]
        return [
          Condition.create(conditionHashLock),
          Condition.create(conditionDeployedTrue),
          Condition.create(conditionDeployedTrue)
        ];
      case 4:  // [conditionHashLock, conditionDeployedTrue, conditionHashLock]
        return [
          Condition.create(conditionHashLock),
          Condition.create(conditionDeployedTrue),
          Condition.create(conditionHashLock)
        ];
      case 5:  // [conditionHashLock, conditionNumeric10, conditionNumeric25]
        return [
          Condition.create(conditionHashLock),
          Condition.create(getConditionDeployedNumeric(10)),
          Condition.create(getConditionDeployedNumeric(25))
        ];
      case 6:  // [conditionHashLock]
        return [Condition.create(conditionHashLock)];
    }
  }

  // get bytes of OpenChannelRequest
  // TODO: is it necessary to calculate channelId/walletId here for tests?
  const getOpenChannelRequest = async ({
    openDeadline = 999999,
    disputeTimeout = 10,
    tokenAddress = null,
    tokenType = 1,
    zeroTotalDeposit = false,
    channelPeers = peers,
    msgValueReceiver = 0
  }) => {
    let paymentChannelInitializerBytes;
    if (tokenType == 1) {  // ETH
      paymentChannelInitializerBytes = getPaymentChannelInitializerBytes({
        openDeadline: openDeadline,
        disputeTimeout: disputeTimeout,
        tokenType: tokenType,
        zeroTotalDeposit: zeroTotalDeposit,
        channelPeers: channelPeers,
        msgValueReceiver: msgValueReceiver
      });
    } else if (tokenType == 2) {  // ERC20
      paymentChannelInitializerBytes = getPaymentChannelInitializerBytes({
        openDeadline: openDeadline,
        disputeTimeout: disputeTimeout,
        tokenAddress: tokenAddress,
        tokenType: tokenType,
        zeroTotalDeposit: zeroTotalDeposit,
        channelPeers: channelPeers,
        msgValueReceiver: msgValueReceiver
      });
    }

    const sigs = await getAllSignatures({
      messageBytes: paymentChannelInitializerBytes,
      signPeers: channelPeers
    });

    let openChannelRequest = {
      channelInitializer: paymentChannelInitializerBytes,
      sigs: sigs
    }

    const openChannelRequestProto = OpenChannelRequest.create(openChannelRequest);
    const openChannelRequestBytes = OpenChannelRequest.encode(openChannelRequestProto)
      .finish()
      .toJSON().data;

    return {
      openChannelRequestBytes: openChannelRequestBytes
    }
  }

  // get bytes of CooperativeWithdrawRequest
  const getCooperativeWithdrawRequestBytes = async ({
    channelId,
    seqNum = 1,
    amount = 5,
    receiverAccount = peers[0],
    withdrawDeadline = 9999999,
    recipientChannelId = "0x0000000000000000000000000000000000000000000000000000000000000000"
  }) => {
    const withdraw = {
      account: web3.utils.hexToBytes(receiverAccount),
      amt: uint2bytes(amount)
    };
    const withdrawProto = AccountAmtPair.create(withdraw);

    const withdrawInfo = {
      channelId: web3.utils.hexToBytes(channelId),
      seqNum: seqNum,
      withdraw: withdrawProto,
      withdrawDeadline: withdrawDeadline,
      recipientChannelId: web3.utils.hexToBytes(recipientChannelId)
    };
    const withdrawInfoProto = CooperativeWithdrawInfo.create(withdrawInfo);
    const withdrawInfoBytes = CooperativeWithdrawInfo.encode(withdrawInfoProto)
      .finish()
      .toJSON().data;

    const sigs = await getAllSignatures({ messageBytes: withdrawInfoBytes });

    const cooperativeWithdrawRequest = {
      withdrawInfo: withdrawInfoBytes,
      sigs: sigs
    }
    const cooperativeWithdrawRequestProto = CooperativeWithdrawRequest.create(cooperativeWithdrawRequest);
    return CooperativeWithdrawRequest.encode(cooperativeWithdrawRequestProto)
      .finish()
      .toJSON().data;
  };

  // get bytes of SignedSimplexStateArray
  const getSignedSimplexStateArrayBytes = async ({
    // common fields
    channelIds,
    seqNums = [1, 1],
    // for cosigned non-null state
    transferAmounts = null,
    lastPayResolveDeadlines = null,
    payIdLists = null,
    peerFroms = peers,
    // for single-signed null state
    signers = null,
    totalPendingAmounts = [0, 0]
  }) => {
    let signedSimplexStateProtos = [];
    for (let i = 0; i < channelIds.length; i++) {
      if (seqNums[i] > 0) {  // cosigned non-null state
        signedSimplexStateProtos[i] = await getCoSignedSimplexStateProto({
          channelId: channelIds[i],
          peerFrom: peerFroms[i],
          seqNum: seqNums[i],
          transferAmount: transferAmounts[i],
          pendingPayIds: payIdLists[i],
          lastPayResolveDeadline: lastPayResolveDeadlines[i],
          totalPendingAmount: totalPendingAmounts[i]
        });
      } else if (seqNums[i] == 0) {  // single-signed null state
        signedSimplexStateProtos[i] = await getSingleSignedSimplexStateProto({
          channelId: channelIds[i],
          signer: signers[i]
        });
      }
    }

    const signedSimplexStateArray = { signedSimplexStates: signedSimplexStateProtos };
    const signedSimplexStateArrayProto = SignedSimplexStateArray.create(signedSimplexStateArray);
    return SignedSimplexStateArray.encode(signedSimplexStateArrayProto)
      .finish()
      .toJSON().data;
  }

  // get bytes of CooperativeSettleRequest
  const getCooperativeSettleRequestBytes = async ({
    channelId,
    seqNum,
    settleAmounts,  // uint[2]
    settleDeadline = 999999
  }) => {
    const settleBalance = getAccountAmtPairs({
      accounts: [peers[0], peers[1]],
      amounts: settleAmounts,
    });

    const cooperativeSettleInfo = {
      channelId: web3.utils.hexToBytes(channelId),
      seqNum: seqNum,
      settleBalance: settleBalance,
      settleDeadline: settleDeadline
    };
    const cooperativeSettleInfoProto = CooperativeSettleInfo.create(cooperativeSettleInfo);
    const cooperativeSettleInfoBytes = CooperativeSettleInfo.encode(cooperativeSettleInfoProto)
      .finish()
      .toJSON().data;

    const sigs = await getAllSignatures({ messageBytes: cooperativeSettleInfoBytes });

    const cooperativeSettleRequest = {
      settleInfo: cooperativeSettleInfoBytes,
      sigs: sigs
    };
    const cooperativeSettleRequestProto = CooperativeSettleRequest.create(cooperativeSettleRequest);
    return CooperativeSettleRequest.encode(cooperativeSettleRequestProto)
      .finish()
      .toJSON().data;
  };

  // get bytes of ResolvePayByConditionsRequest
  const getResolvePayByConditionsRequestBytes = ({
    condPayBytes,
    hashPreimages = []
  }) => {
    const request = {
      condPay: condPayBytes,
      hashPreimages: hashPreimages
    }
    const requestProto = ResolvePayByConditionsRequest.create(request);
    return ResolvePayByConditionsRequest.encode(requestProto)
      .finish()
      .toJSON().data;
  }

  const getMigrationRequest = async ({
    channelId,
    fromLedgerAddress,
    toLedgerAddress,
    migrationDeadline,
    channelPeers = peers
  }) => {
    const migrationInfo = {
      channelId: web3.utils.hexToBytes(channelId),
      fromLedgerAddress: web3.utils.hexToBytes(fromLedgerAddress),
      toLedgerAddress: web3.utils.hexToBytes(toLedgerAddress),
      migrationDeadline: migrationDeadline
    }
    const migrationInfoProto = ChannelMigrationInfo.create(migrationInfo);
    const migrationInfoBytes = ChannelMigrationInfo.encode(migrationInfoProto)
      .finish()
      .toJSON().data;

    const sigs = await getAllSignatures({
      messageBytes: migrationInfoBytes,
      signPeers: channelPeers
    });

    let migrationRequest = {
      channelMigrationInfo: migrationInfoBytes,
      sigs: sigs
    }

    const migrationRequestProto = ChannelMigrationRequest.create(migrationRequest);
    return ChannelMigrationRequest.encode(migrationRequestProto)
      .finish()
      .toJSON().data;
  }

  /********** internal API **********/
  // get bytes of PaymentChannelInitializer
  const getPaymentChannelInitializerBytes = ({
    openDeadline,
    disputeTimeout,
    tokenAddress = null,
    tokenType,
    zeroTotalDeposit,
    channelPeers,
    msgValueReceiver
  }) => {
    let token;
    if (tokenType == 1) {  // ETH
      token = {
        tokenType: tokenType
      };
    } else if (tokenType == 2) {  // ERC20
      token = {
        tokenType: tokenType,
        tokenAddress: web3.utils.hexToBytes(tokenAddress)
      };
    }
    const tokenProto = TokenInfo.create(token);

    let initDistributionProto;
    if (zeroTotalDeposit) {
      initDistributionProto = getTokenDistributionProto({
        accounts: channelPeers,
        amounts: [0, 0],
        tokenProto: tokenProto
      });
    } else {
      initDistributionProto = getTokenDistributionProto({
        accounts: channelPeers,
        amounts: [100, 200],
        tokenProto: tokenProto
      });
    }

    const paymentChannelInitializer = {
      initDistribution: initDistributionProto,
      openDeadline: openDeadline,
      disputeTimeout: disputeTimeout,
      msgValueReceiver: msgValueReceiver
    }
    const paymentChannelInitializerProto = PaymentChannelInitializer.create(
      paymentChannelInitializer
    );
    return PaymentChannelInitializer.encode(paymentChannelInitializerProto)
      .finish()
      .toJSON().data;
  }

  // get signatures of both peers on the given message
  const getAllSignatures = async ({ messageBytes, signPeers = peers }) => {
    const messageHash = sha3(
      web3.utils.bytesToHex(messageBytes)
    );

    const signature0 = await calculateSignature(signPeers[0], messageHash);
    const signature1 = await calculateSignature(signPeers[1], messageHash);
    return [signature0, signature1];
  };

  // get proto of TokenTransfer
  const getTokenTransferProto = ({
    account = null,
    amount,
    tokenProto = null
  }) => {
    let accountAmtPair
    if (account != null) {
      accountAmtPair = {
        account: web3.utils.hexToBytes(account),
        amt: uint2bytes(amount)
      };
    } else {
      accountAmtPair = { amt: uint2bytes(amount) };
    }
    const accountAmtPairProto = AccountAmtPair.create(accountAmtPair);

    let tokenTransfer;
    if (tokenProto != null) {
      tokenTransfer = {
        receiver: accountAmtPairProto,
        tokenInfo: tokenProto
      };
    } else {
      tokenTransfer = { receiver: accountAmtPairProto };
    }
    return TokenTransfer.create(tokenTransfer);
  };

  // get array of AccountAmtPair proto
  const getAccountAmtPairs = ({
    accounts,
    amounts,
  }) => {
    accountAmtPair0 = {
      account: web3.utils.hexToBytes(accounts[0]),
      amt: uint2bytes(amounts[0])
    };
    accountAmtPair1 = {
      account: web3.utils.hexToBytes(accounts[1]),
      amt: uint2bytes(amounts[1])
    };

    return [
      AccountAmtPair.create(accountAmtPair0),
      AccountAmtPair.create(accountAmtPair1)
    ];
  }

  // get proto of token distribution
  const getTokenDistributionProto = ({
    accounts,
    amounts,
    tokenProto = null
  }) => {
    const accountAmtPairProtos = getAccountAmtPairs({
      accounts: accounts,
      amounts: amounts
    });

    let initDistribution;
    if (tokenProto != null) {
      initDistribution = {
        token: tokenProto,
        distribution: accountAmtPairProtos
      }
    } else {
      initDistribution = {
        distribution: accountAmtPairProtos
      }
    }

    return TokenDistribution.create(initDistribution);
  }

  // get proto of cosigned non-null SignedSimplexState
  const getCoSignedSimplexStateProto = async ({
    channelId,
    peerFrom,
    seqNum,
    transferAmount,
    pendingPayIds,
    lastPayResolveDeadline,
    totalPendingAmount
  }) => {
    const transferToPeerProto = getTokenTransferProto({
      amount: transferAmount
    });

    const simplexPaymentChannel = {
      channelId: web3.utils.hexToBytes(channelId),
      peerFrom: web3.utils.hexToBytes(peerFrom),
      seqNum: seqNum,
      transferToPeer: transferToPeerProto,
      pendingPayIds: pendingPayIds,
      lastPayResolveDeadline: lastPayResolveDeadline,
      totalPendingAmount: uint2bytes(totalPendingAmount)
    };
    const simplexPaymentChannelProto = SimplexPaymentChannel.create(simplexPaymentChannel);
    const simplexPaymentChannelBytes = SimplexPaymentChannel.encode(simplexPaymentChannelProto)
      .finish()
      .toJSON().data;

    const sigs = await getAllSignatures({ messageBytes: simplexPaymentChannelBytes });

    const signedSimplexState = {
      simplexState: simplexPaymentChannelBytes,
      sigs: sigs
    };
    return SignedSimplexState.create(signedSimplexState);
  };

  // get proto of single-singed null SignedSimplexState
  const getSingleSignedSimplexStateProto = async ({
    channelId,
    signer
  }) => {
    const simplexPaymentChannel = {
      channelId: web3.utils.hexToBytes(channelId),
      seqNum: 0
    };
    const simplexPaymentChannelProto = SimplexPaymentChannel.create(simplexPaymentChannel);
    const simplexPaymentChannelBytes = SimplexPaymentChannel.encode(simplexPaymentChannelProto)
      .finish()
      .toJSON().data;

    const messageHash = sha3(web3.utils.bytesToHex(simplexPaymentChannelBytes));
    const sig = await calculateSignature(signer, messageHash);
    const signedSimplexState = {
      simplexState: simplexPaymentChannelBytes,
      sigs: [sig]
    };
    return SignedSimplexState.create(signedSimplexState);
  };

  // get bytes of ConditionalPay
  const getConditionalPayBytes = ({
    payTimestamp = 1,
    paySrc,
    payDest,
    conditions,
    logicType = 0,
    maxAmount,
    resolveDeadline = 999999,
    resolveTimeout = 5,
    payResolver
  }) => {
    const transferToPeerProto = getTokenTransferProto({
      amount: maxAmount
    });

    const transferFunc = {
      logicType: logicType,
      maxTransfer: transferToPeerProto
    }
    const transferFuncProto = TransferFunction.create(transferFunc);

    const conditionalPay = {
      payTimestamp: payTimestamp,
      src: web3.utils.hexToBytes(paySrc),
      dest: web3.utils.hexToBytes(payDest),
      conditions: conditions,
      transferFunc: transferFuncProto,
      resolveDeadline: resolveDeadline,
      resolveTimeout: resolveTimeout,
      payResolver: web3.utils.hexToBytes(payResolver)
    }
    const conditionalPayProto = ConditionalPay.create(conditionalPay);
    return ConditionalPay.encode(conditionalPayProto)
      .finish()
      .toJSON().data;
  };

  return {
    getOpenChannelRequest,  // async
    getCooperativeWithdrawRequestBytes,  // async
    getSignedSimplexStateArrayBytes,  // async
    getCooperativeSettleRequestBytes,  // async
    getConditionalPayBytes,
    getResolvePayByConditionsRequestBytes,
    getConditions,
    getVouchedCondPayResultBytes,  // async
    getPayIdListInfo,
    getMigrationRequest  // async
  };
};
