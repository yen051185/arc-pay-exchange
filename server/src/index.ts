import express from "express";
import cors from "cors";

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "arc-pay-exchange",
    network: "Arc Testnet",
    chainId: 5042002,
    timestamp: new Date().toISOString()
  });
});

app.get("/api/config", (_req, res) => {
  res.json({
    chainId: 5042002,
    rpc: "https://rpc.testnet.arc.network",
    explorer: "https://testnet.arcscan.app",
    usdc: "0x3600000000000000000000000000000000000000"
  });
});

app.listen(port, () => {
  console.log(`Arc Pay API listening on http://localhost:${port}`);
});
