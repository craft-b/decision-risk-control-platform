// ─────────────────────────────────────────────────────────────────────────────
// Command palette (⌘K / Ctrl+K) — the fastest path to any asset or surface.
// Groups: Assets (fuzzy jump by name / code / category, worst 30d risk shown
// inline) → Navigate → Actions. Selection always closes the palette first so
// navigation feels instant.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState, useCallback } from "react";
import { useLocation } from "wouter";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  LayoutDashboard,
  Truck,
  CalendarRange,
  MapPin,
  Building2,
  Wrench,
  BarChart2,
  DollarSign,
  Brain,
  TrendingUp,
  Sun,
  Moon,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useEquipment } from "@/hooks/use-equipment";
import { useLatestMultiHorizonPredictions } from "@/hooks/use-risk-score";
import { RiskLevel, RISK_FILL } from "@/lib/risk-format";

const PAGES = [
  { name: "Command Center", href: "/", icon: LayoutDashboard },
  { name: "Equipment", href: "/equipment", icon: Truck },
  { name: "Rentals", href: "/rentals", icon: CalendarRange },
  { name: "Job Sites", href: "/job-sites", icon: MapPin },
  { name: "Vendors", href: "/vendors", icon: Building2 },
  { name: "Maintenance Log", href: "/maintenance", icon: Wrench },
  { name: "Cost Analysis", href: "/maintenance-costs", icon: BarChart2 },
  { name: "Financial", href: "/financial", icon: DollarSign },
  { name: "Predictive Maintenance", href: "/predictive-maintenance", icon: Brain },
  { name: "Model Performance", href: "/ml-performance", icon: TrendingUp },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const { logoutMutation } = useAuth();

  // Data loads lazily — hooks fire only once the palette has been opened, so
  // the shell pays nothing for the palette until it's used.
  const { data: equipment } = useEquipment();
  const { data: predictions } = useLatestMultiHorizonPredictions();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  // Expose an imperative opener for the sidebar search button.
  useEffect(() => {
    const openHandler = () => setOpen(true);
    window.addEventListener("open-command-palette", openHandler);
    return () => window.removeEventListener("open-command-palette", openHandler);
  }, []);

  const riskByEquipment = useMemo(() => {
    const m = new Map<number, { level: RiskLevel; prob: number }>();
    for (const p of (predictions ?? []) as any[]) {
      const id = p.equipmentId ?? p.equipment_id;
      m.set(id, {
        level: (p.risk_level_30d ?? "LOW") as RiskLevel,
        prob: Number(p.prob_30d ?? 0),
      });
    }
    return m;
  }, [predictions]);

  const run = useCallback(
    (fn: () => void) => {
      setOpen(false);
      // Let the dialog close before navigating — keeps the transition clean.
      setTimeout(fn, 0);
    },
    [],
  );

  const toggleTheme = () => {
    const next = document.documentElement.classList.contains("dark") ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem("theme", next);
    } catch {}
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search assets, pages, actions…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>

        <CommandGroup heading="Assets">
          {(equipment ?? []).map((e) => {
            const risk = riskByEquipment.get(e.id);
            return (
              <CommandItem
                key={`asset-${e.id}`}
                value={`${e.name} ${e.equipmentId} ${e.category}`}
                onSelect={() => run(() => navigate(`/assets/${e.id}`))}
              >
                <Truck className="mr-2 h-4 w-4 text-muted-foreground/70" />
                <span className="truncate">{e.name}</span>
                <span className="ml-2 truncate font-mono text-xs text-muted-foreground">
                  {e.equipmentId}
                </span>
                {risk && (
                  <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-3">
                    <span className={cn("h-1.5 w-1.5 rounded-full", RISK_FILL[risk.level])} />
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {Math.round(risk.prob * 100)}%
                    </span>
                  </span>
                )}
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Navigate">
          {PAGES.map((p) => (
            <CommandItem
              key={p.href}
              value={`go to ${p.name}`}
              onSelect={() => run(() => navigate(p.href))}
            >
              <p.icon className="mr-2 h-4 w-4 text-muted-foreground/70" />
              Go to {p.name}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions">
          <CommandItem value="toggle theme dark light" onSelect={() => run(toggleTheme)}>
            <span className="mr-2 flex h-4 w-4 items-center justify-center">
              <Sun className="h-4 w-4 dark:hidden" />
              <Moon className="hidden h-4 w-4 dark:block" />
            </span>
            Toggle Theme
          </CommandItem>
          <CommandItem value="sign out log out" onSelect={() => run(() => logoutMutation.mutate())}>
            <LogOut className="mr-2 h-4 w-4 text-muted-foreground/70" />
            Sign Out
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
