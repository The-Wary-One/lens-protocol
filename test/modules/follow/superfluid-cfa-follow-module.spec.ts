import { BigNumber } from '@ethersproject/bignumber';
import { parseEther } from '@ethersproject/units';
import '@nomiclabs/hardhat-ethers';
import { expect, config } from 'chai';
import { ethers, web3 } from 'hardhat';
import { Currency } from '../../../typechain-types';
import { MAX_UINT256, ZERO_ADDRESS } from '../../helpers/constants';
import { ERRORS } from '../../helpers/errors';
import { getTimestamp, matchEvent, waitForTx } from '../../helpers/utils';
import currencyABI from '../../../artifacts/contracts/mocks/Currency.sol/Currency.json';
import {
  abiCoder,
  BPS_MAX,
  fDAI,
  fDAIx,
  superfluidCFAFollowModule,
  FIRST_PROFILE_ID,
  governance,
  lensHub,
  lensHubImpl,
  makeSuiteCleanRoom,
  MOCK_FOLLOW_NFT_URI,
  MOCK_PROFILE_HANDLE,
  MOCK_PROFILE_URI,
  moduleGlobals,
  treasuryAddress,
  TREASURY_FEE_BPS,
  userAddress,
  userTwo,
  userTwoAddress,
  sf,
  deployerAddress,
  deployTestToken,
  deploySuperToken,
  errorHandler,
  deployer,
  CURRENCY_MINT_AMOUNT,
} from '../../__setup.spec';

config.includeStack = true;

makeSuiteCleanRoom('Superfluid CFA Follow Module', function () {
  const DEFAULT_FOLLOW_PRICE = parseEther('10');
  const DEFAULT_FOLLOW_FLOW_RATE = DEFAULT_FOLLOW_PRICE.div(1 * 30 * 24 * 60 * 60); // Flow rate per seconds

  beforeEach(async function () {
    await expect(
      lensHub.connect(governance).whitelistFollowModule(superfluidCFAFollowModule.address, true)
    ).to.not.be.reverted;
    await expect(
      moduleGlobals.connect(governance).whitelistCurrency(fDAIx.address, true)
    ).to.not.be.reverted;
  });

  context('Negatives', function () {
    context('Initialization', function () {
      it('user should fail to create a profile with superfluid cfa follow module using unwhitelisted currency', async function () {
        const followModuleData = abiCoder.encode(
          ['address', 'address', 'uint256', 'uint96'],
          [userAddress, userTwoAddress, DEFAULT_FOLLOW_PRICE, DEFAULT_FOLLOW_FLOW_RATE]
        );

        await expect(
          lensHub.createProfile({
            to: userAddress,
            handle: MOCK_PROFILE_HANDLE,
            imageURI: MOCK_PROFILE_URI,
            followModule: superfluidCFAFollowModule.address,
            followModuleData: followModuleData,
            followNFTURI: MOCK_FOLLOW_NFT_URI,
          })
        ).to.be.revertedWith(ERRORS.INIT_PARAMS_INVALID);
      });

      it('user should fail to create a profile with superfluid cfa follow module using zero recipient', async function () {
        const followModuleData = abiCoder.encode(
          ['address', 'address', 'uint256', 'uint96'],
          [ZERO_ADDRESS, fDAIx.address, DEFAULT_FOLLOW_PRICE, DEFAULT_FOLLOW_FLOW_RATE]
        );

        await expect(
          lensHub.createProfile({
            to: userAddress,
            handle: MOCK_PROFILE_HANDLE,
            imageURI: MOCK_PROFILE_URI,
            followModule: superfluidCFAFollowModule.address,
            followModuleData: followModuleData,
            followNFTURI: MOCK_FOLLOW_NFT_URI,
          })
        ).to.be.revertedWith(ERRORS.INIT_PARAMS_INVALID);
      });

      it('user should fail to create a profile with superfluid cfa follow module using zero flow rate', async function () {
        const followModuleData = abiCoder.encode(
          ['address', 'address', 'uint256', 'uint96'],
          [userAddress, fDAIx.address, DEFAULT_FOLLOW_PRICE, 0]
        );

        await expect(
          lensHub.createProfile({
            to: userAddress,
            handle: MOCK_PROFILE_HANDLE,
            imageURI: MOCK_PROFILE_URI,
            followModule: superfluidCFAFollowModule.address,
            followModuleData: followModuleData,
            followNFTURI: MOCK_FOLLOW_NFT_URI,
          })
        ).to.be.revertedWith(ERRORS.INIT_PARAMS_INVALID);
      });
    });

    context('Following', function () {
      beforeEach(async function () {
        const followModuleData = abiCoder.encode(
          ['address', 'address', 'uint256', 'uint96'],
          [userAddress, fDAIx.address, DEFAULT_FOLLOW_PRICE, DEFAULT_FOLLOW_FLOW_RATE]
        );
        await expect(
          lensHub.createProfile({
            to: userAddress,
            handle: MOCK_PROFILE_HANDLE,
            imageURI: MOCK_PROFILE_URI,
            followModule: superfluidCFAFollowModule.address,
            followModuleData: followModuleData,
            followNFTURI: MOCK_FOLLOW_NFT_URI,
          })
        ).to.not.be.reverted;
      });

      it('UserTwo should fail to follow passing a different expected currency in data', async function () {
        const data = abiCoder.encode(['address', 'uint256'], [userAddress, DEFAULT_FOLLOW_PRICE]);
        await expect(
          lensHub.connect(userTwo).follow([FIRST_PROFILE_ID], [data])
        ).to.be.revertedWith(ERRORS.MODULE_DATA_MISMATCH);
      });

      it('UserTwo should fail to follow passing a different expected price in data', async function () {
        const data = abiCoder.encode(
          ['address', 'uint256'],
          [fDAIx.address, DEFAULT_FOLLOW_PRICE.add(1)]
        );
        await expect(
          lensHub.connect(userTwo).follow([FIRST_PROFILE_ID], [data])
        ).to.be.revertedWith(ERRORS.MODULE_DATA_MISMATCH);
      });

      it('UserTwo should fail to follow without sufficient currency balance', async function () {
        const data = abiCoder.encode(
          ['address', 'uint256'],
          [fDAIx.address, DEFAULT_FOLLOW_PRICE]
        );
        await expect(
          lensHub.connect(userTwo).follow([FIRST_PROFILE_ID], [data])
        ).to.be.revertedWith(ERRORS.SUPER_TOKEN_TRANSFER_EXCEEDS_BALANCE);
      });

      it('UserTwo should fail to follow without first approving module with enough currency', async function () {
        await expect(fDAI.connect(userTwo).mint(userTwoAddress, CURRENCY_MINT_AMOUNT)).to.not.be.reverted;
        await expect(fDAI.connect(userTwo).approve(fDAIx.address, MAX_UINT256)).to.not.be.reverted;
        await expect(fDAIx.upgrade({ amount: CURRENCY_MINT_AMOUNT.toHexString() }).exec(userTwo)).to.not.be.reverted;
        expect(await fDAIx.balanceOf({ account: userTwoAddress, providerOrSigner: userTwo })).to.eq(CURRENCY_MINT_AMOUNT.toString());

        const data = abiCoder.encode(
          ['address', 'uint256'],
          [fDAIx.address, DEFAULT_FOLLOW_PRICE]
        );
        await expect(
          lensHub.connect(userTwo).follow([FIRST_PROFILE_ID], [data])
        ).to.be.revertedWith(ERRORS.SUPER_TOKEN_TRANSFER_EXCEEDS_ALLOWANCE);
      });

      it('UserTwo should fail to follow without first creating a constant flow agreement', async function () {
        await expect(fDAI.connect(userTwo).mint(userTwoAddress, CURRENCY_MINT_AMOUNT)).to.not.be.reverted;
        await expect(fDAI.connect(userTwo).approve(fDAIx.address, MAX_UINT256)).to.not.be.reverted;
        await expect(fDAIx.upgrade({ amount: CURRENCY_MINT_AMOUNT.toString() }).exec(userTwo)).to.not.be.reverted;
        await expect(fDAIx.approve({ amount: MAX_UINT256, receiver: superfluidCFAFollowModule.address }).exec(userTwo)).to.not.be.reverted;

        const data = abiCoder.encode(
          ['address', 'uint256'],
          [fDAIx.address, DEFAULT_FOLLOW_PRICE]
        );
        await expect(
          lensHub.connect(userTwo).follow([FIRST_PROFILE_ID], [data])
        ).to.be.revertedWith(ERRORS.CFA_INVALID);
      });

      it('UserTwo should fail to follow without first creating a constant flow agreement with the correct recipient', async function () {
        await expect(fDAI.connect(userTwo).mint(userTwoAddress, CURRENCY_MINT_AMOUNT)).to.not.be.reverted;
        await expect(fDAI.connect(userTwo).approve(fDAIx.address, MAX_UINT256)).to.not.be.reverted;
        await expect(fDAIx.upgrade({ amount: CURRENCY_MINT_AMOUNT.toString() }).exec(userTwo)).to.not.be.reverted;
        await expect(fDAIx.approve({ amount: MAX_UINT256, receiver: superfluidCFAFollowModule.address }).exec(userTwo)).to.not.be.reverted;
        await expect(sf.cfaV1.createFlow({
          superToken: fDAIx.address,
          receiver: superfluidCFAFollowModule.address,
          flowRate: DEFAULT_FOLLOW_FLOW_RATE.toString(),
        }).exec(userTwo)).to.not.be.reverted;

        const data = abiCoder.encode(
          ['address', 'uint256'],
          [fDAIx.address, DEFAULT_FOLLOW_PRICE]
        );
        await expect(
          lensHub.connect(userTwo).follow([FIRST_PROFILE_ID], [data])
        ).to.be.revertedWith(ERRORS.CFA_INVALID);
      });

      it('UserTwo should fail to follow without first creating a constant flow agreement with the correct currency', async function () {
        //deploy a fake erc20 token
        await deployTestToken(errorHandler, [":", "fDAI2"], {
          web3,
          from: deployerAddress,
        });
        //deploy a fake erc20 wrapper super token around the fDAI token
        await deploySuperToken(errorHandler, [":", "fDAI2"], {
          web3,
          from: deployerAddress,
        });
        //use the framework to get the super toen
        const fDAI2x = await sf.loadSuperToken('fDAI2x');
        const fDAI2 = new ethers.Contract(fDAI2x.underlyingToken.address, currencyABI.abi, deployer) as Currency; // FIXME
        await expect(fDAI2.connect(userTwo).mint(userTwoAddress, CURRENCY_MINT_AMOUNT)).to.not.be.reverted;
        await expect(fDAI2.connect(userTwo).approve(fDAI2x.address, MAX_UINT256)).to.not.be.reverted;
        await expect(fDAI2x.upgrade({ amount: CURRENCY_MINT_AMOUNT.toString() }).exec(userTwo)).to.not.be.reverted;
        await expect(sf.cfaV1.createFlow({
          superToken: fDAI2x.address,
          receiver: userAddress,
          flowRate: DEFAULT_FOLLOW_FLOW_RATE.toString(),
        }).exec(userTwo)).to.not.be.reverted;
        await expect(fDAI.connect(userTwo).mint(userTwoAddress, CURRENCY_MINT_AMOUNT)).to.not.be.reverted;
        await expect(fDAI.connect(userTwo).approve(fDAIx.address, MAX_UINT256)).to.not.be.reverted;
        await expect(fDAIx.upgrade({ amount: CURRENCY_MINT_AMOUNT.toString() }).exec(userTwo)).to.not.be.reverted;
        await expect(fDAIx.approve({ amount: MAX_UINT256, receiver: superfluidCFAFollowModule.address }).exec(userTwo)).to.not.be.reverted;

        const data = abiCoder.encode(
          ['address', 'uint256'],
          [fDAIx.address, DEFAULT_FOLLOW_PRICE]
        );
        await expect(
          lensHub.connect(userTwo).follow([FIRST_PROFILE_ID], [data])
        ).to.be.revertedWith(ERRORS.CFA_INVALID);
      });

      it('UserTwo should fail to follow without first creating a constant flow agreement with the correct flow rate', async function () {
        await expect(fDAI.connect(userTwo).mint(userTwoAddress, CURRENCY_MINT_AMOUNT)).to.not.be.reverted;
        await expect(fDAI.connect(userTwo).approve(fDAIx.address, MAX_UINT256)).to.not.be.reverted;
        await expect(fDAIx.upgrade({ amount: CURRENCY_MINT_AMOUNT.toString() }).exec(userTwo)).to.not.be.reverted;
        await expect(fDAIx.approve({ amount: MAX_UINT256, receiver: superfluidCFAFollowModule.address }).exec(userTwo)).to.not.be.reverted;
        await expect(sf.cfaV1.createFlow({
          superToken: fDAIx.address,
          receiver: userAddress,
          flowRate: DEFAULT_FOLLOW_FLOW_RATE.sub(1).toString(),
        }).exec(userTwo)).to.not.be.reverted;

        const data = abiCoder.encode(
          ['address', 'uint256'],
          [fDAIx.address, DEFAULT_FOLLOW_PRICE]
        );
        await expect(
          lensHub.connect(userTwo).follow([FIRST_PROFILE_ID], [data])
        ).to.be.revertedWith(ERRORS.CFA_INVALID);
      });

      it('UserTwo should fail to follow if they are already following', async function () {
        await expect(fDAI.connect(userTwo).mint(userTwoAddress, CURRENCY_MINT_AMOUNT)).to.not.be.reverted;
        await expect(fDAI.connect(userTwo).approve(fDAIx.address, MAX_UINT256)).to.not.be.reverted;
        await expect(fDAIx.upgrade({ amount: CURRENCY_MINT_AMOUNT.toString() }).exec(userTwo)).to.not.be.reverted;
        await expect(fDAIx.approve({ amount: MAX_UINT256, receiver: superfluidCFAFollowModule.address }).exec(userTwo)).to.not.be.reverted;
        await expect(sf.cfaV1.createFlow({
          superToken: fDAIx.address,
          receiver: userAddress,
          flowRate: DEFAULT_FOLLOW_FLOW_RATE.toString(),
        }).exec(userTwo)).to.not.be.reverted;

        const data = abiCoder.encode(
          ['address', 'uint256'],
          [fDAIx.address, DEFAULT_FOLLOW_PRICE]
        );
        await expect(lensHub.connect(userTwo).follow([FIRST_PROFILE_ID], [data])).to.not.be.reverted;
        await expect(
          lensHub.connect(userTwo).follow([FIRST_PROFILE_ID], [data])
        ).to.be.revertedWith(ERRORS.FOLLOW_INVALID);
      });

      it('UserTwo should fail to validate follow if they are not following', async function () {
        await expect(superfluidCFAFollowModule.connect(userTwo).validateFollow(FIRST_PROFILE_ID, userTwoAddress, 0)).to.be.revertedWith(ERRORS.FOLLOW_INVALID);
      });

      it('UserTwo should fail to validate follow if they deleted the cfa', async function () {
        await expect(fDAI.connect(userTwo).mint(userTwoAddress, CURRENCY_MINT_AMOUNT)).to.not.be.reverted;
        await expect(fDAI.connect(userTwo).approve(fDAIx.address, MAX_UINT256)).to.not.be.reverted;
        await expect(fDAIx.upgrade({ amount: CURRENCY_MINT_AMOUNT.toString() }).exec(userTwo)).to.not.be.reverted;
        await expect(fDAIx.approve({ amount: MAX_UINT256, receiver: superfluidCFAFollowModule.address }).exec(userTwo)).to.not.be.reverted;
        await expect(sf.cfaV1.createFlow({
          superToken: fDAIx.address,
          receiver: userAddress,
          flowRate: DEFAULT_FOLLOW_FLOW_RATE.toString(),
        }).exec(userTwo)).to.not.be.reverted;

        const data = abiCoder.encode(
          ['address', 'uint256'],
          [fDAIx.address, DEFAULT_FOLLOW_PRICE]
        );
        await expect(lensHub.connect(userTwo).follow([FIRST_PROFILE_ID], [data])).to.not.be.reverted;
        await expect(sf.cfaV1.deleteFlow({
          superToken: fDAIx.address,
          sender: userTwoAddress,
          receiver: userAddress,
        }).exec(userTwo)).to.not.be.reverted;
        await expect(superfluidCFAFollowModule.connect(userTwo).validateFollow(FIRST_PROFILE_ID, userTwoAddress, 0)).to.be.revertedWith(ERRORS.CFA_INVALID);
      });

      it('UserTwo should fail to validate follow if they updated the cfa', async function () {
        await expect(fDAI.connect(userTwo).mint(userTwoAddress, CURRENCY_MINT_AMOUNT)).to.not.be.reverted;
        await expect(fDAI.connect(userTwo).approve(fDAIx.address, MAX_UINT256)).to.not.be.reverted;
        await expect(fDAIx.upgrade({ amount: CURRENCY_MINT_AMOUNT.toString() }).exec(userTwo)).to.not.be.reverted;
        await expect(fDAIx.approve({ amount: MAX_UINT256, receiver: superfluidCFAFollowModule.address }).exec(userTwo)).to.not.be.reverted;
        await expect(sf.cfaV1.createFlow({
          superToken: fDAIx.address,
          receiver: userAddress,
          flowRate: DEFAULT_FOLLOW_FLOW_RATE.toString(),
        }).exec(userTwo)).to.not.be.reverted;

        const data = abiCoder.encode(
          ['address', 'uint256'],
          [fDAIx.address, DEFAULT_FOLLOW_PRICE]
        );
        await expect(lensHub.connect(userTwo).follow([FIRST_PROFILE_ID], [data])).to.not.be.reverted;
        await expect(sf.cfaV1.updateFlow({
          superToken: fDAIx.address,
          sender: userTwoAddress,
          receiver: userAddress,
          flowRate: DEFAULT_FOLLOW_FLOW_RATE.mul(2).toString(),
        }).exec(userTwo)).to.not.be.reverted;
        await expect(superfluidCFAFollowModule.connect(userTwo).validateFollow(FIRST_PROFILE_ID, userTwoAddress, 0)).to.be.revertedWith(ERRORS.CFA_INVALID);
      });

      it('UserTwo should fail to validate follow if they recreated the cfa', async function () {
        await expect(fDAI.connect(userTwo).mint(userTwoAddress, CURRENCY_MINT_AMOUNT)).to.not.be.reverted;
        await expect(fDAI.connect(userTwo).approve(fDAIx.address, MAX_UINT256)).to.not.be.reverted;
        await expect(fDAIx.upgrade({ amount: CURRENCY_MINT_AMOUNT.toString() }).exec(userTwo)).to.not.be.reverted;
        await expect(fDAIx.approve({ amount: MAX_UINT256, receiver: superfluidCFAFollowModule.address }).exec(userTwo)).to.not.be.reverted;
        await expect(sf.cfaV1.createFlow({
          superToken: fDAIx.address,
          receiver: userAddress,
          flowRate: DEFAULT_FOLLOW_FLOW_RATE.toString(),
        }).exec(userTwo)).to.not.be.reverted;

        const data = abiCoder.encode(
          ['address', 'uint256'],
          [fDAIx.address, DEFAULT_FOLLOW_PRICE]
        );
        await expect(lensHub.connect(userTwo).follow([FIRST_PROFILE_ID], [data])).to.not.be.reverted;
        await expect(sf.cfaV1.deleteFlow({
          superToken: fDAIx.address,
          sender: userTwoAddress,
          receiver: userAddress,
        }).exec(userTwo)).to.not.be.reverted;
        await expect(sf.cfaV1.createFlow({
          superToken: fDAIx.address,
          receiver: userAddress,
          flowRate: DEFAULT_FOLLOW_FLOW_RATE.toString(),
        }).exec(userTwo)).to.not.be.reverted;
        await expect(superfluidCFAFollowModule.connect(userTwo).validateFollow(FIRST_PROFILE_ID, userTwoAddress, 0)).to.be.revertedWith(ERRORS.CFA_INVALID);
      });
    });
  });

  context('Scenarios', function () {
    it('User should create a profile with the superfluid cfa follow module as the follow module and data, correct events should be emitted', async function () {
      const followModuleData = abiCoder.encode(
        ['address', 'address', 'uint256', 'uint96'],
        [userAddress, fDAIx.address, DEFAULT_FOLLOW_PRICE, DEFAULT_FOLLOW_FLOW_RATE]
      );
      const tx = lensHub.createProfile({
        to: userAddress,
        handle: MOCK_PROFILE_HANDLE,
        imageURI: MOCK_PROFILE_URI,
        followModule: superfluidCFAFollowModule.address,
        followModuleData: followModuleData,
        followNFTURI: MOCK_FOLLOW_NFT_URI,
      });

      const receipt = await waitForTx(tx);

      expect(receipt.logs.length).to.eq(2);
      matchEvent(receipt, 'Transfer', [ZERO_ADDRESS, userAddress, FIRST_PROFILE_ID], lensHubImpl);
      matchEvent(receipt, 'ProfileCreated', [
        FIRST_PROFILE_ID,
        userAddress,
        userAddress,
        MOCK_PROFILE_HANDLE,
        MOCK_PROFILE_URI,
        superfluidCFAFollowModule.address,
        followModuleData,
        MOCK_FOLLOW_NFT_URI,
        await getTimestamp(),
      ]);
    });

    it('User should create a profile with superfluid cfa follow module using zero amount', async function () {
      const followModuleData = abiCoder.encode(
        ['address', 'address', 'uint256', 'uint96'],
        [userAddress, fDAIx.address, 0, DEFAULT_FOLLOW_FLOW_RATE]
      );

      await expect(
        lensHub.createProfile({
          to: userAddress,
          handle: MOCK_PROFILE_HANDLE,
          imageURI: MOCK_PROFILE_URI,
          followModule: superfluidCFAFollowModule.address,
          followModuleData: followModuleData,
          followNFTURI: MOCK_FOLLOW_NFT_URI,
        })
      ).to.not.be.reverted;
    });

    it('User should create a profile then set the superfluid cfa follow module as the follow module with data, correct events should be emitted', async function () {
      await expect(
        lensHub.createProfile({
          to: userAddress,
          handle: MOCK_PROFILE_HANDLE,
          imageURI: MOCK_PROFILE_URI,
          followModule: ZERO_ADDRESS,
          followModuleData: [],
          followNFTURI: MOCK_FOLLOW_NFT_URI,
        })
      ).to.not.be.reverted;

      const followModuleData = abiCoder.encode(
        ['address', 'address', 'uint256', 'uint96'],
        [userAddress, fDAIx.address, DEFAULT_FOLLOW_PRICE, DEFAULT_FOLLOW_FLOW_RATE]
      );
      const tx = lensHub.setFollowModule(
        FIRST_PROFILE_ID,
        superfluidCFAFollowModule.address,
        followModuleData
      );

      const receipt = await waitForTx(tx);

      expect(receipt.logs.length).to.eq(1);
      matchEvent(receipt, 'FollowModuleSet', [
        FIRST_PROFILE_ID,
        superfluidCFAFollowModule.address,
        followModuleData,
        await getTimestamp(),
      ]);
    });

    it('User should create a profile with the superfluid cfa follow module as the follow module and data, fetched profile data should be accurate', async function () {
      const followModuleData = abiCoder.encode(
        ['address', 'address', 'uint256', 'uint96'],
        [userAddress, fDAIx.address, DEFAULT_FOLLOW_PRICE, DEFAULT_FOLLOW_FLOW_RATE]
      );
      await expect(
        lensHub.createProfile({
          to: userAddress,
          handle: MOCK_PROFILE_HANDLE,
          imageURI: MOCK_PROFILE_URI,
          followModule: superfluidCFAFollowModule.address,
          followModuleData: followModuleData,
          followNFTURI: MOCK_FOLLOW_NFT_URI,
        })
      ).to.not.be.reverted;

      const fetchedData = await superfluidCFAFollowModule.getProfileData(FIRST_PROFILE_ID);
      expect(fetchedData.recipient).to.eq(userAddress);
      expect(fetchedData.currency).to.eq(fDAIx.address);
      expect(fetchedData.amount).to.eq(DEFAULT_FOLLOW_PRICE);
      expect(fetchedData.flowRate).to.eq(DEFAULT_FOLLOW_FLOW_RATE);
    });

    it('User should create a profile with the superfluid cfa follow module as the follow module and data, user two create a cfa and follows, fee distribution is valid', async function () {
      const followModuleData = abiCoder.encode(
        ['address', 'address', 'uint256', 'uint96'],
        [userAddress, fDAIx.address, DEFAULT_FOLLOW_PRICE, DEFAULT_FOLLOW_FLOW_RATE]
      );
      await expect(
        lensHub.createProfile({
          to: userAddress,
          handle: MOCK_PROFILE_HANDLE,
          imageURI: MOCK_PROFILE_URI,
          followModule: superfluidCFAFollowModule.address,
          followModuleData: followModuleData,
          followNFTURI: MOCK_FOLLOW_NFT_URI,
        })
      ).to.not.be.reverted;

      await expect(fDAI.connect(userTwo).mint(userTwoAddress, CURRENCY_MINT_AMOUNT)).to.not.be.reverted;
      await expect(fDAI.connect(userTwo).approve(fDAIx.address, CURRENCY_MINT_AMOUNT)).to.not.be.reverted;
      await expect(fDAIx.upgrade({ amount: CURRENCY_MINT_AMOUNT.toString() }).exec(userTwo)).to.not.be.reverted;
      await expect(fDAIx.approve({ amount: MAX_UINT256, receiver: superfluidCFAFollowModule.address }).exec(userTwo)).to.not.be.reverted;
      await expect(sf.cfaV1.createFlow({
        superToken: fDAIx.address,
        receiver: userAddress,
        flowRate: DEFAULT_FOLLOW_FLOW_RATE.toString(),
      }).exec(userTwo)).to.not.be.reverted;

      const data = abiCoder.encode(
        ['address', 'uint256'],
        [fDAIx.address, DEFAULT_FOLLOW_PRICE]
      );
      await expect(lensHub.connect(userTwo).follow([FIRST_PROFILE_ID], [data])).to.not.be.reverted;

      const expectedTreasuryAmount = BigNumber.from(DEFAULT_FOLLOW_PRICE)
        .mul(TREASURY_FEE_BPS)
        .div(BPS_MAX);
      const expectedRecipientAmount =
        BigNumber.from(DEFAULT_FOLLOW_PRICE).sub(expectedTreasuryAmount);

      expect(await fDAIx.balanceOf({ account: userTwoAddress, providerOrSigner: userTwo })).to.closeTo(
        BigNumber.from(CURRENCY_MINT_AMOUNT)
          .sub(DEFAULT_FOLLOW_PRICE)
          // Superfluid takes a 1h deposit up front on escrow on testnets
          // https://docs.superfluid.finance/superfluid/protocol-developers/interactive-tutorials/money-streaming-1#money-streaming
          .sub(DEFAULT_FOLLOW_FLOW_RATE.mul(1 * 60 * 60)),
        ethers.utils.parseUnits('1', 13)
      );
      expect(await fDAIx.balanceOf({ account: userAddress, providerOrSigner: userTwo })).to.closeTo(expectedRecipientAmount, ethers.utils.parseUnits('1', 13));
      expect(await fDAIx.balanceOf({ account: treasuryAddress, providerOrSigner: userTwo })).to.eq(expectedTreasuryAmount);
    });
  });
});
