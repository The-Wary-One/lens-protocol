// SPDX-License-Identifier: AGPLv3
pragma solidity ^0.8.10;

import { IConstantFlowAgreementV1 } from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IFollowModule } from "../../../interfaces/IFollowModule.sol";
import { ILensHub}  from "../../../interfaces/ILensHub.sol";
import { Errors } from "../../../libraries/Errors.sol";
import { ModuleBase } from "../ModuleBase.sol";
import { SuperfluidModuleBase } from "../SuperfluidModuleBase.sol";
import { FollowValidatorFollowModuleBase } from "./FollowValidatorFollowModuleBase.sol";

/**
 * @notice A struct containing the necessary data to execute follow actions on a given profile.
 *
 * @param recipient The recipient address associated with this profile.
 * @param currency The SuperToken associated with this profile.
 * @param amount The following cost associated with this profile.
 * @param flowRate The Constant Flow Agreement flow rate associated with this profile.
 */
struct ProfileData {
    address recipient;
    address currency;
    uint256 amount;
    uint96 flowRate;
}

/**
 * @title SuperfluidFollowModule
 * @author Wary
 *
 * @notice This module only allows addresses that pay the fee and with an open Superfluid money stream to follow
 */
contract SuperfluidCFAFollowModule is
    IFollowModule,
    ModuleBase,
    SuperfluidModuleBase
{
    using SafeERC20 for IERC20;

    mapping(uint256 => ProfileData) internal _dataByProfile;
    mapping(uint256 => mapping(address => uint256)) internal _followedAt; // profileId => follower => timestamp

    constructor(address hub, address moduleGlobals, address superfluidHost) SuperfluidModuleBase(moduleGlobals, superfluidHost) ModuleBase(hub) {}

    /**
     * @notice This follow module levies a fee on follows and checks if a Superfluid constant agreement flow is created from sender to recipient.
     *
     * @param data The arbitrary data parameter, decoded into:
     *      address recipient: The custom recipient address to direct earnings to.
     *      address currency: The currency address, must be internally whitelisted.
     *      uint256 amount: The currency total amount to levy.
     *      uint96 flowRate: The Superfluid constant flow agreement flow rate.
     *
     * @return An abi encoded bytes parameter, which is the same as the passed data parameter.
     */
    function initializeFollowModule(uint256 profileId, bytes calldata data)
        external
        override
        onlyHub
        returns (bytes memory)
    {
        (address recipient, address currency, uint256 amount, uint96 flowRate) = abi.decode(
            data,
            (address, address, uint256, uint96)
        );
        if (recipient == address(0) || !_currencyWhitelisted(currency) || flowRate == 0)
            revert Errors.InitParamsInvalid();

        _dataByProfile[profileId].recipient = recipient;
        _dataByProfile[profileId].currency = currency;
        _dataByProfile[profileId].amount = amount;
        _dataByProfile[profileId].flowRate = flowRate;
        return data;
    }

    /**
     * @dev Processes a follow by:
     *  1. Checking if the follower was already following
     *  2. Charging a fee
     *  3. Checking if a Superfluid constant flow agreement exists between sender and recipient with the correct flowRate
     */
    function processFollow(
        address follower,
        uint256 profileId,
        bytes calldata data
    ) external override onlyHub {
        address followNFT = ILensHub(HUB).getFollowNFT(profileId);
        if (followNFT == address(0)) revert Errors.FollowInvalid();
        // check that follower owns a followNFT
        // ⚠ LensHub mints a follow nft BEFORE calling processFollow()
        if (IERC721(followNFT).balanceOf(follower) > 1) revert Errors.FollowInvalid();

        address currency = _dataByProfile[profileId].currency;
        uint256 amount = _dataByProfile[profileId].amount;
        _validateDataIsExpected(data, currency, amount);

        (address treasury, uint16 treasuryFee) = _treasuryData();
        address recipient = _dataByProfile[profileId].recipient;
        uint256 treasuryAmount = (amount * treasuryFee) / BPS_MAX;
        uint256 adjustedAmount = amount - treasuryAmount;

        IERC20(currency).safeTransferFrom(follower, recipient, adjustedAmount);
        IERC20(currency).safeTransferFrom(follower, treasury, treasuryAmount);

        uint96 flowRate = _dataByProfile[profileId].flowRate;
        _validateFlow(currency, follower, recipient, flowRate, 0);
        // We must store this timestamp to later verify the subscriber did not update their flow
        _followedAt[profileId][follower] = block.timestamp;
    }

    /**
     * @dev Adapted from FollowValidatorFollowModuleBase.validateFollow to also check the subscriber did not update their stream since they followed.
     */
    function validateFollow(
        uint256 profileId,
        address follower,
        uint256 followNFTTokenId
    ) external view override {
        address followNFT = ILensHub(HUB).getFollowNFT(profileId);
        if (followNFT == address(0)) revert Errors.FollowInvalid();
        if (followNFTTokenId == 0) {
            // check that follower owns a followNFT
            if (IERC721(followNFT).balanceOf(follower) == 0) revert Errors.FollowInvalid();
        } else {
            // check that follower owns the specific followNFT
            if (IERC721(followNFT).ownerOf(followNFTTokenId) != follower)
                revert Errors.FollowInvalid();
        }
        // check that follower's flow
        address currency = _dataByProfile[profileId].currency;
        address recipient = _dataByProfile[profileId].recipient;
        uint96 flowRate = _dataByProfile[profileId].flowRate;
        uint256 followedAt = _followedAt[profileId][follower];
        _validateFlow(currency, follower, recipient, flowRate, followedAt);
    }

    /**
     * @dev We don't need to execute any additional logic on transfers in this follow module.
     */
    function followModuleTransferHook(
        uint256 profileId,
        address from,
        address to,
        uint256 followNFTTokenId
    ) external override {}

    /**
     * @notice Returns the profile data for a given profile, or an empty struct if that profile was not initialized
     * with this module.
     *
     * @param profileId The token ID of the profile to query.
     *
     * @return The ProfileData struct mapped to that profile.
     */
    function getProfileData(uint256 profileId) external view returns (ProfileData memory) {
        return _dataByProfile[profileId];
    }
}
