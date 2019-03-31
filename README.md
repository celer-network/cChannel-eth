# cChannel-eth (WIP)

[![Build Status](https://travis-ci.org/celer-network/cChannel-eth.svg?branch=master)](https://travis-ci.org/celer-network/cChannel-eth)

* [Overview](https://github.com/celer-network/cChannel-eth#overview)
* [Work In Progress (WIP) Notice](https://github.com/celer-network/cChannel-eth#work-in-progress-wip-notice)
* [Release Features](https://github.com/celer-network/cChannel-eth#release-features)
* [Core Concepts](https://github.com/celer-network/cChannel-eth#core-concepts)
* [Protocol Buffers Usage](https://github.com/celer-network/cChannel-eth#protocol-buffers-usage)
* [Testnet](https://github.com/celer-network/cChannel-eth#testnet)
* [Solidity Version](https://github.com/celer-network/cChannel-eth#solidity-version)
* [Code Structure](https://github.com/celer-network/cChannel-eth#code-structure)
	* [contracts folder](https://github.com/celer-network/cChannel-eth#contracts-folder)
	* [test folder](https://github.com/celer-network/cChannel-eth#test-folder)
* [Test cChannel-eth Locally](https://github.com/celer-network/cChannel-eth#test-cchannel-eth-locally)
* [License](https://github.com/celer-network/cChannel-eth#license)

## Overview
cChannel-eth is a collection of smart contracts acting as the binding of cChannel abstraction and compiles to EVM bytecode. Using these components and primitives, a network of state channels can be built and arbitrary applications with defined counterparties can run in highly scalable fashion without losing the trustless core of blockchain systems.

For more details about cChannel and Celer Network, please refer to [Celer Network's official website](https://www.celer.network/).

## Work In Progress (WIP) Notice
cChannel-eth is currently under active developments in our private repo. This public repo only acts as a showcase of periodically public updates.
**This repo is not intended for production use and please DO NOT use the code in this repo with any real money, funds or assets.**

## Release Features
* **Single-contract Multiple-token Support**: supports multiple Ethereum token standards in different channels under one single contract.
* **ETH Support**: users can specify ETH to open an ETH-based channel.
* **ERC20 Token Support**: users can specify an ERC20 token to open an ERC20-based channel.
* **Generalized State Channel**: resolves conditional state dependency by relying on dependent virtual channels.
* **Fully Duplex Channel**: supports two independent simplex (single-direction) channels in a duplex channel, which makes off-chain communications much simpler and more efficient.
* **Boolean Condition Interface**: defines the condition that returns boolean value.
* **Boolean AND Resolution Logic**: resolves a group of conditions based on a simple boolean AND logic.
* **Boolean OR Resolution Logic**: resolves a group of conditions based on a simple boolean OR logic.
* **ERC20-like ETH wrapper**: provides similar APIs of ERC20 tokens for ETH to enable more efficient onchain operations.
* **Single-transaction Channel Opening**: opens channel with a single on-chain transaction through funds approval for both ETH and ERC20 tokens.
* **Batch Multi-Channel Settlements**: intends to settle multiple channels in one batch with a single on-chain transaction.
* **Batch Multi-Payment Liquidation**: liquidates *N* payments in one batch with a single on-chain transaction using PayHashList, which only requires O(1) on-chain storage and O(*n*/*N*) on-chain verifications to liquidate *n* payments.
* **Cooperative Dynamic Withdraw**: skips challenge period and withdraws fund before channel finalized when both participants reach an agreement.
* **Cooperative Settle**: skips challenge period and settles a channel when both participants reach an agreement.

## Core Concepts
* **Peers**: channel participants (only supports two-peer channel for now).
* **Simplex Channel**: a single-direction payment channel from one peer to another peer.
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
* **PayHashList**: data structure including a list of payment hashes and a hash pointer to next PayHashList, which is used in Batch Multi-Payment Liquidation.
* **EthPool**: A ETH wrapper to provide ERC20-like APIs for ETH.
* **Virtual Address Resolver**: establishes the mapping from off-chain address to on-chain address.

## Protocol Buffers Usage
[Protocol Buffers (protobuf)](https://developers.google.com/protocol-buffers/) are "a language-neutral, platform-neutral extensible mechanism for serializing structured data" developed by Google.
We leverage Protocol Buffers to define a series of blockchain-neutral generalized data structures, which can be seamlessly used in off-chain communication protocols and instantly extended to other blockchains that we plan to support.

We also developed and open sourced a library generator of Solidity for decoding proto3 called [pb3-gen-sol](https://github.com/celer-network/pb3-gen-sol), which is listed in the official [Third-Party Add-ons for Protocol Buffers](https://github.com/protocolbuffers/protobuf/blob/master/docs/third_party.md).

Two proto3 files are used in cChannel-eth, `chain2.proto` and `entity.proto`, which are stored in `lib/data/proto/`. `chain2.proto` defines data structures only used in on-chain contracts ("2" means version 2) while `entity.proto` defines data structures used both in on-chain contracts and off-chain communication protocols.

## Testnet
This version is waiting for deployment.

## Solidity Version
Solidity `^0.5.0` or above is required to run cChannel-eth contracts.

## Code Structure
The following is the main code structure of cChannel-eth:
### contracts folder
* **helper**: assistant contracts during development.
* **lib**: libraries for main contracts.
	* **data**: protobuf library for Solidity and original proto3 files.
	* Some interface contracts.
* **truffle**: truffle related contracts.
* **CelerChannel.sol**: contract of cChannel.
* **EthPool.sol**: an ETH wrapper and deposit pool providing ERC20-like APIs for ETH, which is used in the process of Single-transaction Channel Opening.
* **PayRegistry.sol**: contract of pay registry.
* **VirtContractResolver.sol**: contract of virtual contract resolver.

### test folder
* **channel**: unit test files for cChannel.
* **helper**: assistant modules in unit tests including some modules for generating protobuf objects used in test cases.
* **PayRegistryTest.js**: unit tests for PayRegistry.
* **VirtContractResolverTest.js**: unit tests for Virtual Contract Resolver.

## Test cChannel-eth Locally
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
ganache-cli
</pre>
6. Use truffle to run tests of cChannel-eth contracts. 
<pre>
truffle test
</pre> 

<!-- ## Known Issues -->
<!-- No known issues for now. -->

## License
You can view our [license here](https://github.com/celer-network/cChannel-eth/blob/master/LICENSE).
