# cChannel-eth (WIP)

[![Build Status](https://travis-ci.com/celer-network/cChannel-eth.svg?token=367o3XxBHVpEHCQyniUK&branch=master)](https://travis-ci.com/celer-network/cChannel-eth)

## Overview
cChannel-eth is a collection of smart contracts acting as the binding of cChannel abstraction and compiles to EVM bytecode. Using these components and primitives, a network of state channels can be built and arbitrary applications with defined counterparties can run in highly scalable fashion without losing the trustless core of blockchain systems.

For more detailed specification, please refer to [cChannel Generalized State Channel Specification](https://www.celer.network/doc/cChannel_spec.pdf). 
For the full white paper about Celer Network, please refer to [Celer Network Whitepaper](https://www.celer.network/doc/CelerNetwork-Whitepaper.pdf).

## WIP Note
cChannel-eth, including cChannel for other blockchains, is currently under active development in our private repos. This public repo only acts as a showcase of periodically public updates.

## Release Features
* **Single-contract Multiple-token Support:** supports multiple Ethereum token standards in different channels under one single contract.
* **Ether Support:** users can specify ETH to create an Ether-based channel.
* **ERC20 Token Support:** users can specify an ERC20 token to create an ERC20-based channel.
* **Generalized State Channel:** resolves conditional state dependency by relying on dependent virtual channels.
* **Boolean Condition Interface:** defines the condition that returns boolean value.
* **Value Assignment Condition Interface:** defines the condition that returns value assignment.
* **Boolean AND Resolution Logic:** resolves ConditionGroup based on a simple boolean AND logic.
* **Boolean Circuit:** resolves ConditionGroup based on a boolean circuit logic.
* **Single-transaction Channel Opening:** opens channel with a single on-chain transaction through authorized withdrawal message.
* **Dynamic Withdraw:** withdraws fund before channel finalized as long as no participants disagree during challenge period.
* **Cooperative Dynamic Withdraw:** skips challenge period and withdraws fund before channel finalized when all participants reach an agreement.
* **Cooperative Settle:** skips challenge period and settles a channel when all participants reach an agreement.

## Core Concepts
* **Peers:** channel participants.
* **State:** a piece of data stored in the channel agreed by channel participants.
* **State Proof:** serves as a bridge data structure between on-chain contracts and off-chain communication protocols.
* **Condition:** data structure representing the basic unit of conditional dependency.
* **Condition Group:** a higher-level abstraction for a group of conditions to express generalized state dependencies.
* **Off-chain Address Translator:** establishes the mapping from off-chain address to on-chain address.

## Testnet
Wait for deploy.

## Solidity Version
Solidity `^0.4.22` or above is required to run cChannel-eth contracts.

## Code Structure
The following is the main code structure of cChannel-eth:
### contracts folder
* **helper**: assistant contracts during development, currently including an ERC20 example token contract.
* **lib**: libraries for main contracts.
	* **data**: protobuf library for solidity.
	* **external**: external libraries, currently including openzeppelin-solidity.
	* Some interface contracts.
* **DepositPool.sol**: a wallet-like contract used in the process of Single-transaction Channel Opening.
* **GenericChannel.sol**: contract of Generic Conditional Channel.
* **HTLRegistry.sol**: contract of hash time lock registry.
* **VirtContractResolver.sol**: contract of virtual contract resolver.

### test folder
* **helper**: assistant modules in unit tests including some modules for generating protobuf objects used in test cases.
* **mocks**: currently including boolean condition mock contract.
* Unit test files for corresponding contracts in contracts folder.

## Test cChannel-eth Locally
1. Install node v8.9 or above: [https://nodejs.org]().
2. Install Docker CE 18.03.1-ce or above: [https://www.docker.com/community-edition]().
3. Go to cChannel-eth's root directory. 
4. Install the node dependencies in the local node_modules folder. 
<pre>
npm install
</pre> 
5. Install truffle (`sudo` permission might be needed). 
<pre>
npm install -g truffle
</pre> 
6. Setup a PoA private net. A detailed instruction is available at [https://github.com/cpurta/geth-devnet](), or you can simply use the following commands (`sudo` permissions might be needed). 
<pre>
docker build --build-arg DEV_CHAIN=true -f Dockerfile -t geth-devnet https://github.com/cpurta/geth-devnet.git
docker run -d -p 8545:8545 geth-devnet
sleep 30 # to make sure docker container is ready before compiling
</pre>
7. Use truffle to compile, migrate and test cChannel-eth contracts. 
<pre>
truffle compile
truffle migration
truffle test
</pre> 

## Known Issues
* The current version of truffle doesn’t support function overloading. This release uses different names for deposit functions for now and waits for support of future truffle version.
* Contract cannot work correctly on ethereumjs-vm due to js vm bug on opcode.
* Function `authOpenChannel()` only supports ETH deposit for now.

## License
You can view our [license here](https://github.com/celer-network/cChannel-eth/blob/master/LICENSE).
