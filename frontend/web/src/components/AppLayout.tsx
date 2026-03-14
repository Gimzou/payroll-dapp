'use client';

import { ReactNode } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { ShieldCheck } from 'lucide-react';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen bg-background">
      <nav className="sticky top-0 z-50 bg-white border-b border-border px-6 py-3 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-primary rounded-lg flex items-center justify-center">
            <ShieldCheck className="text-white" size={20} />
          </div>
          <div>
            <span className="text-base font-bold text-foreground tracking-tight">
              Confidential Payroll
            </span>
            <span className="hidden sm:inline text-xs text-muted-foreground ml-2 font-medium">
              Powered by Zama FHE
            </span>
          </div>
        </div>
        <ConnectButton
          accountStatus="avatar"
          chainStatus="icon"
          showBalance={false}
        />
      </nav>
      <main className="flex-1 max-w-7xl mx-auto w-full p-6 py-8">
        {children}
      </main>
      <footer className="px-6 py-6 text-center text-muted-foreground text-xs border-t border-border bg-white">
        Confidential Payroll &mdash; Built with Zama Fully Homomorphic Encryption
      </footer>
    </div>
  );
}
