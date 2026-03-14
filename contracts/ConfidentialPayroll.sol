// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";

/**
 * @title ConfidentialPayroll
 * @notice Manages company payroll where salaries and disbursements are
 *         stored as FHE-encrypted values.
 *
 * Token model (token-agnostic):
 *   - The employer sets any IERC7984-compliant token as the payment token.
 *   - The employer holds the treasury in their own wallet and sets the
 *     payroll contract as an operator on the token for the desired duration.
 *   - On each payroll run, this contract calls
 *     token.confidentialTransferFrom(employer, employee, salary)
 *     — no custom token modifications required.
 *
 * Changing the payment token:
 *   - The employer can call setPaymentToken() to switch currencies at any time
 *     (e.g. move from cUSDC to cUSDT). The new token takes effect on the next
 *     payroll run. Existing salary handles remain valid; only the token used
 *     for disbursement changes.
 *
 * Roles:
 *   - Employer (contract owner): registers employees, sets encrypted salaries,
 *     triggers payroll runs, manages the payment token.
 *   - Employee: decrypts their own salary and cumulative payment total via the
 *     Zama Gateway.
 */
contract ConfidentialPayroll is ZamaEthereumConfig {

    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    struct Employee {
        address wallet;
        bool    active;
        uint64  hiredAt;
        uint64  lastPaidAt;
        /// Encrypted monthly salary. Only employer + employee hold ACL access.
        euint64 encSalary;
        /// Running encrypted cumulative total of all payments received.
        euint64 encTotalReceived;
    }

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    address   public employer;

    /// @notice The ERC-7984 token used for payroll disbursement.
    /// @dev    Can be changed by the employer. The employer must hold a balance
    ///         of this token and have set this contract as an operator on it.
    IERC7984  public paymentToken;

    uint256   public nextEmployeeId = 1;

    mapping(uint256 => Employee) private _employees;
    mapping(address => uint256)  public  employeeId;  // wallet → id

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    /// @dev Salary amount is intentionally NOT logged.
    event EmployeeAdded(uint256 indexed id, address indexed wallet, uint256 timestamp);
    event SalaryUpdated(uint256 indexed id, uint256 timestamp);
    event EmployeeDeactivated(uint256 indexed id, uint256 timestamp);

    /// @notice Emitted when the payment token is changed.
    event PaymentTokenUpdated(address indexed previousToken, address indexed newToken);

    /// @dev Individual amounts are NOT logged.
    event PayrollExecuted(uint256 timestamp, uint256 employeeCount);
    event PaymentSent(uint256 indexed employeeId, uint256 timestamp);

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier onlyEmployer() {
        require(msg.sender == employer, "Payroll: not employer");
        _;
    }

    modifier employeeExists(uint256 id) {
        require(id > 0 && id < nextEmployeeId, "Payroll: unknown employee");
        _;
    }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /**
     * @param initialToken  Address of the initial IERC7984 payment token.
     *
     * @dev Before executing payroll, the employer must call
     *      token.setOperator(address(this), expirationTimestamp)
     *      on the chosen token so this contract can pull funds.
     */
    constructor(address initialToken) {
        require(initialToken != address(0), "Payroll: zero token address");
        employer     = msg.sender;
        paymentToken = IERC7984(initialToken);
        emit PaymentTokenUpdated(address(0), initialToken);
    }

    // -------------------------------------------------------------------------
    // Token management (employer only)
    // -------------------------------------------------------------------------

    /**
     * @notice Change the ERC-7984 token used for salary disbursement.
     * @param newToken  Address of the new IERC7984-compliant token.
     *
     * @dev The employer must separately call setOperator on the new token.
     *      This function does not validate that the operator approval exists —
     *      a missing approval will simply cause the next payroll run to silently
     *      disburse zero (ERC-7984 safe-transfer behaviour).
     */
    function setPaymentToken(address newToken) external onlyEmployer {
        require(newToken != address(0), "Payroll: zero token address");
        address previous = address(paymentToken);
        paymentToken = IERC7984(newToken);
        emit PaymentTokenUpdated(previous, newToken);
    }

    // -------------------------------------------------------------------------
    // Employee management (employer only)
    // -------------------------------------------------------------------------

    /**
     * @notice Register a new employee with an encrypted monthly salary.
     *
     * @param wallet            Employee's wallet address.
     * @param encSalaryInput    Salary encrypted client-side via the fhevm SDK.
     * @param inputProof        Accompanying ZK input proof.
     */
    function addEmployee(
        address         wallet,
        externalEuint64 encSalaryInput,
        bytes calldata  inputProof
    ) external onlyEmployer {
        require(wallet != address(0),     "Payroll: zero address");
        require(employeeId[wallet] == 0,  "Payroll: already registered");

        uint256 id        = nextEmployeeId++;
        euint64 encSalary = FHE.fromExternal(encSalaryInput, inputProof);

        _employees[id] = Employee({
            wallet:           wallet,
            active:           true,
            hiredAt:          uint64(block.timestamp),
            lastPaidAt:       0,
            encSalary:        encSalary,
            encTotalReceived: FHE.asEuint64(0)
        });

        employeeId[wallet] = id;

        // ACL: contract keeps operational access; employer and employee can decrypt.
        FHE.allowThis(encSalary);
        FHE.allow(encSalary, employer);
        FHE.allow(encSalary, wallet);

        FHE.allowThis(_employees[id].encTotalReceived);
        FHE.allow(_employees[id].encTotalReceived, wallet);
        FHE.allow(_employees[id].encTotalReceived, employer);

        emit EmployeeAdded(id, wallet, block.timestamp);
    }

    /**
     * @notice Update an active employee's salary.
     *
     * @param id                Employee ID.
     * @param encSalaryInput    New salary encrypted client-side.
     * @param inputProof        Accompanying ZK input proof.
     */
    function updateSalary(
        uint256         id,
        externalEuint64 encSalaryInput,
        bytes calldata  inputProof
    ) external onlyEmployer employeeExists(id) {
        require(_employees[id].active, "Payroll: employee inactive");

        euint64 encSalary        = FHE.fromExternal(encSalaryInput, inputProof);
        _employees[id].encSalary = encSalary;

        FHE.allowThis(encSalary);
        FHE.allow(encSalary, employer);
        FHE.allow(encSalary, _employees[id].wallet);

        emit SalaryUpdated(id, block.timestamp);
    }

    /**
     * @notice Deactivate an employee (e.g. upon termination).
     *         Historical salary and payment data is preserved on-chain.
     */
    function deactivateEmployee(uint256 id)
        external
        onlyEmployer
        employeeExists(id)
    {
        require(_employees[id].active, "Payroll: already inactive");
        _employees[id].active = false;
        emit EmployeeDeactivated(id, block.timestamp);
    }

    // -------------------------------------------------------------------------
    // Payroll execution (employer only)
    // -------------------------------------------------------------------------

    /**
     * @notice Execute payroll for a batch of employee IDs.
     *
     * @dev For each active employee this contract calls:
     *        token.confidentialTransferFrom(employer, employee.wallet, employee.encSalary)
     *
     *      Prerequisites the employer must complete before calling:
     *        1. Hold sufficient balance of `paymentToken`
     *        2. Call paymentToken.setOperator(address(this), expiration)
     *           with an expiration far enough in the future.
     *
     *      Because ERC-7984 transfers use FHE.select internally, an
     *      insufficient employer balance results in a zero transfer rather
     *      than a revert — preserving confidentiality. The PaymentSent event
     *      is still emitted; the off-chain indexer can detect shortfalls by
     *      decrypting the employer's balance after the run.
     *
     * @param ids  Array of employee IDs to pay in this run.
     */
    function executePayroll(uint256[] calldata ids) external onlyEmployer {
        require(ids.length > 0, "Payroll: empty batch");

        // Snapshot the token reference once — guards against reentrancy
        // via a mid-run setPaymentToken call.
        IERC7984 token = paymentToken;

        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];
            if (id == 0 || id >= nextEmployeeId) continue;

            Employee storage emp = _employees[id];
            if (!emp.active) continue;

            _payEmployee(id, emp, token);
        }

        emit PayrollExecuted(block.timestamp, ids.length);
    }

    // -------------------------------------------------------------------------
    // Employee views (each employee reads only their own data)
    // -------------------------------------------------------------------------

    /**
     * @notice Returns the caller's encrypted salary handle.
     *         Submit this to the Zama Gateway to obtain the plaintext.
     *
     * @dev The ACL set during addEmployee/updateSalary ensures only the
     *      employee (and employer) can pass Gateway decryption.
     */
    function myEncryptedSalary() external view returns (euint64) {
        uint256 id = employeeId[msg.sender];
        require(id != 0, "Payroll: not an employee");
        return _employees[id].encSalary;
    }

    /**
     * @notice Returns the caller's encrypted cumulative total received.
     *         Submit this to the Zama Gateway to obtain the plaintext.
     */
    function myEncryptedTotal() external view returns (euint64) {
        uint256 id = employeeId[msg.sender];
        require(id != 0, "Payroll: not an employee");
        return _employees[id].encTotalReceived;
    }

    // -------------------------------------------------------------------------
    // Employer views
    // -------------------------------------------------------------------------

    /**
     * @notice Returns an employee's encrypted salary handle (employer only).
     *         The employer already holds ACL access set during registration.
     */
    function employeeEncryptedSalary(uint256 id)
        external
        view
        onlyEmployer
        employeeExists(id)
        returns (euint64)
    {
        return _employees[id].encSalary;
    }

    /**
     * @notice Returns public (non-sensitive) metadata for an employee.
     */
    function employeeInfo(uint256 id)
        external
        view
        employeeExists(id)
        returns (
            address wallet,
            bool    active,
            uint256 hiredAt,
            uint256 lastPaidAt
        )
    {
        Employee storage emp = _employees[id];
        return (emp.wallet, emp.active, emp.hiredAt, emp.lastPaidAt);
    }

    /// @notice Total number of registered employees (including inactive).
    function totalEmployees() external view returns (uint256) {
        return nextEmployeeId - 1;
    }

    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

    function _payEmployee(
        uint256          id,
        Employee storage emp,
        IERC7984         token
    ) internal {
        // Grant the token contract transient ACL access to the salary handle
        // so it can perform the encrypted arithmetic internally.
        FHE.allowTransient(emp.encSalary, address(token));

        // Pull salary from employer wallet → employee wallet.
        // confidentialTransferFrom returns the actual euint64 transferred
        // (may be zero if employer balance was insufficient).
        euint64 transferred = token.confidentialTransferFrom(
            employer,
            emp.wallet,
            emp.encSalary
        );

        // Update encrypted running total with the actual transferred amount.
        emp.encTotalReceived = FHE.add(emp.encTotalReceived, transferred);
        FHE.allowThis(emp.encTotalReceived);
        FHE.allow(emp.encTotalReceived, emp.wallet);
        FHE.allow(emp.encTotalReceived, employer);

        emp.lastPaidAt = uint64(block.timestamp);

        emit PaymentSent(id, block.timestamp);
    }
}
