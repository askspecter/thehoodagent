"use client";

import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import LaunchForm from "../LaunchForm";
import { useSession } from "../session";

function CreateInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { user, signIn } = useSession();
  const prefill = {
    symbol: params.get("symbol") || null,
    name: params.get("name") || null,
  };

  return (
    <LaunchForm
      network="robinhood"
      user={user}
      onSignIn={signIn}
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
