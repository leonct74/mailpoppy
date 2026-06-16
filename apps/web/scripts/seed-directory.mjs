#!/usr/bin/env node
// Seed/upsert a domain → deployment mapping in the Hub directory (Firestore).
//
// Prereqs: Firestore enabled in the Firebase project, and credentials available:
//   - locally:  GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
//   - or run where Application Default Credentials exist.
//
// Usage:
//   node scripts/seed-directory.mjs <domain> <region> <userPoolId> <clientId> <apiBaseUrl> [accountId]
//
// Example (the current launch deployment):
//   node scripts/seed-directory.mjs yourdomain.com eu-west-1 eu-west-1_yV09AF6Ja \
//     361bkf3ja4ukgmqtgf17mbc37 https://017dtrbes1.execute-api.eu-west-1.amazonaws.com
import { getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const [, , domain, region, userPoolId, clientId, apiBaseUrl, accountId] = process.argv;
if (!domain || !region || !userPoolId || !clientId || !apiBaseUrl) {
  console.error(
    "usage: node scripts/seed-directory.mjs <domain> <region> <userPoolId> <clientId> <apiBaseUrl> [accountId]",
  );
  process.exit(1);
}

const app = getApps()[0] ?? initializeApp({ credential: applicationDefault() });
const db = getFirestore(app);
const key = domain.trim().toLowerCase();

await db
  .collection("domains")
  .doc(key)
  .set(
    {
      domain: key,
      accountId: accountId ?? null,
      deployment: { region, userPoolId, clientId, apiBaseUrl },
      verified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    { merge: true },
  );

console.log(`✓ seeded domains/${key} → ${apiBaseUrl}`);
process.exit(0);
