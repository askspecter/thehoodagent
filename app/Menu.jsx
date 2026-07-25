"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The mobile navigation sheet.
 *
 * This exists ONLY below the nav breakpoint. On a wide screen the tab strip is
 * the navigation and this button is not rendered at all — two controls listing
 * the same destinations side by side is not a menu, it is a duplicate, and it
 * was the reason the header looked cluttered.
 *
 * A right-hand sheet rather than a small dropdown: a dropdown pinned to a corner
 * gives cramped tap targets and covers the content at random, while a sheet has
 * room for a label under every destination and a clear way out.
 */

function BurgerIcon({ open }) {
  // Drawn, not typed. The ☰ glyph renders at a different weight and baseline in
  // every fallback font, and it cannot animate into a close icon.
  return (
    <svg
      className={`burger ${open ? "burger-open" : ""}`}
      width="20"
      height="20"
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
    >
      <line x1="2" y1="5" x2="18" y2="5" />
      <line x1="2" y1="10" x2="18" y2="10" />
      <line x1="2" y1="15" x2="18" y2="15" />
    </svg>
  );
}

export default function Menu({ items, links = [], account = null, footer = null }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const sheetRef = useRef(null);
  const firstItemRef = useRef(null);

  const close = useCallback(({ refocus = false } = {}) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    const onKey = (event) => {
      if (event.key === "Escape") close({ refocus: true });
    };

    // The page behind a sheet must not scroll — otherwise a flick meant for the
    // menu scrolls the content underneath it.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    firstItemRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <>
      <button
        ref={buttonRef}
        className="menu-btn"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={open ? "Close menu" : "Open menu"}
      >
        <BurgerIcon open={open} />
      </button>

      {open && (
        <div className="menu-scrim" onClick={() => close()}>
          <div
            className="menu-sheet"
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="menu-sheet-head">
              <span className="menu-sheet-title">Menu</span>
              <button className="menu-close" onClick={() => close({ refocus: true })} aria-label="Close menu">
                ✕
              </button>
            </div>

            {account && <div className="menu-account">{account}</div>}

            <nav className="menu-list">
              {items.map((item, index) => (
                <button
                  key={item.key}
                  ref={index === 0 ? firstItemRef : null}
                  className={`menu-item ${item.active ? "menu-item-on" : ""}`}
                  aria-current={item.active ? "page" : undefined}
                  onClick={() => {
                    close();
                    item.onSelect();
                  }}
                >
                  <span className="menu-item-body">
                    <span className="menu-item-label">{item.label}</span>
                    {item.hint && <span className="menu-item-hint">{item.hint}</span>}
                  </span>
                </button>
              ))}
            </nav>

            {links.length > 0 && (
              <div className="menu-links">
                {links.map((link) => (
                  <a
                    key={link.href}
                    className="menu-link"
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => close()}
                  >
                    {link.label} <span aria-hidden="true">↗</span>
                  </a>
                ))}
              </div>
            )}

            {footer && <p className="menu-foot">{footer}</p>}
          </div>
        </div>
      )}
    </>
  );
}
