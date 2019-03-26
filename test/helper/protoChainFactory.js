const Web3 = require('web3');
const web3 = new Web3(new Web3.providers.HttpProvider('http://localhost:8545'));
const sha3 = web3.utils.keccak256;

const protoChainLoader = require('./protoChainLoader');

const BooleanCondMock = artifacts.require('BooleanCondMock');

// calculate the signature of given address on given hash
const calculateSignature = async (address, hash) => {
  const sigHex = await web3.eth.sign(hash, address);
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
    PayHashList
  } = protoChain;

  /********** constant vars **********/
  const booleanCondMock = await BooleanCondMock.new();
  const conditionDeployedFalse = {
    conditionType: 1,
    deployedContractAddress: web3.utils.hexToBytes(booleanCondMock.address),
    argsQueryResult: [0]
  };

  const conditionDeployedTrue = {
    conditionType: 1,
    deployedContractAddress: web3.utils.hexToBytes(booleanCondMock.address),
    argsQueryResult: [1]
  };

  const conditionHashLock = {
    conditionType: 0,
    hashLock: web3.utils.hexToBytes(sha3(web3.utils.hexToBytes('0x123456')))
  }

  // TODO: add VIRTUAL_CONTRACT conditions and tests

  /********** external API **********/
  // get the list of PayHashList bytes and the list of PayBytes array in a simplex state
  const getPayHashListInfo = ({
    payAmounts  // from head to tail
  }) => {
    // 1-d array of PayHashList proto
    let payHashListProtos = [];
    // 1-d array of PayHashList bytes, for liquidating pays with CelerChannel
    let payHashListBytesArray = [];
    // 2-d array of pay bytes in list of PayHashList of a simplex channel, 
    // for resolving pays with PayRegistry.
    // Index is consistent with payAmounts.
    let payBytesArray = [];

    for (i = 0; i < payAmounts.length; i++) {
      payBytesArray[i] = []
    }

    for (i = payAmounts.length - 1; i >= 0; i--) {
      let payHashes = [];
      for (j = 0; j < payAmounts[i].length; j++) {
        payBytesArray[i][j] = getConditionalPayBytes({
          payTimestamp: Math.floor(Math.random() * 10000000000),
          paySrc: clients[i],
          payDest: clients[1-i],
          conditions: [Condition.create(conditionDeployedTrue)],
          maxAmount: payAmounts[i][j]
        });
        payHashes[j] = web3.utils.hexToBytes(sha3(payBytesArray[i][j]));
      }

      // assemble PayHashList
      let payHashList;
      if (i == payAmounts.length - 1) {
        payHashList = { payHashes: payHashes };
      } else {
        payHashList = {
          payHashes: payHashes,
          nextListHash: web3.utils.hexToBytes(sha3(payHashListBytesArray[i+1]))
        }
      }
      payHashListProtos[i] = PayHashList.create(payHashList);
      payHashListBytesArray[i] = PayHashList.encode(payHashListProtos[i])
        .finish()
        .toJSON().data;        
    }
    return {
      payHashListProtos: payHashListProtos,
      payBytesArray: payBytesArray,
      payHashListBytesArray: payHashListBytesArray,
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
      amount: [amount]
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

  // get array of condition protos
  const getConditions = ({
    type
  }) => {
    switch (type) {
      case 0:  // [conditionDeployedFalse, conditionHashLock]
        return [
          Condition.create(conditionDeployedFalse), 
          Condition.create(conditionHashLock)
        ];
      case 1:  // [conditionDeployedTrue, conditionHashLock]
        return [
          Condition.create(conditionDeployedTrue), 
          Condition.create(conditionHashLock)
        ];
    }
  }

  // get bytes of OpenChannelRequest
  const getOpenChannelRequest = async ({ 
    CelerChannelAddress,
    openDeadline = 999999, 
    settleTimeout = 10, 
    tokenAddress = null,
    tokenType = 1, 
    zeroTotalDeposit = false,
    channelPeers = peers,
    msgValueRecipient = 0
  }) => {
    let paymentChannelInitializerBytes;
    if (tokenType == 1) {  // ETH
      paymentChannelInitializerBytes = getPaymentChannelInitializerBytes({
        openDeadline: openDeadline,
        settleTimeout: settleTimeout,
        tokenType: tokenType,
        zeroTotalDeposit: zeroTotalDeposit,
        channelPeers: channelPeers,
        msgValueRecipient: msgValueRecipient
      });
    } else if (tokenType == 2) {  // ERC20
      paymentChannelInitializerBytes = getPaymentChannelInitializerBytes({
        openDeadline: openDeadline, 
        settleTimeout: settleTimeout,
        tokenAddress: tokenAddress, 
        tokenType: tokenType,
        zeroTotalDeposit: zeroTotalDeposit,
        channelPeers: channelPeers,
        msgValueRecipient: msgValueRecipient
      });
    }

    // calculate channelId
    const hash = sha3(
      paymentChannelInitializerBytes.concat(web3.utils.hexToBytes(CelerChannelAddress))
    );
    const channelId = parseInt(hash.substring(hash.length-16), 16);

    let openChannelRequest;
    if (zeroTotalDeposit) {
      openChannelRequest = {
        channelInitializer: paymentChannelInitializerBytes,
      }
    } else {
      const sigs = await getAllSignatures({messageBytes: paymentChannelInitializerBytes});
  
      openChannelRequest = {
        channelInitializer: paymentChannelInitializerBytes,
        sigs: sigs
      }
    }
    const openChannelRequestProto = OpenChannelRequest.create(openChannelRequest);
    const openChannelRequestBytes = OpenChannelRequest.encode(openChannelRequestProto)
      .finish()
      .toJSON().data;

    return {
      openChannelRequestBytes: openChannelRequestBytes,
      channelId: channelId
    }
  }

  // get bytes of CooperativeWithdrawRequest
  const getCooperativeWithdrawRequestBytes = async ({ 
    channelId = 1,
    seqNum = 1,
    amount = 5,
    receiverAccount = peers[0],
    withdrawDeadline = 9999999
  }) => {
    const withdraw = {
      account: web3.utils.hexToBytes(receiverAccount),
      amt: [amount]
    };
    const withdrawProto = AccountAmtPair.create(withdraw);

    const withdrawInfo = {
      channelId: channelId,
      seqNum: seqNum,
      withdraw: withdrawProto,
      withdrawDeadline: withdrawDeadline
    };
    const withdrawInfoProto = CooperativeWithdrawInfo.create(withdrawInfo);
    const withdrawInfoBytes = CooperativeWithdrawInfo.encode(withdrawInfoProto)
      .finish()
      .toJSON().data;

    const sigs = await getAllSignatures({messageBytes: withdrawInfoBytes});

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
    payHashLists = null,
    peerFroms = peers,
    // for single-signed null state
    signers = null
  }) => {
    let signedSimplexStateProtos = [];
    for (i = 0; i < channelIds.length; i++) {
      if (seqNums[i] > 0) {  // cosigned non-null state
        signedSimplexStateProtos[i] = await getCoSignedSimplexStateProto({
          channelId: channelIds[i],
          peerFrom: peerFroms[i],
          seqNum: seqNums[i],
          transferAmount: transferAmounts[i],
          pendingPayHashes: payHashLists[i],
          lastPayResolveDeadline: lastPayResolveDeadlines[i]
        });
      } else if (seqNums[i] == 0) {  // single-signed null state
        signedSimplexStateProtos[i] = await getSingleSignedSimplexStateProto({
          channelId: channelIds[i],
          signer: signers[i]
        });
      }
    }
    
    const signedSimplexStateArray = {signedSimplexStates: signedSimplexStateProtos};
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
      channelId: channelId,
      seqNum: seqNum,
      settleBalance: settleBalance,
      settleDeadline: settleDeadline
    };
    const cooperativeSettleInfoProto = CooperativeSettleInfo.create(cooperativeSettleInfo);
    const cooperativeSettleInfoBytes = CooperativeSettleInfo.encode(cooperativeSettleInfoProto)
      .finish()
      .toJSON().data;

    const sigs = await getAllSignatures({messageBytes: cooperativeSettleInfoBytes});

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

  /********** internal API **********/
  // get bytes of PaymentChannelInitializer
  const getPaymentChannelInitializerBytes = ({ 
    openDeadline, 
    settleTimeout, 
    tokenAddress = null, 
    tokenType, 
    zeroTotalDeposit,
    channelPeers,
    msgValueRecipient
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
      settleTimeout: settleTimeout,
      msgValueRecipient: msgValueRecipient
    }
    const paymentChannelInitializerProto = PaymentChannelInitializer.create(
      paymentChannelInitializer
    );
    return PaymentChannelInitializer.encode(paymentChannelInitializerProto)
      .finish()
      .toJSON().data;
  }

  // get signatures of both peers on the given message
  const getAllSignatures = async ({ messageBytes }) => {
    const messageHash = sha3(
      web3.utils.bytesToHex(messageBytes)
    );

    const signature0 = await calculateSignature(peers[0], messageHash);
    const signature1 = await calculateSignature(peers[1], messageHash);
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
        amt: [amount]
      };
    } else {
      accountAmtPair = {amt: [amount]};      
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
      amt: [amounts[0]]
    };
    accountAmtPair1 = {
      account: web3.utils.hexToBytes(accounts[1]),
      amt: [amounts[1]]
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
    pendingPayHashes,
    lastPayResolveDeadline
  }) => {
    const transferToPeerProto = getTokenTransferProto({
      amount: transferAmount
    });

    const simplexPaymentChannel = {
      channelId: channelId,
      peerFrom: web3.utils.hexToBytes(peerFrom),
      seqNum: seqNum,
      transferToPeer: transferToPeerProto,
      pendingPayHashes: pendingPayHashes,
      lastPayResolveDeadline: lastPayResolveDeadline
    };
    const simplexPaymentChannelProto = SimplexPaymentChannel.create(simplexPaymentChannel);
    const simplexPaymentChannelBytes = SimplexPaymentChannel.encode(simplexPaymentChannelProto)
      .finish()
      .toJSON().data;

    const sigs = await getAllSignatures({messageBytes: simplexPaymentChannelBytes});

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
      channelId: channelId,
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
    resolveTimeout = 5
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
      resolveTimeout: resolveTimeout
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
    getPayHashListInfo
  };
};
