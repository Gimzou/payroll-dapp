'use client';

import React from 'react';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ZamaProvider, RelayerWeb } from "@zama-fhe/react-sdk";
import { memoryStorage } from "@zama-fhe/sdk";
import { NETWORK_CONFIG } from '@/lib/contracts';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider, lightTheme } from '@rainbow-me/rainbowkit';
import { Toaster } from 'react-hot-toast';
import { config } from '@/lib/wagmiConfig';
import { useEthersSigner } from '@/lib/ethers';
import { EthersSigner } from "@zama-fhe/sdk/ethers";
import '@rainbow-me/rainbowkit/styles.css';

const queryClient = new QueryClient();

// Polyfill for crypto.randomUUID in non-secure contexts (e.g. testing on LAN via IP)
if (typeof window !== 'undefined' && window.crypto && !window.crypto.randomUUID) {
  window.crypto.randomUUID = function () {
    return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
      (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16)
    ) as `${string}-${string}-${string}-${string}-${string}`;
  };
}

function ZamaWrapper({ children }: { children: React.ReactNode }) {
  const signer = useEthersSigner();

  const zamaSigner = React.useMemo(() => {
    return signer ? new EthersSigner({ signer }) : null;
  }, [signer]);

  const relayer = React.useMemo(() => {
    if (!zamaSigner) return null;
    return new RelayerWeb({
      getChainId: () => zamaSigner.getChainId(),
      transports: {
        31337: {
          relayerUrl: NETWORK_CONFIG[31337].relayerUrl,
          network: "http://127.0.0.1:8545",
        },
        11155111: {
          relayerUrl: NETWORK_CONFIG[11155111].relayerUrl,
          network: "https://ethereum-sepolia-rpc.publicnode.com",
        }
      },
      security: {
        integrityCheck: false
      }
    });
  }, [zamaSigner]);

  if (!zamaSigner || !relayer) {
      return <>{children}</>;
  }

  return (
    <ZamaProvider relayer={relayer} signer={zamaSigner} storage={memoryStorage}>
      {children}
    </ZamaProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={lightTheme({
          accentColor: '#c9a227',
          accentColorForeground: 'white',
          borderRadius: 'medium',
        })}>
          <ZamaWrapper>
            {children}
          </ZamaWrapper>
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: '#fff',
                color: '#1a1a2e',
                border: '1px solid #e5e2db',
                borderRadius: '8px',
                fontSize: '0.875rem',
              },
            }}
          />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
