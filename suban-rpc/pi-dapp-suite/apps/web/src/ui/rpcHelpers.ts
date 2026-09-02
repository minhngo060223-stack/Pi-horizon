import * as StellarSdk from "stellar-sdk";

export function json<T>(v: T) {
  return JSON.stringify(v, null, 2);
}

export function describeError(e: unknown) {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return json(e);
  } catch {
    return String(e);
  }
}

export async function pollTx(rpc: StellarSdk.SorobanRpc.Server, hash: string, timeoutMs = 60_000) {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const tx = await rpc.getTransaction(hash);
    if (tx.status !== "NOT_FOUND") return tx;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for tx ${hash}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

/** Classic inclusion fee from soroban-rpc getFeeStats (stroops string). */
export async function resolveClassicMaxFee(rpc: StellarSdk.SorobanRpc.Server): Promise<string> {
  const floor = 100;
  const fallback = 100_000;
  try {
    const stats = await rpc.getFeeStats();
    const dist = (stats as unknown as { inclusionFee?: Record<string, string | number> }).inclusionFee;
    if (!dist || typeof dist !== "object") return String(fallback);
    const nums = [dist.max, dist.p99, dist.p95, dist.mode, dist.p90, dist.min]
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n) && n > 0);
    const base = nums.length ? Math.max(...nums) : fallback;
    const withMargin = Math.ceil(base * 1.25);
    return String(Math.max(floor, withMargin));
  } catch {
    return String(fallback);
  }
}

export async function submitSoroban(
  rpc: StellarSdk.SorobanRpc.Server,
  passphrase: string,
  signer: StellarSdk.Keypair,
  op: StellarSdk.xdr.Operation
) {
  const account = await rpc.getAccount(signer.publicKey());
  const fee = await resolveClassicMaxFee(rpc);
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee,
    networkPassphrase: passphrase,
  })
    .addOperation(op)
    .setTimeout(60)
    .build();

  const sim = await rpc.simulateTransaction(tx);

  if ("error" in sim && sim.error) {
    throw new Error(`simulateTransaction failed: ${json(sim.error)}`);
  }

  const assembled = StellarSdk.SorobanRpc.assembleTransaction(tx, sim).build();
  assembled.sign(signer);
  const sent = await rpc.sendTransaction(assembled);

  if (sent.status === "ERROR") {
    throw new Error(
      `sendTransaction ERROR: ${json({
        status: sent.status,
        errorResult: (sent as unknown as { errorResult?: unknown }).errorResult,
        diagnosticEvents: (sent as unknown as { diagnosticEvents?: unknown }).diagnosticEvents,
      })}`
    );
  }

  const hash = sent.hash;
  const final = await pollTx(rpc, hash);
  return { sent, final };
}

export async function getNativeBalance(rpc: StellarSdk.SorobanRpc.Server, publicKey: string) {
  const xdrAny = StellarSdk.xdr as unknown as {
    LedgerKey: { account: (value: unknown) => StellarSdk.xdr.LedgerKey };
    LedgerKeyAccount: new (value: unknown) => unknown;
    AccountId: { publicKeyTypeEd25519: (value: Uint8Array) => unknown };
  };
  const strKey = (StellarSdk as unknown as { StrKey: { decodeEd25519PublicKey: (key: string) => Uint8Array } }).StrKey;
  const key = xdrAny.LedgerKey.account(
    new xdrAny.LedgerKeyAccount({
      accountId: xdrAny.AccountId.publicKeyTypeEd25519(strKey.decodeEd25519PublicKey(publicKey)),
    })
  );

  const response = await rpc.getLedgerEntries(key);
  const entry = response.entries?.[0];
  if (!entry) return { exists: false, balance: null, stroops: null, latestLedger: response.latestLedger };

  const accountEntry = entry.val.account();
  const stroops = BigInt(accountEntry.balance().toString());
  const balance = (Number(stroops) / 10_000_000).toFixed(7).replace(/\.?0+$/, "");
  return { exists: true, balance, stroops: stroops.toString(), latestLedger: response.latestLedger };
}

/** Parse JSON fetch body and surface server hint fields. */
export async function readJsonResponse<T>(r: Response): Promise<T> {
  const j = (await r.json()) as T & { ok?: boolean; error?: unknown; hint?: string };
  return j;
}

export function formatHttpError(j: { error?: unknown; hint?: string }, fallback: string) {
  const parts = [
    typeof j.error === "string" ? j.error : j.error != null ? json(j.error) : "",
    j.hint ?? "",
  ].filter(Boolean);
  return parts.join(" — ") || fallback;
}
