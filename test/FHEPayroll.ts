import { ethers, fhevm } from "hardhat";
import { expect } from "chai";
import { FHEPayroll, FHEPayroll__factory, FHEToken, FHEToken__factory } from "../types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { FhevmType } from "@fhevm/hardhat-plugin";

/**
 * Test suite for payroll contract
 * 
 * - Deploy the payroll contract
 * - Deploy the FHEToken contract
 * - Initialize the payroll contract with the FHEToken contract
 */

describe("Confidential Payroll", function () {
    let fhetoken: any;
    let fhepayroll: any;

    let employer: HardhatEthersSigner;
    let alice: HardhatEthersSigner;
    let bob: HardhatEthersSigner;
    let charlie: HardhatEthersSigner;

    const INITIAL_TOKEN_AMOUNT = 10_000_000_000n; // 10M FHE tokens

    beforeEach(async function () {
        [employer, alice, bob, charlie] = await ethers.getSigners();

        // Deploy FHEToken
        const fheTokenFactory = (await ethers.getContractFactory("FHEToken")) as FHEToken__factory;
        fhetoken = (await fheTokenFactory.deploy(
            employer.address,
            INITIAL_TOKEN_AMOUNT,
            "FHEToken",
            "FHE",
            "https://example.com"
        )) as FHEToken;
        await fhetoken.waitForDeployment();

        // Deploy FHEPayroll
        const fhePayrollFactory = (await ethers.getContractFactory("FHEPayroll")) as FHEPayroll__factory;
        fhepayroll = (await fhePayrollFactory.deploy(
            fhetoken.getAddress(), 
            employer.address
        )) as FHEPayroll;
        await fhepayroll.waitForDeployment();
    });

    describe("FHEToken", async function () {
        it('should initialize the employer with the correct amount of tokens', async function () {
            const employerBalance = await fhetoken.confidentialBalanceOf(employer.address);
            const clearBalance = await fhevm.userDecryptEuint(
                FhevmType.euint64,
                employerBalance,
                fhetoken.getAddress(),
                employer
            );
            expect(clearBalance).to.eq(INITIAL_TOKEN_AMOUNT);
        })

        it('should allow transfer from employer to employee', async function () {
            const tokenAddress = await fhetoken.getAddress();
            const employerBalance = await fhetoken.confidentialBalanceOf(employer.address);
            const clearBalance = await fhevm.userDecryptEuint(
                FhevmType.euint64,
                employerBalance,
                tokenAddress,
                employer
            );
            expect(clearBalance).to.eq(INITIAL_TOKEN_AMOUNT);

            const transferAmount = 1_000_000_000n;
            const encryptedTransferAmount = await fhevm
                .createEncryptedInput(tokenAddress, employer.address)
                .add64(transferAmount)
                .encrypt();
            
            await fhetoken
                .connect(employer)
                ['confidentialTransfer(address,bytes32,bytes)'](
                    alice.address,
                    encryptedTransferAmount.handles[0],
                    encryptedTransferAmount.inputProof
                );

            const aliceBalance = await fhetoken.confidentialBalanceOf(alice.address);
            const clearAliceBalance = await fhevm.userDecryptEuint(
                FhevmType.euint64,
                aliceBalance,
                tokenAddress,
                alice
            );
            expect(clearAliceBalance).to.eq(transferAmount);

            const employerBalanceAfterTransfer = await fhetoken.confidentialBalanceOf(employer.address);
            const clearEmployerBalanceAfterTransfer = await fhevm.userDecryptEuint(
                FhevmType.euint64,
                employerBalanceAfterTransfer,
                tokenAddress,
                employer
            );
            expect(clearEmployerBalanceAfterTransfer).to.eq(INITIAL_TOKEN_AMOUNT - transferAmount);
        })
    })

    describe("FHEPayroll", async function () {
        it('should only allow the employer to add an employee', async function () {
            const fhepayrollAddress = await fhepayroll.getAddress();
            const salary = 1000;
            const encryptedSalary = await fhevm
                .createEncryptedInput(fhepayrollAddress, employer.address)
                .add64(salary)
                .encrypt();
            
            await expect(fhepayroll.connect(bob)
                .addEmployee(alice.address, encryptedSalary.handles[0], encryptedSalary.inputProof))
                .to.be.revertedWith("Payroll: not employer");

            await expect(fhepayroll.connect(employer)
                .addEmployee(alice.address, encryptedSalary.handles[0], encryptedSalary.inputProof))
                .to.emit(fhepayroll, "EmployeeAdded");
        })

        it('should accrue the claimable amount of an active employee', async function () {
            const fhepayrollAddress = await fhepayroll.getAddress();
            const tokenAddress = await fhetoken.getAddress();
            const salary = 1000;
            const elapsedSeconds = 60;

            const tenYearsFromNow = Math.floor(Date.now() / 1000) + (10 * 365 * 24 * 60 * 60);
            await fhetoken.connect(employer).setOperator(fhepayrollAddress, tenYearsFromNow);

            const encryptedSalary = await fhevm
                .createEncryptedInput(fhepayrollAddress, employer.address)
                .add64(salary)
                .encrypt();
            
            await expect(fhepayroll.connect(employer)
                .addEmployee(alice.address, encryptedSalary.handles[0], encryptedSalary.inputProof))
                .to.emit(fhepayroll, "EmployeeAdded");

            const currentTimestamp = await time.latest();
            await time.increaseTo(currentTimestamp + elapsedSeconds);

            await fhepayroll.connect(alice).claimPay();

            const employee = await fhepayroll.getEmployee(alice.address);

            const aliceBalance = await fhetoken.confidentialBalanceOf(alice.address);
            const clearAliceBalance = await fhevm.userDecryptEuint(
                FhevmType.euint64,
                aliceBalance,
                tokenAddress,
                alice
            );

            const clearAliceTotalPay = await fhevm.userDecryptEuint(
                FhevmType.euint64,
                employee.encTotalReceived,
                fhepayrollAddress,
                alice
            );
            expect(clearAliceTotalPay).to.eq(clearAliceBalance);
            expect(clearAliceBalance).to.eq(BigInt(salary) * BigInt(employee.lastUpdate - employee.hiredAt));
        })
    })
});

async function deployFixture(employerAddress: HardhatEthersSigner) {
    const tokenFactory = (await ethers.getContractFactory("FHEToken")) as FHEToken__factory;
    const tokenContract = (await tokenFactory.deploy(
        employerAddress.address,
        10_000_000_000n,
        "FHEToken",
        "FHE",
        "https://example.com"
    )) as FHEToken;

    const factory = (await ethers.getContractFactory("FHEPayroll")) as FHEPayroll__factory;
    const fhePayrollContract = (await factory.deploy(tokenContract.getAddress(), employerAddress.address)) as FHEPayroll;

    return { fhePayrollContract, tokenContract };
}

describe("FHEPayroll", function () {
    it('should map the employer address', async function () {
        const [employer] = await ethers.getSigners();
        
        const { fhePayrollContract } = await deployFixture(employer);
        const employerAddress = await fhePayrollContract.employer();
        expect(employerAddress).to.eq(employer.address);
    });

    it('should only allow the employer to add an employee', async function () {
        const [employer, other] = await ethers.getSigners();
        
        const { fhePayrollContract } = await deployFixture(employer);
        const fhePayrollContractAddress = await fhePayrollContract.getAddress();

        const salary = 1000;
        const encryptedSalary = await fhevm
              .createEncryptedInput(fhePayrollContractAddress, employer.address)
              .add64(salary)
              .encrypt();
        
        await expect(fhePayrollContract.connect(other)
            .addEmployee(other.address, encryptedSalary.handles[0], encryptedSalary.inputProof))
            .to.be.revertedWith("Payroll: not employer");

        await expect(fhePayrollContract.connect(employer)
            .addEmployee(other.address, encryptedSalary.handles[0], encryptedSalary.inputProof))
            .to.emit(fhePayrollContract, "EmployeeAdded");
    })

    it('should allow the employer and the employee to decrypt the salary', async function () {
        const [employer, employee, other] = await ethers.getSigners();
        
        const { fhePayrollContract } = await deployFixture(employer);
        const fhePayrollContractAddress = await fhePayrollContract.getAddress();

        const salary = 1000;
        const encryptedSalary = await fhevm
              .createEncryptedInput(fhePayrollContractAddress, employer.address)
              .add64(salary)
              .encrypt();
        
        await expect(fhePayrollContract.connect(employer)
            .addEmployee(employee.address, encryptedSalary.handles[0], encryptedSalary.inputProof))
            .to.emit(fhePayrollContract, "EmployeeAdded");

        const encryptedSalaryHandle = await fhePayrollContract.getSalary(employee.address);
        const clearSalaryByEmployee = await fhevm.userDecryptEuint(
              FhevmType.euint64,
              encryptedSalaryHandle,
              fhePayrollContractAddress,
              employee,
            );
        const clearSalaryByEmployer = await fhevm.userDecryptEuint(
              FhevmType.euint64,
              encryptedSalaryHandle,
              fhePayrollContractAddress,
              employer,
            );
        expect(clearSalaryByEmployee).to.eq(salary);
        expect(clearSalaryByEmployer).to.eq(salary);

        await expect(
            fhevm.userDecryptEuint(
                FhevmType.euint64, 
                encryptedSalaryHandle, 
                fhePayrollContractAddress, 
                other
            )
        ).to.be.rejected;
    })
});
