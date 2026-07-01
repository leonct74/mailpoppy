"use client";

// The paid tier's amount, read live from the Hub's /api/price (which reads the
// configured Stripe price). Shows the real number the moment Stripe is wired up,
// and a calm "Coming soon" until then — so the marketing page never hard-codes or
// drifts from the actual price.
import { useEffect, useState } from "react";

type Price = { amount: number | null; currency: string; interval: string | null };

export function PricingAmount() {
  const [price, setPrice] = useState<Price | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/price")
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        if (!alive) return;
        setPrice(p);
        setLoaded(true);
      })
      .catch(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  // Not configured yet (503) or still loading → the honest placeholder.
  if (!loaded || !price || price.amount == null) {
    return <span className="text-heading text-3xl font-bold">Coming soon</span>;
  }

  const amount = (price.amount / 100).toLocaleString(undefined, {
    style: "currency",
    currency: (price.currency || "usd").toUpperCase(),
    minimumFractionDigits: price.amount % 100 === 0 ? 0 : 2,
  });
  const per = price.interval === "year" ? "/year" : price.interval === "month" ? "/month" : "";

  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-heading text-4xl font-bold">{amount}</span>
      {per && <span className="text-muted text-sm font-medium">{per}</span>}
    </span>
  );
}
