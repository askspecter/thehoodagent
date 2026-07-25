"use client";

import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import LaunchForm from "../LaunchForm";

function CreateInner() {
  const params = useSearchParams();
  const router = useRouter();
  const prefill = {
    symbol: params.get("symbol") || null,
    name: params.get("name") || null,
  };

  return (
    <LaunchForm
      network="robinhood"
      prefill={prefill.symbol || prefill.name ? prefill : null}
      onLaunched={() => router.push("/launches")}
    />
  );
}

export default function CreatePage() {
  // useSearchParams needs a Suspense boundary to prerender cleanly.
  return (
    <Suspense fallback={null}>
      <CreateInner />
    </Suspense>
  );
}
