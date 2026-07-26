"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import TradePanel from "../TradePanel";
import { useSession } from "../session";

function TradeInner() {
  const params = useSearchParams();
  const { user, signIn } = useSession();
  return (
    <TradePanel
      network="robinhood"
      token={params.get("token") || ""}
      user={user}
      onSignIn={signIn}
    />
  );
}

export default function TradePage() {
  return (
    <Suspense fallback={null}>
      <TradeInner />
    </Suspense>
  );
}
