import React, { useCallback, useEffect, useMemo, useState } from "react";
import * as StellarSdk from "stellar-sdk";
import { clearAllPersisted, clearPersistedSecret, persistSnapshot, readStorage } from "./storage";
import {
  describeError,
  formatHttpError,
  getNativeBalance,
  json,
  readJsonResponse,
  resolveClassicMaxFee,
  submitSoroban,
} from "./rpcHelpers";

const rpcUrl = import.meta.env.VITE_PI_RPC_URL ?? "http://localhost:8000";
const networkPassphrase = import.meta.env.VITE_NETWORK_PASSPHRASE ?? "Pi Testnet";
const faucetUrl = import.meta.env.VITE_FAUCET_URL ?? "http://localhost:4000";

/** stellar-base types contract args as ScVal; SDK accepts Address/primitives at runtime */
function asContractArg(v: unknown): StellarSdk.xdr.ScVal {
  return v as StellarSdk.xdr.ScVal;
}

type AsyncCtx = {
  run: (label: string, fn: () => Promise<unknown>) => Promise<void>;
  loadingLabel: string | null;
  lastError: string | null;
};

function SecurityBanner() {
  return (
    <div
      style={{
        background: "#3d2914",
        color: "#fdb",
        padding: "10px 12px",
        borderRadius: 8,
        marginBottom: 16,
        fontSize: 13,
        lineHeight: 1.45,
      }}
    >
      <strong>Dev-only:</strong> This UI stores your wallet <strong>secret key</strong> in{" "}
      <code>localStorage</code> when you create or import a wallet. Anyone with access to this browser profile or XSS
      can steal funds. Do not use with real assets or production deployments.
    </div>
  );
}

function NetworkStatusPanel({
  rpc,
  ctx,
  networkPassphrase: passphrase,
}: {
  rpc: StellarSdk.SorobanRpc.Server;
  ctx: AsyncCtx;
  networkPassphrase: string;
}) {
  const [classicFeePreview, setClassicFeePreview] = useState<string>("—");

  useEffect(() => {
    let cancelled = false;
    resolveClassicMaxFee(rpc)
      .then((f) => {
        if (!cancelled) setClassicFeePreview(f);
      })
      .catch(() => {
        if (!cancelled) setClassicFeePreview("(unavailable)");
      });
    return () => {
      cancelled = true;
    };
  }, [rpc]);

  return (
    <section style={{ border: "1px solid #ddd", padding: 12, borderRadius: 8 }}>
      <h3 style={{ marginTop: 0 }}>Network</h3>
      <p style={{ margin: "4px 0", fontSize: 13 }}>
        RPC: <code>{rpcUrl}</code>
        <br />
        Passphrase: <code>{passphrase}</code>
        <br />
        Faucet API: <code>{faucetUrl}</code>
        <br />
        Estimated classic fee (preview): <code>{classicFeePreview}</code> stroops
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button disabled={!!ctx.loadingLabel} onClick={() => ctx.run("getHealth", () => rpc.getHealth())}>
          getHealth
        </button>
        <button disabled={!!ctx.loadingLabel} onClick={() => ctx.run("getNetwork", () => rpc.getNetwork())}>
          getNetwork
        </button>
        <button
          disabled={!!ctx.loadingLabel}
          onClick={() => ctx.run("getLatestLedger", () => rpc.getLatestLedger())}
        >
          getLatestLedger
        </button>
        <button disabled={!!ctx.loadingLabel} onClick={() => ctx.run("getFeeStats", () => rpc.getFeeStats())}>
          getFeeStats
        </button>
      </div>
      {ctx.lastError && (
        <div style={{ color: "#c00", marginTop: 8, fontSize: 13 }}>Last error: {ctx.lastError}</div>
      )}
    </section>
  );
}

function WalletPanel({
  kp,
  setKp,
  rpc,
  ctx,
}: {
  kp: StellarSdk.Keypair | null;
  setKp: (k: StellarSdk.Keypair | null) => void;
  rpc: StellarSdk.SorobanRpc.Server;
  ctx: AsyncCtx;
}) {
  const [importSecret, setImportSecret] = useState("");
  const [fundAmount, setFundAmount] = useState("2");
  const [balance, setBalance] = useState<{ exists: boolean; balance: string | null; stroops: string | null } | null>(
    null
  );

  const refreshBalance = useCallback(async () => {
    if (!kp) {
      setBalance(null);
      return null;
    }
    const next = await getNativeBalance(rpc, kp.publicKey());
    setBalance(next);
    return next;
  }, [kp, rpc]);

  useEffect(() => {
    refreshBalance().catch(() => setBalance({ exists: false, balance: null, stroops: null }));
  }, [refreshBalance]);

  return (
    <section style={{ border: "1px solid #ddd", padding: 12, borderRadius: 8 }}>
      <h3 style={{ marginTop: 0 }}>Wallet</h3>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <button
          disabled={!!ctx.loadingLabel}
          onClick={() => setKp(StellarSdk.Keypair.random())}
          type="button"
        >
          Create wallet
        </button>
        <button
          disabled={!!ctx.loadingLabel || !kp}
          type="button"
          onClick={() => {
            clearPersistedSecret();
            setKp(null);
          }}
        >
          Forget wallet (clear secret)
        </button>
        <button
          disabled={!!ctx.loadingLabel}
          type="button"
          onClick={() => {
            clearAllPersisted();
            setKp(null);
            window.location.reload();
          }}
        >
          Reset all stored UI data
        </button>
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, opacity: 0.8 }}>Import from secret key</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
          <input
            type="password"
            autoComplete="off"
            value={importSecret}
            onChange={(e) => setImportSecret(e.target.value)}
            placeholder="SXXXXXXXX..."
            style={{ flex: "1 1 240px", minWidth: 200 }}
          />
          <button
            type="button"
            disabled={!!ctx.loadingLabel || !importSecret.trim()}
            onClick={() => {
              try {
                setKp(StellarSdk.Keypair.fromSecret(importSecret.trim()));
                setImportSecret("");
              } catch {
                ctx.run("_invalid_secret", async () => {
                  throw new Error("Invalid secret key");
                });
              }
            }}
          >
            Import
          </button>
        </div>
      </div>

      {kp && (
        <div style={{ marginTop: 12, fontSize: 13 }}>
          <div>
            Public: <code>{kp.publicKey()}</code>
          </div>
          <div style={{ marginTop: 6 }}>
            Secret: <code>{kp.secret()}</code>
          </div>
          <div style={{ marginTop: 8 }}>
            Status:{" "}
            <code>
              {balance ? (balance.exists ? `active, balance ${balance.balance} native` : "not active / not funded") : "checking"}
            </code>
          </div>
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, opacity: 0.8 }}>Funding amount</div>
            <input
              value={fundAmount}
              onChange={(e) => setFundAmount(e.target.value)}
              placeholder="2"
              inputMode="decimal"
              style={{ width: 120 }}
            />
          </div>
          <button
            style={{ marginTop: 8 }}
            type="button"
            disabled={!!ctx.loadingLabel}
            onClick={() =>
              ctx.run("faucet/fund", async () => {
                const r = await fetch(`${faucetUrl}/faucet/fund`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ destination: kp.publicKey(), startingBalance: fundAmount }),
                });
                const j = await readJsonResponse<{
                  ok?: boolean;
                  send?: unknown;
                  mode?: string;
                  hint?: string;
                  error?: unknown;
                }>(r);
                if (!r.ok || j.ok === false) {
                  throw new Error(`${formatHttpError(j, "faucet error")}\n\n${json(j)}`);
                }
                await refreshBalance();
                return j;
              })
            }
          >
            Activate / fund wallet
          </button>
          <button
            style={{ marginTop: 8, marginLeft: 8 }}
            type="button"
            disabled={!!ctx.loadingLabel}
            onClick={() => ctx.run("wallet.balance", refreshBalance)}
          >
            Refresh balance
          </button>
        </div>
      )}
    </section>
  );
}

function AppInner() {
  const rpc = useMemo(
    () =>
      new StellarSdk.SorobanRpc.Server(rpcUrl, {
        allowHttp: rpcUrl.startsWith("http://"),
      }),
    []
  );

  const saved = useMemo(() => readStorage(), []);

  const [kp, setKp] = useState<StellarSdk.Keypair | null>(() => {
    try {
      return saved.secret ? StellarSdk.Keypair.fromSecret(saved.secret) : null;
    } catch {
      return null;
    }
  });

  const [out, setOut] = useState<string>("ready");
  const [loadingLabel, setLoadingLabel] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const [adminToken, setAdminToken] = useState<string>(
    () => saved.adminToken ?? (import.meta.env.VITE_ADMIN_TOKEN as string | undefined) ?? ""
  );
  const [contracts, setContracts] = useState<Record<string, unknown>>({});
  const [tokenId, setTokenId] = useState<string>(() => saved.tokenId ?? "");
  const [poolId, setPoolId] = useState<string>(() => saved.poolId ?? "");
  const [routerId, setRouterId] = useState<string>(() => saved.routerId ?? "");
  const [subId, setSubId] = useState<string>(() => saved.subId ?? "");

  const run = useCallback(async (label: string, fn: () => Promise<unknown>) => {
    setLoadingLabel(label);
    setLastError(null);
    try {
      const r = await fn();
      setOut(json(r));
    } catch (e: unknown) {
      const msg = describeError(e);
      setLastError(msg);
      setOut(msg);
    } finally {
      setLoadingLabel(null);
    }
  }, []);

  const ctx: AsyncCtx = useMemo(() => ({ run, loadingLabel, lastError }), [run, loadingLabel, lastError]);

  useEffect(() => {
    persistSnapshot({
      secretKey: kp?.secret() ?? null,
      adminToken,
      tokenId,
      poolId,
      routerId,
      subId,
    });
  }, [kp, adminToken, tokenId, poolId, routerId, subId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${faucetUrl}/contracts/state`);
        const j = await readJsonResponse<{ ok?: boolean; state?: Record<string, unknown> }>(r);
        if (cancelled || !r.ok || !j.state) return;
        const st = j.state;
        setContracts((prev) => ({ ...prev, ...st }));
        const rec = st as Record<string, string>;
        if (rec.token) setTokenId(rec.token);
        if (rec.dex_pool) setPoolId(rec.dex_pool);
        if (rec.dex_router) setRouterId(rec.dex_router);
        if (rec.subscription) setSubId(rec.subscription);
      } catch {
        /* faucet may be down on first paint */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyBackendState = useCallback(
    (st: Record<string, unknown> | undefined | null) => {
      if (!st || typeof st !== "object") return;
      setContracts((prev) => ({ ...prev, ...st }));
      const s = st as Record<string, string>;
      if (s.token) setTokenId(s.token);
      if (s.dex_pool) setPoolId(s.dex_pool);
      if (s.dex_router) setRouterId(s.dex_router);
      if (s.subscription) setSubId(s.subscription);
    },
    [setContracts, setPoolId, setRouterId, setSubId, setTokenId]
  );

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 16, maxWidth: 980, margin: "0 auto" }}>
      <h2 style={{ marginBottom: 8 }}>Pi Dapp Suite</h2>
      {loadingLabel && (
        <div style={{ fontSize: 13, marginBottom: 8, color: "#06c" }}>
          Running: <code>{loadingLabel}</code>…
        </div>
      )}

      <SecurityBanner />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <WalletPanel kp={kp} setKp={setKp} rpc={rpc} ctx={ctx} />
        <NetworkStatusPanel rpc={rpc} ctx={ctx} networkPassphrase={networkPassphrase} />
      </div>

      <ContractsPanel
        adminToken={adminToken}
        setAdminToken={setAdminToken}
        contracts={contracts}
        tokenId={tokenId}
        setTokenId={setTokenId}
        poolId={poolId}
        setPoolId={setPoolId}
        routerId={routerId}
        setRouterId={setRouterId}
        subId={subId}
        setSubId={setSubId}
        ctx={ctx}
        kp={kp}
        rpc={rpc}
        applyBackendState={applyBackendState}
      />

      <section style={{ marginTop: 16 }}>
        <h3>Output</h3>
        <pre style={{ background: "#111", color: "#eee", padding: 12, borderRadius: 8, overflowX: "auto" }}>
          {out}
        </pre>
      </section>
    </div>
  );
}

/** Contracts + Soroban actions */
function ContractsPanel({
  adminToken,
  setAdminToken,
  contracts,
  tokenId,
  setTokenId,
  poolId,
  setPoolId,
  routerId,
  setRouterId,
  subId,
  setSubId,
  ctx,
  kp,
  rpc,
  applyBackendState,
}: {
  adminToken: string;
  setAdminToken: (s: string) => void;
  contracts: Record<string, unknown>;
  tokenId: string;
  setTokenId: (s: string) => void;
  poolId: string;
  setPoolId: (s: string) => void;
  routerId: string;
  setRouterId: (s: string) => void;
  subId: string;
  setSubId: (s: string) => void;
  ctx: AsyncCtx;
  kp: StellarSdk.Keypair | null;
  rpc: StellarSdk.SorobanRpc.Server;
  applyBackendState: (st: Record<string, unknown> | undefined | null) => void;
}) {
  return (
    <section style={{ marginTop: 16, border: "1px solid #ddd", padding: 12, borderRadius: 8 }}>
      <h3 style={{ marginTop: 0 }}>Contracts (Soroban)</h3>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            Admin token (shared secret for dev — enables deploy). Stored locally for convenience.
          </div>
          <input
            value={adminToken}
            onChange={(e) => setAdminToken(e.target.value)}
            placeholder="ADMIN_TOKEN or set VITE_ADMIN_TOKEN"
            style={{ width: "100%", marginTop: 4 }}
            autoComplete="off"
          />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
          <button
            type="button"
            disabled={!!ctx.loadingLabel}
            onClick={() =>
              ctx.run("contracts/state", async () => {
                const r = await fetch(`${faucetUrl}/contracts/state`);
                const j = await readJsonResponse<{ state?: Record<string, unknown> }>(r);
                if (!r.ok) throw new Error(formatHttpError(j as { error?: unknown; hint?: string }, "load failed"));
                applyBackendState(j.state);
                return j;
              })
            }
          >
            Load contract IDs
          </button>
          <button
            type="button"
            disabled={!!ctx.loadingLabel || !adminToken}
            title={!adminToken ? "Set admin token to match faucet ADMIN_TOKEN" : undefined}
            onClick={() =>
              ctx.run("deploy-all", async () => {
                const r = await fetch(`${faucetUrl}/admin/contracts/deploy-all`, {
                  method: "POST",
                  headers: { "x-admin-token": adminToken },
                });
                const j = await readJsonResponse<{
                  ok?: boolean;
                  ids?: Record<string, unknown>;
                  error?: unknown;
                  hint?: string;
                }>(r);
                if (!r.ok || j.ok === false) {
                  const msg = formatHttpError(j as { error?: unknown; hint?: string }, "deploy failed");
                  if (r.status === 401) throw new Error(`${msg} (check ADMIN_TOKEN on faucet and header x-admin-token)`);
                  throw new Error(msg);
                }
                applyBackendState(j.ids ?? {});
                return j;
              })
            }
          >
            Deploy all (backend)
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <label>
          <div style={{ fontSize: 12, opacity: 0.8 }}>Token contract ID</div>
          <input value={tokenId} onChange={(e) => setTokenId(e.target.value)} style={{ width: "100%" }} />
        </label>
        <label>
          <div style={{ fontSize: 12, opacity: 0.8 }}>DEX pool contract ID</div>
          <input value={poolId} onChange={(e) => setPoolId(e.target.value)} style={{ width: "100%" }} />
        </label>
        <label>
          <div style={{ fontSize: 12, opacity: 0.8 }}>DEX router contract ID</div>
          <input value={routerId} onChange={(e) => setRouterId(e.target.value)} style={{ width: "100%" }} />
        </label>
        <label>
          <div style={{ fontSize: 12, opacity: 0.8 }}>Subscription contract ID</div>
          <input value={subId} onChange={(e) => setSubId(e.target.value)} style={{ width: "100%" }} />
        </label>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        <button
          type="button"
          disabled={!!ctx.loadingLabel || !kp || !tokenId}
          onClick={() =>
            ctx.run("token.balance", async () => {
              const c = new StellarSdk.Contract(tokenId);
              const op = c.call(
                "balance",
                asContractArg(StellarSdk.Address.fromString(kp!.publicKey()))
              );
              return submitSoroban(rpc, networkPassphrase, kp!, op);
            })}
        >
          Token.balance(me)
        </button>

        <button
          type="button"
          disabled={!!ctx.loadingLabel || !kp || !subId}
          onClick={() =>
            ctx.run("subscribe", async () => {
              const latest = await rpc.getLatestLedger();
              const current = Number(latest.sequence);
              const c = new StellarSdk.Contract(subId);
              const op = c.call(
                "subscribe",
                asContractArg(StellarSdk.Address.fromString(kp!.publicKey())),
                asContractArg(1),
                asContractArg(current)
              );
              return submitSoroban(rpc, networkPassphrase, kp!, op);
            })}
        >
          Subscribe(plan=1)
        </button>

        <button
          type="button"
          disabled={!!ctx.loadingLabel || !kp || !subId}
          onClick={() =>
            ctx.run("is_active", async () => {
              const latest = await rpc.getLatestLedger();
              const current = Number(latest.sequence);
              const c = new StellarSdk.Contract(subId);
              const op = c.call(
                "is_active",
                asContractArg(StellarSdk.Address.fromString(kp!.publicKey())),
                asContractArg(1),
                asContractArg(current)
              );
              return submitSoroban(rpc, networkPassphrase, kp!, op);
            })}
        >
          Subscription.is_active(plan=1)
        </button>

        <button
          type="button"
          disabled={!!ctx.loadingLabel || !kp || !poolId}
          onClick={() =>
            ctx.run("pool.add_liquidity", async () => {
              const c = new StellarSdk.Contract(poolId);
              const op = c.call(
                "add_liquidity",
                asContractArg(StellarSdk.Address.fromString(kp!.publicKey())),
                asContractArg(1000),
                asContractArg(1000)
              );
              return submitSoroban(rpc, networkPassphrase, kp!, op);
            })}
        >
          Pool.add_liquidity(1000,1000)
        </button>

        <button
          type="button"
          disabled={!!ctx.loadingLabel || !kp || !routerId || !tokenId}
          onClick={() =>
            ctx.run("router.quote", async () => {
              const c = new StellarSdk.Contract(routerId);
              const op = c.call(
                "quote_exact_in",
                asContractArg(tokenId),
                asContractArg(tokenId),
                asContractArg(1000)
              );
              return submitSoroban(rpc, networkPassphrase, kp!, op);
            })}
        >
          Router.quote_exact_in(1000)
        </button>
      </div>

      <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
        Loaded keys in contract state object: <code>{Object.keys(contracts).length}</code>
      </div>
    </section>
  );
}

export function App() {
  return <AppInner />;
}
