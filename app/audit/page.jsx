"use client";

import { Suspense } from "react";
import AuditView from "../AuditView";

export default function AuditPage() {
  // AuditView reads a token from the query, which needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <AuditView />
    </Suspense>
  );
}
