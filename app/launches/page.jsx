"use client";

import LaunchFeed from "../LaunchFeed";
import { useAppNavigate } from "../useAppNavigate";

export default function LaunchesPage() {
  const navigate = useAppNavigate();
  return (
    <LaunchFeed
      network="robinhood"
      onAudit={(token) => navigate({ view: "audit", token, runAudit: true })}
      onTrade={(token) => navigate({ view: "trade", token })}
      nonce={0}
    />
  );
}
