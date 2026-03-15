// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";

/// @title FHE Payroll Contract
/// @author Gimzou
/// @notice Manages confidential salaries and payroll using Zama FHE
contract FHEPayroll is ZamaEthereumConfig {
    // ── Types ────────────────────────────────────────────────────────────────
    enum EmployeeStatus {
        None,
        Active,
        Inactive,
        Terminated
    }

    struct Employee {
        EmployeeStatus status;
        uint256 index;
        uint64 hiredAt;
        uint64 lastUpdate;
        // ── FHE fields (handles — re-grant ACL on every write) ─
        euint64 encSalary; // salary in token per second
        euint64 encClaimable; // claimable amount
        euint64 encTotalReceived; // cumulative pay
    }

    // ── Errors ───────────────────────────────────────────────────────────────

    error NotEmployer();
    error NotEmployerOrSelf();
    error InvalidEmployeeStatus(EmployeeStatus required, EmployeeStatus current);
    error InvalidEmployeeAddress();
    error EmployeeNotFound();
    error EmployeeNotActive();
    error EmployeeMustBeActiveOrInactive();

    // ── State ────────────────────────────────────────────────────────────────

    /// @notice The address of the employer
    address public employer;

    /// @notice The payment token contract (ERC7984)
    ERC7984 public paymentToken;

    /// @notice List of all employee addresses
    address[] public employeeList;

    /// @notice Mapping from employee address to their data
    mapping(address employee => Employee data) public employees;

    // ── Events ───────────────────────────────────────────────────────────────

    /// @notice Emitted when a new employee is added
    /// @param employee The address of the added employee
    event EmployeeAdded(address indexed employee);

    /// @notice Emitted when an employee's status changes
    /// @param employee The address of the employee
    /// @param oldStatus The previous status
    /// @param newStatus The new status
    event EmployeeStatusChanged(address indexed employee, EmployeeStatus oldStatus, EmployeeStatus newStatus);

    /// @notice Emitted when an employee is deleted from the payroll
    /// @param employee The address of the deleted employee
    event EmployeeDeleted(address indexed employee);

    /// @notice Emitted when an employee's salary is updated
    /// @param employee The address of the employee
    event SalaryUpdated(address indexed employee);

    /// @notice Emitted when an employee claims their pay
    /// @param employee The address of the employee
    /// @param timestamp The time of withdrawal
    event PayWithdrawn(address indexed employee, uint64 indexed timestamp);

    // ── Access control ───────────────────────────────────────────────────────

    modifier onlyEmployer() {
        if (msg.sender != employer) revert NotEmployer();
        _;
    }

    modifier onlyEmployerOrSelf(address _employee) {
        if (msg.sender != employer && msg.sender != _employee) revert NotEmployerOrSelf();
        _;
    }

    modifier onlyStatus(address _employee, EmployeeStatus _requiredStatus) {
        if (employees[_employee].status != _requiredStatus) {
            revert InvalidEmployeeStatus(_requiredStatus, employees[_employee].status);
        }
        _;
    }

    /// @notice Constructor
    /// @param _token  Address of the IERC7984 payment token.
    /// @param _employer  Address of the employer.
    constructor(address _token, address _employer) {
        paymentToken = ERC7984(_token);
        employer = _employer;
    }

    // ── Employee management ──────────────────────────────────────────────────

    /// @notice Add an employee
    /// @param _employee  Address of the employee.
    /// @param _encryptedSalary  Encrypted monthly salary.
    /// @param _inputProof  ZK proof that the ciphertext is valid.
    function addEmployee(
        address _employee,
        externalEuint64 _encryptedSalary,
        bytes calldata _inputProof
    ) external onlyEmployer onlyStatus(_employee, EmployeeStatus.None) {
        if (_employee == address(0)) revert InvalidEmployeeAddress();

        uint64 nowTime = uint64(block.timestamp);
        euint64 salary = FHE.fromExternal(_encryptedSalary, _inputProof);

        employeeList.push(_employee);

        employees[_employee] = Employee({
            status: EmployeeStatus.Active,
            index: employeeList.length - 1,
            hiredAt: nowTime,
            lastUpdate: nowTime,
            encSalary: salary,
            encClaimable: FHE.asEuint64(0),
            encTotalReceived: FHE.asEuint64(0)
        });

        FHE.allowThis(employees[_employee].encSalary);
        FHE.allow(employees[_employee].encSalary, employer);
        FHE.allow(employees[_employee].encSalary, _employee);

        FHE.allowThis(employees[_employee].encClaimable);
        FHE.allow(employees[_employee].encClaimable, employer);
        FHE.allow(employees[_employee].encClaimable, _employee);

        FHE.allowThis(employees[_employee].encTotalReceived);
        FHE.allow(employees[_employee].encTotalReceived, employer);
        FHE.allow(employees[_employee].encTotalReceived, _employee);

        emit EmployeeAdded(_employee);
    }

    /// @notice Get the info of an employee
    /// @param _employee The address of the employee
    /// @return The Employee struct
    function getEmployee(address _employee) external view onlyEmployerOrSelf(_employee) returns (Employee memory) {
        if (employees[_employee].status == EmployeeStatus.None) revert EmployeeNotFound();

        return employees[_employee];
    }

    /// @notice Deactivate an employee
    /// @param _employee  Address of the employee.
    function deactivateEmployee(address _employee) external onlyEmployer onlyStatus(_employee, EmployeeStatus.Active) {
        _accrueEarnings(_employee);

        employees[_employee].lastUpdate = uint64(block.timestamp);
        employees[_employee].status = EmployeeStatus.Inactive;

        emit EmployeeStatusChanged(_employee, EmployeeStatus.Active, EmployeeStatus.Inactive);
    }

    /// @notice Activate an employee
    /// @param _employee  Address of the employee.
    function activateEmployee(address _employee) external onlyEmployer onlyStatus(_employee, EmployeeStatus.Inactive) {
        _accrueEarnings(_employee);

        employees[_employee].lastUpdate = uint64(block.timestamp);
        employees[_employee].status = EmployeeStatus.Active;

        emit EmployeeStatusChanged(_employee, EmployeeStatus.Inactive, EmployeeStatus.Active);
    }

    /// @notice Terminate an employee (allowed from Active or Inactive/Paused status)
    /// @param _employee  Address of the employee.
    function terminateEmployee(address _employee) external onlyEmployer {
        EmployeeStatus current = employees[_employee].status;
        if (current != EmployeeStatus.Active && current != EmployeeStatus.Inactive) {
            revert EmployeeMustBeActiveOrInactive();
        }
        _accrueEarnings(_employee);

        employees[_employee].lastUpdate = uint64(block.timestamp);
        employees[_employee].status = EmployeeStatus.Terminated;

        emit EmployeeStatusChanged(_employee, current, EmployeeStatus.Terminated);
    }

    /// @notice Delete an employee from the payroll
    /// @param _employee  Address of the employee.
    function deleteEmployee(address _employee) external onlyEmployer onlyStatus(_employee, EmployeeStatus.Terminated) {
        uint256 indexToRemove = employees[_employee].index;
        uint256 lastIndex = employeeList.length - 1;

        if (indexToRemove != lastIndex) {
            address lastEmployee = employeeList[lastIndex];
            employeeList[indexToRemove] = lastEmployee;
            employees[lastEmployee].index = indexToRemove;
        }

        employeeList.pop();

        delete employees[_employee];

        emit EmployeeDeleted(_employee);
    }

    // ── Salary management ────────────────────────────────────────────────────

    /// @notice Update an employee's salary
    /// @param _employee  Address of the employee.
    /// @param _encryptedSalary  The salary already encrypted client-side
    /// @param _inputProof       The ZK proof that the ciphertext is valid
    function updateSalary(
        address _employee,
        externalEuint64 _encryptedSalary,
        bytes calldata _inputProof
    ) external onlyEmployer {
        EmployeeStatus current = employees[_employee].status;
        if (current != EmployeeStatus.Active && current != EmployeeStatus.Inactive) {
            revert EmployeeMustBeActiveOrInactive();
        }
        _accrueEarnings(_employee);

        euint64 salary = FHE.fromExternal(_encryptedSalary, _inputProof);
        employees[_employee].encSalary = salary;

        // Grant decryption rights
        FHE.allowThis(employees[_employee].encSalary);
        FHE.allow(employees[_employee].encSalary, employer);
        FHE.allow(employees[_employee].encSalary, _employee);

        emit SalaryUpdated(_employee);
    }

    /// @notice Returns the encrypted handle of the salary (expressed in payment token per second)
    /// @param _employee  Address of the employee.
    /// @return The encrypted salary handle
    function getSalary(address _employee) external view onlyEmployerOrSelf(_employee) returns (euint64) {
        if (employees[_employee].status == EmployeeStatus.None) revert EmployeeNotFound();

        return employees[_employee].encSalary;
    }

    /// @notice On-demand earnings accrual — lets any authorised party sync the
    ///         claimable balance without changing employment status.
    /// @param _employee  Address of the employee.
    function accrueEarnings(address _employee) external onlyEmployerOrSelf(_employee) {
        if (employees[_employee].status != EmployeeStatus.Active) revert EmployeeNotActive();
        _accrueEarnings(_employee);
    }

    /// @notice Accrue earnings for an employee
    /// @param _employee  Address of the employee.
    function _accrueEarnings(address _employee) internal {
        Employee storage employee = employees[_employee];

        uint64 nowTime = uint64(block.timestamp);
        uint64 elapsedSeconds = nowTime - employee.lastUpdate;
        employee.lastUpdate = nowTime;

        if (employee.status == EmployeeStatus.Active && elapsedSeconds > 0) {
            // Use scalar operands when possible to save gas
            euint64 newlyEarned = FHE.mul(employee.encSalary, elapsedSeconds);

            // Add the newly earned amount to the "claimable amount"
            euint64 newClaimable = FHE.add(employee.encClaimable, newlyEarned);
            employee.encClaimable = newClaimable;

            FHE.allowThis(employee.encClaimable);
            FHE.allow(employee.encClaimable, employer);
            FHE.allow(employee.encClaimable, _employee);
        }
    }

    // ── Payment management ───────────────────────────────────────────────────

    /// @notice Claim payment for an employee (Active, Inactive, or Terminated).
    ///         Deactivation/termination stops accrual but does not forfeit
    ///         any already-accrued balance.
    function claimPay() external {
        EmployeeStatus current = employees[msg.sender].status;
        if (
            current != EmployeeStatus.Active &&
            current != EmployeeStatus.Inactive &&
            current != EmployeeStatus.Terminated
        ) {
            revert EmployeeNotFound();
        }
        Employee storage employee = employees[msg.sender];
        uint64 nowTime = uint64(block.timestamp);

        _accrueEarnings(msg.sender);
        euint64 claimable = employee.encClaimable;
        FHE.allow(claimable, address(paymentToken));

        employee.encTotalReceived = FHE.add(employee.encTotalReceived, claimable);
        employee.encClaimable = FHE.asEuint64(0);

        FHE.allowThis(employee.encTotalReceived);
        FHE.allow(employee.encTotalReceived, employer);
        FHE.allow(employee.encTotalReceived, msg.sender);

        FHE.allowThis(employee.encClaimable);
        FHE.allow(employee.encClaimable, employer);
        FHE.allow(employee.encClaimable, msg.sender);

        paymentToken.confidentialTransferFrom(employer, msg.sender, claimable);

        emit PayWithdrawn(msg.sender, nowTime);
    }
}
