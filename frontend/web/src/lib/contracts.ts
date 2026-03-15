export const FHE_PAYROLL_ADDRESS = "0x3734095f5eC9a20247Fb32AF82800750a0e25078";
// Token address is resolved at runtime via payrollContract.paymentToken() — no hardcoded constant needed.

export const NETWORK_CONFIG = {
  // Local Hardhat Node
  31337: {
    kms: "0xbE0E383937d564D7FF0BC3b46c51f0bF8d5C311A",
    acl: "0xf0Ffdc93b7E186bC2f8CB3dAA75D86d1930A433D",
    inputVerifier: "0xBBC1fFCdc7C316aAAd72E807D9b0272BE8F84DA0", // Example Local/Standard
    decryptionAddress: "0x5D8BD78e2ea6bbE41f26dFe9fdaEAa349e077478",
    inputVerificationAddress: "0x483b9dE06E4E4C7D35CCf5837A1668487406D955",
    gateway: "http://localhost:8080",
    relayerUrl: "http://localhost:3000", // Local Relayer if any, usually same as gateway or specific
    gatewayChainId: 10901,
  },
  // Sepolia Testnet
  11155111: {
    kms: "0xbE0E383937d564D7FF0BC3b46c51f0bF8d5C311A",
    acl: "0xf0Ffdc93b7E186bC2f8CB3dAA75D86d1930A433D",
    inputVerifier: "0xBBC1fFCdc7C316aAAd72E807D9b0272BE8F84DA0",
    decryptionAddress: "0x5D8BD78e2ea6bbE41f26dFe9fdaEAa349e077478",
    inputVerificationAddress: "0x483b9dE06E4E4C7D35CCf5837A1668487406D955",
    gateway: "https://gateway.sepolia.zama.ai",
    relayerUrl: "https://relayer.testnet.zama.org",
    gatewayChainId: 10901,
  },
};

export const FHE_PAYROLL_ABI = [
  "function employeeList(uint256) view returns (address)",
  "function employer() view returns (address)",
  "function paymentToken() view returns (address)",
  "function getEmployee(address) view returns (tuple(uint8 status, uint256 index, uint64 hiredAt, uint64 lastUpdate, bytes32 encSalary, bytes32 encClaimable, bytes32 encTotalReceived))",
  "function getSalary(address) view returns (bytes32)",
  "function addEmployee(address, bytes32, bytes) external",
  "function updateSalary(address, bytes32, bytes) external",
  "function activateEmployee(address) external",
  "function deactivateEmployee(address) external",
  "function terminateEmployee(address) external",
  "function deleteEmployee(address) external",
  "function accrueEarnings(address) external",
  "function claimPay() external",
  "event EmployeeAdded(address indexed employee)",
  "event SalaryUpdated(address indexed employee)",
  "event PayWithdrawn(address indexed employee, uint64 timestamp)",
];

export const FHE_TOKEN_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (bytes32)",
  "function confidentialBalanceOf(address) view returns (bytes32)",
  "function approve(address, uint64) external returns (bool)",
  "function allowance(address, address) view returns (uint256)",
  "function setOperator(address, uint48) external",
  "function isOperator(address, address) view returns (bool)",
];
