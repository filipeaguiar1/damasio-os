"use client";

import { ReactNode, useState } from "react";

type CompactFilterProps = {
  label?: string;
  children: ReactNode;
};

export function CompactFilter({ label = "Filters", children }: CompactFilterProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="compact-filter">
      <button
        type="button"
        className="filter-icon-btn"
        aria-label={label}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">⌕</span>
      </button>
      {open && (
        <div className="compact-filter-panel">
          <div className="compact-filter-title">{label}</div>
          {children}
        </div>
      )}
    </div>
  );
}
