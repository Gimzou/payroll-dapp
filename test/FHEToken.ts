import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { FHEToken, FHEToken__factory } from "../types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("FHEToken", function () {
  let token: FHEToken;
  let owner: HardhatEthersSigner;
  let recipient: HardhatEthersSigner;

  const INITIAL_AMOUNT = 1000;
  const TRANSFER_AMOUNT = 100;

  beforeEach(async function () {
    [owner, recipient] = await ethers.getSigners();

    // Deploy FHEToken contract
    const tokenFactory = (await ethers.getContractFactory("FHEToken")) as FHEToken__factory;
    token = await tokenFactory.deploy(
      owner.address,
      INITIAL_AMOUNT,
      "Confidential Token",
      "CTKN",
      "https://example.com/token",
    );
  });

  describe("Confidential Transfer Process", function () {
    it("should be initialized with the correct amount", async function () {
      const ownerBalanceHandle = await token.confidentialBalanceOf(owner.address);
      const decryptedBalance = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        ownerBalanceHandle,
        await token.getAddress(),
        owner,
      );
      console.log(`decryptedBalance: ${decryptedBalance}`);
      expect(decryptedBalance).to.eq(INITIAL_AMOUNT);
    });

    it("should transfer tokens from owner to recipient", async function () {
      // Create encrypted input for transfer amount
      const encryptedInput = await fhevm
        .createEncryptedInput(await token.getAddress(), owner.address)
        .add64(TRANSFER_AMOUNT)
        .encrypt();

      console.log(`encryptedInput: ${encryptedInput}`);

      // Perform the confidential transfer
      await expect(
        token
          .connect(owner)
          [
            "confidentialTransfer(address,bytes32,bytes)"
          ](recipient.address, encryptedInput.handles[0], encryptedInput.inputProof),
      ).to.not.be.reverted;

      // Check that both addresses have balance handles (without decryption for now)
      const recipientBalanceHandle = await token.confidentialBalanceOf(recipient.address);
      const ownerBalanceHandle = await token.confidentialBalanceOf(owner.address);
      console.log(`recipientBalanceHandle: ${recipientBalanceHandle}`);
      console.log(`ownerBalanceHandle: ${ownerBalanceHandle}`);
      expect(recipientBalanceHandle).to.not.equal(0n);
      expect(ownerBalanceHandle).to.not.equal(0n);
    });
  });
});
