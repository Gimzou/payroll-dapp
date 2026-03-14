'use client';

import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { Wallet, LogOut } from 'lucide-react';

declare global {
  interface Window {
    ethereum?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
}

export default function ConnectButton({ onConnect }: { onConnect: (signer: ethers.Signer | null) => void }) {
  const [address, setAddress] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    const providerObj = (window as any).ethereum; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (providerObj) {
      const handleChainChanged = () => {
        window.location.reload();
      };
      const handleAccountsChanged = (accounts: string[]) => {
        if (accounts.length === 0) {
          setAddress("");
          onConnect(null);
        } else {
          window.location.reload(); // Safer to reload on account change to clear all state
        }
      };

      providerObj.on('chainChanged', handleChainChanged);
      providerObj.on('accountsChanged', handleAccountsChanged);

      return () => {
        providerObj.removeListener('chainChanged', handleChainChanged);
        providerObj.removeListener('accountsChanged', handleAccountsChanged);
      };
    }
  }, [onConnect]); 

  const connect = async () => {
    let providerObj = (window as any).ethereum; // eslint-disable-line @typescript-eslint/no-explicit-any
    
    // If multiple wallets (MetaMask + Rabby + etc)
    if (providerObj?.providers?.length) {
      // Find the one that's actually on Hardhat if available, otherwise use the first one
      providerObj = providerObj.providers.find((p: any) => p.chainId === '0x7a69') || providerObj.providers[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
    }

    if (!providerObj) {
      // Small delay retry for browsers with slow injection
      await new Promise(resolve => setTimeout(resolve, 500));
      providerObj = (window as any).ethereum; // eslint-disable-line @typescript-eslint/no-explicit-any
    }

    if (providerObj) {
      try {
        setLoading(true);
        
        // Use a more direct request pattern for widest browser compatibility
        await providerObj.request({ method: 'eth_requestAccounts' });
        
        const provider = new ethers.BrowserProvider(providerObj);
        const signer = await provider.getSigner();
        const address = await signer.getAddress();
        
        setAddress(address);
        onConnect(signer);
      } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        console.error("Wallet connection error:", err);
        if (err.code !== 4001) {
          alert(`Connection failed: ${err.message || "Please check your wallet extension"}`);
        }
      } finally {
        setLoading(false);
      }
    } else {
      alert('No Ethereum wallet detected. Please ensure your extension is enabled.');
    }
  };

  const disconnect = () => {
    setAddress("");
    onConnect(null);
  };

  if (!mounted) return (
    <div className="btn-secondary flex items-center gap-2 opacity-50 cursor-wait">
      <Wallet size={18} />
      <span>Detecting Wallet...</span>
    </div>
  );

  return address ? (
    <button onClick={disconnect} className="btn-secondary flex items-center gap-2">
      <LogOut size={18} />
      <span className="font-mono">{address.slice(0, 6)}...{address.slice(-4)}</span>
    </button>
  ) : (
    <button 
      onClick={connect} 
      disabled={loading}
      className={`btn-primary flex items-center gap-2 min-w-[160px] justify-center transition-all ${loading ? 'opacity-70 cursor-not-allowed scale-95' : 'hover:scale-105'}`}
    >
      <Wallet size={18} className={loading ? 'animate-pulse' : ''} />
      <span>{loading ? 'Connecting...' : 'Connect Wallet'}</span>
    </button>
  );
}
