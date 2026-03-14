'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  Banknote,
  ShieldCheck,
  RefreshCw,
  Search,
  Lock,
  Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { FHE_PAYROLL_ABI, FHE_PAYROLL_ADDRESS } from '@/lib/contracts';
import EmployerDashboard from '@/components/EmployerDashboard';
import EmployeeDashboard from '@/components/EmployeeDashboard';
import { Providers } from '@/components/Providers';
import AppLayout from '@/components/AppLayout';
import { useEthersSigner } from '@/lib/ethers';
import { useAccount, useSwitchChain, useChainId } from 'wagmi';
import { ethers } from 'ethers';

function HomeContent() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const signer = useEthersSigner();
  const [role, setRole] = useState<'employer' | 'employee' | null>(null);
  const [loading, setLoading] = useState(false);
  const isSupportedNetwork = chainId === 31337 || chainId === 11155111;

  const switchToSepolia = () => switchChain({ chainId: 11155111 });

  const checkRole = useCallback(async () => {
    if (!signer || !address || !isSupportedNetwork) return;
    try {
      setLoading(true);
      const contract = new ethers.Contract(FHE_PAYROLL_ADDRESS, FHE_PAYROLL_ABI, signer);
      let employerAddr = '';
      try {
        employerAddr = await contract.employer();
      } catch (e) {
        console.warn('Contract call failed:', e);
        toast.error('Could not reach contract. Check your network and contract address.');
        setRole(null);
        return;
      }
      if (address.toLowerCase() === employerAddr.toLowerCase()) {
        setRole('employer');
      } else {
        try {
          await contract.getEmployee(address);
          setRole('employee');
        } catch {
          setRole(null);
        }
      }
    } catch (err) {
      console.error('Role verification failed:', err);
      setRole(null);
    } finally {
      setLoading(false);
    }
  }, [signer, address, isSupportedNetwork]);

  useEffect(() => {
    if (isConnected && isSupportedNetwork && signer) {
      checkRole();
    } else {
      setRole(null);
    }
  }, [isConnected, isSupportedNetwork, signer, checkRole]);

  return (
    <AppLayout>
      {!isConnected ? (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="card-elevated p-12 max-w-2xl"
          >
            <div className="w-16 h-16 bg-secondary rounded-2xl flex items-center justify-center mx-auto mb-6">
              <Banknote size={32} className="text-primary" />
            </div>
            <h1 className="text-3xl font-bold mb-3 text-foreground">Confidential Payroll</h1>
            <p className="text-muted-foreground text-base mb-8 max-w-md mx-auto">
              Enterprise payroll management with fully encrypted salaries on-chain.
              Connect your wallet to get started.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <div className="badge badge-neutral py-2 px-4 text-sm">
                <Lock size={14} />
                <span>End-to-End Encrypted</span>
              </div>
              <div className="badge badge-neutral py-2 px-4 text-sm">
                <ShieldCheck size={14} />
                <span>EVM Compatible</span>
              </div>
            </div>
          </motion.div>
        </div>
      ) : (
        <AnimatePresence mode="wait">
          {!isSupportedNetwork ? (
            <motion.div
              key="wrong-network"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="card-elevated p-10 text-center max-w-lg mx-auto mt-16"
            >
              <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center mx-auto mb-4">
                <Search size={24} className="text-red-500" />
              </div>
              <h3 className="text-xl font-bold mb-2">Unsupported Network</h3>
              <p className="text-muted-foreground mb-6 text-sm">
                Chain ID <span className="font-mono bg-muted px-2 py-0.5 rounded text-xs">{chainId}</span> is not supported.
                Please switch to Sepolia.
              </p>
              <button onClick={switchToSepolia} className="btn-primary">
                Switch to Sepolia
              </button>
            </motion.div>
          ) : loading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center min-h-[50vh]"
            >
              <Loader2 className="animate-spin text-primary mb-4" size={32} />
              <p className="text-muted-foreground font-medium text-sm">Verifying role on chain...</p>
            </motion.div>
          ) : role === 'employer' ? (
            <motion.div
              key="employer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {signer && <EmployerDashboard signer={signer} />}
            </motion.div>
          ) : role === 'employee' ? (
            <motion.div
              key="employee"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {signer && <EmployeeDashboard signer={signer} />}
            </motion.div>
          ) : (
            <motion.div
              key="unauthorized"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="card-elevated p-10 text-center max-w-lg mx-auto mt-16"
            >
              <div className="w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center mx-auto mb-4">
                <Users size={24} className="text-amber-600" />
              </div>
              <h3 className="text-xl font-bold mb-2">Access Not Found</h3>
              <p className="text-muted-foreground mb-2 text-sm">
                This address is not registered in the payroll contract.
              </p>
              <p className="font-mono text-xs bg-muted px-3 py-2 rounded-lg mb-6 inline-block">{address}</p>
              <div>
                <button onClick={checkRole} className="btn-secondary flex items-center gap-2 mx-auto">
                  <RefreshCw size={14} />
                  <span>Retry</span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </AppLayout>
  );
}

export default function Home() {
  return (
    <Providers>
      <HomeContent />
    </Providers>
  );
}
