"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Menu from "./Menu";
import { useSession } from "./session";
import { AUTH_ERRORS, AuthProblem, DESTINATIONS, EXTERNAL_LINKS, TAPE, XLogo } from "./constants";

/**
 * The header, command tape and navigation, shared by every page.
 *
 * Each section is a real route now, so navigation is `<Link>`s and the active
 * tab is derived from the path — not from a `view` state variable. The tab strip
 * shows only on the app routes; the landing and legal pages keep the wordmark
 * and the menu but drop the tabs, so they read as their own thing.
 */

const APP_KEYS = new Set(DESTINATIONS.map((d) => d.key));

/** The sign-in failure notice. Reads the query with `window` so the header does
 *  not need a Suspense boundary the way `useSearchParams` would. */
function AuthNotice() {
  const { setup } = useSession();
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("auth_error");
    if (err) {
      setAuthError(AUTH_ERRORS[err] || `Sign-in failed (${err}).`);
      // Strip it so a refresh does not resurface the banner.
      const url = new URL(window.location.href);
      url.searchParams.delete("auth_error");
      url.searchParams.delete("missing");
      window.history.replaceState({}, "", url.pathname + url.search);
    }
  }, []);

  if (!authError) return null;
  return <AuthProblem message={authError} setup={setup} onDismiss={() => setAuthError(null)} />;
}

export default function SiteChrome() {
  const { user, loading, signIn, logout } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  // "/terminal" → "terminal"; "/" → "home".
  const activeKey = pathname === "/" ? "home" : pathname.split("/")[1];
  const onAppRoute = APP_KEYS.has(activeKey);
  const isLegal = activeKey === "privacy" || activeKey === "terms";

  return (
    <>
      {!isLegal && (
        <div className="tape" aria-hidden="true">
          <div className="tape-track">
            {[...TAPE, ...TAPE].map(([cmd, arg], i) => (
              <span className="tape-item" key={i}>
                <b>▸ {cmd}</b> {arg}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="shell chrome-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="CABLE home">
          <span className="brand-mark">
            <img className="brand-logo" src="/cable.png" alt="" />
            CABLE
          </span>
        </Link>

        <div className="topbar-right">
          {loading ? (
            <span className="topbar-wait" aria-label="Loading session">
              …
            </span>
          ) : user ? (
            <div className="user">
              {user.avatar && <img className="avatar" src={user.avatar} alt="" />}
              <Link className="user-handle" href="/profile">
                @{user.username}
              </Link>
              <button className="btn btn-ghost topbar-wide" onClick={logout}>
                Sign out
              </button>
            </div>
          ) : (
            <a className="btn btn-x topbar-wide" href="/api/auth/x/login">
              <XLogo /> Sign in with X
            </a>
          )}

          <Menu
            items={[
              ...DESTINATIONS.map(({ key, label, hint, href }) => ({
                key,
                label,
                hint,
                active: activeKey === key,
                onSelect: () => router.push(href),
              })),
              ...(user
                ? [{ key: "signout", label: "Sign out", hint: `@${user.username}`, onSelect: logout }]
                : []),
            ]}
            links={EXTERNAL_LINKS}
            account={
              user ? (
                <div className="menu-user">
                  {user.avatar && <img className="avatar" src={user.avatar} alt="" />}
                  <span>
                    <span className="menu-user-handle">@{user.username}</span>
                    <span className="menu-user-sub">signed in with X</span>
                  </span>
                </div>
              ) : (
                <a className="btn btn-x menu-signin" href="/api/auth/x/login">
                  <XLogo /> Sign in with X
                </a>
              )
            }
            footer="Not affiliated with Robinhood. Nothing here is financial advice."
          />
        </div>
      </header>

      {onAppRoute && (
        <nav className="nav">
          {DESTINATIONS.map(({ key, label, href }) => (
            <Link
              key={key}
              className={`nav-tab ${activeKey === key ? "nav-on" : ""}`}
              href={href}
              aria-current={activeKey === key ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
          <span className="nav-spacer" />
          {EXTERNAL_LINKS.map((link) => (
            <a
              key={link.href}
              className="nav-tab nav-ext"
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {link.label} <span aria-hidden="true">↗</span>
            </a>
          ))}
        </nav>
      )}

      <AuthNotice />
      </div>
    </>
  );
}
