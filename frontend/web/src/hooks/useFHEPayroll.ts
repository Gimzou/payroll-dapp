/**
 * useFHEPayroll — FHE Payroll contract interaction hook
 *
 * Mirrors the `useFHECounterWagmi` pattern from the Zama fhevm-react-template:
 * - Read employees via `useReadContract` (wagmi)
 * - Get ethers signer from wagmi's connector client
 * - Use React SDK's `useEncrypt` and `useUserDecryptFlow` for FHE operations
 * - Use toast for user feedback (react-hot-toast)
 *
 * This is the single source of truth for all contract interactions in the app.
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useChainId } from 'wagmi';
import { useZamaSDK, useEncrypt, useUserDecryptFlow } from '@zama-fhe/react-sdk';
import toast from 'react-hot-toast';
import {
  FHE_PAYROLL_ADDRESS,
  FHE_PAYROLL_ABI,
  FHE_TOKEN_ADDRESS,
  FHE_TOKEN_ABI,
} from '@/lib/contracts';

export interface EmployeeData {
  address: string;
  status: number;
  hiredAt: bigint;
  encSalary: string;
  decryptedSalary?: string;
  isRevealing?: boolean;
}

export function useFHEPayroll(signer: ethers.Signer | undefined) {
  const sdk = useZamaSDK();
  const encrypt = useEncrypt();
  const decryptFlow = useUserDecryptFlow();
  const chainId = useChainId();

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------
  const [employees, setEmployees] = useState<EmployeeData[]>([]);
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [isLoadingEmployees, setIsLoadingEmployees] = useState(false);
  const [txPending, setTxPending] = useState(false);

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  const getContract = useCallback(
    (abi: ethers.InterfaceAbi, address: string, mode: 'read' | 'write' = 'write') => {
      return new ethers.Contract(address, abi, mode === 'write' ? signer : signer?.provider ?? signer);
    },
    [signer],
  );

  // ------------------------------------------------------------------
  // Read: authorization status
  // ------------------------------------------------------------------
  const checkAuthorization = useCallback(async () => {
    if (!signer) return;
    try {
      const addr = await signer.getAddress();
      const tokenContract = getContract(FHE_TOKEN_ABI, FHE_TOKEN_ADDRESS, 'read');
      const authorized = await tokenContract.isOperator(addr, FHE_PAYROLL_ADDRESS);
      setIsAuthorized(authorized);
    } catch (err) {
      console.error('Authorization check failed:', err);
    }
  }, [signer, getContract]);

  // ------------------------------------------------------------------
  // Read: employee list (imperative, since it's a paginated list)
  // ------------------------------------------------------------------
  const fetchEmployees = useCallback(async () => {
    if (!signer) return;
    setIsLoadingEmployees(true);
    try {
      // Must use signer (not provider) because getEmployee() has onlyEmployerOrSelf modifier
      // that checks msg.sender — a bare provider sends eth_call with from=0x0 which fails
      const contract = getContract(FHE_PAYROLL_ABI, FHE_PAYROLL_ADDRESS, 'write');
      const list: EmployeeData[] = [];
      let i = 0;
      while (true) {
        try {
          const addr = await contract.employeeList(i);
          const data = await contract.getEmployee(addr);
          list.push({
            address: addr,
            status: Number(data.status),
            hiredAt: data.hiredAt,
            encSalary: data.encSalary,
          });
          i++;
        } catch {
          break; // End of list
        }
      }
      setEmployees(list);
    } catch (err) {
      console.error('Failed to fetch employees:', err);
      toast.error('Failed to load employees from chain.');
    } finally {
      setIsLoadingEmployees(false);
    }
  }, [signer, getContract]);

  useEffect(() => {
    if (signer) {
      fetchEmployees();
      checkAuthorization();
    }
  }, [signer, fetchEmployees, checkAuthorization]);

  // ------------------------------------------------------------------
  // Write: authorize payroll contract as operator
  // ------------------------------------------------------------------
  const handleAuthorize = useCallback(async () => {
    if (!signer) return;
    const toastId = toast.loading('Authorizing Payroll contract...');
    try {
      setTxPending(true);
      const tokenContract = getContract(FHE_TOKEN_ABI, FHE_TOKEN_ADDRESS);
      const until = Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 60 * 60; // 10 years
      const tx = await tokenContract.setOperator(FHE_PAYROLL_ADDRESS, until);
      await tx.wait();
      setIsAuthorized(true);
      toast.success('Payroll contract authorized!', { id: toastId });
    } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast.error(`Authorization failed: ${err.reason || err.message}`, { id: toastId });
    } finally {
      setTxPending(false);
    }
  }, [signer, getContract]);

  // ------------------------------------------------------------------
  // Write: add employee (FHE-encrypted salary)
  // ------------------------------------------------------------------
  const handleAddEmployee = useCallback(
    async (employeeAddress: string, salaryStr: string): Promise<boolean> => {
      if (!signer || !sdk) {
        toast.error('FHE system not ready.');
        return false;
      }
      const toastId = toast.loading('1/3: Encrypting salary with FHE...');
      try {
        setTxPending(true);
        const salaryValue = parseInt(salaryStr, 10);
        const userAddr = (await signer.getAddress()) as `0x${string}`;

        const result = await encrypt.mutateAsync({
          values: [{ value: BigInt(salaryValue), type: 'euint64' }],
          contractAddress: FHE_PAYROLL_ADDRESS,
          userAddress: userAddr,
        });

        toast.loading('2/3: Awaiting MetaMask confirmation...', { id: toastId });
        const contract = getContract(FHE_PAYROLL_ABI, FHE_PAYROLL_ADDRESS);
        const tx = await contract.addEmployee(employeeAddress, result.handles[0], result.inputProof, {
          gasLimit: 1_200_000,
        });

        toast.loading('3/3: Mining confidential record...', { id: toastId });
        await tx.wait();
        toast.success('Employee added to confidential ledger!', { id: toastId });
        fetchEmployees();
        return true;
      } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        toast.error(`Registration failed: ${err.reason || err.message}`, { id: toastId });
        return false;
      } finally {
        setTxPending(false);
      }
    },
    [signer, sdk, encrypt, getContract, fetchEmployees],
  );

  // ------------------------------------------------------------------
  // FHE Decrypt: reveal salary for a specific employee
  // ------------------------------------------------------------------
  const handleReveal = useCallback(
    async (index: number) => {
      const emp = employees[index];
      if (!emp || !sdk) {
        toast.error('FHE system not ready.');
        return;
      }
      setEmployees(prev => {
        const next = [...prev];
        next[index] = { ...next[index], isRevealing: true };
        return next;
      });
      const toastId = toast.loading('Decrypting salary...');
      try {
        const handleHex = ethers.toBeHex(BigInt(emp.encSalary), 32) as `0x${string}`;
        const results = await decryptFlow.mutateAsync({
          handles: [{ handle: handleHex, contractAddress: FHE_PAYROLL_ADDRESS }],
          durationDays: 30,
        });
        const clearValue = results[handleHex]?.toString() ?? '0';
        setEmployees(prev => {
          const next = [...prev];
          next[index] = { ...next[index], decryptedSalary: clearValue, isRevealing: false };
          return next;
        });
        toast.success(`Salary revealed: ${clearValue} tokens`, { id: toastId });
      } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        toast.error(`Decryption failed: ${err.message}`, { id: toastId });
        setEmployees(prev => {
          const next = [...prev];
          next[index] = { ...next[index], isRevealing: false };
          return next;
        });
      }
    },
    [employees, sdk, decryptFlow],
  );

  // ------------------------------------------------------------------
  // Write: deactivate / terminate / delete employee
  // ------------------------------------------------------------------
  const handleEmployeeAction = useCallback(
    async (address: string, action: 'activate' | 'deactivate' | 'terminate' | 'delete') => {
      if (!signer) return;
      const toastId = toast.loading(`${action.charAt(0).toUpperCase() + action.slice(1)}ing employee...`);
      try {
        setTxPending(true);
        const contract = getContract(FHE_PAYROLL_ABI, FHE_PAYROLL_ADDRESS);
        let tx;
        if (action === 'activate') tx = await contract.activateEmployee(address);
        else if (action === 'deactivate') tx = await contract.deactivateEmployee(address);
        else if (action === 'terminate') tx = await contract.terminateEmployee(address);
        else tx = await contract.deleteEmployee(address);
        await tx.wait();
        toast.success(`Employee ${action}d successfully.`, { id: toastId });
        fetchEmployees();
      } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        toast.error(`Action failed: ${err.reason || err.message}`, { id: toastId });
      } finally {
        setTxPending(false);
      }
    },
    [signer, getContract, fetchEmployees],
  );

  return {
    // State
    employees,
    isAuthorized,
    isLoadingEmployees,
    txPending,
    fheReady: Boolean(sdk),
    chainId,
    // Actions
    fetchEmployees,
    checkAuthorization,
    handleAddEmployee,
    handleReveal,
    handleAuthorize,
    handleEmployeeAction,
    // Expose decrypt flow status for UI
    isDecrypting: decryptFlow.isPending,
  };
}

// ------------------------------------------------------------------
// Employee-specific hook
// ------------------------------------------------------------------
export interface EmployeeChainData {
  status: number;
  index: bigint;
  hiredAt: bigint;
  lastUpdate: bigint;
  encSalary: string;
  encClaimable: string;
  encTotalReceived: string;
}

export const STATUS_LABELS: Record<number, string> = {
  0: 'None',
  1: 'Active',
  2: 'Inactive',
  3: 'Terminated',
};

export function useFHEEmployee(signer: ethers.Signer | undefined) {
  const sdk = useZamaSDK();
  const decryptFlow = useUserDecryptFlow();
  const chainId = useChainId();

  const [employeeData, setEmployeeData] = useState<EmployeeChainData | null>(null);
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [txPending, setTxPending] = useState(false);

  // Separate decrypt states for salary rate vs claimable balance
  const [decryptedSalary, setDecryptedSalary] = useState<string | null>(null);
  const [decryptedClaimable, setDecryptedClaimable] = useState<string | null>(null);
  const [decryptedTotalReceived, setDecryptedTotalReceived] = useState<string | null>(null);
  const [isDecryptingSalary, setIsDecryptingSalary] = useState(false);
  const [isDecryptingClaimable, setIsDecryptingClaimable] = useState(false);
  const [isDecryptingTotal, setIsDecryptingTotal] = useState(false);

  const fetchData = useCallback(async () => {
    if (!signer) return;
    setLoading(true);
    try {
      const addr = await signer.getAddress();
      setAddress(addr);
      const contract = new ethers.Contract(FHE_PAYROLL_ADDRESS, FHE_PAYROLL_ABI, signer);
      const data = await contract.getEmployee(addr);
      setEmployeeData({
        status: Number(data.status),
        index: data.index,
        hiredAt: data.hiredAt,
        lastUpdate: data.lastUpdate,
        encSalary: data.encSalary,
        encClaimable: data.encClaimable,
        encTotalReceived: data.encTotalReceived,
      });
    } catch (err) {
      console.error('Failed to fetch employee data', err);
    } finally {
      setLoading(false);
    }
  }, [signer]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Helper to decrypt a single FHE handle
  const decryptHandle = useCallback(
    async (encValue: string, label: string): Promise<string | null> => {
      if (!sdk) {
        toast.error('FHE system not ready.');
        return null;
      }
      const toastId = toast.loading(`Decrypting ${label}...`);
      try {
        const handleHex = ethers.toBeHex(BigInt(encValue), 32) as `0x${string}`;
        const results = await decryptFlow.mutateAsync({
          handles: [{ handle: handleHex, contractAddress: FHE_PAYROLL_ADDRESS }],
          durationDays: 30,
        });
        const clear = results[handleHex]?.toString() ?? '0';
        toast.success(`${label}: ${clear} tokens/s`, { id: toastId });
        return clear;
      } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        toast.error(`Decryption failed: ${err.message}`, { id: toastId });
        return null;
      }
    },
    [sdk, decryptFlow],
  );

  const handleRevealSalary = useCallback(async () => {
    if (!employeeData) return;
    setIsDecryptingSalary(true);
    const result = await decryptHandle(employeeData.encSalary, 'Salary rate');
    if (result) setDecryptedSalary(result);
    setIsDecryptingSalary(false);
  }, [employeeData, decryptHandle]);

  const handleRevealClaimable = useCallback(async () => {
    if (!employeeData) return;
    setIsDecryptingClaimable(true);
    const result = await decryptHandle(employeeData.encClaimable, 'Claimable balance');
    if (result) setDecryptedClaimable(result);
    setIsDecryptingClaimable(false);
  }, [employeeData, decryptHandle]);

  const handleRevealTotalReceived = useCallback(async () => {
    if (!employeeData) return;
    setIsDecryptingTotal(true);
    const result = await decryptHandle(employeeData.encTotalReceived, 'Total received');
    if (result) setDecryptedTotalReceived(result);
    setIsDecryptingTotal(false);
  }, [employeeData, decryptHandle]);

  const handleClaim = useCallback(async () => {
    if (!signer || !employeeData) return;
    if (employeeData.status === 0) {
      toast.error('Cannot claim: you are not registered as an employee.');
      return;
    }
    const toastId = toast.loading('Claiming accrued pay...');
    try {
      setTxPending(true);
      const contract = new ethers.Contract(FHE_PAYROLL_ADDRESS, FHE_PAYROLL_ABI, signer);
      const tx = await contract.claimPay({ gasLimit: 1_500_000 });
      await tx.wait();
      toast.success('Pay claimed! Tokens transferred to your wallet.', { id: toastId });
      // Reset decrypted values since they changed on-chain
      setDecryptedClaimable(null);
      setDecryptedTotalReceived(null);
      fetchData();
    } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast.error(`Claim failed: ${err.reason || err.message}`, { id: toastId });
    } finally {
      setTxPending(false);
    }
  }, [signer, employeeData, fetchData]);

  return {
    employeeData,
    address,
    loading,
    txPending,
    fheReady: Boolean(sdk),
    chainId,
    // Salary rate
    decryptedSalary,
    isDecryptingSalary,
    handleRevealSalary,
    // Claimable balance
    decryptedClaimable,
    isDecryptingClaimable,
    handleRevealClaimable,
    // Total received
    decryptedTotalReceived,
    isDecryptingTotal,
    handleRevealTotalReceived,
    // Actions
    fetchData,
    handleClaim,
  };
}
