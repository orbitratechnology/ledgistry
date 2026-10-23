import { cn } from "@/lib/utils";

/** Ledgistry mark: a ledger "L" closing into a settled line, with a highlight dot. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      className={cn("size-8 shrink-0 text-primary", className)}
    >
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <path
        d="M11 8.5v12.25a2.25 2.25 0 0 0 2.25 2.25H22"
        fill="none"
        stroke="white"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M16 14.5h6" stroke="white" strokeOpacity="0.55" strokeWidth="3" strokeLinecap="round" />
      <circle cx="22.5" cy="9" r="2.25" className="fill-brand-highlight" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <LogoMark />
      <span className="text-base font-semibold tracking-tight">Ledgistry</span>
    </span>
  );
}
