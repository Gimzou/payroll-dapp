import { http, createConfig } from "wagmi";
import { sepolia, hardhat } from "wagmi/chains";
import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { metaMaskWallet, injectedWallet, rainbowWallet } from "@rainbow-me/rainbowkit/wallets";

const connectors = connectorsForWallets(
  [
    {
      groupName: "Recommended",
      wallets: [metaMaskWallet, injectedWallet, rainbowWallet],
    },
  ],
  {
    appName: "FHE Payroll DApp",
    projectId: "unused", // Using manual connectors avoids WalletConnect requirement for the build
  },
);

export const config = createConfig({
  connectors,
  chains: [hardhat, sepolia],
  transports: {
    [hardhat.id]: http("http://127.0.0.1:8545"),
    [sepolia.id]: http(),
  },
  ssr: false,
});
