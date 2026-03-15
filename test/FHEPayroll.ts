import { ethers, fhevm } from "hardhat";
import { expect } from "chai";
import { FHEPayroll, FHEPayroll__factory, FHEToken, FHEToken__factory } from "../types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { FhevmType } from "@fhevm/hardhat-plugin";

describe("FHEPayroll", function () {
  let fhetoken: FHEToken;
  let fhepayroll: FHEPayroll;
  let employer: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  const INITIAL_TOKEN_AMOUNT = 10_000_000_000n;
  const SALARY = 5000n; // tokens per second

  beforeEach(async function () {
    [employer, alice, bob] = await ethers.getSigners();

    const fheTokenFactory = (await ethers.getContractFactory("FHEToken")) as FHEToken__factory;
    fhetoken = (await fheTokenFactory.deploy(
      employer.address,
      INITIAL_TOKEN_AMOUNT,
      "FHEToken",
      "FHE",
      "https://example.com",
    )) as FHEToken;
    await fhetoken.waitForDeployment();

    const fhePayrollFactory = (await ethers.getContractFactory("FHEPayroll")) as FHEPayroll__factory;
    fhepayroll = (await fhePayrollFactory.deploy(await fhetoken.getAddress(), employer.address)) as FHEPayroll;
    await fhepayroll.waitForDeployment();

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

  describe("FHEToken", function () {
    it("should initialize the employer with the correct amount of tokens", async function () {
      const employerBalance = await fhetoken.confidentialBalanceOf(employer.address);
      const clearBalance = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        employerBalance,
        fhetoken.getAddress(),
        employer,
      );
      expect(clearBalance).to.eq(INITIAL_TOKEN_AMOUNT);
    });

    it("should allow transfer from employer to employee", async function () {
      const tokenAddress = await fhetoken.getAddress();
      const transferAmount = 1_000_000_000n;
      const encryptedTransferAmount = await fhevm
        .createEncryptedInput(tokenAddress, employer.address)
        .add64(transferAmount)
        .encrypt();

      await fhetoken
        .connect(employer)
        [
          "confidentialTransfer(address,bytes32,bytes)"
        ](alice.address, encryptedTransferAmount.handles[0], encryptedTransferAmount.inputProof);

      const clearAliceBalance = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        await fhetoken.confidentialBalanceOf(alice.address),
        tokenAddress,
        alice,
      );
      expect(clearAliceBalance).to.eq(transferAmount);

      const clearEmployerBalance = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        await fhetoken.confidentialBalanceOf(employer.address),
        tokenAddress,
        employer,
      );
      expect(clearEmployerBalance).to.eq(INITIAL_TOKEN_AMOUNT - transferAmount);
    });
  });

  describe("Employee Management", function () {
    it("should only allow the employer to add an employee", async function () {
      const fhepayrollAddress = await fhepayroll.getAddress();
      const encryptedSalary = await fhevm
        .createEncryptedInput(fhepayrollAddress, employer.address)
        .add64(SALARY)
        .encrypt();

      await expect(
        fhepayroll.connect(bob).addEmployee(alice.address, encryptedSalary.handles[0], encryptedSalary.inputProof),
      ).to.be.revertedWithCustomError(fhepayroll, "NotEmployer");

      await expect(
        fhepayroll.connect(employer).addEmployee(alice.address, encryptedSalary.handles[0], encryptedSalary.inputProof),
      ).to.emit(fhepayroll, "EmployeeAdded");
    });

    it("should accrue the claimable amount for an active employee", async function () {
      const fhepayrollAddress = await fhepayroll.getAddress();
      const tokenAddress = await fhetoken.getAddress();
      const elapsedSeconds = 60;

      await addEmployee(alice, SALARY);

      const currentTimestamp = await time.latest();
      await time.increaseTo(currentTimestamp + elapsedSeconds);
      await fhepayroll.connect(alice).claimPay();

      const employee = await fhepayroll.getEmployee(alice.address);
      const clearAliceBalance = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        await fhetoken.confidentialBalanceOf(alice.address),
        tokenAddress,
        alice,
      );
      const clearAliceTotalPay = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        employee.encTotalReceived,
        fhepayrollAddress,
        alice,
      );
      expect(clearAliceTotalPay).to.eq(clearAliceBalance);
      expect(clearAliceBalance).to.eq(SALARY * BigInt(employee.lastUpdate - employee.hiredAt));
    });
  });

  describe("Confidentiality", function () {
    it("should allow only employer or the employee to decrypt salary", async function () {
      await addEmployee(alice, SALARY);

      const employeeData = await fhepayroll.connect(employer).getEmployee(alice.address);

      const decryptedByEmployer = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        employeeData.encSalary,
        await fhepayroll.getAddress(),
        employer,
      );
      expect(decryptedByEmployer).to.equal(SALARY);

      const decryptedByAlice = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        employeeData.encSalary,
        await fhepayroll.getAddress(),
        alice,
      );
      expect(decryptedByAlice).to.equal(SALARY);

      await expect(fhepayroll.connect(bob).getEmployee(alice.address)).to.be.revertedWith(
        "Payroll: not employer or self",
      );
    });
  });

  describe("Lifecycle & Accrual", function () {
    it("should accrue pay only when Active", async function () {
      await addEmployee(alice, SALARY);
      await time.increase(100);

      await fhepayroll.connect(employer).deactivateEmployee(alice.address);
      const emp = await fhepayroll.getEmployee(alice.address);
      const claimableAtDeactivation = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        emp.encClaimable,
        await fhepayroll.getAddress(),
        alice,
      );
      expect(claimableAtDeactivation).to.be.at.least(SALARY * 100n);

      await time.increase(100);

      await fhepayroll.connect(alice).claimPay();
      const balanceAfterInactive = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        await fhetoken.confidentialBalanceOf(alice.address),
        await fhetoken.getAddress(),
        alice,
      );
      expect(balanceAfterInactive).to.be.closeTo(claimableAtDeactivation, SALARY * 2n);

      await fhepayroll.connect(employer).activateEmployee(alice.address);
      await time.increase(100);
      await fhepayroll.connect(alice).claimPay();

      const balanceAfterReactivation = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        await fhetoken.confidentialBalanceOf(alice.address),
        await fhetoken.getAddress(),
        alice,
      );
      expect(balanceAfterReactivation).to.be.at.least(balanceAfterInactive + SALARY * 100n);
    });

    it("should allow final claim after termination", async function () {
      await addEmployee(alice, SALARY);
      await time.increase(100);

      await fhepayroll.connect(employer).terminateEmployee(alice.address);
      await time.increase(100);

      await fhepayroll.connect(alice).claimPay();
      const finalBalance = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        await fhetoken.confidentialBalanceOf(alice.address),
        await fhetoken.getAddress(),
        alice,
      );
      expect(finalBalance).to.be.at.least(SALARY * 100n);

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
      await addEmployee(alice, SALARY);
      await time.increase(100);

      const newSalary = SALARY * 2n;
      const encryptedNewSalary = await fhevm
        .createEncryptedInput(await fhepayroll.getAddress(), employer.address)
        .add64(newSalary)
        .encrypt();

      await fhepayroll
        .connect(employer)
        .updateSalary(alice.address, encryptedNewSalary.handles[0], encryptedNewSalary.inputProof);

      await time.increase(100);
      await fhepayroll.connect(alice).claimPay();

      const totalReceived = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        await fhetoken.confidentialBalanceOf(alice.address),
        await fhetoken.getAddress(),
        alice,
      );
      expect(totalReceived).to.be.at.least(100n * SALARY + 100n * newSalary);
    });
  });

  describe("Security & Access Control", function () {
    it("should revert if non-employer tries to update salary", async function () {
      await addEmployee(alice, SALARY);

      const encryptedSalary = await fhevm
        .createEncryptedInput(await fhepayroll.getAddress(), alice.address)
        .add64(SALARY * 2n)
        .encrypt();

      await expect(
        fhepayroll.connect(alice).updateSalary(alice.address, encryptedSalary.handles[0], encryptedSalary.inputProof),
      ).to.be.revertedWith("Payroll: not employer");
    });
  });

  describe("accrueEarnings", function () {
    it("should allow the employer to manually sync earnings for an Active employee", async function () {
      await addEmployee(alice, SALARY);
      await time.increase(100);

      await expect(fhepayroll.connect(employer).accrueEarnings(alice.address)).to.not.be.reverted;

      const emp = await fhepayroll.connect(employer).getEmployee(alice.address);
      const claimable = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        emp.encClaimable,
        await fhepayroll.getAddress(),
        alice,
      );
      expect(claimable).to.be.at.least(SALARY * 100n);
    });

    it("should allow the employee to sync their own earnings", async function () {
      await addEmployee(alice, SALARY);
      await time.increase(50);
      await expect(fhepayroll.connect(alice).accrueEarnings(alice.address)).to.not.be.reverted;
    });

    it("should revert when called by a third party", async function () {
      await addEmployee(alice, SALARY);
      await expect(fhepayroll.connect(bob).accrueEarnings(alice.address)).to.be.revertedWith(
        "Payroll: not employer or self",
      );
    });

    it("should revert for a non-Active employee", async function () {
      await addEmployee(alice, SALARY);
      await fhepayroll.connect(employer).deactivateEmployee(alice.address);
      await expect(fhepayroll.connect(employer).accrueEarnings(alice.address)).to.be.revertedWith(
        "Payroll: employee must be Active",
      );
    });
  });
});
