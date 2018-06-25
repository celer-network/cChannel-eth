const HDWalletProvider = require('truffle-hdwallet-provider');
const mnemonic =
  'daksljd adsjlasd laksjdlsajldjsa dlksaj';

module.exports = {
  networks: {
    development: {
      host: '127.0.0.1',
      port: 8545,
      gas: 6500000,
      network_id: "*" // match any network
    },
    ropsten: {
      provider: function() {
        return new HDWalletProvider(
          mnemonic,
          'https://ropsten.infura.io/pEz7xYXTUP5N0beMfIW0'
        );
      },
      network_id: 3,
      gas: 4600000
    }
  },
  solc: { optimizer: { enabled: true, runs: 200 } }
};
