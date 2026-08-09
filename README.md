# Arc Pay & Exchange

A beginner-friendly dApp for Arc Testnet.

## Features

- Connect MetaMask/Rabby/Coinbase Wallet through the browser's EIP-1193 provider
- Automatically add/switch to Arc Testnet
- Read native USDC balance
- Send native USDC
- Read the ERC-20 USDC interface balance
- Swap USDC <-> EURC on Arc Testnet through Circle Swap Kit
- Show transaction links on ArcScan
- Node.js/Express health API
- No user private keys are stored by the server

## Arc Testnet

- Chain ID: 5042002
- RPC: https://rpc.testnet.arc.network
- Explorer: https://testnet.arcscan.app
- Native gas asset: USDC
- ERC-20 USDC interface: 0x3600000000000000000000000000000000000000

## Run locally

Requirements: Node.js 22+ and an EVM browser wallet.

```bash
npm install
npm run dev
```

Open http://localhost:5173.

## Testnet funds

Use Circle's official faucet:

https://faucet.circle.com/

You need testnet USDC because Arc uses USDC for gas.

## Swap

The swap tab uses Circle's Swap Kit in permissionless mode by default. A Circle Kit key can be supplied through the client environment if you want higher limits.

Copy `client/.env.example` to `client/.env`:

```env
VITE_CIRCLE_KIT_KEY=
```

Never put a wallet private key in this project.

## Production hosting

The client is a static Vite app and can be hosted on Vercel/Netlify/Cloudflare Pages.
The server is an ordinary Node.js Express app and can be hosted on Render/Railway/Fly.io/etc.

For a truly one-click public deployment, a hosting account must be connected because this environment cannot publish a live public website on your behalf.
