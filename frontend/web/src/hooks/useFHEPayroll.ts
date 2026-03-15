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
"use client";

import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { useChainId } from "wagmi";
import { useZamaSDK, useEncrypt, useUserDecryptFlow } from "@zama-fhe/react-sdk";
import toast from "react-hot-toast";
import { FHE_PAYROLL_ADDRESS, FHE_PAYROLL_ABI, FHE_TOKEN_ABI } from "@/lib/contracts";

export interface EmployeeData {
  address: string;
  status: number;
  hiredAt: bigint;
  encSalary: string;
  encClaimable: string;
  encTotalReceived: string;
  decryptedSalary?: string;
  decryptedClaimable?: string;
  decryptedTotalReceived?: string;
  isRevealingSalary?: boolean;
  isRevealingClaimable?: boolean;
  isRevealingTotal?: boolean;
  salaryRevealedAt?: number; // JS timestamp (Date.now()) when salary was last decrypted
  lastUpdate: bigint;
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
  const [tokenSymbol, setTokenSymbol] = useState("token");
  const [tokenName, setTokenName] = useState("");
  const [tokenAddress, setTokenAddress] = useState("");
  const [decryptedOwnBalance, setDecryptedOwnBalance] = useState<string | undefined>(undefined);
  const [isRevealingOwnBalance, setIsRevealingOwnBalance] = useState(false);

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  const getContract = useCallback(
    (abi: ethers.InterfaceAbi, address: string, mode: "read" | "write" = "write") => {
      return new ethers.Contract(address, abi, mode === "write" ? signer : (signer?.provider ?? signer));
    },
    [signer],
  );

  // ------------------------------------------------------------------
  // Read: payment token metadata (resolved dynamically from paymentToken())
  // ------------------------------------------------------------------
  const fetchTokenInfo = useCallback(async () => {
    if (!signer) return;
    try {
      const payrollContract = getContract(FHE_PAYROLL_ABI, FHE_PAYROLL_ADDRESS, "read");
      const resolvedAddress: string = await payrollContract.paymentToken();
      const tokenContract = new ethers.Contract(resolvedAddress, FHE_TOKEN_ABI, signer.provider ?? signer);
      const [symbol, name]: [string, string] = await Promise.all([tokenContract.symbol(), tokenContract.name()]);
      setTokenAddress(resolvedAddress);
      setTokenSymbol(symbol);
      setTokenName(name);
    } catch (err) {
      console.error("Failed to fetch token info:", err);
    }
  }, [signer, getContract]);

  // ------------------------------------------------------------------
  // Read: authorization status
  // ------------------------------------------------------------------
  const checkAuthorization = useCallback(async () => {
    if (!signer) return;
    try {
      const addr = await signer.getAddress();
      const payrollContract = getContract(FHE_PAYROLL_ABI, FHE_PAYROLL_ADDRESS, "read");
      const tokenAddress: string = await payrollContract.paymentToken();
      const tokenContract = new ethers.Contract(tokenAddress, FHE_TOKEN_ABI, signer.provider ?? signer);
      const authorized: boolean = await tokenContract.isOperator(addr, FHE_PAYROLL_ADDRESS);
      setIsAuthorized(authorized);
    } catch (err) {
      console.error("Authorization check failed:", err);
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
      const contract = getContract(FHE_PAYROLL_ABI, FHE_PAYROLL_ADDRESS, "write");
      const freshList: Omit<
        EmployeeData,
        | "decryptedSalary"
        | "decryptedClaimable"
        | "decryptedTotalReceived"
        | "isRevealingSalary"
        | "isRevealingClaimable"
        | "isRevealingTotal"
        | "salaryRevealedAt"
      >[] = [];
      let i = 0;
      while (true) {
        try {
          const addr = await contract.employeeList(i);
          const data = await contract.getEmployee(addr);
          freshList.push({
            address: addr,
            status: Number(data.status),
            hiredAt: data.hiredAt,
            lastUpdate: data.lastUpdate,
            encSalary: data.encSalary,
            encClaimable: data.encClaimable,
            encTotalReceived: data.encTotalReceived,
          });
          i++;
        } catch {
          break; // End of list
        }
      }
      // Merge fresh chain data with existing decrypted state.
      // FHE handles (bytes32) are deterministically tied to their ciphertext:
      // if a handle changed on-chain (after updateSalary, claimPay, etc.),
      // the cached plaintext is automatically invalidated — no manual resets needed.
      setEmployees((prev) =>
        freshList.map((fresh) => {
          const existing = prev.find((e) => e.address === fresh.address);
          return {
            ...fresh,
            decryptedSalary: existing?.encSalary === fresh.encSalary ? existing.decryptedSalary : undefined,
            decryptedClaimable: existing?.encClaimable === fresh.encClaimable ? existing.decryptedClaimable : undefined,
            decryptedTotalReceived:
              existing?.encTotalReceived === fresh.encTotalReceived ? existing.decryptedTotalReceived : undefined,
            salaryRevealedAt: existing?.encSalary === fresh.encSalary ? existing.salaryRevealedAt : undefined,
          };
        }),
      );
    } catch (err) {
      console.error("Failed to fetch employees:", err);
      toast.error("Failed to load employees from chain.");
    } finally {
      setIsLoadingEmployees(false);
    }
  }, [signer, getContract]);

  useEffect(() => {
    if (signer) {
      fetchEmployees();
      checkAuthorization();
      fetchTokenInfo();
    }
  }, [signer, fetchEmployees, checkAuthorization, fetchTokenInfo]);

  // ------------------------------------------------------------------
  // Write: authorize payroll contract as operator on the payment token
  // ------------------------------------------------------------------
  const handleAuthorize = useCallback(async () => {
    if (!signer) return;
    const toastId = toast.loading("Authorizing Payroll contract...");
    try {
      setTxPending(true);
      const payrollContract = getContract(FHE_PAYROLL_ABI, FHE_PAYROLL_ADDRESS, "read");
      const tokenAddress: string = await payrollContract.paymentToken();
      const tokenContract = getContract(FHE_TOKEN_ABI, tokenAddress);
      const until = Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 60 * 60; // 10 years
      const tx = await tokenContract.setOperator(FHE_PAYROLL_ADDRESS, until);
      await tx.wait();
      setIsAuthorized(true);
      toast.success("Payroll contract authorized!", { id: toastId });
    } catch (err: any) {
      // eslint-disable-line @typescript-eslint/no-explicit-any
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
        toast.error("FHE system not ready.");
        return false;
      }
      const toastId = toast.loading("1/3: Encrypting salary with FHE...");
      try {
        setTxPending(true);
        const salaryValue = parseInt(salaryStr, 10);
        const userAddr = (await signer.getAddress()) as `0x${string}`;

        const result = await encrypt.mutateAsync({
          values: [{ value: BigInt(salaryValue), type: "euint64" }],
          contractAddress: FHE_PAYROLL_ADDRESS,
          userAddress: userAddr,
        });

        toast.loading("2/3: Awaiting MetaMask confirmation...", { id: toastId });
        const contract = getContract(FHE_PAYROLL_ABI, FHE_PAYROLL_ADDRESS);
        const tx = await contract.addEmployee(employeeAddress, result.handles[0], result.inputProof, {
          gasLimit: 1_200_000,
        });

        toast.loading("3/3: Mining confidential record...", { id: toastId });
        await tx.wait();
        toast.success("Employee added to confidential ledger!", { id: toastId });
        fetchEmployees();
        return true;
      } catch (err: any) {
        // eslint-disable-line @typescript-eslint/no-explicit-any
        toast.error(`Registration failed: ${err.reason || err.message}`, { id: toastId });
        return false;
      } finally {
        setTxPending(false);
      }
    },
    [signer, sdk, encrypt, getContract, fetchEmployees],
  );

  // ------------------------------------------------------------------
  // Write: update employee salary (FHE-encrypted)
  // ------------------------------------------------------------------
  const handleUpdateSalary = useCallback(
    async (employeeAddress: string, salaryStr: string): Promise<boolean> => {
      if (!signer || !sdk) {
        toast.error("FHE system not ready.");
        return false;
      }
      const toastId = toast.loading("1/3: Encrypting new salary with FHE...");
      try {
        setTxPending(true);
        const salaryValue = parseInt(salaryStr, 10);
        const userAddr = (await signer.getAddress()) as `0x${string}`;

        const result = await encrypt.mutateAsync({
          values: [{ value: BigInt(salaryValue), type: "euint64" }],
          contractAddress: FHE_PAYROLL_ADDRESS,
          userAddress: userAddr,
        });

        toast.loading("2/3: Awaiting MetaMask confirmation...", { id: toastId });
        const contract = getContract(FHE_PAYROLL_ABI, FHE_PAYROLL_ADDRESS);
        const tx = await contract.updateSalary(employeeAddress, result.handles[0], result.inputProof, {
          gasLimit: 1_200_000,
        });

        toast.loading("3/3: Updating confidential record...", { id: toastId });
        await tx.wait();
        toast.success("Salary updated successfully!", { id: toastId });
        // fetchEmployees will auto-clear the stale decryptedSalary for this employee
        // because the encSalary handle changes on-chain after updateSalary
        fetchEmployees();
        return true;
      } catch (err: any) {
        // eslint-disable-line @typescript-eslint/no-explicit-any
        toast.error(`Update failed: ${err.reason || err.message}`, { id: toastId });
        return false;
      } finally {
        setTxPending(false);
      }
    },
    [signer, sdk, encrypt, getContract, fetchEmployees],
  );

  // ------------------------------------------------------------------
  // FHE Reveal (employer): one function per encrypted handle
  // ------------------------------------------------------------------
  const handleRevealSalary = useCallback(
    async (index: number) => {
      const emp = employees[index];
      if (!emp || !sdk) {
        toast.error("FHE system not ready.");
        return;
      }
      if (emp.isRevealingSalary) return;
      setEmployees((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], isRevealingSalary: true };
        return next;
      });
      const toastId = toast.loading("Decrypting salary...");
      try {
        const handleHex = ethers.toBeHex(BigInt(emp.encSalary), 32) as `0x${string}`;
        const results = await decryptFlow.mutateAsync({
          handles: [{ handle: handleHex, contractAddress: FHE_PAYROLL_ADDRESS }],
          durationDays: 30,
        });
        const clearValue = results[handleHex]?.toString() ?? "0";
        setEmployees((prev) => {
          const next = [...prev];
          next[index] = {
            ...next[index],
            decryptedSalary: clearValue,
            isRevealingSalary: false,
            salaryRevealedAt: Date.now(),
          };
          return next;
        });
        toast.success(`Salary: ${clearValue} ${tokenSymbol}/s`, { id: toastId });
      } catch (err: any) {
        // eslint-disable-line @typescript-eslint/no-explicit-any
        toast.error(`Decryption failed: ${err.message}`, { id: toastId });
        setEmployees((prev) => {
          const next = [...prev];
          next[index] = { ...next[index], isRevealingSalary: false };
          return next;
        });
      }
    },
    [employees, sdk, decryptFlow, tokenSymbol],
  );

  const handleRevealClaimable = useCallback(
    async (index: number) => {
      const emp = employees[index];
      if (!emp || !sdk) {
        toast.error("FHE system not ready.");
        return;
      }
      if (emp.isRevealingClaimable) return;
      setEmployees((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], isRevealingClaimable: true };
        return next;
      });
      const toastId = toast.loading("Decrypting claimable balance...");
      try {
        const handleHex = ethers.toBeHex(BigInt(emp.encClaimable), 32) as `0x${string}`;
        const results = await decryptFlow.mutateAsync({
          handles: [{ handle: handleHex, contractAddress: FHE_PAYROLL_ADDRESS }],
          durationDays: 30,
        });
        const clearValue = results[handleHex]?.toString() ?? "0";
        setEmployees((prev) => {
          const next = [...prev];
          next[index] = { ...next[index], decryptedClaimable: clearValue, isRevealingClaimable: false };
          return next;
        });
        toast.success(`Claimable: ${clearValue} ${tokenSymbol}`, { id: toastId });
      } catch (err: any) {
        // eslint-disable-line @typescript-eslint/no-explicit-any
        toast.error(`Decryption failed: ${err.message}`, { id: toastId });
        setEmployees((prev) => {
          const next = [...prev];
          next[index] = { ...next[index], isRevealingClaimable: false };
          return next;
        });
      }
    },
    [employees, sdk, decryptFlow, tokenSymbol],
  );

  const handleRevealTotal = useCallback(
    async (index: number) => {
      const emp = employees[index];
      if (!emp || !sdk) {
        toast.error("FHE system not ready.");
        return;
      }
      if (emp.isRevealingTotal) return;
      setEmployees((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], isRevealingTotal: true };
        return next;
      });
      const toastId = toast.loading("Decrypting total received...");
      try {
        const handleHex = ethers.toBeHex(BigInt(emp.encTotalReceived), 32) as `0x${string}`;
        const results = await decryptFlow.mutateAsync({
          handles: [{ handle: handleHex, contractAddress: FHE_PAYROLL_ADDRESS }],
          durationDays: 30,
        });
        const clearValue = results[handleHex]?.toString() ?? "0";
        setEmployees((prev) => {
          const next = [...prev];
          next[index] = { ...next[index], decryptedTotalReceived: clearValue, isRevealingTotal: false };
          return next;
        });
        toast.success(`Total received: ${clearValue} ${tokenSymbol}`, { id: toastId });
      } catch (err: any) {
        // eslint-disable-line @typescript-eslint/no-explicit-any
        toast.error(`Decryption failed: ${err.message}`, { id: toastId });
        setEmployees((prev) => {
          const next = [...prev];
          next[index] = { ...next[index], isRevealingTotal: false };
          return next;
        });
      }
    },
    [employees, sdk, decryptFlow, tokenSymbol],
  );

  // ------------------------------------------------------------------
  // FHE Hide (employer): clear decrypted value from React state
  // Setting to undefined (not '') is intentional: it matches the
  // `decryptedValue?: string` optional field convention and triggers
  // the "Encrypted" display branch in the UI.
  // ------------------------------------------------------------------
  const handleHideSalary = useCallback((index: number) => {
    setEmployees((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], decryptedSalary: undefined, salaryRevealedAt: undefined };
      return next;
    });
  }, []);

  const handleHideClaimable = useCallback((index: number) => {
    setEmployees((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], decryptedClaimable: undefined };
      return next;
    });
  }, []);

  const handleHideTotal = useCallback((index: number) => {
    setEmployees((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], decryptedTotalReceived: undefined };
      return next;
    });
  }, []);

  // ------------------------------------------------------------------
  // FHE Refresh (employer): fetch the latest handle from chain, then re-decrypt.
  // Does NOT rely on the employees[] array for the handle — reads directly from
  // the contract to avoid React closure staleness after a write transaction.
  // ------------------------------------------------------------------
  const handleRefreshSalary = useCallback(
    async (index: number) => {
      const emp = employees[index];
      if (!emp || !sdk) return;
      if (emp.isRevealingSalary) return;
      setEmployees((prev) => {
        const next = [...prev];
        next[index] = {
          ...next[index],
          decryptedSalary: undefined,
          salaryRevealedAt: undefined,
          isRevealingSalary: true,
        };
        return next;
      });
      const toastId = toast.loading("Refreshing salary from chain...");
      try {
        const contract = getContract(FHE_PAYROLL_ABI, FHE_PAYROLL_ADDRESS, "write");
        const data = await contract.getEmployee(emp.address);
        const freshHandle = data.encSalary as string;
        const handleHex = ethers.toBeHex(BigInt(freshHandle), 32) as `0x${string}`;
        const results = await decryptFlow.mutateAsync({
          handles: [{ handle: handleHex, contractAddress: FHE_PAYROLL_ADDRESS }],
          durationDays: 30,
        });
        const clearValue = results[handleHex]?.toString() ?? "0";
        setEmployees((prev) => {
          const next = [...prev];
          next[index] = {
            ...next[index],
            encSalary: freshHandle,
            decryptedSalary: clearValue,
            isRevealingSalary: false,
            salaryRevealedAt: Date.now(),
          };
          return next;
        });
        toast.success(`Salary: ${clearValue} ${tokenSymbol}/s`, { id: toastId });
      } catch (err: any) {
        // eslint-disable-line @typescript-eslint/no-explicit-any
        toast.error(`Refresh failed: ${err.message}`, { id: toastId });
        setEmployees((prev) => {
          const next = [...prev];
          next[index] = { ...next[index], isRevealingSalary: false };
          return next;
        });
      }
    },
    [employees, sdk, decryptFlow, getContract, tokenSymbol],
  );

  const handleRefreshClaimable = useCallback(
    async (index: number) => {
      const emp = employees[index];
      if (!emp || !sdk) return;
      if (emp.isRevealingClaimable) return;
      setEmployees((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], decryptedClaimable: undefined, isRevealingClaimable: true };
        return next;
      });
      const toastId = toast.loading("Refreshing claimable balance...");
      try {
        const contract = getContract(FHE_PAYROLL_ABI, FHE_PAYROLL_ADDRESS, "write");
        const data = await contract.getEmployee(emp.address);
        const freshHandle = data.encClaimable as string;
        const handleHex = ethers.toBeHex(BigInt(freshHandle), 32) as `0x${string}`;
        const results = await decryptFlow.mutateAsync({
          handles: [{ handle: handleHex, contractAddress: FHE_PAYROLL_ADDRESS }],
          durationDays: 30,
        });
        const clearValue = results[handleHex]?.toString() ?? "0";
        setEmployees((prev) => {
          const next = [...prev];
          next[index] = {
            ...next[index],
            encClaimable: freshHandle,
            decryptedClaimable: clearValue,
            isRevealingClaimable: false,
          };
          return next;
        });
        toast.success(`Claimable: ${clearValue} ${tokenSymbol}`, { id: toastId });
      } catch (err: any) {
        // eslint-disable-line @typescript-eslint/no-explicit-any
        toast.error(`Refresh failed: ${err.message}`, { id: toastId });
        setEmployees((prev) => {
          const next = [...prev];
          next[index] = { ...next[index], isRevealingClaimable: false };
          return next;
        });
      }
    },
    [employees, sdk, decryptFlow, getContract, tokenSymbol],
  );

  const handleRefreshTotal = useCallback(
    async (index: number) => {
      const emp = employees[index];
      if (!emp || !sdk) return;
      if (emp.isRevealingTotal) return;
      setEmployees((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], decryptedTotalReceived: undefined, isRevealingTotal: true };
        return next;
      });
      const toastId = toast.loading("Refreshing total received...");
      try {
        const contract = getContract(FHE_PAYROLL_ABI, FHE_PAYROLL_ADDRESS, "write");
        const data = await contract.getEmployee(emp.address);
        const freshHandle = data.encTotalReceived as string;
        const handleHex = ethers.toBeHex(BigInt(freshHandle), 32) as `0x${string}`;
        const results = await decryptFlow.mutateAsync({
          handles: [{ handle: handleHex, contractAddress: FHE_PAYROLL_ADDRESS }],
          durationDays: 30,
        });
        const clearValue = results[handleHex]?.toString() ?? "0";
        setEmployees((prev) => {
          const next = [...prev];
          next[index] = {
            ...next[index],
            encTotalReceived: freshHandle,
            decryptedTotalReceived: clearValue,
            isRevealingTotal: false,
          };
          return next;
        });
        toast.success(`Total received: ${clearValue} ${tokenSymbol}`, { id: toastId });
      } catch (err: any) {
        // eslint-disable-line @typescript-eslint/no-explicit-any
        toast.error(`Refresh failed: ${err.message}`, { id: toastId });
        setEmployees((prev) => {
          const next = [...prev];
          next[index] = { ...next[index], isRevealingTotal: false };
          return next;
        });
      }
    },
    [employees, sdk, decryptFlow, getContract, tokenSymbol],
  );

  // ------------------------------------------------------------------
  // FHE Reveal/Hide/Refresh: employer's own token wallet balance
  // contractAddress must be tokenAddress (ACL set by the token contract, not payroll)
  // ------------------------------------------------------------------
  const handleRevealOwnBalance = useCallback(async () => {
    if (!signer || !sdk || !tokenAddress) {
      toast.error("Token not loaded yet.");
      return;
    }
    if (isRevealingOwnBalance) return;
    setIsRevealingOwnBalance(true);
    const toastId = toast.loading("Decrypting your wallet balance...");
    try {
      const addr = await signer.getAddress();
      const tokenContract = new ethers.Contract(tokenAddress, FHE_TOKEN_ABI, signer.provider ?? signer);
      const handleRaw = await tokenContract.confidentialBalanceOf(addr);
      const handleHex = ethers.toBeHex(BigInt(handleRaw), 32) as `0x${string}`;
      const results = await decryptFlow.mutateAsync({
        handles: [{ handle: handleHex, contractAddress: tokenAddress as `0x${string}` }],
        durationDays: 30,
      });
      const clearValue = results[handleHex]?.toString() ?? "0";
      setDecryptedOwnBalance(clearValue);
      toast.success(`Your balance: ${clearValue} ${tokenSymbol}`, { id: toastId });
    } catch (err: any) {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      toast.error(`Decryption failed: ${err.message}`, { id: toastId });
    } finally {
      setIsRevealingOwnBalance(false);
    }
  }, [signer, sdk, tokenAddress, tokenSymbol, isRevealingOwnBalance, decryptFlow]);

  const handleHideOwnBalance = useCallback(() => {
    setDecryptedOwnBalance(undefined);
  }, []);

  const handleRefreshOwnBalance = useCallback(async () => {
    if (!signer || !sdk || !tokenAddress || isRevealingOwnBalance) return;
    setDecryptedOwnBalance(undefined);
    setIsRevealingOwnBalance(true);
    const toastId = toast.loading("Refreshing your wallet balance...");
    try {
      const addr = await signer.getAddress();
      const tokenContract = new ethers.Contract(tokenAddress, FHE_TOKEN_ABI, signer.provider ?? signer);
      const handleRaw = await tokenContract.confidentialBalanceOf(addr);
      const handleHex = ethers.toBeHex(BigInt(handleRaw), 32) as `0x${string}`;
      const results = await decryptFlow.mutateAsync({
        handles: [{ handle: handleHex, contractAddress: tokenAddress as `0x${string}` }],
        durationDays: 30,
      });
      const clearValue = results[handleHex]?.toString() ?? "0";
      setDecryptedOwnBalance(clearValue);
      toast.success(`Your balance: ${clearValue} ${tokenSymbol}`, { id: toastId });
    } catch (err: any) {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      toast.error(`Refresh failed: ${err.message}`, { id: toastId });
    } finally {
      setIsRevealingOwnBalance(false);
    }
  }, [signer, sdk, tokenAddress, tokenSymbol, isRevealingOwnBalance, decryptFlow]);

  // ------------------------------------------------------------------
  // Write: sync claimable balance on-chain for an Active employee
  // Calls accrueEarnings(_employee) which runs _accrueEarnings internally,
  // updating encClaimable with the accrued amount since lastUpdate.
  // ------------------------------------------------------------------
  const handleSyncClaimable = useCallback(
    async (index: number) => {
      const emp = employees[index];
      if (!emp || !signer) return;
      if (emp.status !== 1) {
        toast.error("Sync only available for Active employees.");
        return;
      }
      const toastId = toast.loading("Syncing accrued earnings on-chain...");
      try {
        setTxPending(true);
        const contract = getContract(FHE_PAYROLL_ABI, FHE_PAYROLL_ADDRESS);
        const tx = await contract.accrueEarnings(emp.address, { gasLimit: 800_000 });
        await tx.wait();
        toast.success("Earnings synced! Decrypt claimable to see the update.", { id: toastId });
        fetchEmployees();
      } catch (err: any) {
        // eslint-disable-line @typescript-eslint/no-explicit-any
        toast.error(`Sync failed: ${err.reason || err.message}`, { id: toastId });
      } finally {
        setTxPending(false);
      }
    },
    [employees, signer, getContract, fetchEmployees],
  );

  // ------------------------------------------------------------------
  // Write: activate / deactivate / terminate / delete employee
  // ------------------------------------------------------------------
  const handleEmployeeAction = useCallback(
    async (address: string, action: "activate" | "deactivate" | "terminate" | "delete") => {
      if (!signer) return;
      const toastId = toast.loading(`${action.charAt(0).toUpperCase() + action.slice(1)}ing employee...`);
      try {
        setTxPending(true);
        const contract = getContract(FHE_PAYROLL_ABI, FHE_PAYROLL_ADDRESS);
        let tx;
        if (action === "activate") tx = await contract.activateEmployee(address);
        else if (action === "deactivate") tx = await contract.deactivateEmployee(address);
        else if (action === "terminate") tx = await contract.terminateEmployee(address);
        else tx = await contract.deleteEmployee(address);
        await tx.wait();
        toast.success(`Employee ${action}d successfully.`, { id: toastId });
        fetchEmployees();
      } catch (err: any) {
        // eslint-disable-line @typescript-eslint/no-explicit-any
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
    tokenSymbol,
    tokenName,
    tokenAddress,
    // Employer own balance
    decryptedOwnBalance,
    isRevealingOwnBalance,
    handleRevealOwnBalance,
    handleHideOwnBalance,
    handleRefreshOwnBalance,
    // Actions
    fetchEmployees,
    checkAuthorization,
    handleAddEmployee,
    handleUpdateSalary,
    // Reveal
    handleRevealSalary,
    handleRevealClaimable,
    handleRevealTotal,
    // Hide
    handleHideSalary,
    handleHideClaimable,
    handleHideTotal,
    // Refresh
    handleRefreshSalary,
    handleRefreshClaimable,
    handleRefreshTotal,
    // Sync claimable
    handleSyncClaimable,
    // Other write actions
    handleAuthorize,
    handleEmployeeAction,
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
  0: "None",
  1: "Active",
  2: "Paused",
  3: "Terminated",
};

export function useFHEEmployee(signer: ethers.Signer | undefined) {
  const sdk = useZamaSDK();
  const decryptFlow = useUserDecryptFlow();
  const chainId = useChainId();

  const [employeeData, setEmployeeData] = useState<EmployeeChainData | null>(null);
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [txPending, setTxPending] = useState(false);
  const [tokenSymbol, setTokenSymbol] = useState("token");
  const [tokenName, setTokenName] = useState("");
  const [tokenAddress, setTokenAddress] = useState("");

  const [decryptedSalary, setDecryptedSalary] = useState<string | null>(null);
  const [decryptedClaimable, setDecryptedClaimable] = useState<string | null>(null);
  const [decryptedTotalReceived, setDecryptedTotalReceived] = useState<string | null>(null);
  const [isDecryptingSalary, setIsDecryptingSalary] = useState(false);
  const [isDecryptingClaimable, setIsDecryptingClaimable] = useState(false);
  const [isDecryptingTotal, setIsDecryptingTotal] = useState(false);
  const [decryptedBalance, setDecryptedBalance] = useState<string | null>(null);
  const [isDecryptingBalance, setIsDecryptingBalance] = useState(false);

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
    } catch (err: any) {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      // "employee not found" is expected for unregistered wallets — show the empty-state UI
      if (err?.reason === "Payroll: employee not found" || err?.message?.includes("employee not found")) {
        setEmployeeData(null);
      } else {
        console.error("Failed to fetch employee data", err);
      }
    } finally {
      setLoading(false);
    }
  }, [signer]);

  const fetchTokenInfo = useCallback(async () => {
    if (!signer) return;
    try {
      const payrollContract = new ethers.Contract(FHE_PAYROLL_ADDRESS, FHE_PAYROLL_ABI, signer.provider ?? signer);
      const resolvedAddress: string = await payrollContract.paymentToken();
      const tokenContract = new ethers.Contract(resolvedAddress, FHE_TOKEN_ABI, signer.provider ?? signer);
      const [symbol, name]: [string, string] = await Promise.all([tokenContract.symbol(), tokenContract.name()]);
      setTokenAddress(resolvedAddress);
      setTokenSymbol(symbol);
      setTokenName(name);
    } catch (err) {
      console.error("Failed to fetch token info:", err);
    }
  }, [signer]);

  useEffect(() => {
    fetchData();
    fetchTokenInfo();
  }, [fetchData, fetchTokenInfo]);

  // Helper to decrypt a single FHE handle
  const decryptHandle = useCallback(
    async (encValue: string, label: string): Promise<string | null> => {
      if (!sdk) {
        toast.error("FHE system not ready.");
        return null;
      }
      const toastId = toast.loading(`Decrypting ${label}...`);
      try {
        const handleHex = ethers.toBeHex(BigInt(encValue), 32) as `0x${string}`;
        const results = await decryptFlow.mutateAsync({
          handles: [{ handle: handleHex, contractAddress: FHE_PAYROLL_ADDRESS }],
          durationDays: 30,
        });
        const clear = results[handleHex]?.toString() ?? "0";
        toast.success(`${label}: ${clear}`, { id: toastId });
        return clear;
      } catch (err: any) {
        // eslint-disable-line @typescript-eslint/no-explicit-any
        toast.error(`Decryption failed: ${err.message}`, { id: toastId });
        return null;
      }
    },
    [sdk, decryptFlow],
  );

  // ------------------------------------------------------------------
  // Reveal
  // ------------------------------------------------------------------
  const handleRevealSalary = useCallback(async () => {
    if (!employeeData) return;
    setIsDecryptingSalary(true);
    const result = await decryptHandle(employeeData.encSalary, "Salary rate");
    if (result) setDecryptedSalary(result);
    setIsDecryptingSalary(false);
  }, [employeeData, decryptHandle]);

  const handleRevealClaimable = useCallback(async () => {
    if (!employeeData) return;
    setIsDecryptingClaimable(true);
    const result = await decryptHandle(employeeData.encClaimable, "Claimable balance");
    if (result) setDecryptedClaimable(result);
    setIsDecryptingClaimable(false);
  }, [employeeData, decryptHandle]);

  const handleRevealTotalReceived = useCallback(async () => {
    if (!employeeData) return;
    setIsDecryptingTotal(true);
    const result = await decryptHandle(employeeData.encTotalReceived, "Total received");
    if (result) setDecryptedTotalReceived(result);
    setIsDecryptingTotal(false);
  }, [employeeData, decryptHandle]);

  // ------------------------------------------------------------------
  // Hide: clear decrypted value from React state
  // ------------------------------------------------------------------
  const handleHideSalary = useCallback(() => {
    setDecryptedSalary(null);
  }, []);
  const handleHideClaimable = useCallback(() => {
    setDecryptedClaimable(null);
  }, []);
  const handleHideTotalReceived = useCallback(() => {
    setDecryptedTotalReceived(null);
  }, []);

  // ------------------------------------------------------------------
  // Refresh: fetch latest handle from chain → re-decrypt.
  // Reads fresh data directly from the contract to avoid closure staleness.
  // ------------------------------------------------------------------
  const handleRefreshSalary = useCallback(async () => {
    if (!signer || !sdk || isDecryptingSalary) return;
    setDecryptedSalary(null);
    setIsDecryptingSalary(true);
    try {
      const addr = await signer.getAddress();
      const contract = new ethers.Contract(FHE_PAYROLL_ADDRESS, FHE_PAYROLL_ABI, signer);
      const data = await contract.getEmployee(addr);
      const result = await decryptHandle(data.encSalary, "Salary rate");
      if (result) {
        setDecryptedSalary(result);
        setEmployeeData((prev) => (prev ? { ...prev, encSalary: data.encSalary, lastUpdate: data.lastUpdate } : prev));
      }
    } catch (err) {
      console.error("Refresh salary failed", err);
    } finally {
      setIsDecryptingSalary(false);
    }
  }, [signer, sdk, isDecryptingSalary, decryptHandle]);

  const handleRefreshClaimable = useCallback(async () => {
    if (!signer || !sdk || isDecryptingClaimable) return;
    setDecryptedClaimable(null);
    setIsDecryptingClaimable(true);
    try {
      const addr = await signer.getAddress();
      const contract = new ethers.Contract(FHE_PAYROLL_ADDRESS, FHE_PAYROLL_ABI, signer);
      const data = await contract.getEmployee(addr);
      const result = await decryptHandle(data.encClaimable, "Claimable balance");
      if (result) {
        setDecryptedClaimable(result);
        setEmployeeData((prev) => (prev ? { ...prev, encClaimable: data.encClaimable } : prev));
      }
    } catch (err) {
      console.error("Refresh claimable failed", err);
    } finally {
      setIsDecryptingClaimable(false);
    }
  }, [signer, sdk, isDecryptingClaimable, decryptHandle]);

  const handleRefreshTotalReceived = useCallback(async () => {
    if (!signer || !sdk || isDecryptingTotal) return;
    setDecryptedTotalReceived(null);
    setIsDecryptingTotal(true);
    try {
      const addr = await signer.getAddress();
      const contract = new ethers.Contract(FHE_PAYROLL_ADDRESS, FHE_PAYROLL_ABI, signer);
      const data = await contract.getEmployee(addr);
      const result = await decryptHandle(data.encTotalReceived, "Total received");
      if (result) {
        setDecryptedTotalReceived(result);
        setEmployeeData((prev) => (prev ? { ...prev, encTotalReceived: data.encTotalReceived } : prev));
      }
    } catch (err) {
      console.error("Refresh total received failed", err);
    } finally {
      setIsDecryptingTotal(false);
    }
  }, [signer, sdk, isDecryptingTotal, decryptHandle]);

  // ------------------------------------------------------------------
  // Wallet balance: reveal/hide/refresh
  // contractAddress must be tokenAddress (ACL set by the token contract)
  // ------------------------------------------------------------------
  const handleRevealBalance = useCallback(async () => {
    if (!signer || !sdk || !tokenAddress) {
      toast.error("Token not loaded yet.");
      return;
    }
    if (isDecryptingBalance) return;
    setIsDecryptingBalance(true);
    const toastId = toast.loading("Decrypting your wallet balance...");
    try {
      const addr = await signer.getAddress();
      const tokenContract = new ethers.Contract(tokenAddress, FHE_TOKEN_ABI, signer.provider ?? signer);
      const handleRaw = await tokenContract.confidentialBalanceOf(addr);
      const handleHex = ethers.toBeHex(BigInt(handleRaw), 32) as `0x${string}`;
      const results = await decryptFlow.mutateAsync({
        handles: [{ handle: handleHex, contractAddress: tokenAddress as `0x${string}` }],
        durationDays: 30,
      });
      const clear = results[handleHex]?.toString() ?? "0";
      setDecryptedBalance(clear);
      toast.success(`Balance: ${clear} ${tokenSymbol}`, { id: toastId });
    } catch (err: any) {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      toast.error(`Decryption failed: ${err.message}`, { id: toastId });
    } finally {
      setIsDecryptingBalance(false);
    }
  }, [signer, sdk, tokenAddress, tokenSymbol, isDecryptingBalance, decryptFlow]);

  const handleHideBalance = useCallback(() => {
    setDecryptedBalance(null);
  }, []);

  const handleRefreshBalance = useCallback(async () => {
    if (!signer || !sdk || !tokenAddress || isDecryptingBalance) return;
    setDecryptedBalance(null);
    setIsDecryptingBalance(true);
    const toastId = toast.loading("Refreshing your wallet balance...");
    try {
      const addr = await signer.getAddress();
      const tokenContract = new ethers.Contract(tokenAddress, FHE_TOKEN_ABI, signer.provider ?? signer);
      const handleRaw = await tokenContract.confidentialBalanceOf(addr);
      const handleHex = ethers.toBeHex(BigInt(handleRaw), 32) as `0x${string}`;
      const results = await decryptFlow.mutateAsync({
        handles: [{ handle: handleHex, contractAddress: tokenAddress as `0x${string}` }],
        durationDays: 30,
      });
      const clear = results[handleHex]?.toString() ?? "0";
      setDecryptedBalance(clear);
      toast.success(`Balance: ${clear} ${tokenSymbol}`, { id: toastId });
    } catch (err: any) {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      toast.error(`Refresh failed: ${err.message}`, { id: toastId });
    } finally {
      setIsDecryptingBalance(false);
    }
  }, [signer, sdk, tokenAddress, tokenSymbol, isDecryptingBalance, decryptFlow]);

  // ------------------------------------------------------------------
  // Write + decrypt: sync accrued earnings on-chain then decrypt claimable.
  // Calls accrueEarnings (chain tx) → fetches fresh encClaimable handle → decrypts.
  // ------------------------------------------------------------------
  const handleSyncAndDecryptClaimable = useCallback(async () => {
    if (!signer || !employeeData || employeeData.status !== 1 || !sdk) return;
    if (txPending || isDecryptingClaimable) return;
    const toastId = toast.loading("1/2: Syncing accrued earnings...");
    setTxPending(true);
    try {
      const addr = await signer.getAddress();
      const contract = new ethers.Contract(FHE_PAYROLL_ADDRESS, FHE_PAYROLL_ABI, signer);
      const tx = await contract.accrueEarnings(addr, { gasLimit: 800_000 });
      await tx.wait();
      setTxPending(false);
      toast.loading("2/2: Decrypting claimable balance...", { id: toastId });
      // Fetch fresh handle — claimable ciphertext changed after accrueEarnings
      const freshData = await contract.getEmployee(addr);
      const freshHandle = freshData.encClaimable as string;
      setEmployeeData((prev) =>
        prev ? { ...prev, encClaimable: freshHandle, lastUpdate: freshData.lastUpdate } : prev,
      );
      setDecryptedClaimable(null);
      setIsDecryptingClaimable(true);
      const handleHex = ethers.toBeHex(BigInt(freshHandle), 32) as `0x${string}`;
      const results = await decryptFlow.mutateAsync({
        handles: [{ handle: handleHex, contractAddress: FHE_PAYROLL_ADDRESS }],
        durationDays: 30,
      });
      const clear = results[handleHex]?.toString() ?? "0";
      setDecryptedClaimable(clear);
      toast.success(`Claimable: ${clear} ${tokenSymbol}`, { id: toastId });
    } catch (err: any) {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      toast.error(`Failed: ${err.reason || err.message}`, { id: toastId });
    } finally {
      setTxPending(false);
      setIsDecryptingClaimable(false);
    }
  }, [signer, employeeData, sdk, txPending, isDecryptingClaimable, decryptFlow, tokenSymbol]);

  const handleClaim = useCallback(async () => {
    if (!signer || !employeeData) return;
    if (employeeData.status === 0) {
      toast.error("Cannot claim: you are not registered as an employee.");
      return;
    }
    const toastId = toast.loading("Claiming accrued pay...");
    try {
      setTxPending(true);
      const contract = new ethers.Contract(FHE_PAYROLL_ADDRESS, FHE_PAYROLL_ABI, signer);
      const tx = await contract.claimPay({ gasLimit: 1_500_000 });
      await tx.wait();
      toast.success("Pay claimed! Tokens transferred to your wallet.", { id: toastId });
      // Both handles change on-chain after claim — clear cached plaintext
      setDecryptedClaimable(null);
      setDecryptedTotalReceived(null);
      fetchData();
    } catch (err: any) {
      // eslint-disable-line @typescript-eslint/no-explicit-any
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
    tokenSymbol,
    tokenName,
    tokenAddress,
    // Salary rate
    decryptedSalary,
    isDecryptingSalary,
    handleRevealSalary,
    handleHideSalary,
    handleRefreshSalary,
    // Claimable balance
    decryptedClaimable,
    isDecryptingClaimable,
    handleRevealClaimable,
    handleHideClaimable,
    handleRefreshClaimable,
    handleSyncAndDecryptClaimable,
    // Total received
    decryptedTotalReceived,
    isDecryptingTotal,
    handleRevealTotalReceived,
    handleHideTotalReceived,
    handleRefreshTotalReceived,
    // Wallet balance
    decryptedBalance,
    isDecryptingBalance,
    handleRevealBalance,
    handleHideBalance,
    handleRefreshBalance,
    // Actions
    fetchData,
    handleClaim,
  };
}
