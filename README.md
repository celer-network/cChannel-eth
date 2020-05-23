# CelerPay state channel contracts

[![Build Status](https://travis-ci.org/celer-network/cChannel-eth.svg?branch=master)](https://travis-ci.org/celer-network/cChannel-eth)

* [Overview](#overview)
* [Core Concepts](#core-concepts)
* [Release Features](#release-features)
* [Protocol Buffers](#protocol-buffers)
* [Solidity Version](#solidity-version)
* [Code Structure](#code-structure)
* [Test Locally](#test-locally)

## Overview
CelerPay is a generalized payment network that supports efficient off-chain token transfer with the capbability to resolve arbitrary conditional dependency on on-chain verifiable states. This repo implements the CelerPay contracts on Ethereum. It includes a collection of smart contracts acting as the binding of core CelerPay abstractions and supporting modules. CeleryPay smart contracts only specify the interaction logic of two peers. A network of payment channels can be built using these single-hop primitives and protocols.

To learn more about Celer state channel network, please refer to the [CelerCore technical documentation](https://www.celer.network/docs/celercore/channel/overview.html). More specifically, [this page](https://www.celer.network/docs/celercore/channel/pay_contracts.html) gives a detailed description of our smart contract design, structure, and API flows.

## Core Concepts
* **Peers**: channel participants (only supports two-peer channel for now).
* **Simplex Channel**: a single-direction payment channel from one peer to the other peer.
* **Duplex Channel**: a bidirectional payment channel between peers including two independent simplex channels.
* **Simplex State**: a piece of data describing the state of a simplex channel.
* **Signed Simplex State**: Simplex State signed by channel participants, which serves as a bridge data structure between on-chain contracts and off-chain communication protocols.
* **Condition**: data structure representing the basic unit of conditional dependency.
* **Transfer Function**: a higher-level abstraction of generalized state dependencies on a group of conditions.
* **Conditional Payment**: data structure representing a physical payment from payment source to payment destination.
* **Payment Source**: the address sends out a payment, namely the source of this payment route.
* **Payment Destination**: the address receives a payment, namely the destination of this payment route.
* **Vouched Conditional Payment Result**: the result of a conditional payment agreed by the payment source and payment destination.
* **PayRegistry**: a global registry which updates and records all payment results.
* **PayIdList**: data structure including a list of payment ids and a hash pointer to next PayIdList, which is used in Batch Multi-Payment Clearing.
* **EthPool**: A ETH wrapper to provide ERC20-like APIs for ETH.
* **Virtual Address Resolver**: establishes the mapping from off-chain address to on-chain address.

## Release Features
* **Single-contract Multiple-token Support**: supports multiple Ethereum token standards in different channels under one single contract.
* **ETH Support**: users can specify ETH to open an ETH-based channel.
* **ERC20 Token Support**: users can specify an ERC20 token to open an ERC20-based channel.
* **Generalized State Channel**: resolves conditional state dependency by relying on dependent virtual channels.
* **Fully Duplex Channel**: supports two independent simplex (single-direction) channels in a duplex channel, which makes off-chain communications much simpler and more efficient.
* **Boolean Condition Interface**: defines the condition that returns boolean value.
* **Boolean AND Resolution Logic**: resolves a group of conditions based on boolean AND logic.
* **Boolean OR Resolution Logic**: resolves a group of conditions based on boolean OR logic.
* **Numeric Condition Interface**: defines the condition that returns numeric value.
* **Numeric ADD Resolution Logic**: resolves a group of conditions based on numeric ADD logic.
* **Numeric MAX Resolution Logic**: resolves a group of conditions based on numeric MAX logic.
* **Numeric MIN Resolution Logic**: resolves a group of conditions based on numeric MIN logic.
* **ERC20-like ETH wrapper**: provides similar APIs of ERC20 tokens for ETH to enable more efficient onchain operations.
* **Single-transaction Channel Opening**: opens channel with a single on-chain transaction through funds approval for both ETH and ERC20 tokens.
* **Dynamic Withdraw**: withdraws fund before channel finalized as long as no peers disagree during challenge period.
* **Cooperative Dynamic Withdraw**: skips challenge period and withdraws fund before channel finalized when both peers reach an agreement.
* **Lightweight cooperative on-chain checkpoint**: support snapshotting transfer map of co-signed states on-chain.
* **Batch Multi-Channel Settlements**: intends to settle multiple channels in one batch with a single on-chain transaction.
* **Batch Multi-Payment Clearing**: clears *N* payments in one batch with a single on-chain transaction using PayIdList, which only requires O(1) on-chain storage and O(*n*/*N*) on-chain verifications to clear *n* payments.
* **Cooperative Settle**: skips challenge period and settles a channel when both peers reach an agreement.

## Protocol Buffers
[Protocol Buffers (protobuf)](https://developers.google.com/protocol-buffers/) are "a language-neutral, platform-neutral extensible mechanism for serializing structured data" developed by Google.
We leverage Protocol Buffers to define a series of blockchain-neutral generalized data structures, which can be seamlessly used in off-chain communication protocols and instantly extended to other blockchains that we will support.

We have also developed and open sourced a Solidity library generator of proto3 decoders called [pb3-gen-sol](https://github.com/celer-network/pb3-gen-sol), which is listed in protobuf's official [Third-Party Add-ons for Protocol Buffers](https://github.com/protocolbuffers/protobuf/blob/master/docs/third_party.md).

Two proto3 files are used in cChannel-eth, `chain.proto` and `entity.proto`, which are stored in `lib/data/proto/`. `chain.proto` defines data structures only used in on-chain contracts, while `entity.proto` defines data structures used both in on-chain contracts and off-chain communication protocols.

## Solidity Version
Solidity `^0.5.1` or above is required to run cChannel-eth contracts.

## Code Structure
The following is the main code structure of cChannel-eth:
### contracts folder
* **helper**: assistant contracts during development.
* **lib**: libraries for main contracts.
	* **data**: protobuf library for Solidity and original proto3 files.
	* Some interface contracts.
* **truffle**: truffle related contracts.
* **CelerLedger.sol**: contract of CelerLedger.
* **CelerWallet.sol**: contract of CelerWallet.
* **EthPool.sol**: an ETH wrapper and deposit pool providing ERC20-like APIs for ETH, which is used in the process of Single-transaction Channel Opening.
* **PayRegistry.sol**: contract of pay registry.
* **VirtContractResolver.sol**: contract of virtual contract resolver.

### test folder
* **channel**: unit test files for cChannel.
* **gas_measurement**: fine-granularity gas measurements for contract deployments and function calls.
* **helper**: assistant modules in unit tests including some modules for generating protobuf objects used in test cases.
* **EthPoolTest.js**: unit tests for EthPool.
* **PayRegistryTest.js**: unit tests for PayRegistry.
* **VirtContractResolverTest.js**: unit tests for Virtual Contract Resolver.

## Test Locally
1. Install node v10: [https://nodejs.org](https://nodejs.org).
2. Go to cChannel-eth's root directory. 
3. Install the node dependencies in the local node_modules folder. 
<pre>
npm install
</pre> 
4. Install truffle and ganache-cli (`sudo` permission might be needed). 
<pre>
npm install -g truffle ganache-cli
</pre> 
5. Run ganache-cli
<pre>
ganache-cli -l 8000000
</pre>
6. Use truffle to run tests of cChannel-eth contracts. 
<pre>
truffle test
</pre>