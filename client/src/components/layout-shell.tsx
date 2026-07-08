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
  Boxes,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useState } from "react";
import { cn } from "@/lib/utils";

type NavItem = { name: string; href: string; icon: React.ComponentType<{ className?: string }> };
type NavSection = { label: string; items: NavItem[] };

const NAV_SECTIONS: NavSection[] = [
  {
    label: "Operations",
    items: [
      { name: "Dashboard", href: "/", icon: LayoutDashboard },
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

function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 ring-1 ring-inset ring-primary/30">
        <Boxes className="h-5 w-5 text-blue-400" />
      </div>
      <div className="min-w-0">
        <p className={cn("font-semibold tracking-tight text-white leading-tight", compact ? "text-sm" : "text-[15px]")}>
          Craft &amp; Smash
        </p>
        <p className="text-[11px] font-medium tracking-wide text-slate-400 leading-tight">
          Asset Intelligence
        </p>
      </div>
    </div>
  );
}

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logoutMutation } = useAuth();
  const [open, setOpen] = useState(false);

  const NavContent = () => (
    <div className="flex h-full flex-col bg-slate-950 text-slate-300">
      <div className="px-5 pt-6 pb-5 border-b border-white/[0.06]">
        <Wordmark />
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-5 space-y-6">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label}>
            <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const isActive = location === item.href;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={cn(
                      "relative flex items-center gap-3 rounded-md px-3 py-2 text-[13px] font-medium transition-colors duration-150 group",
                      isActive
                        ? "bg-white/[0.06] text-white"
                        : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-100"
                    )}
                    onClick={() => setOpen(false)}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-0.5 rounded-full bg-blue-500" />
                    )}
                    <item.icon
                      className={cn(
                        "h-4 w-4 shrink-0",
                        isActive ? "text-blue-400" : "text-slate-500 group-hover:text-slate-300"
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

      <div className="border-t border-white/[0.06] p-3">
        <div className="flex items-center gap-3 rounded-lg px-3 py-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-slate-200 ring-1 ring-inset ring-white/10">
            {user?.username.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-slate-200">{user?.username}</p>
            <p className="flex items-center gap-1 text-[11px] text-slate-500">
              {user?.role === "ADMINISTRATOR" && <ShieldCheck className="h-3 w-3" />}
              {user?.role?.toLowerCase().replace(/_/g, " ")}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
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
      <div className="hidden md:block fixed inset-y-0 z-50 w-60 border-r border-slate-900">
        <NavContent />
      </div>

      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 flex h-14 items-center justify-between border-b border-white/[0.06] bg-slate-950 px-4">
        <Wordmark compact />
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="text-slate-300 hover:bg-white/[0.06] hover:text-white">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-60 border-r-slate-900 p-0">
            <NavContent />
          </SheetContent>
        </Sheet>
      </div>

      {/* Main Content */}
      <main className="min-h-screen flex-1 pt-14 md:ml-60 md:pt-0">
        <div className="mx-auto max-w-7xl p-4 md:p-8 lg:p-10">
          {children}
        </div>
      </main>
    </div>
  );
}
