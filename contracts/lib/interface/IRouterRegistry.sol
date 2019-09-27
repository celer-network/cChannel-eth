pragma solidity ^0.5.5;


/**
 * @title RouterRegistry interface for routing
 */
interface IRouterRegistry {
    enum RouterOperation { Add, Remove, Refresh }

    function registerRouter() external;

    function deregisterRouter() external;

    function refreshRouter() external;

    event RouterUpdated(RouterOperation indexed op, address indexed routerAddress);
}