"use client";

import Profile from "../Profile";
import { useSession } from "../session";
import { useAppNavigate } from "../useAppNavigate";

export default function ProfilePage() {
  const { user, signIn } = useSession();
  const navigate = useAppNavigate();
  return <Profile network="robinhood" user={user} onSignIn={signIn} onNavigate={navigate} />;
}
