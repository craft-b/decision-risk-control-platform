import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { 
  LayoutDashboard, 
  Truck, 
  CalendarRange, 
  LogOut, 
  Menu,
  ShieldAlert,
  Activity,
  MapPin,
  Building2,
  Wrench,
  Brain,
  TrendingUp
} from "lucide-react";
import { FaTruckMonster } from "react-icons/fa";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logoutMutation } = useAuth();
  const [open, setOpen] = useState(false);

  const navigation = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard },
    { name: 'Equipment', href: '/equipment', icon: Truck },
    { name: 'Rentals', href: '/rentals', icon: CalendarRange },
    { name: 'Job Sites', href: '/job-sites', icon: MapPin },
    { name: 'Vendors', href: '/vendors', icon: Building2 },
    { name: 'Maintenance', href: '/maintenance', icon: Wrench }, 
    { name: 'Risk Analytics', href: '/risk-analytics', icon: Activity }, 
    { name: 'Predictive Maintenance', href: '/predictive-maintenance', icon: Brain }, 
    { name: 'ML Performance', href: '/ml-performance', icon: TrendingUp },
  ];

  const NavContent = () => (
    <div className="flex flex-col h-full bg-slate-900 text-white">
      <div className="p-6 border-b border-slate-800">
        <h1 className="text-2xl font-bold font-display tracking-widest text-primary flex items-center gap-2">
          <FaTruckMonster className="h-6 w-6" />
          CRAFT & SMASH
        </h1>
        <p className="text-xs text-slate-400 mt-1 uppercase tracking-widest">Rental Systems</p>
      </div>

      <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
        {navigation.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.name} href={item.href} className={cn(
              "flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-all duration-200 group",
              isActive 
                ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" 
                : "text-slate-300 hover:bg-slate-800 hover:text-white"
            )}
            onClick={() => setOpen(false)}
            >
              <item.icon className={cn("h-5 w-5", isActive ? "text-primary-foreground" : "text-slate-400 group-hover:text-white")} />
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-800 bg-slate-900/50">
        <div className="flex items-center gap-3 px-4 py-3 mb-2 rounded-lg bg-slate-800/50 border border-slate-700">
          <div className="h-8 w-8 rounded-full bg-slate-700 flex items-center justify-center text-primary font-bold">
            {user?.username.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="text-sm font-medium text-white truncate">{user?.username}</p>
            <p className="text-xs text-slate-400 flex items-center gap-1">
              {user?.role === 'ADMINISTRATOR' && <ShieldAlert className="h-3 w-3 text-primary" />}
              {user?.role}
            </p>
          </div>
        </div>
        <Button 
          variant="ghost" 
          className="w-full justify-start text-slate-400 hover:text-red-400 hover:bg-red-950/20"
          onClick={() => logoutMutation.mutate()}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign Out
        </Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop Sidebar */}
      <div className="hidden md:block w-64 fixed inset-y-0 z-50">
        <NavContent />
      </div>

      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-16 bg-slate-900 z-50 flex items-center px-4 justify-between border-b border-slate-800">
         <h1 className="text-xl font-bold font-display text-primary flex items-center gap-2">
          <FaTruckMonster className="h-6 w-6" />
          CRAFT & SMASH
        </h1>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="text-white">
              <Menu className="h-6 w-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 border-r-slate-800 w-64">
            <NavContent />
          </SheetContent>
        </Sheet>
      </div>

      {/* Main Content */}
      <main className="flex-1 md:ml-64 pt-16 md:pt-0 min-h-screen transition-all duration-300">
        <div className="max-w-7xl mx-auto p-4 md:p-8 lg:p-12">
          {children}
        </div>
      </main>
    </div>
  );
}