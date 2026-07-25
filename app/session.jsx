"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

/**
 * One session for the whole site.
 *
 * Now that each section is its own route, fetching `/api/auth/me` inside every
 * page would mean a round trip on every navigation. The provider lives in the
 * root layout, which persists across route changes, so the session is read once
 * and shared.
 */

const SessionContext = createContext({
  user: null,
  setup: null,
  loading: true,
  error: null,
  signIn: () => {},
  logout: async () => {},
});

export function SessionProvider({ children }) {
  const [user, setUser] = useState(null);
  const [setup, setSetup] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        setUser(data.user || null);
        setSetup(data.setup || null);
        if (data.error) setError(data.error);
      })
      .catch(() => setError("Could not reach the server."))
      .finally(() => setLoading(false));
  }, []);

  const signIn = useCallback(() => {
    window.location.href = "/api/auth/x/login";
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
  }, []);

  return (
    <SessionContext.Provider value={{ user, setup, loading, error, signIn, logout }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
