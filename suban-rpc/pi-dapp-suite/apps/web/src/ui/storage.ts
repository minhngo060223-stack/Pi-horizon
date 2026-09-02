/** Browser persistence for dev UX only — secrets in localStorage are not production-safe. */

export const PERSIST_KEY = "pi-dapp-suite-ui-v1";

export type PersistedV1 = {
  v: 1;
  secret?: string;
  adminToken?: string;
  tokenId?: string;
  poolId?: string;
  routerId?: string;
  subId?: string;
};

export function readStorage(): PersistedV1 {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return { v: 1 };
    const j = JSON.parse(raw) as PersistedV1;
    if (j?.v !== 1) return { v: 1 };
    return { ...j, v: 1 };
  } catch {
    return { v: 1 };
  }
}

export type PersistSnapshotInput = {
  secretKey: string | null;
  adminToken: string;
  tokenId: string;
  poolId: string;
  routerId: string;
  subId: string;
};

/** Replace persisted fields from current UI snapshot (omit secret when null). */
export function persistSnapshot(s: PersistSnapshotInput) {
  const next: PersistedV1 = {
    v: 1,
    adminToken: s.adminToken || undefined,
    tokenId: s.tokenId || undefined,
    poolId: s.poolId || undefined,
    routerId: s.routerId || undefined,
    subId: s.subId || undefined,
  };
  if (s.secretKey) next.secret = s.secretKey;
  localStorage.setItem(PERSIST_KEY, JSON.stringify(next));
}

export function clearPersistedSecret() {
  const cur = readStorage();
  delete cur.secret;
  localStorage.setItem(PERSIST_KEY, JSON.stringify(cur));
}

export function clearAllPersisted() {
  localStorage.removeItem(PERSIST_KEY);
}
