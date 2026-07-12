// ─────────────────────────────────────────────────────────────────────────────
// Brand — the product identity in code.
//
// Mark: a hexagonal plate (machined hardware) carrying a risk-trajectory pulse
// that rises and is caught before the spike — the product promise in one glyph.
// The plate draws in currentColor so it sits on any surface; the pulse is the
// interactive blue, the one accent the design system allows.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("h-8 w-8", className)}
      aria-hidden="true"
    >
      {/* Hex plate */}
      <path
        d="M16 2.5 L27.5 9 L27.5 23 L16 29.5 L4.5 23 L4.5 9 Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        className="opacity-90"
      />
      {/* Risk pulse — rises, spikes, and is intercepted */}
      <path
        d="M8 19.5 L12 19.5 L14.5 12.5 L17.5 21.5 L19.5 16.5 L24 16.5"
        stroke="hsl(var(--primary))"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BrandLockup({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <BrandMark className="h-8 w-8 shrink-0 text-foreground" />
      <div className="min-w-0 leading-none">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Craft &amp; Smash
        </p>
        <p className="mt-1 text-[15px] font-semibold tracking-tight text-foreground">
          Asset Intelligence
        </p>
      </div>
    </div>
  );
}

// ─── Theme toggle ─────────────────────────────────────────────────────────────
// Dark is the default; the preference persists. The <html> class is the single
// source of truth (set before first paint by the index.html bootstrap).

function currentTheme(): "dark" | "light" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<"dark" | "light">(() => currentTheme());

  // The <html> class is the source of truth; mutate it imperatively so the
  // switch is instant and immune to state-timing issues, then mirror to state
  // for the icon and persist the preference.
  const toggle = () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* private mode — theme just won't persist */
    }
    setTheme(next);
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn("h-8 w-8 p-0 text-muted-foreground hover:text-foreground", className)}
            onClick={toggle}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p>{theme === "dark" ? "Light theme" : "Dark theme"}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
