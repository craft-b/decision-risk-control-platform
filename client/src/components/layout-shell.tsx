import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import {
  LayoutDashboard,
  Truck,
  CalendarRange,
  LogOut,
  Menu,
  ShieldCheck,
  MapPin,
  Building2,
  Wrench,
  Brain,
  TrendingUp,
  BarChart2,
  DollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandLockup, BrandMark, ThemeToggle } from "@/components/brand";
import { CommandPalette } from "@/components/command-palette";

type NavItem = { name: string; href: string; icon: React.ComponentType<{ className?: string }> };
type NavSection = { label: string; items: NavItem[] };

const NAV_SECTIONS: NavSection[] = [
  {
    label: "Operations",
    items: [
      { name: "Command Center", href: "/", icon: LayoutDashboard },
      { name: "Equipment", href: "/equipment", icon: Truck },
      { name: "Rentals", href: "/rentals", icon: CalendarRange },
      { name: "Job Sites", href: "/job-sites", icon: MapPin },
      { name: "Vendors", href: "/vendors", icon: Building2 },
    ],
  },
  {
    label: "Maintenance",
    items: [
      { name: "Maintenance Log", href: "/maintenance", icon: Wrench },
      { name: "Cost Analysis", href: "/maintenance-costs", icon: BarChart2 },
      { name: "Financial", href: "/financial", icon: DollarSign },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { name: "Predictive Maintenance", href: "/predictive-maintenance", icon: Brain },
      { name: "Model Performance", href: "/ml-performance", icon: TrendingUp },
    ],
  },
];

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logoutMutation } = useAuth();
  const [open, setOpen] = useState(false);

  const NavContent = () => (
    <div className="flex h-full flex-col bg-card">
      <div className="border-b border-border px-5 pb-5 pt-6">
        <Link href="/" onClick={() => setOpen(false)}>
          <BrandLockup />
        </Link>
      </div>

      {/* Palette launcher — the fast path; ⌘K works everywhere */}
      <div className="px-3 pt-3">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            window.dispatchEvent(new Event("open-command-palette"));
          }}
          className="flex w-full items-center gap-2 rounded-md border border-border bg-background/60 px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:border-input hover:text-foreground"
        >
          <Search className="h-3.5 w-3.5" />
          <span>Search…</span>
          <kbd className="ml-auto rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            ⌘K
          </kbd>
        </button>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label}>
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const isActive =
                  location === item.href ||
                  (item.href === "/" && location.startsWith("/assets/"));
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-md px-3 py-2 text-[13px] font-medium transition-colors duration-150",
                      isActive
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                    onClick={() => setOpen(false)}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary" />
                    )}
                    <item.icon
                      className={cn(
                        "h-4 w-4 shrink-0",
                        isActive
                          ? "text-primary"
                          : "text-muted-foreground/70 group-hover:text-muted-foreground",
                      )}
                    />
                    {item.name}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-3 rounded-lg px-3 py-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground ring-1 ring-inset ring-border">
            {user?.username.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-foreground">{user?.username}</p>
            <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
              {user?.role === "ADMINISTRATOR" && <ShieldCheck className="h-3 w-3" />}
              {user?.role?.toLowerCase().replace(/_/g, " ")}
            </p>
          </div>
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => logoutMutation.mutate()}
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop Sidebar */}
      <div className="fixed inset-y-0 z-50 hidden w-60 border-r border-border md:block">
        <NavContent />
      </div>

      {/* Mobile Header */}
      <div className="fixed left-0 right-0 top-0 z-50 flex h-14 items-center justify-between border-b border-border bg-card px-4 md:hidden">
        <Link href="/" className="flex items-center gap-2.5">
          <BrandMark className="h-7 w-7 text-foreground" />
          <span className="text-sm font-semibold tracking-tight text-foreground">
            Asset Intelligence
          </span>
        </Link>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-60 border-r border-border p-0">
            <NavContent />
          </SheetContent>
        </Sheet>
      </div>

      {/* Main Content */}
      <main className="min-h-screen min-w-0 flex-1 pt-14 md:ml-60 md:pt-0">
        <div className="mx-auto max-w-7xl p-4 md:p-8 lg:p-10">
          {children}
        </div>
      </main>

      <CommandPalette />
    </div>
  );
}
