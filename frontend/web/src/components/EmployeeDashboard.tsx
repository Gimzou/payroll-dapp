"use client";

import { ethers } from "ethers";
import {
  Banknote,
  ShieldCheck,
  Loader2,
  TrendingUp,
  Clock,
  Eye,
  EyeOff,
  Lock,
  Wallet,
  ArrowDownCircle,
  AlertCircle,
  RefreshCw,
  Coins,
  Copy,
  Check,
  Zap,
} from "lucide-react";
import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { useFHEEmployee, STATUS_LABELS } from "@/hooks/useFHEPayroll";

function StatusBadge({ status }: { status: number }) {
  const cls: Record<number, string> = {
    1: "badge-success",
    2: "badge-warning",
    3: "badge-error",
  };
  return <span className={`badge ${cls[status] ?? "badge-neutral"}`}>{STATUS_LABELS[status] ?? "Unknown"}</span>;
}

// ------------------------------------------------------------------
// Reusable confidential field card
// Revealed state: shows value + Refresh (re-decrypt from chain) + Hide (clear from state)
// Encrypted state: shows lock + Decrypt button
// ------------------------------------------------------------------
function ConfidentialField({
  label,
  icon: Icon,
  decryptedValue,
  unit,
  isDecrypting,
  onDecrypt,
  onHide,
  onRefresh,
  fheReady,
  hint,
}: {
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  decryptedValue: string | null;
  unit: string;
  isDecrypting: boolean;
  onDecrypt: () => void;
  onHide: () => void;
  onRefresh: () => void;
  fheReady: boolean;
  hint: string;
}) {
  return (
    <div className="card p-6">
      <div className="flex justify-between items-start mb-4">
        <div className="w-10 h-10 bg-secondary rounded-lg flex items-center justify-center text-primary">
          <Icon size={20} />
        </div>
        {decryptedValue !== null ? (
          <div className="flex items-center gap-1">
            <button
              onClick={onRefresh}
              disabled={isDecrypting || !fheReady}
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
              title="Re-decrypt (refresh from chain)"
            >
              {isDecrypting ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            </button>
            <button
              onClick={onHide}
              disabled={isDecrypting}
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
              title="Hide value"
            >
              <EyeOff size={13} />
            </button>
          </div>
        ) : (
          <span className="badge badge-neutral">
            <ShieldCheck size={10} /> FHE
          </span>
        )}
      </div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{label}</p>
      {decryptedValue !== null ? (
        <p className="text-2xl font-bold text-foreground">
          {decryptedValue} <span className="text-sm font-normal text-muted-foreground">{unit}</span>
        </p>
      ) : (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground flex items-center gap-1.5">
            <Lock size={14} /> Encrypted
          </span>
          <button
            onClick={onDecrypt}
            disabled={!fheReady || isDecrypting}
            className="btn-secondary py-2 px-4 text-xs flex items-center gap-1.5"
          >
            {isDecrypting ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />}
            Decrypt
          </button>
        </div>
      )}
      <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border">{hint}</p>
    </div>
  );
}

export default function EmployeeDashboard({ signer }: { signer: ethers.Signer }) {
  const {
    employeeData,
    address,
    loading,
    txPending,
    fheReady,
    tokenSymbol,
    tokenName,
    tokenAddress,
    decryptedSalary,
    isDecryptingSalary,
    handleRevealSalary,
    handleHideSalary,
    handleRefreshSalary,
    decryptedClaimable,
    isDecryptingClaimable,
    handleRevealClaimable,
    handleHideClaimable,
    handleRefreshClaimable,
    handleSyncAndDecryptClaimable,
    decryptedTotalReceived,
    isDecryptingTotal,
    handleRevealTotalReceived,
    handleHideTotalReceived,
    handleRefreshTotalReceived,
    decryptedBalance,
    isDecryptingBalance,
    handleRevealBalance,
    handleHideBalance,
    handleRefreshBalance,
    fetchData,
    handleClaim,
  } = useFHEEmployee(signer);

  const [salaryPeriod, setSalaryPeriod] = useState<"second" | "hour" | "day" | "month" | "year">("hour");
  const [tokenAddressCopied, setTokenAddressCopied] = useState(false);

  const copyTokenAddress = useCallback(async () => {
    if (!tokenAddress) return;
    await navigator.clipboard.writeText(tokenAddress);
    setTokenAddressCopied(true);
    setTimeout(() => setTokenAddressCopied(false), 1500);
  }, [tokenAddress]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <Loader2 className="animate-spin text-primary mb-4" size={32} />
        <p className="text-sm text-muted-foreground font-medium">Loading your records...</p>
      </div>
    );
  }

  if (!employeeData) {
    return (
      <div className="card-elevated p-10 text-center max-w-lg mx-auto mt-16">
        <div className="w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center mx-auto mb-4">
          <AlertCircle size={24} className="text-amber-600" />
        </div>
        <h2 className="text-xl font-bold mb-2 text-foreground">No Profile Found</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Address <span className="font-mono text-xs bg-muted px-2 py-1 rounded">{address}</span> is not registered.
          Contact your employer.
        </p>
        <button onClick={fetchData} className="btn-secondary">
          Refresh
        </button>
      </div>
    );
  }

  const PERIOD_MULTIPLIERS: Record<string, { factor: number; label: string }> = {
    second: { factor: 1, label: "/s" },
    hour: { factor: 3_600, label: "/hour" },
    day: { factor: 86_400, label: "/day" },
    month: { factor: 2_592_000, label: "/month" },
    year: { factor: 31_536_000, label: "/year" },
  };

  const convertedSalary =
    decryptedSalary !== null
      ? (BigInt(decryptedSalary) * BigInt(PERIOD_MULTIPLIERS[salaryPeriod].factor)).toString()
      : null;

  const isActive = employeeData.status === 1;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold text-foreground">My Compensation</h1>
            <StatusBadge status={employeeData.status} />
          </div>
          <p className="text-muted-foreground text-sm">View and manage your encrypted payroll data</p>
        </div>
        <div className="card px-4 py-3 flex items-center gap-3">
          <Wallet size={16} className="text-muted-foreground" />
          <span className="font-mono text-xs text-foreground">
            {address.slice(0, 8)}...{address.slice(-6)}
          </span>
          <button
            onClick={fetchData}
            className="p-1 hover:bg-muted rounded transition-colors"
            title="Refresh on-chain data"
          >
            <RefreshCw size={12} className="text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Claimable Balance — Hero Card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="card-elevated p-8 bg-gradient-to-br from-white via-white to-secondary/30"
      >
        <div className="flex items-center gap-2 mb-6">
          <Banknote size={18} className="text-primary" />
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Claimable Balance</p>
          {tokenSymbol && <span className="badge badge-neutral font-mono text-xs ml-1">{tokenSymbol}</span>}
        </div>

        <div className="flex flex-col md:flex-row items-start md:items-end justify-between gap-6">
          <div>
            {decryptedClaimable !== null ? (
              <>
                <div className="flex items-end gap-3">
                  <p className="text-5xl font-bold text-foreground tracking-tight">
                    {decryptedClaimable}
                    <span className="text-xl font-normal text-muted-foreground ml-2">{tokenSymbol}</span>
                  </p>
                  <div className="flex gap-1 mb-1.5">
                    {isActive && (
                      <button
                        onClick={handleSyncAndDecryptClaimable}
                        disabled={txPending || isDecryptingClaimable || !fheReady}
                        title="Sync earnings on-chain then re-decrypt"
                        className="p-1.5 rounded-md hover:bg-violet-50 text-muted-foreground hover:text-violet-600 transition-colors disabled:opacity-30"
                      >
                        {(txPending || isDecryptingClaimable) ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                      </button>
                    )}
                    <button
                      onClick={handleRefreshClaimable}
                      disabled={isDecryptingClaimable || !fheReady}
                      title="Re-decrypt current on-chain value"
                      className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
                    >
                      {isDecryptingClaimable ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    </button>
                    <button
                      onClick={handleHideClaimable}
                      disabled={isDecryptingClaimable}
                      title="Hide balance"
                      className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
                    >
                      <EyeOff size={14} />
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-4 flex-wrap">
                <span className="text-lg text-muted-foreground flex items-center gap-2">
                  <Lock size={16} /> Balance encrypted
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={handleRevealClaimable}
                    disabled={!fheReady || isDecryptingClaimable || txPending}
                    className="btn-secondary py-2 px-4 text-sm flex items-center gap-2"
                  >
                    {isDecryptingClaimable ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                    Decrypt
                  </button>
                  {isActive && (
                    <button
                      onClick={handleSyncAndDecryptClaimable}
                      disabled={!fheReady || txPending || isDecryptingClaimable}
                      className="btn-primary py-2 px-4 text-sm flex items-center gap-2"
                      title="Sync accrued earnings on-chain then decrypt"
                    >
                      {(txPending || isDecryptingClaimable) ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                      Sync & Decrypt
                    </button>
                  )}
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-2">Accrued since your last claim, updated every block.</p>
          </div>

          <button
            onClick={handleClaim}
            disabled={txPending}
            className="btn-primary py-4 px-8 text-base flex items-center gap-2 shrink-0"
          >
            {txPending ? <Loader2 className="animate-spin" size={18} /> : <Banknote size={18} />}
            Claim Pay
          </button>
        </div>

        {!isActive && (
          <div className="mt-6 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2">
            <AlertCircle size={14} className="text-amber-600 shrink-0" />
            <p className="text-xs text-amber-700">
              Your status is <strong>{STATUS_LABELS[employeeData.status]}</strong> &mdash; salary is no longer accruing,
              but you can still claim any remaining balance.
            </p>
          </div>
        )}
      </motion.div>

      {/* Confidential Data */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Salary Rate — inline card with period picker */}
        <div className="card p-6">
          <div className="flex justify-between items-start mb-4">
            <div className="w-10 h-10 bg-secondary rounded-lg flex items-center justify-center text-primary">
              <TrendingUp size={20} />
            </div>
            {decryptedSalary !== null ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={handleRefreshSalary}
                  disabled={isDecryptingSalary || !fheReady}
                  className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
                  title="Re-decrypt (refresh from chain)"
                >
                  {isDecryptingSalary ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                </button>
                <button
                  onClick={handleHideSalary}
                  disabled={isDecryptingSalary}
                  className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
                  title="Hide value"
                >
                  <EyeOff size={13} />
                </button>
              </div>
            ) : (
              <span className="badge badge-neutral">
                <ShieldCheck size={10} /> FHE
              </span>
            )}
          </div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Salary Rate</p>
          {decryptedSalary !== null ? (
            <>
              <p className="text-2xl font-bold text-foreground">
                {convertedSalary}
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  {tokenSymbol}
                  {PERIOD_MULTIPLIERS[salaryPeriod].label}
                </span>
              </p>
              <div className="flex gap-1 mt-3">
                {Object.entries(PERIOD_MULTIPLIERS).map(([key, { label }]) => (
                  <button
                    key={key}
                    onClick={() => setSalaryPeriod(key as typeof salaryPeriod)}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                      salaryPeriod === key
                        ? "bg-primary text-white"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                <Lock size={14} /> Encrypted
              </span>
              <button
                onClick={handleRevealSalary}
                disabled={!fheReady || isDecryptingSalary}
                className="btn-secondary py-2 px-4 text-xs flex items-center gap-1.5"
              >
                {isDecryptingSalary ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />}
                Decrypt
              </button>
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border">
            Your per-second compensation rate, encrypted on-chain.
          </p>
        </div>

        <ConfidentialField
          label="Total Received"
          icon={ArrowDownCircle}
          decryptedValue={decryptedTotalReceived}
          unit={tokenSymbol}
          isDecrypting={isDecryptingTotal}
          onDecrypt={handleRevealTotalReceived}
          onHide={handleHideTotalReceived}
          onRefresh={handleRefreshTotalReceived}
          fheReady={fheReady}
          hint="Cumulative pay claimed since enrollment."
        />

        <ConfidentialField
          label="Wallet Balance"
          icon={Wallet}
          decryptedValue={decryptedBalance}
          unit={tokenSymbol}
          isDecrypting={isDecryptingBalance}
          onDecrypt={handleRevealBalance}
          onHide={handleHideBalance}
          onRefresh={handleRefreshBalance}
          fheReady={fheReady}
          hint="Your current on-chain token wallet balance."
        />
      </div>

      {/* Employment Details */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card p-5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center text-muted-foreground">
            <Clock size={16} />
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Hired</p>
            <p className="text-sm font-semibold text-foreground">
              {new Date(Number(employeeData.hiredAt) * 1000).toLocaleDateString()}{" "}
              {new Date(Number(employeeData.hiredAt) * 1000).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
        </div>
        <div className="card p-5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center text-muted-foreground">
            <Clock size={16} />
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Last Update</p>
            <p className="text-sm font-semibold text-foreground">
              {new Date(Number(employeeData.lastUpdate) * 1000).toLocaleDateString()}{" "}
              {new Date(Number(employeeData.lastUpdate) * 1000).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
        </div>
        <div className="card p-5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center text-muted-foreground shrink-0">
            <Coins size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Token</p>
            <p className="text-sm font-semibold text-foreground truncate">
              {tokenName || "ERC-7984"}
              {tokenSymbol && tokenSymbol !== "token" && (
                <span className="text-xs text-muted-foreground font-mono ml-1.5">{tokenSymbol}</span>
              )}
            </p>
            {tokenAddress && (
              <div className="flex items-center gap-1 mt-0.5">
                <span className="font-mono text-xs text-muted-foreground truncate">
                  {tokenAddress.slice(0, 8)}…{tokenAddress.slice(-6)}
                </span>
                <button
                  onClick={copyTokenAddress}
                  className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  title={tokenAddressCopied ? "Copied!" : "Copy token address"}
                >
                  {tokenAddressCopied ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="card p-5 flex items-center gap-3">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center ${fheReady ? "bg-emerald-50 text-emerald-600" : "bg-muted text-muted-foreground"}`}
          >
            <ShieldCheck size={16} />
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">FHE Engine</p>
            <p className="text-sm font-semibold text-foreground">{fheReady ? "Operational" : "Initializing..."}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
