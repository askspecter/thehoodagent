"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The ⋮ overflow menu.
 *
 * The tab strip only has room for the four things people do most; everything
 * else lives here. It is a real menu, not a styled dropdown: Escape closes it,
 * a click outside closes it, focus returns to the button afterwards, and the
 * items are ordinary buttons so a screen reader announces them as such.
 */
export default function Menu({ items, links = [], footer = null }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const firstItemRef = useRef(null);

  const close = useCallback(
    ({ refocus = false } = {}) => {
      setOpen(false);
      if (refocus) buttonRef.current?.focus();
    },
    []
  );

  useEffect(() => {
    if (!open) return undefined;

    const onPointer = (event) => {
      if (!wrapRef.current?.contains(event.target)) close();
    };
    const onKey = (event) => {
      if (event.key === "Escape") close({ refocus: true });
    };

    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    firstItemRef.current?.focus();

    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <div className="menu-wrap" ref={wrapRef}>
      <button
        ref={buttonRef}
        className={`menu-btn ${open ? "nav-on" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More"
        title="More"
      >
        ⋮
      </button>

      {open && (
        <div className="menu-pop" role="menu">
          {items.map((item, index) => (
            <button
              key={item.key}
              ref={index === 0 ? firstItemRef : null}
              className={`menu-item ${item.active ? "menu-item-on" : ""}`}
              role="menuitem"
              onClick={() => {
                close();
                item.onSelect();
              }}
            >
              <span className="menu-item-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="menu-item-body">
                <span className="menu-item-label">{item.label}</span>
                {item.hint && <span className="menu-item-hint">{item.hint}</span>}
              </span>
              {item.active && (
                <span className="menu-item-dot" aria-hidden="true">
                  ●
                </span>
              )}
            </button>
          ))}

          {links.length > 0 && (
            <>
              <div className="menu-sep" role="separator" />
              {links.map((link) => (
                <a
                  key={link.href}
                  className="menu-item"
                  role="menuitem"
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => close()}
                >
                  <span className="menu-item-icon" aria-hidden="true">
                    {link.icon}
                  </span>
                  <span className="menu-item-body">
                    <span className="menu-item-label">{link.label} ↗</span>
                    {link.hint && <span className="menu-item-hint">{link.hint}</span>}
                  </span>
                </a>
              ))}
            </>
          )}

          {footer && <div className="menu-foot">{footer}</div>}
        </div>
      )}
    </div>
  );
}
