import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { LayoutShell } from "@/components/layout-shell";
import { Loader2 } from "lucide-react";

import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import EquipmentList from "@/pages/equipment-list";
import RentalsList from "@/pages/rentals-list";
import NotFound from "@/pages/not-found";
import RiskAnalytics from "@/pages/risk-monitoring";
import MaintenanceLog from "./pages/maintenance-log";
import JobSitesList from '@/pages/job-sites-list';
import VendorsList from '@/pages/vendors-list';
import PredictiveMaintenanceDashboard from '@/pages/predictive-maintenance-dashboard';
import MLPerformanceDashboard from "./pages/ml-dashboard";


// Protected Route Wrapper
function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  return (
    <LayoutShell>
      <Component />
    </LayoutShell>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      
      {/* Protected Routes */}
      <Route path="/">
        <ProtectedRoute component={Dashboard} />
      </Route>
      <Route path="/equipment">
        <ProtectedRoute component={EquipmentList} />
      </Route>
      <Route path="/rentals">
        <ProtectedRoute component={RentalsList} />
      </Route>
      <Route path="/risk-analytics">
        <ProtectedRoute component={RiskAnalytics} />
      </Route>
      <Route path="/maintenance">
        <ProtectedRoute component={MaintenanceLog} />
      </Route>
      <Route path="/job-sites">
        <ProtectedRoute component={JobSitesList} />
      </Route> 
      <Route path="/vendors">
        <ProtectedRoute component={VendorsList} />
      </Route>
      <Route path="/predictive-maintenance">
        <ProtectedRoute component={PredictiveMaintenanceDashboard} />
      </Route>
      <Route path="/ml-performance">
        <ProtectedRoute component={MLPerformanceDashboard} />
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Router />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
