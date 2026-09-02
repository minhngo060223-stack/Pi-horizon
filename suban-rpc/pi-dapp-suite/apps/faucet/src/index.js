import express from "express";
import cors from "cors";
import { z } from "zod";
import pLimit from "p-limit";
import * as StellarSdk from "stellar-sdk";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// Dev: pi-dapp-suite/apps/faucet/src -> pi-dapp-suite.
// Docker: /app/src -> /app (contracts and state files are copied/mounted there).
const devRoot = path.resolve(here, "..", "..", "..");
const dockerRoot = path.resolve(here, "..");
const repoRoot = process.env.APP_ROOT ?? (existsSync(path.join(dockerRoot, "contracts")) ? dockerRoot : devRoot);
dotenv.config({ path: path.join(repoRoot, ".env") });

const envSchema = z.object({
  PI_RPC_URL: z.string().url(),
  NETWORK_PASSPHRASE: z.string().min(1),
  FAUCET_PUBLIC: z.string().min(1),
  FAUCET_SECRET: z.string().min(1),
  PORT: z.string().optional(),
  ADMIN_TOKEN: z.string().min(8).optional(),
  FAUCET_MAX_FEE_STROOPS: z.string().regex(/^\d+$/).optional(),
});

const env = envSchema.parse({
  PI_RPC_URL: process.env.PI_RPC_URL,
  NETWORK_PASSPHRASE: process.env.NETWORK_PASSPHRASE,
  FAUCET_PUBLIC: process.env.FAUCET_PUBLIC,
  FAUCET_SECRET: process.env.FAUCET_SECRET,
  PORT: process.env.PORT,
  ADMIN_TOKEN: process.env.ADMIN_TOKEN,
  FAUCET_MAX_FEE_STROOPS: process.env.FAUCET_MAX_FEE_STROOPS,
});

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const rpc = new StellarSdk.SorobanRpc.Server(env.PI_RPC_URL, {
  allowHttp: env.PI_RPC_URL.startsWith("http://"),
});

const faucetKeypair = StellarSdk.Keypair.fromSecret(env.FAUCET_SECRET);

const limit = pLimit(2);

/** Resolve classic inclusion fee from RPC stats with floor/safety margin (stroops string). */
async function resolveClassicMaxFee(rpc) {
  const configured = Number(env.FAUCET_MAX_FEE_STROOPS ?? "1000000");
  const floor = Number.isFinite(configured) && configured > 0 ? configured : 1_000_000;
  const fallback = floor;
  try {
    const stats = await rpc.getFeeStats();
    const dist = stats?.inclusionFee ?? stats?.InclusionFee;
    if (!dist || typeof dist !== "object") return String(fallback);
    const nums = [
      dist.max,
      dist.p99,
      dist.p95,
      dist.mode,
      dist.p90,
      dist.min,
    ]
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n) && n > 0);
    const base = nums.length ? Math.max(...nums) : fallback;
    const withMargin = Math.ceil(base * 10);
    return String(Math.max(floor, withMargin));
  } catch {
    return String(fallback);
  }
}

async function destinationAccountExists(rpc, publicKey) {
  try {
    await rpc.getAccount(publicKey);
    return true;
  } catch {
    return false;
  }
}

async function waitForDestinationAccount(rpc, publicKey, timeoutMs = 300_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await destinationAccountExists(rpc, publicKey)) return true;
    await sleep(1500);
  }
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSubmittedTx(rpc, hash, timeoutMs = 300_000) {
  const start = Date.now();
  let lastTx;
  while (Date.now() - start < timeoutMs) {
    try {
      const tx = await rpc.getTransaction(hash);
      lastTx = tx;
      if (tx.status !== "NOT_FOUND") return tx;
    } catch (e) {
      if (e.message?.includes("Bad union switch")) {
        lastTx = { status: "PENDING", hash };
      } else {
        throw e;
      }
    }
    await sleep(1500);
  }
  return lastTx ?? { status: "NOT_FOUND", hash };
}

/** Build a fresh signed tx from the current account sequence number. */
async function buildClassicTx(rpc, passphrase, sourceKp, operations, fee) {
  const account = await rpc.getAccount(sourceKp.publicKey());
  let tb = new StellarSdk.TransactionBuilder(account, { fee, networkPassphrase: passphrase });
  for (const op of operations) tb = tb.addOperation(op);
  const tx = tb.setTimeout(300).build();
  tx.sign(sourceKp);
  return tx;
}

/**
 * Submit a classic tx, rebuilding with fresh sequence on every TRY_AGAIN_LATER.
 * TRY_AGAIN_LATER means stellar-core's pending queue is full for this slot;
 * a fresh sequence number is required after each ledger advance.
 */
async function sendClassicTx(rpc, passphrase, sourceKp, operations, confirmPublicKey) {
  let lastSend;
  let lastFee = null;
  let lastAttempt = 0;

  for (let attempt = 1; attempt <= 12; attempt += 1) {
    lastAttempt = attempt;
    const baseFee = Number(await resolveClassicMaxFee(rpc));
    const effectiveBase = Number.isFinite(baseFee) && baseFee > 0 ? baseFee : 1_000_000;
    const surgeMultiplier = Math.min(1 + attempt * 2, 25);
    const fee = String(Math.min(Math.ceil(effectiveBase * surgeMultiplier), 50_000_000));
    lastFee = fee;
    // Rebuild tx with fresh sequence number on every attempt.
    const tx = await buildClassicTx(rpc, passphrase, sourceKp, operations, fee);
    lastSend = await rpc.sendTransaction(tx);

    if (lastSend.status === "PENDING" || lastSend.status === "DUPLICATE") {
      const final = await waitForSubmittedTx(rpc, lastSend.hash);
      const accountConfirmed = confirmPublicKey
        ? await waitForDestinationAccount(rpc, confirmPublicKey)
        : false;
      return {
        send: lastSend,
        final,
        accepted: final?.status === "SUCCESS" || accountConfirmed,
        accountConfirmed,
        attempt,
        feeBidStroops: fee,
      };
    }

    if (lastSend.status !== "TRY_AGAIN_LATER") {
      return { send: lastSend, final: null, accepted: false, attempt, feeBidStroops: fee };
    }

    // Wait for roughly one ledger before rebuilding with the new sequence.
    await sleep(Math.min(6000 * attempt, 30_000));
  }

  const accountConfirmed = confirmPublicKey
    ? await waitForDestinationAccount(rpc, confirmPublicKey)
    : false;
  return {
    send: lastSend,
    final: null,
    accepted: accountConfirmed,
    accountConfirmed,
    attempt: lastAttempt,
    feeBidStroops: lastFee,
  };
}

const execFileAsync = promisify(execFile);
const contractsRoot = path.join(repoRoot, "contracts");
const contractsStatePath = path.join(repoRoot, ".contracts-state.json");
const contractsEnvPath = path.join(repoRoot, ".contracts.env");

function requireAdmin(req, res) {
  if (!env.ADMIN_TOKEN) {
    return res.status(400).json({
      ok: false,
      error: "ADMIN_TOKEN is not set on the backend",
      hint: "Set ADMIN_TOKEN in pi-dapp-suite/.env and restart the faucet service.",
    });
  }
  const got = req.header("x-admin-token");
  if (!got || got !== env.ADMIN_TOKEN) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized",
      hint: "Send header x-admin-token exactly matching the server's ADMIN_TOKEN.",
    });
  }
  return null;
}

async function readContractsState() {
  try {
    const raw = await fs.readFile(contractsStatePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeContractsState(next) {
  await fs.writeFile(contractsStatePath, JSON.stringify(next, null, 2), "utf8");
}

async function writeContractsEnv(ids) {
  const lines = [
    `TOKEN_CONTRACT_ID=${ids.token ?? ""}`,
    `DEX_POOL_CONTRACT_ID=${ids.dex_pool ?? ""}`,
    `DEX_ROUTER_CONTRACT_ID=${ids.dex_router ?? ""}`,
    `SUBSCRIPTION_CONTRACT_ID=${ids.subscription ?? ""}`,
    `CONTRACTS_DEPLOYED_AT=${ids.deployedAt ?? ""}`,
    "",
  ];
  await fs.writeFile(contractsEnvPath, lines.join("\n"), "utf8");
}

app.get("/health", async (_req, res) => {
  try {
    const health = await rpc.getHealth();
    res.json({ ok: true, health });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: String(e?.message ?? e),
      details: String(e),
      stack: e?.stack ? String(e.stack) : undefined,
      piRpcUrl: env.PI_RPC_URL,
    });
  }
});

app.get("/contracts/state", async (_req, res) => {
  const state = await readContractsState();
  res.json({ ok: true, state });
});

app.post("/admin/contracts/deploy-all", async (req, res) => {
  const denied = requireAdmin(req, res);
  if (denied) return;

  try {
    const tryBuild = async () => {
      try {
        await execFileAsync("cargo", ["build", "--target", "wasm32-unknown-unknown", "--release"], { cwd: contractsRoot });
      } catch { /* prebuilt in Docker */ }
    };
    await tryBuild();

    const resolveWasm = async (crateName, wasmName = crateName) => {
      const candidates = [
        path.join(contractsRoot, "target", "wasm32-unknown-unknown", "release", `${wasmName}.wasm`),
        path.join(contractsRoot, crateName, "target", "wasm32-unknown-unknown", "release", `${wasmName}.wasm`),
      ];
      for (const candidate of candidates) {
        try { await fs.access(candidate); return candidate; } catch { /* next */ }
      }
      throw new Error(`Missing WASM for ${crateName}`);
    };

    const wasm = {
      token: await resolveWasm("token"),
      dex_pool: await resolveWasm("dex_pool"),
      dex_router: await resolveWasm("dex_router"),
      subscription: await resolveWasm("subscription"),
    };

    const { xdr, hash, TransactionBuilder, Operation } = StellarSdk;

    const deployOne = async (wasmPath) => {
      const wasmBuf = await fs.readFile(wasmPath);
      const wasmHash = hash(wasmBuf);

      const account = await rpc.getAccount(faucetKeypair.publicKey());
      const hf = xdr.HostFunction.hostFunctionTypeCreateContract(
        new xdr.CreateContractArgs({
          contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
            new xdr.ContractIdPreimageFromAddress({
              address: xdr.ScAddress.scAddressTypeAccount(
                xdr.AccountId.publicKeyTypeEd25519(faucetKeypair.rawPublicKey())
              ),
              salt: xdr.Uint256.fromXDR(Buffer.alloc(32)),
            })
          ),
          executable: xdr.ContractExecutable.contractExecutableWasm(wasmHash),
        })
      );

      const op = Operation.invokeHostFunction({ func: hf, auth: [] });

      const fee = await resolveClassicMaxFee(rpc);

      const tx = new TransactionBuilder(account, {
        fee,
        networkPassphrase: env.NETWORK_PASSPHRASE,
      })
        .addOperation(op)
        .setTimeout(300)
        .build();

      const sim = await rpc.simulateTransaction(tx);
      if (sim.error) throw new Error(`simulateTransaction failed: ${JSON.stringify(sim.error)}`);

      const assembled = StellarSdk.SorobanRpc.assembleTransaction(tx, sim).build();
      assembled.sign(faucetKeypair);
      const txXdr = assembled.toEnvelope().toXDR("base64");

      const sendResp = await fetch(env.PI_RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendTransaction", params: { transaction: txXdr } }),
      });
      const sendJson = await sendResp.json();
      if (sendJson.error) throw new Error(sendJson.error.message || JSON.stringify(sendJson.error));
      if (sendJson.result?.status === "ERROR") throw new Error(JSON.stringify(sendJson.result));

      // Contract ID = SHA-256(wasmHash || sourcePubKey || salt)
      return hash(Buffer.concat([wasmHash, faucetKeypair.rawPublicKey(), Buffer.alloc(32)])).toString("hex");
    };

    const ids = {
      token: await deployOne(wasm.token),
      dex_pool: await deployOne(wasm.dex_pool),
      dex_router: await deployOne(wasm.dex_router),
      subscription: await deployOne(wasm.subscription),
    };

    const state = await readContractsState();
    const next = { ...state, ...ids, deployedAt: new Date().toISOString() };
    await writeContractsState(next);
    await writeContractsEnv(next);
    res.json({ ok: true, ids: next });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e), details: String(e), piRpcUrl: env.PI_RPC_URL });
  }
});

const invokeSchema = z.object({
  contractId: z.string().min(1),
  fn: z.string().min(1),
  // soroban-cli args as strings, already formatted (e.g. ["--admin", "G...", "--decimals", "7"])
  args: z.array(z.string()).optional(),
});

app.post("/admin/contracts/invoke", async (req, res) => {
  const denied = requireAdmin(req, res);
  if (denied) return;

  const parsed = invokeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const { contractId, fn, args } = parsed.data;
  try {
    try {
      await execFileAsync("soroban", ["--version"]);
    } catch (verErr) {
      return res.status(503).json({
        ok: false,
        error: "soroban CLI unavailable",
        hint: "Install Soroban CLI or extend the Docker image.",
        details: String(verErr?.message ?? verErr),
        code: verErr?.code,
      });
    }

    const common = ["--rpc-url", env.PI_RPC_URL, "--network-passphrase", env.NETWORK_PASSPHRASE];
    const { stdout, stderr } = await execFileAsync(
      "stellar",
      [
        "contract",
        "invoke",
        "--id",
        contractId,
        "--source-account",
        env.FAUCET_SECRET,
        ...common,
        "--",
        fn,
        ...(args ?? []),
      ],
      { cwd: contractsRoot }
    );
    res.json({ ok: true, stdout: stdout.trim(), stderr: (stderr ?? "").trim() });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: String(e?.message ?? e),
      details: String(e),
      code: e?.code,
      hint: e?.code === "ENOENT" ? "soroban CLI not found on PATH." : undefined,
    });
  }
});

const fundSchema = z.object({
  destination: z.string().min(1),
  startingBalance: z
    .string()
    .regex(/^\d+(\.\d{1,7})?$/, "Amount must be a positive decimal with up to 7 decimal places")
    .optional(),
});

app.post("/faucet/fund", async (req, res) => {
  const parsed = fundSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const { destination, startingBalance } = parsed.data;
  let destPk;
  try {
    destPk = StellarSdk.Keypair.fromPublicKey(destination).publicKey();
  } catch {
    return res.status(400).json({ ok: false, error: "Invalid destination public key" });
  }

  const amountStr = startingBalance ?? "2";

  // serialize requests to avoid sequence races
  const result = await limit(async () => {
    const exists = await destinationAccountExists(rpc, destPk);

    const operations = exists
      ? [
          StellarSdk.Operation.payment({
            destination: destPk,
            asset: StellarSdk.Asset.native(),
            amount: amountStr,
          }),
        ]
      : [
          StellarSdk.Operation.createAccount({
            destination: destPk,
            startingBalance: amountStr,
          }),
        ];

    let submitted = await sendClassicTx(rpc, env.NETWORK_PASSPHRASE, faucetKeypair, operations, destPk);

    // Race: account created between check and submit — retry as payment
    if (submitted.send?.status === "ERROR" && !exists) {
      try {
        const alt = await sendClassicTx(
          rpc,
          env.NETWORK_PASSPHRASE,
          faucetKeypair,
          [
            StellarSdk.Operation.payment({
              destination: destPk,
              asset: StellarSdk.Asset.native(),
              amount: amountStr,
            }),
          ],
          destPk
        );
        submitted = alt;
      } catch {
        /* keep original send for client diagnostics */
      }
    }

    return {
      ...submitted,
      mode: exists ? "payment" : "createAccount",
      piRpcUrl: env.PI_RPC_URL,
      hint:
        !submitted.accepted
          ? "Funding was not confirmed on-chain. Check send.status, final.status, and accountConfirmed; RPC may be congested or the transaction may have failed."
          : undefined,
    };
  });

  const ok = result.accepted === true;
  res.status(ok ? 200 : 502).json({ ok, ...result });
});

const port = Number(env.PORT ?? 4000);
app.listen(port, "0.0.0.0", () => {
  // eslint-disable-next-line no-console
  console.log(`faucet listening on :${port}`);
});

