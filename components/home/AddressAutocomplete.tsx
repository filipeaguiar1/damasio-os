"use client";

import { useEffect, useId, useRef, useState } from "react";

type Suggestion = { id: string; label: string; latitude: number; longitude: number };
type Props = { value: string; onChange: (value: string) => void; placeholder?: string; ariaLabel?: string };

export function AddressAutocomplete({ value, onChange, placeholder = "Start typing your address...", ariaLabel = "Address" }: Props) {
  const listId = useId();
  const requestId = useRef(0);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const query = value.trim();
    if (query.length < 3 || !open) { setSuggestions([]); setLoading(false); return; }
    const current = ++requestId.current;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/map/suggest?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        const data = await response.json() as { suggestions?: Suggestion[] };
        if (current === requestId.current) setSuggestions(response.ok && Array.isArray(data.suggestions) ? data.suggestions : []);
      } catch { if (current === requestId.current) setSuggestions([]); }
      finally { if (current === requestId.current) setLoading(false); }
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [value, open]);

  function select(suggestion: Suggestion) {
    onChange(suggestion.label);
    setSuggestions([]);
    setOpen(false);
  }

  return <div className="address-autocomplete">
    <input className="input" value={value} onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 150)} onChange={event => { onChange(event.target.value); setOpen(true); }} placeholder={placeholder} aria-label={ariaLabel} aria-autocomplete="list" aria-controls={listId} autoComplete="street-address" />
    {open && value.trim().length >= 3 && <div className="address-suggestions" id={listId} role="listbox">
      {loading && <div className="address-suggestion-status">Searching addresses...</div>}
      {!loading && suggestions.map(suggestion => <button type="button" role="option" key={`${suggestion.id}-${suggestion.label}`} onMouseDown={event => event.preventDefault()} onClick={() => select(suggestion)}>{suggestion.label}</button>)}
      {!loading && !suggestions.length && <div className="address-suggestion-status">Keep typing or enter the address manually.</div>}
    </div>}
  </div>;
}
