"use client";

import { useMemo, useRef, useState } from "react";
import type { Contact } from "@/lib/contacts";

/**
 * A To-field that autocompletes against derived contacts. Recipients stay a
 * plain comma/space-separated string (the composer already parses that); this
 * only suggests completions for the token currently being typed.
 */
export function RecipientsInput({
  value,
  onChange,
  contacts,
  placeholder = "To",
}: {
  value: string;
  onChange: (v: string) => void;
  contacts: Contact[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // The token being typed = the trailing run of non-separator characters.
  const token = useMemo(() => /[^,;\s]*$/.exec(value)?.[0] ?? "", [value]);
  const prefix = value.slice(0, value.length - token.length);

  const chosen = useMemo(
    () =>
      new Set(
        value
          .split(/[,;\s]+/)
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      ),
    [value],
  );

  const matches = useMemo(() => {
    const q = token.trim().toLowerCase();
    if (q.length < 1) return [];
    return contacts
      .filter((c) => {
        const a = c.address.toLowerCase();
        if (chosen.has(a)) return false;
        return a.includes(q) || (c.name?.toLowerCase().includes(q) ?? false);
      })
      .slice(0, 6);
  }, [contacts, token, chosen]);

  const show = open && matches.length > 0;

  function choose(address: string) {
    onChange(`${prefix}${address}, `);
    setOpen(false);
    setActive(0);
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!show) {
      if (e.key === "ArrowDown" && matches.length > 0) {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      setActive((i) => Math.min(i + 1, matches.length - 1));
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      setActive((i) => Math.max(i - 1, 0));
      e.preventDefault();
    } else if (e.key === "Enter" || e.key === "Tab") {
      const pick = matches[active];
      if (pick) {
        choose(pick.address);
        e.preventDefault();
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative bg-transparent">
      <input
        ref={inputRef}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        // Delay so a click on a suggestion registers before blur closes the list.
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
        autoCapitalize="off"
        autoComplete="off"
        className="text-text placeholder:text-dim w-full bg-transparent px-4 py-2.5 text-sm outline-none"
      />
      {show && (
        <ul className="bg-surface-high border-hairline absolute top-full right-0 left-0 z-40 max-h-56 overflow-auto rounded-b-xl border shadow-lg">
          {matches.map((c, i) => (
            <li key={c.address}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(c.address)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full flex-col items-start px-4 py-2 text-left transition-colors ${
                  i === active ? "bg-primary/15" : "hover:bg-surface-variant"
                }`}
              >
                {c.name ? (
                  <>
                    <span className="text-text text-sm font-medium">{c.name}</span>
                    <span className="text-muted text-xs">{c.address}</span>
                  </>
                ) : (
                  <span className="text-text text-sm">{c.address}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
