pragma solidity ^0.5.1;

import "./LedgerOperation.sol";
import "./LedgerChannel.sol";
import "./LedgerStruct.sol";
import "../interface/ICelerLedger.sol";
import "../data/PbChain.sol";
import "../data/PbEntity.sol";

/**
 * @title Ledger Migrate Library
 * @notice CelerLedger library about channel migration
 */
library LedgerMigrate {
    using LedgerChannel for LedgerStruct.Channel;
    using LedgerOperation for LedgerStruct.Ledger;

    /**
     * @notice Migrate a channel from this CelerLedger to a new CelerLedger
     * @param _self storage data of CelerLedger contract
     * @param _migrationRequest bytes of migration request message
     * @return migrated channel id
     */
    function migrateChannelTo(
        LedgerStruct.Ledger storage _self,
        bytes calldata _migrationRequest
    )
        external returns(bytes32) 
    {
        PbChain.ChannelMigrationRequest memory migrationRequest = 
            PbChain.decChannelMigrationRequest(_migrationRequest);
        PbEntity.ChannelMigrationInfo memory migrationInfo = 
            PbEntity.decChannelMigrationInfo(migrationRequest.channelMigrationInfo);
        bytes32 channelId = migrationInfo.channelId;
        LedgerStruct.Channel storage c = _self.channelMap[channelId];
        address toLedgerAddr = migrationInfo.toLedgerAddress;

        require(
            c.status == LedgerStruct.ChannelStatus.Operable ||
            c.status == LedgerStruct.ChannelStatus.Settling
        );
        bytes32 h = keccak256(migrationRequest.channelMigrationInfo);
        // use Channel Library instead
        require(c._checkCoSignatures(h, migrationRequest.sigs), "Check co-sigs failed");
        require(migrationInfo.fromLedgerAddress == address(this), "From ledger address is not this");
        require(toLedgerAddr == msg.sender, "To ledger address is not msg.sender");
        require(block.number <= migrationInfo.migrationDeadline, "Passed migration deadline");

        _self._updateChannelStatus(c, LedgerStruct.ChannelStatus.Migrated);
        c.migratedTo = toLedgerAddr;
        emit MigrateChannelTo(channelId, toLedgerAddr);

        _self.celerWallet.transferOperatorship(channelId, toLedgerAddr);

        return channelId;
    }

    /**
     * @notice Migrate a channel from an old CelerLedger to this CelerLedger
     * @param _self storage data of CelerLedger contract
     * @param _fromLedgerAddr the old ledger address to migrate from
     * @param _migrationRequest bytes of migration request message
     */
    // TODO: think about future multi versions upgrade (if-else branch for addr and import libs as mini-v1, mini-v2, mini-v3,
    //       otherwise, only one interface can be used because all interfaces share the same name.)
    function migrateChannelFrom(
        LedgerStruct.Ledger storage _self,
        address _fromLedgerAddr,
        bytes calldata _migrationRequest
    )
        external
    {
        // TODO: latest version of openzeppelin Address.sol provide this api toPayable()
        address payable fromLedgerAddrPayable = address(uint160(_fromLedgerAddr));
        bytes32 channelId = ICelerLedger(fromLedgerAddrPayable).migrateChannelTo(_migrationRequest);
        LedgerStruct.Channel storage c = _self.channelMap[channelId];
        require(c.status == LedgerStruct.ChannelStatus.Uninitialized, "Immigrated channel already exists");
        require(
            _self.celerWallet.getOperator(channelId) == address(this),
            "Operatorship not transferred"
        );

        _self._updateChannelStatus(c, LedgerStruct.ChannelStatus.Operable);
        c._importChannelMigrationArgs(fromLedgerAddrPayable, channelId);
        c._importPeersMigrationInfo(fromLedgerAddrPayable, channelId);

        emit MigrateChannelFrom(channelId, _fromLedgerAddr);
    }
    
    event MigrateChannelTo(bytes32 indexed channelId, address indexed newLedgerAddr);
    
    event MigrateChannelFrom(bytes32 indexed channelId, address indexed oldLedgerAddr);
}
