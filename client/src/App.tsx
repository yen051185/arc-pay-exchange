import { useEffect, useState } from "react";
import {
  formatUnits,
  parseUnits,
  type Address,
  type EIP1193Provider,
} from "viem";

const ARC_CHAIN_ID = 5042002;
const ARC_CHAIN_HEX = "0x4cef52";
const ARC_RPC = "https://rpc.testnet.arc.network";
const ARC_EXPLORER = "https://testnet.arcscan.app";
const USDC = "0x3600000000000000000000000000000000000000" as Address;

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function txUrl(hash: string) {
  return `${ARC_EXPLORER}/tx/${hash}`;
}

async function walletRequest<T = unknown>(
  method: string,
  params?: unknown[]
): Promise<T> {
  if (!window.ethereum) {
    throw new Error("Không tìm thấy MetaMask. Hãy cài MetaMask rồi tải lại trang.");
  }
  return (await window.ethereum.request({
    method,
    params,
  })) as T;
}

/**
 * Arc has one USDC balance:
 * - native EVM representation: 18 decimals
 * - ERC-20 USDC interface: 6 decimals
 *
 * The wallet network metadata below deliberately uses 18 decimals so it
 * matches the native transaction representation used by eth_sendTransaction.
 */
async function ensureArcNetwork() {
  try {
    await walletRequest("wallet_switchEthereumChain", [
      { chainId: ARC_CHAIN_HEX },
    ]);
  } catch (error: any) {
    if (error?.code !== 4902) throw error;

    await walletRequest("wallet_addEthereumChain", [
      {
        chainId: ARC_CHAIN_HEX,
        chainName: "Arc Testnet",
        nativeCurrency: {
          name: "USDC",
          symbol: "USDC",
          decimals: 18,
        },
        rpcUrls: [ARC_RPC],
        blockExplorerUrls: [ARC_EXPLORER],
      },
    ]);

    await walletRequest("wallet_switchEthereumChain", [
      { chainId: ARC_CHAIN_HEX },
    ]);
  }
}

async function readNativeBalance(address: Address) {
  const raw = await walletRequest<string>("eth_getBalance", [address, "latest"]);
  return formatUnits(BigInt(raw), 18);
}

async function readErc20Balance(address: Address) {
  // balanceOf(address): 0x70a08231 + 32-byte padded address
  const data =
    "0x70a08231" +
    address.slice(2).toLowerCase().padStart(64, "0");

  const raw = await walletRequest<string>("eth_call", [
    { to: USDC, data },
    "latest",
  ]);

  return formatUnits(BigInt(raw), 6);
}

function App() {
  const [account, setAccount] = useState<Address | null>(null);
  const [balance, setBalance] = useState("0");
  const [erc20Balance, setErc20Balance] = useState("0");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState("");
  const [txHash, setTxHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"pay" | "exchange">("pay");

  async function connectWallet() {
    try {
      setBusy(true);
      setStatus("Đang kết nối MetaMask…");

      await ensureArcNetwork();

      const accounts = await walletRequest<string[]>("eth_requestAccounts");
      const address = accounts?.[0] as Address | undefined;

      if (!address) throw new Error("MetaMask chưa trả về địa chỉ ví.");

      setAccount(address);
      setStatus("Đã kết nối MetaMask với Arc Testnet.");
      await refresh(address);
    } catch (error: any) {
      setStatus(
        error?.shortMessage ||
          error?.message ||
          "Không thể kết nối MetaMask."
      );
    } finally {
      setBusy(false);
    }
  }

  async function refresh(address = account) {
    if (!address) return;

    try {
      const [native, token] = await Promise.all([
        readNativeBalance(address),
        readErc20Balance(address),
      ]);

      setBalance(native);
      setErc20Balance(token);
    } catch (error: any) {
      setStatus(
        error?.shortMessage ||
          error?.message ||
          "Không thể đọc số dư Arc Testnet."
      );
    }
  }

  async function sendUSDC() {
    try {
      setBusy(true);
      setTxHash("");
      setStatus("Đang chuẩn bị giao dịch…");

      if (!account) throw new Error("Hãy kết nối MetaMask trước.");
      if (!/^0x[a-fA-F0-9]{40}$/.test(recipient)) {
        throw new Error("Địa chỉ người nhận không hợp lệ.");
      }
      if (!amount || Number(amount) <= 0) {
        throw new Error("Hãy nhập số USDC hợp lệ.");
      }

      await ensureArcNetwork();

      // Arc native USDC uses 18 decimals internally.
      const value = parseUnits(amount, 18);

      const hash = await walletRequest<string>("eth_sendTransaction", [
        {
          from: account,
          to: recipient as Address,
          value: `0x${value.toString(16)}`,
        },
      ]);

      setTxHash(hash);
      setStatus(
        "Đã gửi giao dịch. Arc có finality xác định; kiểm tra giao dịch trên ArcScan."
      );

      // Give the RPC a moment to expose the updated balance.
      setTimeout(() => refresh(account), 1200);
    } catch (error: any) {
      setStatus(
        error?.shortMessage ||
          error?.message ||
          "Giao dịch USDC thất bại."
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const ethereum = window.ethereum;
    if (!ethereum) return;

    const onAccountsChanged = (accounts: string[]) => {
      const address = accounts?.[0] as Address | undefined;
      setAccount(address || null);
      if (address) refresh(address);
      else {
        setBalance("0");
        setErc20Balance("0");
      }
    };

    const onChainChanged = () => {
      window.location.reload();
    };

    ethereum.on?.("accountsChanged", onAccountsChanged);
    ethereum.on?.("chainChanged", onChainChanged);

    return () => {
      ethereum.removeListener?.("accountsChanged", onAccountsChanged);
      ethereum.removeListener?.("chainChanged", onChainChanged);
    };
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <div className="brand">ARC PAY</div>
          <div className="subbrand">Payments & Exchange</div>
        </div>

        <button className="walletBtn" onClick={connectWallet} disabled={busy}>
          {account ? shortAddress(account) : "Connect MetaMask"}
        </button>
      </header>

      <main className="container">
        <section className="hero">
          <div>
            <span className="pill">ARC TESTNET</span>
            <h1>Pay and exchange with USDC.</h1>
            <p>
              Thanh toán USDC trực tiếp từ MetaMask trên Arc Testnet.
            </p>
          </div>

          <div className="balanceCard">
            <span>USDC balance</span>
            <strong>{Number(balance).toFixed(4)}</strong>
            <small>Native USDC • 18 decimals internally</small>

            {account && (
              <button className="refresh" onClick={() => refresh()}>
                Refresh
              </button>
            )}
          </div>
        </section>

        <section className="tabs">
          <button
            className={tab === "pay" ? "active" : ""}
            onClick={() => setTab("pay")}
          >
            Pay
          </button>
          <button
            className={tab === "exchange" ? "active" : ""}
            onClick={() => setTab("exchange")}
          >
            Exchange
          </button>
        </section>

        <section className="panel">
          {tab === "pay" ? (
            <>
              <h2>Send USDC</h2>
              <p className="hint">
                Gửi USDC native tới một ví EVM khác trên Arc Testnet.
              </p>

              <label>Recipient address</label>
              <input
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="0x…"
              />

              <label>Amount (USDC)</label>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="10.00"
                inputMode="decimal"
              />

              <button
                className="primary"
                disabled={busy || !account}
                onClick={sendUSDC}
              >
                {busy ? "Processing…" : "Send USDC"}
              </button>
            </>
          ) : (
            <>
              <h2>Exchange</h2>
              <p className="hint">
                Khu vực Exchange đã được giữ trong giao diện. Hoán đổi USDC
                ↔ EURC cần một swap route/contract hoặc Circle Swap Kit có
                cấu hình hợp lệ; không nên giả lập giao dịch hoặc tự ý chuyển
                tiền tới một contract không xác minh.
              </p>

              <div className="status">
                Thanh toán USDC trên Arc Testnet đã sẵn sàng. Exchange sẽ được
                bật sau khi cấu hình route swap chính thức.
              </div>
            </>
          )}

          {status && <div className="status">{status}</div>}

          {txHash && (
            <a
              className="tx"
              href={txUrl(txHash)}
              target="_blank"
              rel="noreferrer"
            >
              Xem giao dịch trên ArcScan ↗
            </a>
          )}
        </section>

        <section className="infoGrid">
          <div className="info">
            <span>Network</span>
            <strong>Arc Testnet</strong>
            <small>Chain ID {ARC_CHAIN_ID}</small>
          </div>

          <div className="info">
            <span>USDC</span>
            <strong>{shortAddress(USDC)}</strong>
            <small>ERC-20 interface • 6 decimals</small>
          </div>

          <div className="info">
            <span>ERC-20 balance</span>
            <strong>{Number(erc20Balance).toFixed(4)} USDC</strong>
            <small>Same underlying USDC balance</small>
          </div>
        </section>

        <footer>
          Testnet only. Tokens have no real-world value. Never enter a private
          key or seed phrase into this app.
        </footer>
      </main>
    </div>
  );
}

export default App;
