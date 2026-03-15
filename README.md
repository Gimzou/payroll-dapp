# FHE Payroll DApp

A confidential payroll system built on [Zama's FHEVM](https://docs.zama.ai/fhevm). Employee salaries, claimable balances, and total earnings are **fully encrypted on-chain** using Fully Homomorphic Encryption — no one can read them without an explicit decryption grant, not even a block explorer.

> **Live demo:** _[link coming after deployment]_
> **Network:** Sepolia testnet

---

## What makes this different

Traditional on-chain payroll exposes every salary and payment in plain text. This dApp keeps all compensation figures as FHE ciphertexts stored in the smart contract. Values are only decrypted when the authorised party (employer or the employee themselves) explicitly requests it — the decryption happens off-chain via Zama's relayer and KMS, never on the chain itself.

| What is encrypted | Who can decrypt |
|---|---|
| Salary rate (tokens/second) | Employer, employee |
| Claimable balance | Employer, employee |
| Lifetime received | Employer, employee |
| Token wallet balance | Token holder only |

---

## Architecture

```
┌─────────────────────────────────────────────┐
│  Browser (Next.js + React)                  │
│  ┌──────────────────┐  ┌──────────────────┐ │
│  │ EmployerDashboard│  │EmployeeDashboard │ │
│  └────────┬─────────┘  └────────┬─────────┘ │
│           │   useFHEPayroll /   │            │
│           │   useFHEEmployee    │            │
│           └──────────┬──────────┘            │
│          wagmi + ethers.js                   │
└─────────────────────┬───────────────────────┘
                      │ JSON-RPC
          ┌───────────▼───────────┐
          │   Sepolia Testnet     │
          │  ┌─────────────────┐  │
          │  │   FHEPayroll    │  │  ← encrypted euint64 state
          │  │   FHEToken      │  │  ← ERC-7984 confidential token
          │  └────────┬────────┘  │
          └───────────┼───────────┘
                      │ ACL grants
          ┌───────────▼───────────┐
          │  Zama Coprocessor /   │
          │  KMS / Relayer        │  ← handles FHE operations
          └───────────────────────┘
```

**Contracts**
- `FHEPayroll.sol` — manages the employee registry, encrypted salary accrual, and pay claims
- `FHEToken.sol` — ERC-7984 confidential ERC-20 used as the payment token (symbol: `cUSDC`)

**Frontend**
- Role detection: checks whether the connected wallet is the `employer` or a registered employee
- Employer view: employee table with encrypted payroll fields, on-demand accrual sync, expandable rows with hire dates
- Employee view: personal dashboard with salary rate, claimable balance, wallet balance, and pay claim flow

---

## Local development

### Prerequisites

- Node.js ≥ 20
- npm ≥ 7

### 1. Install dependencies

```bash
# Root (Hardhat + contracts)
npm install

# Frontend
cd frontend/web && npm install
```

### 2. Set Hardhat variables

```bash
npx hardhat vars set MNEMONIC          # 12-word seed phrase for deployer
npx hardhat vars set INFURA_API_KEY    # Infura project ID for Sepolia RPC
npx hardhat vars set ETHERSCAN_API_KEY # Optional — for contract verification
```

### 3. Compile and test contracts

```bash
npm run compile
npm run test
```

### 4. Start the frontend locally

```bash
cd frontend/web
npm run dev        # http://localhost:3001
```

> The dev server sets the required COOP/COEP headers automatically via `next.config.ts`. No extra configuration needed for local FHE operations.

---

## Deploying contracts to Sepolia

```bash
# Deploy FHEToken + FHEPayroll
npm run deploy:sepolia
```

The script prints the deployed addresses. Update `frontend/web/src/lib/contracts.ts`:

```ts
export const FHE_PAYROLL_ADDRESS = "0x<new-payroll-address>";
```

The token address is resolved at runtime via `payrollContract.paymentToken()`.

```bash
# Optional: verify source code on Etherscan
npm run verify:sepolia
```

> To force a clean redeploy (useful before a demo), bump `func.id` in `deploy/deploy.ts` (e.g. `deploy_payroll_v3` → `deploy_payroll_v4`) and re-run the deploy script.

---

## Deploying the frontend

The frontend is a fully static Next.js export deployed on **Cloudflare Pages**.

### Manual build

```bash
cd frontend/web
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<your-id> npm run build
# Output: frontend/web/out/
```

### Automated (GitHub Actions)

Every push to `main` that touches `frontend/web/**` triggers [`.github/workflows/deploy-frontend.yml`](.github/workflows/deploy-frontend.yml).

**Required GitHub secrets:**

| Secret | Where to get it |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens → Create Token (use the "Edit Cloudflare Pages" template) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → right sidebar on any domain page |
| `WALLETCONNECT_PROJECT_ID` | [cloud.walletconnect.com](https://cloud.walletconnect.com) → New Project (free) |

**One-time Cloudflare Pages setup:**

```bash
# Install wrangler locally (or use npx)
npx wrangler pages project create fhe-payroll
```

Or create the project in the Cloudflare dashboard (Pages → Create a project → Direct Upload, name it `fhe-payroll`). The GitHub Action will push to it automatically from then on.

---

## Demo walkthrough

### Employer flow

1. Connect the deployer wallet (the address that ran `deploy:sepolia`)
2. The app detects the employer role automatically
3. Click **Authorize Distributions** — this calls `setOperator` on `FHEToken`, allowing the payroll contract to transfer tokens on `claimPay`
4. Click **Add Employee** — enter a wallet address and a salary rate; the value is FHE-encrypted in the browser before submission
5. Use **Zap (⚡)** on any active employee to sync accrued earnings on-chain
6. Click the **eye icon** on any encrypted cell to decrypt and reveal the value
7. Expand any row with the **chevron** to see hire date, last sync timestamp, and the full address

### Employee flow

1. Connect a wallet that has been registered by the employer
2. The app detects the employee role and shows the personal dashboard
3. Click **Sync & Decrypt** on the claimable card to accrue earnings and decrypt in one step
4. Click **Claim Pay** to transfer the claimable amount to your wallet (requires the employer to have authorised distributions first)

### Funding the contract

The deployer wallet receives the full `cUSDC` supply on deploy. Before the demo, the employer must hold enough tokens — no explicit `transfer` to the contract is needed since `claimPay` uses `confidentialTransferFrom` on the approved operator.

---

## Tech stack

| Layer | Technology |
|---|---|
| FHE | [Zama FHEVM](https://github.com/zama-ai/fhevm) — `@fhevm/solidity` |
| Smart contracts | Solidity 0.8.27, Hardhat, hardhat-deploy |
| Token standard | ERC-7984 (OpenZeppelin confidential contracts) |
| Frontend | Next.js 16, React 19, TypeScript |
| Web3 | wagmi v2, viem, ethers.js v6 |
| Wallet UI | RainbowKit |
| FHE browser SDK | `@zama-fhe/react-sdk`, `@zama-fhe/relayer-sdk` |
| Styling | Tailwind CSS v4, Framer Motion |
| CI/CD | GitHub Actions, Cloudflare Pages |

---

## Project structure

```
payroll-dapp/
├── contracts/
│   ├── FHEPayroll.sol      # Core payroll logic
│   └── FHEToken.sol        # Confidential ERC-20
├── deploy/
│   └── deploy.ts           # hardhat-deploy script
├── test/                   # Hardhat tests
├── frontend/
│   └── web/
│       ├── src/
│       │   ├── app/        # Next.js App Router
│       │   ├── components/ # EmployerDashboard, EmployeeDashboard
│       │   ├── hooks/      # useFHEPayroll, useFHEEmployee
│       │   └── lib/        # contracts.ts (addresses + ABIs), wagmiConfig
│       └── public/
│           └── _headers    # COOP/COEP headers for Cloudflare Pages
├── .github/
│   └── workflows/
│       ├── main.yml              # Contract CI (compile, test, coverage)
│       └── deploy-frontend.yml   # Frontend build + Cloudflare Pages deploy
└── hardhat.config.ts
```

---

## License

BSD-3-Clause-Clear — see [LICENSE](LICENSE).

---

*Built for the [Zama Developer Program](https://www.zama.ai/developer-program)*
