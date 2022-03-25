// SPDX-License-Identifier: AGPL-3.0-only

pragma solidity ^0.8.10;

import { ISuperfluid } from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import { ISuperToken } from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperToken.sol";
import { IConstantFlowAgreementV1 } from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";
import { CFAv1Library } from "@superfluid-finance/ethereum-contracts/contracts/apps/CFAv1Library.sol";
import { Errors } from "../../libraries/Errors.sol";
import { Events } from "../../libraries/Events.sol";
import { IModuleGlobals } from "../../interfaces/IModuleGlobals.sol";

/**
 * @title SuperfluidModuleBase
 * @author Wary
 *
 * @notice This is an abstract contract to be inherited from by modules that require some Superfluid protocol functionality.
 */
abstract contract SuperfluidModuleBase {
    using CFAv1Library for CFAv1Library.InitData;

    CFAv1Library.InitData public cfaV1;
    uint16 internal constant BPS_MAX = 10000;
    address public immutable MODULE_GLOBALS;

    constructor(address moduleGlobals, address superfluidHost) {
        if (moduleGlobals == address(0) || superfluidHost == address(0)) revert Errors.InitParamsInvalid();
        MODULE_GLOBALS = moduleGlobals;
        cfaV1 = CFAv1Library.InitData(
            ISuperfluid(superfluidHost),
            IConstantFlowAgreementV1(
                address(ISuperfluid(superfluidHost).getAgreementClass(
                    keccak256("org.superfluid-finance.agreements.ConstantFlowAgreement.v1")
                ))
            )
        );
        emit Events.SuperfluidModuleBaseConstructed(moduleGlobals, superfluidHost, block.timestamp);
    }

    function _currencyWhitelisted(address currency) internal view returns (bool) {
        return IModuleGlobals(MODULE_GLOBALS).isCurrencyWhitelisted(currency);
    }

    function _validateDataIsExpected(
        bytes calldata data,
        address currency,
        uint256 amount
    ) internal pure {
        (address decodedCurrency, uint256 decodedAmount) = abi.decode(data, (address, uint256));
        if (decodedAmount != amount || decodedCurrency != currency)
            revert Errors.ModuleDataMismatch();
    }

    function _treasuryData() internal view returns (address, uint16) {
        return IModuleGlobals(MODULE_GLOBALS).getTreasuryData();
    }

    function _validateFlow(
        address currency,
        address sender,
        address recipient,
        uint96 flowRate,
        uint256 timestamp
    ) internal view {
        (uint256 lastUpdatedAt, int96 currentFlowRate,,) = cfaV1.cfa.getFlow(ISuperToken(currency), sender, recipient);
        if (
            currentFlowRate != int96(flowRate) ||
            timestamp != 0 && lastUpdatedAt > timestamp
        )
            revert Errors.CFAInvalid();
    }
}
