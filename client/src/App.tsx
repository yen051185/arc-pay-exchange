import { useEffect, useState } from "react";

const ARC_CHAIN_ID = 5042002;
const ARC_CHAIN_HEX = "0x4CEF52";
const ARC_RPC = "https://rpc.testnet.arc.network";
const ARC_EXPLORER = "https://testnet.arcscan.app";
const USDC_ADDRESS =
  "0x3600000000000000000000000000000000000000";

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: any[]) => void) => void;
  removeListener?: (event: string, handler: (...args: any[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function explorerTx(hash: string) {
  return `${ARC_EXPLORER}/tx/${hash}`;
}

function parseUnits18(value: string): bigint {
  const cleaned = value.trim();
  if (!/^(?:\d+)(?:\.\d{1,18})?$/.test(cleaned)) {
    throw new Error("Số USDC không hợp lệ. Ví dụ: 10 hoặc 10.25");
  }

  const [whole, fraction = ""] = cleaned.split(".");
  return BigInt(whole) * 10n ** 18n +
    BigInt((fraction + "0".repeat(18)).slice(0, 18));
}

function formatUnits18(value: bigint): string {
  const whole = value / 10n ** 18n;
  const fraction = (value % 10n ** 18n).toString().padStart(18, "0");
  const display = fraction.slice(0, 6).replace(/0+$/, "");
  return display ? `${whole}.${display}` : whole.toString();
}

function formatUnits6(value: bigint): string {
  const whole = value / 10n ** 6n;
  const fraction = (value % 10n ** 6n).toString().padStart(6, "0");
  const display = fraction.replace(/0+$/, "");
  return display ? `${whole}.${display}` : whole.toString();
}

async function walletRequest<T = unknown>(
  method: string,
  params?: unknown[]
): Promise<T> {
  if (!window.ethereum) {
    throw new Error(
      "Không tìm thấy MetaMask. Hãy mở trang này bằng trình duyệt đã cài MetaMask."
    );
  }

  return (await window.ethereum.request({ method, params })) as T;
}

async function ensureArcNetwork() {
  if (!window.ethereum) {
    throw new Error("Không tìm thấy MetaMask.");
  }

  try {
    await walletRequest("wallet_switchEthereumChain", [
      { chainId: ARC_CHAIN_HEX },
    ]);
  } catch (error: any) {
    if (error?.code !== 4902) {
      throw error;
    }

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

async function readNativeBalance(address: string) {
  const raw = await walletRequest<string>("eth_getBalance", [
    address,
    "latest",
  ]);
  return formatUnits18(BigInt(raw));
}

async function readErc20Balance(address: string) {
  const data =
    "0x70a08231" +
    address.slice(2).toLowerCase().padStart(64, "0");

  const raw = await walletRequest<string>("eth_call", [
    { to: USDC_ADDRESS, data },
    "latest",
  ]);

  return formatUnits6(BigInt(raw));
}

function App() {
  const [account, setAccount] = useState<string | null>(null);
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
      setStatus("Đang mở MetaMask…");

      if (!window.ethereum) {
        throw new Error(
          "Không tìm thấy MetaMask. Hãy cài MetaMask trên trình duyệt này."
        );
      }

      const accounts = await walletRequest<string[]>("eth_requestAccounts");
      const address = accounts?.[0];

      if (!address) {
        throw new Error("MetaMask chưa trả về địa chỉ ví.");
      }

      await ensureArcNetwork();

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
      setStatus("Đã cập nhật số dư.");
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

      if (!account) {
        throw new Error("Hãy kết nối MetaMask trước.");
      }

      if (!/^0x[a-fA-F0-9]{40}$/.test(recipient.trim())) {
        throw new Error("Địa chỉ người nhận không hợp lệ.");
      }

      const value = parseUnits18(amount);
      if (value <= 0n) {
        throw new Error("Hãy nhập số USDC lớn hơn 0.");
      }

      await ensureArcNetwork();

      setStatus("Hãy xác nhận giao dịch USDC trong MetaMask…");

      const hash = await walletRequest<string>("eth_sendTransaction", [
        {
          from: account,
          to: recipient.trim(),
          value: `0x${value.toString(16)}`,
        },
      ]);

      setTxHash(hash);
      setStatus("Đã gửi giao dịch. Đang chờ Arc xác nhận…");

      for (let i = 0; i < 20; i++) {
        try {
          const receipt = await walletRequest<any>(
            "eth_getTransactionReceipt",
            [hash]
          );
          if (receipt) {
            setStatus("Giao dịch đã được xác nhận trên Arc Testnet.");
            await refresh(account);
            return;
          }
        } catch {
          // Keep polling.
        }

        await new Promise((resolve) => setTimeout(resolve, 800));
      }

      setStatus(
        "Giao dịch đã được gửi. Bạn có thể mở ArcScan để kiểm tra trạng thái."
      );
    } catch (error: any) {
      const message =
        error?.shortMessage ||
        error?.message ||
        "Giao dịch USDC thất bại.";

      if (error?.code === 4001) {
        setStatus("Bạn đã từ chối giao dịch trong MetaMask.");
      } else {
        setStatus(message);
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const ethereum = window.ethereum;
    if (!ethereum) return;

    const onAccountsChanged = (accounts: string[]) => {
      const address = accounts?.[0] || null;
      setAccount(address);

      if (address) {
        refresh(address);
      } else {
        setBalance("0");
        setErc20Balance("0");
        setStatus("Ví đã ngắt kết nối.");
      }
    };

    const onChainChanged = (chainId: string) => {
      if (chainId.toLowerCase() !== ARC_CHAIN_HEX.toLowerCase()) {
        setStatus("Vui lòng chuyển MetaMask về Arc Testnet.");
      } else if (account) {
        refresh(account);
      }
    };

    ethereum.on?.("accountsChanged", onAccountsChanged);
    ethereum.on?.("chainChanged", onChainChanged);

    return () => {
      ethereum.removeListener?.("accountsChanged", onAccountsChanged);
      ethereum.removeListener?.("chainChanged", onChainChanged);
    };
  }, [account]);

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <div className="brand">ARC PAY</div>
          <div className="subbrand">Payments & Exchange</div>
        </div>

        <button
          className="walletBtn"
          onClick={connectWallet}
          disabled={busy}
        >
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
            <strong>{balance}</strong>
            <small>Native USDC • 18 decimals internally</small>

            {account && (
              <button className="refresh" onClick={() => refresh()}>
                Refresh balance
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
                spellCheck={false}
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
                Chức năng Exchange cần một swap route/contract chính thức.
                Tôi không giả lập swap và không tự ý chuyển tiền của bạn tới
                contract chưa xác minh.
              </p>

              <div className="status">
                Payment và USDC transfer trên Arc Testnet đã được bật.
                Exchange sẽ được bật sau khi có route swap hợp lệ.
              </div>
            </>
          )}

          {status && <div className="status">{status}</div>}

          {txHash && (
            <a
              className="tx"
              href={explorerTx(txHash)}
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
            <strong>{shortAddress(USDC_ADDRESS)}</strong>
            <small>Native + ERC-20 interface</small>
          </div>

          <div className="info">
            <span>ERC-20 balance</span>
            <strong>{erc20Balance} USDC</strong>
            <small>Display decimals: 6</small>
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
