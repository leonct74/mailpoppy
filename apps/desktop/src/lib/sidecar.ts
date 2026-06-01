// Thin client for the local provisioning sidecar (desktop-admin-only).
const SIDECAR = "http://127.0.0.1:8787";

export async function sidecar<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SIDECAR}${path}`, init);
  if (!res.ok) throw new Error(`sidecar ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}
