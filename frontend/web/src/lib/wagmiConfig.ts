import { http } from "wagmi";
import { sepolia, hardhat } from "wagmi/chains";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";

export const config = getDefaultConfig({
  appName: "FHE Payroll DApp",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "",
  chains: [hardhat, sepolia],
  transports: {
    [hardhat.id]: http("http://127.0.0.1:8545"),
    [sepolia.id]: http(),
  },
  ssr: false,
});
