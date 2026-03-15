import { ethers, fhevm } from "hardhat";
import { expect } from "chai";
import { FHEPayroll, FHEPayroll__factory, FHEToken, FHEToken__factory } from "../types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { FhevmType } from "@fhevm/hardhat-plugin";

describe("FHEPayroll Enhanced Tests", function () {
  let fhetoken: FHEToken;
  let fhepayroll: FHEPayroll;
  let employer: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  const INITIAL_TOKEN_AMOUNT = 1_000_000_000n; // 1B tokens
  const MONTHLY_SALARY = 5000n; // Salary in tokens per second (simplified for testing)

  beforeEach(async function () {
    [employer, alice, bob] = await ethers.getSigners();

    // Deploy FHEToken
    const fheTokenFactory = (await ethers.getContractFactory("FHEToken")) as FHEToken__factory;
    fhetoken = (await fheTokenFactory.deploy(
      employer.address,
      INITIAL_TOKEN_AMOUNT,
      "FHEToken",
      "FHE",
      "https://example.com",
    )) as FHEToken;
    await fhetoken.waitForDeployment();

    // Deploy FHEPayroll
    const fhePayrollFactory = (await ethers.getContractFactory("FHEPayroll")) as FHEPayroll__factory;
    fhepayroll = (await fhePayrollFactory.deploy(await fhetoken.getAddress(), employer.address)) as FHEPayroll;
    await fhepayroll.waitForDeployment();

    // Grant FHEPayroll allowance to spend employer's tokens
    const tenYearsFromNow = Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 60 * 60;
    await fhetoken.connect(employer).setOperator(await fhepayroll.getAddress(), tenYearsFromNow);
  });

  async function addEmployee(employee: HardhatEthersSigner, salary: bigint) {
    const encryptedSalary = await fhevm
      .createEncryptedInput(await fhepayroll.getAddress(), employer.address)
      .add64(salary)
      .encrypt();

    await fhepayroll
      .connect(employer)
      .addEmployee(employee.address, encryptedSalary.handles[0], encryptedSalary.inputProof);
  }

  describe("Confidentiality", function () {
    it("should allow only employer or the employee to decrypt salary", async function () {
      await addEmployee(alice, MONTHLY_SALARY);

      const employeeData = await fhepayroll.connect(employer).getEmployee(alice.address);

      // Employer decrypts
      const decryptedByEmployer = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        employeeData.encSalary,
        await fhepayroll.getAddress(),
        employer,
      );
      expect(decryptedByEmployer).to.equal(MONTHLY_SALARY);

      // Alice decrypts
      const decryptedByAlice = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        employeeData.encSalary,
        await fhepayroll.getAddress(),
        alice,
      );
      expect(decryptedByAlice).to.equal(MONTHLY_SALARY);

      // Bob (unauthorized) cannot access getEmployee even if he knows the address
      await expect(fhepayroll.connect(bob).getEmployee(alice.address)).to.be.revertedWithCustomError(
        fhepayroll,
        "NotEmployerOrSelf",
      );
    });
  });

  describe("Lifecycle & Accrual", function () {
    it("should accrue pay only when Active", async function () {
      await addEmployee(alice, MONTHLY_SALARY);

      // Accrual for 100 seconds
      await time.increase(100);

      // Deactivate
      await fhepayroll.connect(employer).deactivateEmployee(alice.address);
      const emp = await fhepayroll.getEmployee(alice.address);
      const claimableAtDeactivation = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        emp.encClaimable,
        await fhepayroll.getAddress(),
        alice,
      );
      expect(claimableAtDeactivation).to.be.at.least(MONTHLY_SALARY * 100n);

      // Wait 100 more seconds while Inactive
      await time.increase(100);

      // Claim pay and check balance
      await fhepayroll.connect(alice).claimPay();
      const balanceAfterInactive = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        await fhetoken.confidentialBalanceOf(alice.address),
        await fhetoken.getAddress(),
        alice,
      );
      // Balance should still be the same as at deactivation (plus/minus small delta for block timestamps)
      expect(balanceAfterInactive).to.be.closeTo(claimableAtDeactivation, MONTHLY_SALARY * 2n);

      // Reactivate
      await fhepayroll.connect(employer).activateEmployee(alice.address);
      await time.increase(100);
      await fhepayroll.connect(alice).claimPay();

      const balanceAfterReactivation = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        await fhetoken.confidentialBalanceOf(alice.address),
        await fhetoken.getAddress(),
        alice,
      );
      expect(balanceAfterReactivation).to.be.at.least(balanceAfterInactive + MONTHLY_SALARY * 100n);
    });

    it("should allow final claim after termination", async function () {
      await addEmployee(alice, MONTHLY_SALARY);
      await time.increase(100);

      await fhepayroll.connect(employer).terminateEmployee(alice.address);

      // Wait while terminated
      await time.increase(100);

      // Claim pay
      await fhepayroll.connect(alice).claimPay();
      const finalBalance = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        await fhetoken.confidentialBalanceOf(alice.address),
        await fhetoken.getAddress(),
        alice,
      );
      expect(finalBalance).to.be.at.least(MONTHLY_SALARY * 100n);

      // Try to accrues/claim again - should not add anything new because terminated
      await time.increase(100);
      await fhepayroll.connect(alice).claimPay();
      const balanceAfterMoreTime = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        await fhetoken.confidentialBalanceOf(alice.address),
        await fhetoken.getAddress(),
        alice,
      );
      expect(balanceAfterMoreTime).to.equal(finalBalance);
    });
  });

  describe("Salary Updates", function () {
    it("should accrue previous salary before applying new one", async function () {
      await addEmployee(alice, MONTHLY_SALARY);
      await time.increase(100);

      const newSalary = MONTHLY_SALARY * 2n;
      const encryptedNewSalary = await fhevm
        .createEncryptedInput(await fhepayroll.getAddress(), employer.address)
        .add64(newSalary)
        .encrypt();

      await fhepayroll
        .connect(employer)
        .updateSalary(alice.address, encryptedNewSalary.handles[0], encryptedNewSalary.inputProof);

      // Wait 100 seconds with new salary
      await time.increase(100);

      await fhepayroll.connect(alice).claimPay();
      const totalReceived = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        await fhetoken.confidentialBalanceOf(alice.address),
        await fhetoken.getAddress(),
        alice,
      );

      // Expected: (100 * MONTHLY_SALARY) + (100 * newSalary)
      const expected = 100n * MONTHLY_SALARY + 100n * newSalary;
      expect(totalReceived).to.be.at.least(expected);
    });
  });

  describe("Security & Access Control", function () {
    it("should revert if non-employer tries to add employee", async function () {
      const encryptedSalary = await fhevm
        .createEncryptedInput(await fhepayroll.getAddress(), alice.address)
        .add64(MONTHLY_SALARY)
        .encrypt();

      await expect(
        fhepayroll.connect(alice).addEmployee(bob.address, encryptedSalary.handles[0], encryptedSalary.inputProof),
      ).to.be.revertedWithCustomError(fhepayroll, "NotEmployer");
    });

    it("should revert if non-employer tries to update salary", async function () {
      await addEmployee(alice, MONTHLY_SALARY);

      const encryptedSalary = await fhevm
        .createEncryptedInput(await fhepayroll.getAddress(), alice.address)
        .add64(MONTHLY_SALARY * 2n)
        .encrypt();

      await expect(
        fhepayroll.connect(alice).updateSalary(alice.address, encryptedSalary.handles[0], encryptedSalary.inputProof),
      ).to.be.revertedWithCustomError(fhepayroll, "NotEmployer");
    });
  });

  describe("accrueEarnings", function () {
    it("should allow the employer to manually sync earnings for an Active employee", async function () {
      await addEmployee(alice, MONTHLY_SALARY);
      await time.increase(100);

      await expect(fhepayroll.connect(employer).accrueEarnings(alice.address)).to.not.be.reverted;

      const emp = await fhepayroll.connect(employer).getEmployee(alice.address);
      const claimable = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        emp.encClaimable,
        await fhepayroll.getAddress(),
        alice,
      );
      expect(claimable).to.be.at.least(MONTHLY_SALARY * 100n);
    });

    it("should allow the employee to sync their own earnings", async function () {
      await addEmployee(alice, MONTHLY_SALARY);
      await time.increase(50);
      await expect(fhepayroll.connect(alice).accrueEarnings(alice.address)).to.not.be.reverted;
    });

    it("should revert when called by a third party", async function () {
      await addEmployee(alice, MONTHLY_SALARY);
      await expect(fhepayroll.connect(bob).accrueEarnings(alice.address)).to.be.revertedWithCustomError(
        fhepayroll,
        "NotEmployerOrSelf",
      );
    });

    it("should revert for a non-Active employee", async function () {
      await addEmployee(alice, MONTHLY_SALARY);
      await fhepayroll.connect(employer).deactivateEmployee(alice.address);
      await expect(fhepayroll.connect(employer).accrueEarnings(alice.address)).to.be.revertedWithCustomError(
        fhepayroll,
        "EmployeeNotActive",
      );
    });
  });
});
