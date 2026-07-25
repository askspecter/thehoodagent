"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

/**
 * Turns a view intent into a route change.
 *
 * The terminal, the launch feed and the profile all say "take me to X with this
 * token". When everything was one page that meant flipping a `view` variable;
 * now it is a real navigation, and the token or prefill rides along in the query
 * so the destination route can pick it up.
 */
export function useAppNavigate() {
  const router = useRouter();

  return useCallback(
    (intent) => {
      if (!intent?.view) return;

      if (intent.view === "audit" && intent.token) {
        const run = intent.runAudit ? "&run=1" : "";
        router.push(`/audit?token=${encodeURIComponent(intent.token)}${run}`);
        return;
      }
      if (intent.view === "trade" && intent.token) {
        router.push(`/trade?token=${encodeURIComponent(intent.token)}`);
        return;
      }
      if (intent.view === "create" && intent.prefill) {
        const q = new URLSearchParams();
        if (intent.prefill.symbol) q.set("symbol", intent.prefill.symbol);
        if (intent.prefill.name) q.set("name", intent.prefill.name);
        router.push(`/create${q.toString() ? `?${q}` : ""}`);
        return;
      }
      router.push(`/${intent.view}`);
    },
    [router]
  );
}
