// Firestore writes for the Hub's account/billing plane (kept apart from directory.ts, which
// is the read/resolve path). The webhook calls applyReconciledState() after mapping a Stripe
// subscription with reconcileSubscription().
import type { Firestore } from "firebase-admin/firestore";
import type { ReconciledState } from "./stripeReconcile";

/**
 * Persist a reconciled subscription:
 *  - update the account's payment standing (subscriptionStatus + currentPeriodEnd), and
 *  - flip each of the account's domains' `mobileActive` to match the active set (so a domain
 *    whose line item was removed gets switched off, not just left stale).
 * Domain docs are keyed by the domain string, which is exactly what `activeDomains` holds.
 */
export async function applyReconciledState(
  db: Firestore,
  accountId: string,
  state: ReconciledState,
): Promise<void> {
  const now = Date.now();
  await db
    .collection("accounts")
    .doc(accountId)
    .set(
      {
        subscriptionStatus: state.subscriptionStatus,
        currentPeriodEnd: state.currentPeriodEnd,
        updatedAt: now,
      },
      { merge: true },
    );

  const owned = await db.collection("domains").where("accountId", "==", accountId).get();
  if (owned.empty) return;

  const active = new Set(state.activeDomains);
  const batch = db.batch();
  let changed = 0;
  owned.forEach((doc) => {
    const shouldBe = active.has(doc.id);
    if (doc.get("mobileActive") !== shouldBe) {
      batch.update(doc.ref, { mobileActive: shouldBe, updatedAt: now });
      changed++;
    }
  });
  if (changed > 0) await batch.commit();
}
