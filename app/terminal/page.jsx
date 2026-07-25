"use client";

import Terminal from "../Terminal";
import { useSession } from "../session";
import { useAppNavigate } from "../useAppNavigate";

export default function TerminalPage() {
  const { user, signIn } = useSession();
  const navigate = useAppNavigate();
  return <Terminal network="robinhood" user={user} onNavigate={navigate} onSignIn={signIn} />;
}
