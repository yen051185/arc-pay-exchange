import { useEffect, useMemo, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  formatUnits,
  parseUnits,
  type Address,
  type EIP1193Provider,
} from "viem";
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import { createSwapKitContext, swap } from "@circle-fin/swap-kit";

const ARC_CHAIN_ID = 5042002;
const ARC_RPC = "https://rpc.testnet.arc.network";
const ARC_EXPLORER = "https://testnet.arcscan.app";
const USDC = "0x3600000000000000000000000000000000000000" as Address;

const arcTestnet = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC] } },
  blockExplorers: { default: { name: "ArcScan", url: ARC_EXPLORER } },
});

const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function explorerTx(hash: string) {
  return `${ARC_EXPLORER}/tx/${hash}`;
}

function App() {
  const [account, setAccount] = useState<Address | null>(null);
  const [nativeBalance, setNativeBalance] = useState("0");
  const [erc20Balance, setErc20Balance] = useState("0");
  const [tab, setTab] = useState<"pay" | "swap">("pay");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [swapAmount, setSwapAmount] = useState("");
  const [direction, setDirection] = useState<"USDC_TO_EURC" | "EURC_TO_USDC">("USDC_TO_EURC");
  const [status, setStatus] = useState("");
  const [txHash, setTxHash] = useState("");
  const [busy, setBusy] = useState(false);

  const publicClient = useMemo(
    () => createPublicClient({ chain: arcTestnet, transport: custom(window.ethereum!) }),
    []
  );

  async function ensureArc() {
    if (!window.ethereum) throw new Error("Please install MetaMask or another EVM wallet.");
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x4CEF52" }],
      });
    } catch (err: any) {
      if (err?.code !== 4902) throw err;
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: "0x4CEF52",
          chainName: "Arc Testnet",
          nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
          rpcUrls: [ARC_RPC],
          blockExplorerUrls: [ARC_EXPLORER],
        }],
      });
    }
  }

  async function connect() {
  try {
    setStatus("Connecting wallet…");

    if (!window.ethereum) {
      throw new Error("Please install MetaMask first.");
    }

    const wallet = createWalletClient({
      chain: arcTestnet,
      transport: custom(window.ethereum),
    });

    const addresses = await wallet.requestAddresses();

    if (!addresses[0]) {
      throw new Error("No MetaMask account selected.");
    }

    setAccount(addresses[0] as Address);

    await ensureArc();

    setStatus("Wallet connected to Arc Testnet.");
  } catch (e: any) {
    setStatus(
      e?.shortMessage ||
      e?.message ||
      "Could not connect to MetaMask."
    );
  }
}
    }
  }

  async function refresh() {
    if (!account) return;
    try {
      const native = await publicClient.getBalance({ address: account });
      const token = await publicClient.readContract({
        address: USDC,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account],
      });
      setNativeBalance(formatUnits(native, 18));
      setErc20Balance(formatUnits(token, 6));
    } catch (e: any) {
      setStatus(e?.shortMessage || e?.message || "Could not read balance.");
    }
  }

  useEffect(() => {
    if (account) refresh();
  }, [account]);

  useEffect(() => {
    const ethereum = window.ethereum;
    if (!ethereum) return;
    const onAccountsChanged = (accounts: string[]) => setAccount((accounts[0] as Address) || null);
    const onChainChanged = () => window.location.reload();
    ethereum.on?.("accountsChanged", onAccountsChanged);
    ethereum.on?.("chainChanged", onChainChanged);
    return () => {
      ethereum.removeListener?.("accountsChanged", onAccountsChanged);
      ethereum.removeListener?.("chainChanged", onChainChanged);
    };
  }, []);

  async function sendPayment() {
    try {
      setBusy(true);
      setStatus("Preparing payment…");
      setTxHash("");
      if (!account) throw new Error("Connect your wallet first.");
      if (!/^0x[a-fA-F0-9]{40}$/.test(recipient)) throw new Error("Recipient address is invalid.");
      if (!amount || Number(amount) <= 0) throw new Error("Enter a valid amount.");
      await ensureArc();

      const wallet = createWalletClient({ account, chain: arcTestnet, transport: custom(window.ethereum!) });
      const hash = await wallet.sendTransaction({
        to: recipient as Address,
        value: parseUnits(amount, 18),
      });
      setTxHash(hash);
      setStatus("Payment submitted. Waiting for confirmation…");
      await publicClient.waitForTransactionReceipt({ hash });
      setStatus("Payment confirmed.");
      await refresh();
    } catch (e: any) {
      setStatus(e?.shortMessage || e?.message || "Payment failed.");
    } finally {
      setBusy(false);
    }
  }

  async function doSwap() {
    try {
      setBusy(true);
      setStatus("Preparing swap…");
      setTxHash("");
      if (!account) throw new Error("Connect your wallet first.");
      if (!swapAmount || Number(swapAmount) <= 0) throw new Error("Enter a valid swap amount.");
      await ensureArc();
      if (!window.ethereum) throw new Error("Wallet provider unavailable.");

      const adapter = await createViemAdapterFromProvider({
        provider: window.ethereum,
        capabilities: {
          addressContext: "user-controlled",
          supportedChains: [arcTestnet as any],
        },
      });

      const context = createSwapKitContext();
      const tokenIn = direction === "USDC_TO_EURC" ? "USDC" : "EURC";
      const tokenOut = direction === "USDC_TO_EURC" ? "EURC" : "USDC";

      const config: any = {};
      const kitKey = import.meta.env.VITE_CIRCLE_KIT_KEY;
      if (kitKey) config.kitKey = kitKey;

      const result: any = await swap(context, {
        from: { adapter, chain: "Arc_Testnet" },
        tokenIn,
        tokenOut,
        amountIn: swapAmount,
        config,
      });

      const hash = result?.txHash || result?.transactionHash || "";
      if (hash) setTxHash(hash);
      setStatus("Swap completed.");
      await refresh();
    } catch (e: any) {
      setStatus(e?.shortMessage || e?.message || "Swap failed. Check that the route is available and your wallet has enough testnet funds.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <div className="brand">ARC PAY</div>
          <div className="subbrand">Payments & Exchange</div>
        </div>
        <button className="walletBtn" onClick={connect}>
          {account ? shortAddress(account) : "Connect Wallet"}
        </button>
      </header>

      <main className="container">
        <section className="hero">
          <div>
            <span className="pill">ARC TESTNET</span>
            <h1>Pay and exchange with USDC.</h1>
            <p>Simple wallet-to-wallet payments and USDC ⇄ EURC swaps on Arc Testnet.</p>
          </div>
          <div className="balanceCard">
            <span>USDC balance</span>
            <strong>{Number(nativeBalance).toFixed(4)}</strong>
            <small>Native balance • gas + transfers</small>
            {account && <button className="refresh" onClick={refresh}>Refresh</button>}
          </div>
        </section>

        <section className="tabs">
          <button className={tab === "pay" ? "active" : ""} onClick={() => setTab("pay")}>Pay</button>
          <button className={tab === "swap" ? "active" : ""} onClick={() => setTab("swap")}>Exchange</button>
        </section>

        <section className="panel">
          {tab === "pay" ? (
            <>
              <h2>Send USDC</h2>
              <p className="hint">The recipient receives native USDC. Arc uses USDC for gas, so you do not need ETH.</p>
              <label>Recipient address</label>
              <input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="0x…" />
              <label>Amount (USDC)</label>
              <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="10.00" inputMode="decimal" />
              <button className="primary" disabled={busy || !account} onClick={sendPayment}>
                {busy ? "Processing…" : "Send USDC"}
              </button>
            </>
          ) : (
            <>
              <h2>Exchange</h2>
              <p className="hint">Arc Testnet currently supports USDC, EURC and cirBTC for Circle Swap Kit routes.</p>
              <div className="direction">
                <button className={direction === "USDC_TO_EURC" ? "selected" : ""} onClick={() => setDirection("USDC_TO_EURC")}>USDC → EURC</button>
                <button className={direction === "EURC_TO_USDC" ? "selected" : ""} onClick={() => setDirection("EURC_TO_USDC")}>EURC → USDC</button>
              </div>
              <label>Amount</label>
              <input value={swapAmount} onChange={e => setSwapAmount(e.target.value)} placeholder="10.00" inputMode="decimal" />
              <button className="primary" disabled={busy || !account} onClick={doSwap}>
                {busy ? "Swapping…" : "Exchange"}
              </button>
            </>
          )}

          {status && <div className="status">{status}</div>}
          {txHash && (
            <a className="tx" href={explorerTx(txHash)} target="_blank" rel="noreferrer">
              View transaction on ArcScan ↗
            </a>
          )}
        </section>

        <section className="infoGrid">
          <div className="info">
            <span>Network</span><strong>Arc Testnet</strong><small>Chain ID {ARC_CHAIN_ID}</small>
          </div>
          <div className="info">
            <span>USDC interface</span><strong>{shortAddress(USDC)}</strong><small>ERC-20 • 6 decimals</small>
          </div>
          <div className="info">
            <span>Wallet balance</span><strong>{Number(erc20Balance).toFixed(4)} USDC</strong><small>ERC-20 view of the same underlying USDC</small>
          </div>
        </section>

        <footer>
          Testnet only. Tokens have no real-world value. Never enter a private key or seed phrase into this app.
        </footer>
      </main>
    </div>
  );
}

export default App;
