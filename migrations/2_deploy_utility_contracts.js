var VirtContractResolver = artifacts.require("VirtContractResolver");
var HTLRegistry = artifacts.require("HTLRegistry");
var DepositPool = artifacts.require("DepositPool");
var GenericConditionalChannel = artifacts.require("GenericConditionalChannel");
var ERC20ExampleToken = artifacts.require("ERC20ExampleToken");

module.exports = function(deployer) {
  deployer.deploy(HTLRegistry);
  deployer.deploy(DepositPool);
  deployer.deploy(VirtContractResolver).then(function() {
    deployer.deploy(DepositPool).then(function () {
      deployer.deploy(
        GenericConditionalChannel, 0, VirtContractResolver.address, DepositPool.address
      );
    });
  });

  deployer.deploy(ERC20ExampleToken);
};
