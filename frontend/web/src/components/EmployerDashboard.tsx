'use client';

import { useState } from 'react';
import { ethers } from 'ethers';
import {
  Users,
  Trash2,
  UserPlus,
  ShieldCheck,
  Loader2,
  X,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useFHEPayroll } from '@/hooks/useFHEPayroll';

export default function EmployerDashboard({ signer }: { signer: ethers.Signer }) {
  const {
    employees,
    isAuthorized,
    isLoadingEmployees,
    txPending,
    fheReady,
    chainId,
    handleAddEmployee,
    handleReveal,
    handleAuthorize,
    handleEmployeeAction,
  } = useFHEPayroll(signer);

  const [showAddModal, setShowAddModal] = useState(false);
  const [newEmployee, setNewEmployee] = useState({ address: '', salary: '' });
  const [salaryPeriod, setSalaryPeriod] = useState<'hour' | 'day' | 'month' | 'year'>('month');
  const [hidden, setHidden] = useState<Record<number, boolean>>({});

  const PERIOD_DIVISORS: Record<string, number> = {
    hour: 3_600,
    day: 86_400,
    month: 2_592_000,
    year: 31_536_000,
  };

  const salaryAmount = parseInt(newEmployee.salary, 10);
  const tokensPerSecond = !isNaN(salaryAmount) && salaryAmount > 0
    ? Math.floor(salaryAmount / PERIOD_DIVISORS[salaryPeriod])
    : 0;

  const onRegister = async () => {
    if (!newEmployee.address || !newEmployee.salary || tokensPerSecond <= 0) return;
    const success = await handleAddEmployee(newEmployee.address, tokensPerSecond.toString());
    if (success) {
      setShowAddModal(false);
      setNewEmployee({ address: '', salary: '' });
      setSalaryPeriod('month');
    }
  };

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
                <th className="px-6 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-center">Status</th>
                <th className="px-6 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-center">Salary Rate</th>
                <th className="px-6 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoadingEmployees ? (
                <tr>
                  <td colSpan={4} className="px-6 py-16 text-center">
                    <Loader2 className="animate-spin mx-auto text-muted-foreground mb-3" size={28} />
                    <p className="text-sm text-muted-foreground">Loading employee data...</p>
                  </td>
                </tr>
              ) : employees.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-16 text-center">
                    <div className="w-12 h-12 bg-muted rounded-xl flex items-center justify-center mx-auto mb-3">
                      <UserPlus size={20} className="text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground">No employees registered yet.</p>
                  </td>
                </tr>
              ) : (
                employees.map((emp, idx) => (
                  <tr key={emp.address} className="table-row group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs font-bold text-primary shrink-0">
                          {idx + 1}
                        </div>
                        <span className="font-mono text-xs text-foreground">{emp.address}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={`badge ${
                        emp.status === 1 ? 'badge-success' :
                        emp.status === 2 ? 'badge-warning' :
                        emp.status === 3 ? 'badge-error' : 'badge-neutral'
                      }`}>
                        {['None', 'Active', 'Inactive', 'Terminated'][emp.status] || 'Unknown'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        {emp.decryptedSalary && !hidden[idx] ? (
                          <span className="font-semibold text-foreground">
                            {emp.decryptedSalary} <span className="text-xs text-muted-foreground">tok/s</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs flex items-center gap-1">
                            <Lock size={12} /> Encrypted
                          </span>
                        )}
                        <button
                          onClick={() => {
                            if (emp.decryptedSalary && !hidden[idx]) {
                              setHidden(h => ({ ...h, [idx]: true }));
                            } else if (hidden[idx]) {
                              setHidden(h => ({ ...h, [idx]: false }));
                            } else {
                              handleReveal(idx);
                            }
                          }}
                          disabled={emp.isRevealing || !fheReady}
                          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
                        >
                          {emp.isRevealing ? <Loader2 size={14} className="animate-spin" /> : (emp.decryptedSalary && !hidden[idx]) ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => handleEmployeeAction(emp.address, 'activate')}
                          className="p-2 rounded-md hover:bg-emerald-50 text-muted-foreground hover:text-emerald-600 transition-colors disabled:opacity-30"
                          disabled={emp.status !== 2 || txPending}
                          title="Activate"
                        >
                          <Unlock size={14} />
                        </button>
                        <button
                          onClick={() => handleEmployeeAction(emp.address, 'deactivate')}
                          className="p-2 rounded-md hover:bg-amber-50 text-muted-foreground hover:text-amber-600 transition-colors disabled:opacity-30"
                          disabled={emp.status !== 1 || txPending}
                          title="Deactivate"
                        >
                          <Lock size={14} />
                        </button>
                        <button
                          onClick={() => handleEmployeeAction(emp.address, 'delete')}
                          className="p-2 rounded-md hover:bg-red-50 text-muted-foreground hover:text-red-600 transition-colors disabled:opacity-30"
                          disabled={txPending}
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

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
                <button
                  onClick={() => setShowAddModal(false)}
                  className="p-1.5 hover:bg-muted rounded-md text-muted-foreground"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Wallet Address
                  </label>
                  <input
                    type="text"
                    placeholder="0x..."
                    className="w-full bg-white border border-border rounded-lg px-4 py-3 text-sm font-mono focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none transition-all"
                    value={newEmployee.address}
                    onChange={e => setNewEmployee({ ...newEmployee, address: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Compensation Rate
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="e.g. 5000"
                      className="flex-1 bg-white border border-border rounded-lg px-4 py-3 text-sm focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none transition-all"
                      value={newEmployee.salary}
                      onChange={e => setNewEmployee({ ...newEmployee, salary: e.target.value })}
                    />
                    <select
                      value={salaryPeriod}
                      onChange={e => setSalaryPeriod(e.target.value as typeof salaryPeriod)}
                      className="bg-white border border-border rounded-lg px-3 py-3 text-sm focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none transition-all"
                    >
                      <option value="hour">/ Hour</option>
                      <option value="day">/ Day</option>
                      <option value="month">/ Month (30d)</option>
                      <option value="year">/ Year (365d)</option>
                    </select>
                  </div>
                  {newEmployee.salary && tokensPerSecond > 0 && (
                    <p className="text-xs text-muted-foreground mt-2">
                      = <span className="font-semibold text-foreground">{tokensPerSecond}</span> tokens/second on-chain
                    </p>
                  )}
                  {newEmployee.salary && tokensPerSecond === 0 && salaryAmount > 0 && (
                    <p className="text-xs text-amber-600 mt-2">
                      Amount too small for this period — results in 0 tokens/second on-chain
                    </p>
                  )}
                  <div className="mt-3 p-3 bg-secondary/50 rounded-lg flex gap-2 items-start">
                    <ShieldCheck className="text-primary shrink-0 mt-0.5" size={14} />
                    <p className="text-xs text-secondary-foreground leading-relaxed">
                      This value is encrypted client-side using FHE before being sent to the smart contract.
                    </p>
                  </div>
                </div>

                <button
                  onClick={onRegister}
                  disabled={txPending || !fheReady || !newEmployee.address || !newEmployee.salary || tokensPerSecond <= 0}
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
