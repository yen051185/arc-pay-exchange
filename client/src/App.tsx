import { useEffect, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  formatUnits,
  http,
  parseUnits,
  type Address,
  type EIP1193Provider,
} from "viem";

const ARC_CHAIN_ID = 5042002;
const ARC_CHAIN_HEX = "0x4CF4B2";
const ARC_RPC = "https://rpc.testnet.arc.network";
const ARC_EXPLORER = "https://testnet.arcscan.app";
const USDC = "0x3600000000000000000000000000000000000000" as Address;
const USDC_DECIMALS = 6;

const arcTestnet = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC] } },
  blockExplorers: {
    default: { name: "ArcScan", url: ARC_EXPLORER },
  },
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
    ethereum?: EIP1193Provider & {
      isMetaMask?: boolean;
      providers?: Array<EIP1193Provider & { isMetaMask?: boolean }>;
    };
  }
}

function getEthereum(): EIP1193Provider | undefined {
  const ethereum = window.ethereum;
  if (!ethereum) return undefined;

  // If several injected wallets exist, prefer MetaMask.
  const providers = ethereum.providers;
  if (providers?.length) {
    return providers.find((p) => p.isMetaMask) ?? providers[0];
  }

  return ethereum;
}

const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_RPC),
});

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function explorerTx(hash: string) {
  return `${ARC_EXPLORER}/tx/${hash}`;
}

async function addOrSwitchArc(provider: EIP1193Provider) {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: ARC_CHAIN_HEX }],
    });
  } catch (error: any) {
    if (error?.code !== 4902) throw error;

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: ARC_CHAIN_HEX,
          chainName: "Arc Testnet",
          nativeCurrency: {
            name: "USDC",
            symbol: "USDC",
            decimals: 6,
          },
          rpcUrls: [ARC_RPC],
          blockExplorerUrls: [ARC_EXPLORER],
        },
      ],
    });

    // Some wallets add the chain but do not switch automatically.
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: ARC_CHAIN_HEX }],
      });
    } catch {
      // If the wallet already switched, this second request is harmless.
    }
  }
}

function App() {
  const [account, setAccount] = useState<Address | null>(null);
  const [balance, setBalance] = useState("0.000000");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState(
    "Connect MetaMask to use Arc Testnet."
  );
  const [txHash, setTxHash] = useState("");
  const [busy, setBusy] = useState(false);

  async function connectWallet() {
    const provider = getEthereum();

    if (!provider) {
      setStatus(
        "MetaMask was not detected. Please install/unlock MetaMask and refresh this page."
      );
      return;
    }

    try {
      setBusy(true);
      setStatus("Opening MetaMask…");
      setTxHash("");

      // First request access to the account. This is intentionally done
      // before asking MetaMask to switch networks.
      const accounts = (await provider.request({
        method: "eth_requestAccounts",
      })) as string[];

      if (!accounts?.[0]) {
        throw new Error("No MetaMask account was selected.");
      }

      const address = accounts[0] as Address;
      setAccount(address);

      setStatus("Switching to Arc Testnet…");
      await addOrSwitchArc(provider);

      setStatus("Connected to Arc Testnet.");
      await loadBalance(address);
    } catch (error: any) {
      const message =
        error?.shortMessage ||
        error?.message ||
        "MetaMask connection was cancelled or failed.";
      setStatus(message);
    } finally {
      setBusy(false);
    }
  }

  async function loadBalance(address = account) {
    if (!address) return;

    try {
      // Use the standard ERC-20 interface. Arc documents this as the
      // recommended way to read/send USDC and avoid native/ERC-20
      // decimal confusion.
      const raw = await publicClient.readContract({
        address: USDC,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      });

      setBalance(formatUnits(raw, USDC_DECIMALS));
    } catch (error: any) {
      setStatus(
        error?.shortMessage ||
          error?.message ||
          "Could not read your USDC balance."
      );
    }
  }

  async function sendPayment() {
    const provider = getEthereum();

    if (!provider) {
      setStatus("MetaMask was not detected.");
      return;
    }

    if (!account) {
      setStatus("Connect MetaMask first.");
      return;
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(recipient)) {
      setStatus("Please enter a valid recipient wallet address.");
      return;
    }

    if (!amount || Number(amount) <= 0) {
      setStatus("Please enter a valid USDC amount.");
      return;
    }

    try {
      setBusy(true);
      setStatus("Preparing USDC payment…");
      setTxHash("");

      await addOrSwitchArc(provider);

      const wallet = createWalletClient({
        account,
        chain: arcTestnet,
        transport: custom(provider),
      });

      const value = parseUnits(amount, USDC_DECIMALS);

      const hash = await wallet.writeContract({
        address: USDC,
        abi: erc20Abi,
        functionName: "transfer",
        args: [recipient as Address, value],
      });

      setTxHash(hash);
      setStatus("Transaction submitted. Waiting for confirmation…");

      await publicClient.waitForTransactionReceipt({ hash });

      setStatus("Payment confirmed on Arc Testnet.");
      setAmount("");
      await loadBalance(account);
    } catch (error: any) {
      setStatus(
        error?.shortMessage ||
          error?.message ||
          "The USDC payment failed."
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const provider = getEthereum();
    if (!provider) return;

    const onAccountsChanged = (accounts: string[]) => {
      const next = accounts?.[0] as Address | undefined;
      setAccount(next || null);
      if (next) {
        loadBalance(next);
        setStatus("Wallet account changed.");
      } else {
        setBalance("0.000000");
        setStatus("Wallet disconnected.");
      }
    };

    const onChainChanged = (chainId: string) => {
      if (chainId?.toLowerCase() === ARC_CHAIN_HEX.toLowerCase()) {
        setStatus("Connected to Arc Testnet.");
        if (account) loadBalance(account);
      } else {
        setStatus("Please switch MetaMask back to Arc Testnet.");
      }
    };

    const p = provider as any;
    p.on?.("accountsChanged", onAccountsChanged);
    p.on?.("chainChanged", onChainChanged);

    return () => {
      p.removeListener?.("accountsChanged", onAccountsChanged);
      p.removeListener?.("chainChanged", onChainChanged);
    };
  }, [account]);

  const card: React.CSSProperties = {
    background: "white",
    border: "1px solid #e5e7eb",
    borderRadius: 18,
    padding: 24,
    boxShadow: "0 8px 30px rgba(0,0,0,0.06)",
  };

  const button: React.CSSProperties = {
    width: "100%",
    border: 0,
    borderRadius: 12,
    padding: "13px 16px",
    fontSize: 16,
    fontWeight: 700,
    cursor: busy ? "wait" : "pointer",
    background: "#111827",
    color: "white",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f5f7fb",
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
        color: "#111827",
      }}
    >
      <header
        style={{
          background: "#111827",
          color: "white",
          padding: "18px 24px",
        }}
      >
        <div
          style={{
            maxWidth: 980,
            margin: "0 auto",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 16,
          }}
        >
          <div>
            <div style={{ fontSize: 21, fontWeight: 800 }}>
              Arc Pay & Exchange
            </div>
            <div style={{ opacity: 0.75, fontSize: 13 }}>
              Arc Testnet · USDC payments
            </div>
          </div>

          <button
            onClick={connectWallet}
            disabled={busy}
            style={{
              ...button,
              width: "auto",
              background: "#ffffff",
              color: "#111827",
              padding: "10px 15px",
            }}
          >
            {account ? shortAddress(account) : "Connect MetaMask"}
          </button>
        </div>
      </header>

      <main
        style={{
          maxWidth: 980,
          margin: "0 auto",
          padding: "34px 20px 60px",
        }}
      >
        <section
          style={{
            ...card,
            marginBottom: 20,
            background: "linear-gradient(135deg, #111827, #374151)",
            color: "white",
          }}
        >
          <div style={{ fontSize: 13, opacity: 0.7 }}>ARC TESTNET</div>
          <div
            style={{
              fontSize: 38,
              fontWeight: 800,
              marginTop: 6,
              letterSpacing: -1,
            }}
          >
            {balance} USDC
          </div>
          <div style={{ marginTop: 10, opacity: 0.78 }}>
            {account ? shortAddress(account) : "Wallet not connected"}
          </div>
          <button
            onClick={() => loadBalance()}
            disabled={!account || busy}
            style={{
              marginTop: 18,
              border: "1px solid rgba(255,255,255,.25)",
              background: "rgba(255,255,255,.1)",
              color: "white",
              borderRadius: 10,
              padding: "9px 13px",
              cursor: account && !busy ? "pointer" : "not-allowed",
            }}
          >
            Refresh balance
          </button>
        </section>

        <section style={card}>
          <h2 style={{ marginTop: 0, marginBottom: 6 }}>Send USDC</h2>
          <p style={{ marginTop: 0, color: "#6b7280" }}>
            Send USDC to another EVM wallet on Arc Testnet.
          </p>

          <label style={{ display: "block", fontWeight: 700, marginTop: 20 }}>
            Recipient address
          </label>
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value.trim())}
            placeholder="0x..."
            spellCheck={false}
            style={{
              width: "100%",
              boxSizing: "border-box",
              marginTop: 8,
              border: "1px solid #d1d5db",
              borderRadius: 10,
              padding: 13,
              fontSize: 15,
            }}
          />

          <label style={{ display: "block", fontWeight: 700, marginTop: 16 }}>
            Amount (USDC)
          </label>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="1.00"
            inputMode="decimal"
            style={{
              width: "100%",
              boxSizing: "border-box",
              marginTop: 8,
              border: "1px solid #d1d5db",
              borderRadius: 10,
              padding: 13,
              fontSize: 15,
            }}
          />

          <button
            onClick={sendPayment}
            disabled={busy || !account}
            style={{
              ...button,
              marginTop: 20,
              opacity: busy || !account ? 0.55 : 1,
            }}
          >
            {busy ? "Processing…" : "Send USDC"}
          </button>

          <div
            style={{
              marginTop: 18,
              padding: 14,
              borderRadius: 10,
              background: "#f3f4f6",
              color: "#374151",
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            <strong>Status:</strong> {status}
          </div>

          {txHash && (
            <div style={{ marginTop: 14 }}>
              <a
                href={explorerTx(txHash)}
                target="_blank"
                rel="noreferrer"
                style={{ color: "#2563eb", fontWeight: 700 }}
              >
                View transaction on ArcScan →
              </a>
            </div>
          )}
        </section>

        <section
          style={{
            ...card,
            marginTop: 20,
            background: "#fff7ed",
            borderColor: "#fed7aa",
          }}
        >
          <strong>Exchange</strong>
          <p style={{ marginBottom: 0, color: "#7c2d12", lineHeight: 1.5 }}>
            USDC ⇄ EURC exchange is temporarily disabled while we complete the
            server-side swap integration. The payment wallet connection and
            USDC transfer are the stable testnet functions in this version.
          </p>
        </section>

        <footer
          style={{
            textAlign: "center",
            marginTop: 28,
            color: "#6b7280",
            fontSize: 13,
          }}
        >
          Arc Testnet · Chain ID {ARC_CHAIN_ID} · USDC
        </footer>
      </main>
    </div>
  );
}

export default App;
