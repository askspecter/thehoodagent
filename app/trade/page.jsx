"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import TradePanel from "../TradePanel";

function TradeInner() {
  const params = useSearchParams();
  return <TradePanel network="robinhood" token={params.get("token") || ""} />;
}

export default function TradePage() {
  return (
    <Suspense fallback={null}>
      <TradeInner />
    </Suspense>
  );
}
