'use client';

import { useState, useCallback } from 'react';
import { ethers } from 'ethers';
import {
  Users,
  Trash2,
  UserPlus,
  UserX,
  ShieldCheck,
  Loader2,
  X,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  AlertTriangle,
  CheckCircle2,
  Pencil,
  RefreshCw,
  Coins,
  Copy,
  Check,
  Zap,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useFHEPayroll } from '@/hooks/useFHEPayroll';

// ------------------------------------------------------------------
// Reusable encrypted-value cell — three states: Encrypted / Decrypting / Revealed
// ------------------------------------------------------------------
function EncryptedCell({
  decryptedValue,
  unit,
  isRevealing,
  onReveal,
  onHide,
  onRefresh,
  fheReady,
  txPending,
}: {
  decryptedValue: string | undefined;
  unit: string;
  isRevealing: boolean | undefined;
  onReveal: () => void;
  onHide: () => void;
  onRefresh: () => void;
  fheReady: boolean;
  txPending: boolean;
}) {
  const busy = isRevealing || txPending;
  return (
    <div className="flex items-center justify-center gap-1">
      {decryptedValue !== undefined ? (
        <>
          <span className="font-semibold text-foreground text-xs tabular-nums">
            {decryptedValue}
            <span className="text-muted-foreground font-normal ml-1">{unit}</span>
          </span>
          <button
            onClick={onRefresh}
            disabled={busy || !fheReady}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
            title="Re-decrypt (refresh from chain)"
          >
            {isRevealing
              ? <Loader2 size={11} className="animate-spin" />
              : <RefreshCw size={11} />}
          </button>
          <button
            onClick={onHide}
            disabled={!!isRevealing}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
            title="Hide value"
          >
            <EyeOff size={11} />
          </button>
        </>
      ) : (
        <>
          <span className="text-muted-foreground text-xs flex items-center gap-1">
            <Lock size={10} /> Encrypted
          </span>
          <button
            onClick={onReveal}
            disabled={busy || !fheReady}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
            title="Decrypt"
          >
            {isRevealing
              ? <Loader2 size={11} className="animate-spin" />
              : <Eye size={11} />}
          </button>
        </>
      )}
    </div>
  );
}

// Module-level constant — defined once, never recreated on re-render
const PERIOD_DIVISORS: Record<string, number> = {
  hour: 3_600,
  day: 86_400,
  month: 2_592_000,
  year: 31_536_000,
};

// ------------------------------------------------------------------
// Salary conversion preview with effective-rate feedback
// ------------------------------------------------------------------
function SalaryPreview({
  input,
  period,
  divisors,
  tokenSymbol,
}: {
  input: string;
  period: string;
  divisors: Record<string, number>;
  tokenSymbol: string;
}) {
  const raw = parseInt(input, 10);
  if (!input || isNaN(raw) || raw <= 0) return null;

  const tps = Math.floor(raw / divisors[period]);
  const effective = tps * divisors[period];
  const hasRounding = effective !== raw;

  if (tps === 0) {
    return (
      <p className="text-xs text-amber-600 mt-2">
        Amount too small — results in 0 {tokenSymbol}/second on-chain (minimum: {divisors[period]} {tokenSymbol}/{period})
      </p>
    );
  }

  return (
    <div className="mt-2 space-y-0.5">
      <p className="text-xs text-muted-foreground">
        = <span className="font-semibold text-foreground">{tps}</span> {tokenSymbol}/second on-chain
      </p>
      {hasRounding && (
        <p className="text-xs text-amber-600">
          Effective rate: <span className="font-semibold">{effective.toLocaleString()}</span> {tokenSymbol}/{period}
          <span className="text-amber-500"> ({raw.toLocaleString()} rounds down due to integer division)</span>
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Salary input fields — defined at module level so React never sees
// a new component type on re-render (which would reset focus on every keystroke)
// ------------------------------------------------------------------
function SalaryFields({
  value,
  period,
  tokenSymbol,
  onValueChange,
  onPeriodChange,
}: {
  value: string;
  period: string;
  tokenSymbol: string;
  onValueChange: (v: string) => void;
  onPeriodChange: (p: 'hour' | 'day' | 'month' | 'year') => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1.5">Compensation Rate</label>
      <div className="flex gap-2">
        <input
          type="number"
          placeholder="e.g. 3600"
          className="flex-1 bg-white border border-border rounded-lg px-4 py-3 text-sm focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none transition-all"
          value={value}
          onChange={e => onValueChange(e.target.value)}
        />
        <select
          value={period}
          onChange={e => onPeriodChange(e.target.value as 'hour' | 'day' | 'month' | 'year')}
          className="bg-white border border-border rounded-lg px-3 py-3 text-sm focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none transition-all"
        >
          <option value="hour">/ Hour</option>
          <option value="day">/ Day</option>
          <option value="month">/ Month (30d)</option>
          <option value="year">/ Year (365d)</option>
        </select>
      </div>
      <SalaryPreview input={value} period={period} divisors={PERIOD_DIVISORS} tokenSymbol={tokenSymbol} />
      <div className="mt-3 p-3 bg-secondary/50 rounded-lg flex gap-2 items-start">
        <ShieldCheck className="text-primary shrink-0 mt-0.5" size={14} />
        <p className="text-xs text-secondary-foreground leading-relaxed">
          This value is encrypted client-side using FHE before being sent to the smart contract.
        </p>
      </div>
    </div>
  );
}

export default function EmployerDashboard({ signer }: { signer: ethers.Signer }) {
  const {
    employees,
    isAuthorized,
    isLoadingEmployees,
    txPending,
    fheReady,
    chainId,
    tokenSymbol,
    tokenName,
    tokenAddress,
    decryptedOwnBalance,
    isRevealingOwnBalance,
    handleRevealOwnBalance,
    handleHideOwnBalance,
    handleRefreshOwnBalance,
    handleAddEmployee,
    handleUpdateSalary,
    handleRevealSalary,
    handleRevealClaimable,
    handleRevealTotal,
    handleHideSalary,
    handleHideClaimable,
    handleHideTotal,
    handleRefreshSalary,
    handleRefreshClaimable,
    handleRefreshTotal,
    handleSyncClaimable,
    handleAuthorize,
    handleEmployeeAction,
  } = useFHEPayroll(signer);

  const [showAddModal, setShowAddModal] = useState(false);
  const [newEmployee, setNewEmployee] = useState({ address: '', salary: '' });
  const [salaryPeriod, setSalaryPeriod] = useState<'hour' | 'day' | 'month' | 'year'>('hour');

  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [updateTarget, setUpdateTarget] = useState('');
  const [updateSalaryInput, setUpdateSalaryInput] = useState('');
  const [updateSalaryPeriod, setUpdateSalaryPeriod] = useState<'hour' | 'day' | 'month' | 'year'>('hour');

  const [tokenAddressCopied, setTokenAddressCopied] = useState(false);

  const copyTokenAddress = useCallback(async () => {
    if (!tokenAddress) return;
    await navigator.clipboard.writeText(tokenAddress);
    setTokenAddressCopied(true);
    setTimeout(() => setTokenAddressCopied(false), 1500);
  }, [tokenAddress]);

  const onRegister = async () => {
    const raw = parseInt(newEmployee.salary, 10);
    const tps = !isNaN(raw) && raw > 0 ? Math.floor(raw / PERIOD_DIVISORS[salaryPeriod]) : 0;
    if (!newEmployee.address || tps <= 0) return;
    const success = await handleAddEmployee(newEmployee.address, tps.toString());
    if (success) {
      setShowAddModal(false);
      setNewEmployee({ address: '', salary: '' });
      setSalaryPeriod('hour');
    }
  };

  const onUpdate = async () => {
    const raw = parseInt(updateSalaryInput, 10);
    const tps = !isNaN(raw) && raw > 0 ? Math.floor(raw / PERIOD_DIVISORS[updateSalaryPeriod]) : 0;
    if (!updateTarget || tps <= 0) return;
    const success = await handleUpdateSalary(updateTarget, tps.toString());
    if (success) {
      setShowUpdateModal(false);
      setUpdateTarget('');
      setUpdateSalaryInput('');
      setUpdateSalaryPeriod('hour');
    }
  };

  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null);

  const toggleExpand = useCallback((addr: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(addr)) next.delete(addr);
      else next.add(addr);
      return next;
    });
  }, []);

  const copyAddr = useCallback(async (addr: string) => {
    await navigator.clipboard.writeText(addr);
    setCopiedAddr(addr);
    setTimeout(() => setCopiedAddr(null), 1500);
  }, []);

  const formatTimestamp = (ts: bigint) =>
    new Date(Number(ts) * 1000).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

  const networkLabel = chainId === 11155111 ? 'Sepolia' : chainId === 31337 ? 'Hardhat' : `Chain ${chainId}`;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Payroll Management</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage employees and encrypted compensation</p>
        </div>
        <div className="flex gap-3">
          {isAuthorized === false && (
            <button
              onClick={handleAuthorize}
              disabled={txPending}
              className="btn-secondary flex items-center gap-2 text-amber-700 border-amber-200 bg-amber-50 hover:bg-amber-100"
            >
              {txPending ? <Loader2 size={16} className="animate-spin" /> : <Unlock size={16} />}
              <span>Authorize Distributions</span>
            </button>
          )}
          <button
            onClick={() => setShowAddModal(true)}
            disabled={!fheReady || !isAuthorized}
            className="btn-primary flex items-center gap-2"
          >
            <UserPlus size={16} />
            <span>Add Employee</span>
          </button>
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card p-5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Employees</p>
          <p className="text-2xl font-bold text-foreground">{employees.length}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Authorization</p>
          {isAuthorized === true ? (
            <div className="flex items-center gap-1.5 text-emerald-600 font-semibold text-sm mt-1">
              <CheckCircle2 size={16} /> Verified
            </div>
          ) : isAuthorized === false ? (
            <div className="flex items-center gap-1.5 text-amber-600 font-semibold text-sm mt-1">
              <AlertTriangle size={16} /> Required
            </div>
          ) : (
            <Loader2 size={16} className="animate-spin text-muted-foreground mt-1" />
          )}
        </div>
        <div className="card p-5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">FHE Engine</p>
          {fheReady ? (
            <div className="flex items-center gap-1.5 text-emerald-600 font-semibold text-sm mt-1">
              <ShieldCheck size={16} /> Ready
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-muted-foreground font-semibold text-sm mt-1">
              <Loader2 size={16} className="animate-spin" /> Loading
            </div>
          )}
        </div>
        <div className="card p-5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Network</p>
          <p className="text-sm font-semibold text-foreground mt-1">{networkLabel}</p>
        </div>
      </div>

      {/* Token Info Banner */}
      {tokenName && (
        <div className="card px-5 py-3 flex items-center gap-3 flex-wrap">
          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Coins size={14} className="text-primary" />
          </div>
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Payment Token</span>
          <span className="text-sm font-semibold text-foreground">{tokenName}</span>
          <span className="badge badge-neutral font-mono text-xs">{tokenSymbol}</span>
          <span className="badge badge-neutral text-xs">ERC-7984</span>
          {tokenAddress && (
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-xs text-muted-foreground hidden sm:inline">
                {tokenAddress.slice(0, 8)}…{tokenAddress.slice(-6)}
              </span>
              <button
                onClick={copyTokenAddress}
                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title={tokenAddressCopied ? 'Copied!' : 'Copy token address'}
              >
                {tokenAddressCopied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
              </button>
            </div>
          )}
          {/* Employer's own wallet balance */}
          <div className="flex items-center gap-1.5 ml-auto pl-3 border-l border-border">
            <span className="text-xs text-muted-foreground">My balance:</span>
            {decryptedOwnBalance !== undefined ? (
              <>
                <span className="text-xs font-semibold text-foreground">
                  {decryptedOwnBalance}
                  <span className="text-muted-foreground font-normal ml-1">{tokenSymbol}</span>
                </span>
                <button
                  onClick={handleRefreshOwnBalance}
                  disabled={isRevealingOwnBalance || !fheReady}
                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
                  title="Refresh balance"
                >
                  {isRevealingOwnBalance ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                </button>
                <button
                  onClick={handleHideOwnBalance}
                  disabled={isRevealingOwnBalance}
                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
                  title="Hide balance"
                >
                  <EyeOff size={11} />
                </button>
              </>
            ) : (
              <button
                onClick={handleRevealOwnBalance}
                disabled={isRevealingOwnBalance || !fheReady}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
                title="Decrypt your wallet balance"
              >
                {isRevealingOwnBalance ? <Loader2 size={11} className="animate-spin" /> : <Eye size={11} />}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Employee Table */}
      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-muted-foreground" />
            <h2 className="text-base font-semibold text-foreground">Employee Registry</h2>
          </div>
          <span className="badge badge-neutral">
            <Lock size={10} />
            Encrypted
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="table-header">
                <th className="px-6 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Address</th>
                <th className="px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-center">Status</th>
                <th className="px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-center">Salary Rate</th>
                <th className="px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-center">Claimable</th>
                <th className="px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-center">Total Received</th>
                <th className="px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoadingEmployees ? (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center">
                    <Loader2 className="animate-spin mx-auto text-muted-foreground mb-3" size={28} />
                    <p className="text-sm text-muted-foreground">Loading employee data...</p>
                  </td>
                </tr>
              ) : employees.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center">
                    <div className="w-12 h-12 bg-muted rounded-xl flex items-center justify-center mx-auto mb-3">
                      <UserPlus size={20} className="text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground">No employees registered yet.</p>
                  </td>
                </tr>
              ) : (
                employees.flatMap((emp, idx) => [
                  <tr key={`${emp.address}-main`} className="table-row group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleExpand(emp.address)}
                          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
                          title={expandedRows.has(emp.address) ? 'Collapse' : 'Show details'}
                        >
                          {expandedRows.has(emp.address)
                            ? <ChevronDown size={14} />
                            : <ChevronRight size={14} />}
                        </button>
                        <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center text-xs font-bold text-primary shrink-0">
                          {idx + 1}
                        </div>
                        <span className="font-mono text-xs text-foreground">
                          {emp.address.slice(0, 10)}…{emp.address.slice(-8)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-center">
                      <span className={`badge ${
                        emp.status === 1 ? 'badge-success' :
                        emp.status === 2 ? 'badge-warning' :
                        emp.status === 3 ? 'badge-error' : 'badge-neutral'
                      }`}>
                        {['None', 'Active', 'Paused', 'Terminated'][emp.status] || 'Unknown'}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-center">
                      <EncryptedCell
                        decryptedValue={emp.decryptedSalary}
                        unit={`${tokenSymbol}/s`}
                        isRevealing={emp.isRevealingSalary}
                        onReveal={() => handleRevealSalary(idx)}
                        onHide={() => handleHideSalary(idx)}
                        onRefresh={() => handleRefreshSalary(idx)}
                        fheReady={fheReady}
                        txPending={txPending}
                      />
                    </td>
                    <td className="px-4 py-4 text-center">
                      <EncryptedCell
                        decryptedValue={emp.decryptedClaimable}
                        unit={tokenSymbol}
                        isRevealing={emp.isRevealingClaimable}
                        onReveal={() => handleRevealClaimable(idx)}
                        onHide={() => handleHideClaimable(idx)}
                        onRefresh={() => handleRefreshClaimable(idx)}
                        fheReady={fheReady}
                        txPending={txPending}
                      />
                    </td>
                    <td className="px-4 py-4 text-center">
                      <EncryptedCell
                        decryptedValue={emp.decryptedTotalReceived}
                        unit={tokenSymbol}
                        isRevealing={emp.isRevealingTotal}
                        onReveal={() => handleRevealTotal(idx)}
                        onHide={() => handleHideTotal(idx)}
                        onRefresh={() => handleRefreshTotal(idx)}
                        fheReady={fheReady}
                        txPending={txPending}
                      />
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex justify-end gap-1">
                        {/* Sync claimable — only when Active */}
                        {emp.status === 1 && (
                          <button
                            onClick={() => handleSyncClaimable(idx)}
                            className="p-2 rounded-md hover:bg-violet-50 text-muted-foreground hover:text-violet-600 transition-colors disabled:opacity-30"
                            disabled={txPending}
                            title="Sync accrued earnings on-chain"
                          >
                            <Zap size={14} />
                          </button>
                        )}
                        {/* Activate — only when Paused */}
                        {emp.status === 2 && (
                          <button
                            onClick={() => handleEmployeeAction(emp.address, 'activate')}
                            className="p-2 rounded-md hover:bg-emerald-50 text-muted-foreground hover:text-emerald-600 transition-colors disabled:opacity-30"
                            disabled={txPending}
                            title="Activate"
                          >
                            <Unlock size={14} />
                          </button>
                        )}
                        {/* Pause — only when Active */}
                        {emp.status === 1 && (
                          <button
                            onClick={() => handleEmployeeAction(emp.address, 'deactivate')}
                            className="p-2 rounded-md hover:bg-amber-50 text-muted-foreground hover:text-amber-600 transition-colors disabled:opacity-30"
                            disabled={txPending}
                            title="Pause"
                          >
                            <Lock size={14} />
                          </button>
                        )}
                        {/* Terminate — when Active or Paused */}
                        {(emp.status === 1 || emp.status === 2) && (
                          <button
                            onClick={() => handleEmployeeAction(emp.address, 'terminate')}
                            className="p-2 rounded-md hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-30"
                            disabled={txPending}
                            title="Terminate employment"
                          >
                            <UserX size={14} />
                          </button>
                        )}
                        {/* Update Salary — when Active or Paused */}
                        {(emp.status === 1 || emp.status === 2) && (
                          <button
                            onClick={() => { setUpdateTarget(emp.address); setShowUpdateModal(true); }}
                            className="p-2 rounded-md hover:bg-blue-50 text-muted-foreground hover:text-blue-600 transition-colors disabled:opacity-30"
                            disabled={txPending}
                            title="Update Salary"
                          >
                            <Pencil size={14} />
                          </button>
                        )}
                        {/* Delete — always visible, enabled only when Terminated */}
                        <button
                          onClick={() => handleEmployeeAction(emp.address, 'delete')}
                          className="p-2 rounded-md hover:bg-red-50 text-muted-foreground hover:text-red-600 transition-colors disabled:opacity-30"
                          disabled={emp.status !== 3 || txPending}
                          title={emp.status !== 3 ? 'Terminate employment first' : 'Delete employee record'}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>,
                  ...(expandedRows.has(emp.address) ? [
                    <tr key={`${emp.address}-detail`} className="border-b border-border">
                      <td colSpan={6} className="px-6 pb-5 pt-0 bg-secondary/30">
                        <div className="flex flex-wrap gap-x-10 gap-y-4 pt-4 border-t border-border/40">
                          <div className="flex-1 min-w-[260px]">
                            <p className="text-xs font-medium text-muted-foreground mb-1.5">Full Address</p>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs text-foreground break-all">{emp.address}</span>
                              <button
                                onClick={() => copyAddr(emp.address)}
                                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
                                title={copiedAddr === emp.address ? 'Copied!' : 'Copy address'}
                              >
                                {copiedAddr === emp.address
                                  ? <Check size={12} className="text-emerald-600" />
                                  : <Copy size={12} />}
                              </button>
                            </div>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1.5">Hired</p>
                            <p className="text-sm text-foreground">{formatTimestamp(emp.hiredAt)}</p>
                          </div>
                          {emp.lastUpdate > 0n && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground mb-1.5">Last Sync</p>
                              <p className="text-sm text-foreground">{formatTimestamp(emp.lastUpdate)}</p>
                            </div>
                          )}
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1.5">Employee #</p>
                            <p className="text-sm font-semibold text-foreground">{idx + 1}</p>
                          </div>
                        </div>
                      </td>
                    </tr>,
                  ] : []),
                ])
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Update Salary Modal */}
      <AnimatePresence>
        {showUpdateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => !txPending && setShowUpdateModal(false)}
              className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              className="card-elevated w-full max-w-md p-8 relative z-10"
            >
              {txPending && (
                <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-20 flex flex-col items-center justify-center rounded-xl">
                  <Loader2 className="animate-spin text-primary mb-3" size={32} />
                  <p className="text-sm font-semibold text-foreground">Processing transaction...</p>
                  <p className="text-xs text-muted-foreground mt-1">Check your wallet for progress</p>
                </div>
              )}
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-lg font-bold text-foreground">Update Salary</h3>
                  <p className="text-sm text-muted-foreground mt-1 font-mono truncate max-w-[280px]">{updateTarget}</p>
                </div>
                <button onClick={() => setShowUpdateModal(false)} className="p-1.5 hover:bg-muted rounded-md text-muted-foreground">
                  <X size={18} />
                </button>
              </div>
              <div className="space-y-5">
                <SalaryFields
                  value={updateSalaryInput}
                  period={updateSalaryPeriod}
                  tokenSymbol={tokenSymbol}
                  onValueChange={setUpdateSalaryInput}
                  onPeriodChange={setUpdateSalaryPeriod}
                />
                <button
                  onClick={onUpdate}
                  disabled={txPending || !fheReady || (() => {
                    const raw = parseInt(updateSalaryInput, 10);
                    return isNaN(raw) || raw <= 0 || Math.floor(raw / PERIOD_DIVISORS[updateSalaryPeriod]) <= 0;
                  })()}
                  className="btn-primary w-full py-3 flex items-center justify-center gap-2"
                >
                  <ShieldCheck size={16} />
                  <span>Encrypt & Update</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Registration Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => !txPending && setShowAddModal(false)}
              className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              className="card-elevated w-full max-w-md p-8 relative z-10"
            >
              {txPending && (
                <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-20 flex flex-col items-center justify-center rounded-xl">
                  <Loader2 className="animate-spin text-primary mb-3" size={32} />
                  <p className="text-sm font-semibold text-foreground">Processing transaction...</p>
                  <p className="text-xs text-muted-foreground mt-1">Check your wallet for progress</p>
                </div>
              )}
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-lg font-bold text-foreground">Add Employee</h3>
                  <p className="text-sm text-muted-foreground mt-1">Salary is encrypted before submission</p>
                </div>
                <button onClick={() => setShowAddModal(false)} className="p-1.5 hover:bg-muted rounded-md text-muted-foreground">
                  <X size={18} />
                </button>
              </div>
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Wallet Address</label>
                  <input
                    type="text"
                    placeholder="0x..."
                    className="w-full bg-white border border-border rounded-lg px-4 py-3 text-sm font-mono focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none transition-all"
                    value={newEmployee.address}
                    onChange={e => setNewEmployee({ ...newEmployee, address: e.target.value })}
                  />
                </div>
                <SalaryFields
                  value={newEmployee.salary}
                  period={salaryPeriod}
                  tokenSymbol={tokenSymbol}
                  onValueChange={v => setNewEmployee({ ...newEmployee, salary: v })}
                  onPeriodChange={setSalaryPeriod}
                />
                <button
                  onClick={onRegister}
                  disabled={txPending || !fheReady || !newEmployee.address || (() => {
                    const raw = parseInt(newEmployee.salary, 10);
                    return isNaN(raw) || raw <= 0 || Math.floor(raw / PERIOD_DIVISORS[salaryPeriod]) <= 0;
                  })()}
                  className="btn-primary w-full py-3 flex items-center justify-center gap-2"
                >
                  <ShieldCheck size={16} />
                  <span>Encrypt & Register</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
