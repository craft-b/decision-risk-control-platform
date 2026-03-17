import { useEquipment } from "@/hooks/use-equipment";
import { useRentals } from "@/hooks/use-rentals";
import { useMaintenanceDueSoon } from "@/hooks/use-maintenance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Cell,
} from "recharts";
import { DollarSign, TrendingUp, Percent, AlertCircle, Calendar, AlertTriangle } from "lucide-react";
import { format, startOfWeek, addDays, isSameDay, startOfMonth, subMonths, differenceInDays } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

export default function Dashboard() {
  const { data: equipment } = useEquipment();
  const { data: rentals } = useRentals();
  const { data: dueSoonList } = useMaintenanceDueSoon();
  const overdueCount = dueSoonList?.filter(d => Number(d.daysUntilDue) < 0).length ?? 0;
  const dueSoonCount = dueSoonList?.filter(d => Number(d.daysUntilDue) >= 0).length ?? 0;

  const today = new Date();
  const weekStart = startOfWeek(today, { weekStartsOn: 0 });
  
  const { data: revenueSummary } = useQuery({
    queryKey: ['/api/dashboard/revenue-summary'],
    queryFn: async () => {
      const res = await fetch('/api/dashboard/revenue-summary', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
  });

  const { data: monthlyTrendData } = useQuery({
    queryKey: ['/api/dashboard/monthly-trend'],
    queryFn: async () => {
      const res = await fetch('/api/dashboard/monthly-trend', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
  });

  const { data: dailyRevenueData } = useQuery({
    queryKey: ['/api/dashboard/daily-revenue'],
    queryFn: async () => {
      const res = await fetch('/api/dashboard/daily-revenue', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return res.json() as Promise<Array<{ day: string; revenue: number }>>;
    },
  });

  const weekToDateRevenue    = revenueSummary?.revenueWtd       ?? 0;
  const monthlyRevenue       = revenueSummary?.revenue30d       ?? 0;
  const utilizationRate      = revenueSummary?.utilizationRate  ?? 0;
  const avgUtilization30d    = revenueSummary?.avgUtilization30d ?? 0;
  const outstandingAR        = revenueSummary?.outstandingAr    ?? 0;
  const uninvoicedCount      = revenueSummary?.uninvoicedCount  ?? 0;
  const totalEquipment       = revenueSummary?.totalEquipment   ?? 0;
  const rentedEquipment      = revenueSummary?.rentedEquipment  ?? 0;
  const monthlyTrend         = (monthlyTrendData ?? []) as Array<{ month: string; revenue: number }>;
  const dailyRevenue         = (dailyRevenueData ?? []) as Array<{ day: string; revenue: number }>;
  const hasAnyDailyRevenue   = dailyRevenue.some(d => d.revenue > 0);

  // Top 5 Revenue-Generating Job Sites
  const siteRevenueMap: Record<string, { name: string; revenue: number; equipmentCount: number }> = {};
  rentals?.forEach(rental => {
    const siteName = rental.jobSite?.name || rental.jobSite?.jobId || 'Unknown';
    if (!siteRevenueMap[siteName]) {
      siteRevenueMap[siteName] = { name: siteName, revenue: 0, equipmentCount: 0 };
    }
    
    if (rental.receiveDate) {
      const startDate = new Date(rental.receiveDate);
      const endDate = rental.returnDate ? new Date(rental.returnDate) : today;
      const days = differenceInDays(endDate, startDate) + 1;
      const dailyRate = Number(rental.equipment?.dailyRate || 0);
      siteRevenueMap[siteName].revenue += dailyRate * days;
      siteRevenueMap[siteName].equipmentCount += 1;
    }
  });

  const topJobSites = Object.values(siteRevenueMap)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  // Equipment count by job site (active rentals only)
  const siteCounts: Record<string, number> = {};
  rentals?.filter(r => r.status === 'ACTIVE').forEach(r => {
    const site = r.jobSite?.name || r.jobSite?.jobId || 'Unknown';
    siteCounts[site] = (siteCounts[site] || 0) + 1;
  });
  const equipmentBySite = Object.entries(siteCounts)
    .map(([site, count]) => ({ site, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const SITE_COLORS = [
    '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ef4444',
    '#14b8a6', '#ec4899', '#f97316', '#06b6d4', '#84cc16',
    '#a855f7', '#64748b',
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Financial Dashboard</h2>
          <p className="text-muted-foreground">Real-time revenue analytics and fleet performance</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="h-4 w-4" />
          <span>Week of {format(weekStart, 'MMM d, yyyy')}</span>
        </div>
      </div>

      {/* Key Financial Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="shadow-sm hover:shadow-md transition-shadow border-l-4 border-l-blue-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Week-to-Date Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              ${weekToDateRevenue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </div>
            <p className="text-xs text-muted-foreground">
              {differenceInDays(today, weekStart) + 1} days elapsed
            </p>
          </CardContent>
        </Card>
        
        <Card className="shadow-sm hover:shadow-md transition-shadow border-l-4 border-l-green-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">30-Day Revenue</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              ${monthlyRevenue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </div>
            <p className="text-xs text-muted-foreground">Accrued revenue, rolling 30 days</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm hover:shadow-md transition-shadow border-l-4 border-l-purple-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Fleet Utilization</CardTitle>
            <Percent className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">
              {utilizationRate.toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">
              {rentedEquipment} of {totalEquipment} assets rented
            </p>
            <p className="text-xs text-purple-500 font-medium mt-1">
              {avgUtilization30d.toFixed(1)}% avg last 30 days
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm hover:shadow-md transition-shadow border-l-4 border-l-orange-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Outstanding A/R</CardTitle>
            <AlertCircle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              ${outstandingAR.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </div>
            <p className="text-xs text-muted-foreground">Unpaid completed rentals</p>
            {uninvoicedCount > 0 && (
              <p className="text-xs text-orange-500 font-medium mt-1">
                {uninvoicedCount} rental{uninvoicedCount !== 1 ? 's' : ''} awaiting invoice
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Daily Revenue (Last 30 Days)</CardTitle>
            <p className="text-sm text-muted-foreground">Accrued daily rate for all active &amp; completed rentals</p>
          </CardHeader>
          <CardContent className="pl-2">
            <div className="h-[350px] w-full">
              {!hasAnyDailyRevenue ? (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  No rental revenue in the last 30 days
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyRevenue} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis
                      dataKey="day"
                      stroke="#888888"
                      fontSize={11}
                      tickLine={false}
                      interval={4}
                      tickFormatter={(v) => {
                        try { return format(new Date(v + 'T00:00:00'), 'MMM d'); } catch { return v; }
                      }}
                    />
                    <YAxis
                      stroke="#888888"
                      fontSize={11}
                      tickLine={false}
                      tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
                    />
                    <Tooltip
                      formatter={(value: number) => [`$${value.toLocaleString()}`, 'Revenue']}
                      labelFormatter={(label) => {
                        try { return format(new Date(label + 'T00:00:00'), 'MMM d, yyyy'); } catch { return label; }
                      }}
                      contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    />
                    <Bar dataKey="revenue" fill="#3b82f6" radius={[3, 3, 0, 0]} name="Revenue" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Revenue Trend (12 Months)</CardTitle>
            <p className="text-sm text-muted-foreground">Monthly completed rental revenue</p>
          </CardHeader>
          <CardContent>
            <div className="h-[350px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthlyTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis
                    dataKey="month"
                    stroke="#888888"
                    fontSize={12}
                    tickLine={false}
                  />
                  <YAxis
                    stroke="#888888"
                    fontSize={12}
                    tickLine={false}
                    tickFormatter={(value) => `$${value / 1000}k`}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: '8px',
                      border: 'none',
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                    }}
                    formatter={(value) => [`$${Number(value).toLocaleString()}`, 'Revenue']}
                  />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="#3b82f6"
                    strokeWidth={3}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                    name="Revenue"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Equipment by Job Site */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Active Equipment by Job Site</CardTitle>
          <p className="text-sm text-muted-foreground">Units currently deployed per site</p>
        </CardHeader>
        <CardContent>
          {equipmentBySite.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
              No active rentals
            </div>
          ) : (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={equipmentBySite}
                  layout="vertical"
                  margin={{ top: 4, right: 24, bottom: 4, left: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    stroke="#888888"
                    fontSize={12}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="site"
                    stroke="#888888"
                    fontSize={11}
                    tickLine={false}
                    width={140}
                    tick={{ fill: '#475569' }}
                  />
                  <Tooltip
                    formatter={(value: number) => [value, 'Units deployed']}
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {equipmentBySite.map((_, i) => (
                      <Cell key={i} fill={SITE_COLORS[i % SITE_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Maintenance Alerts */}
      {(dueSoonList?.length ?? 0) > 0 && (
        <Card className="border-l-4 border-l-orange-500 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              Maintenance Alerts
            </CardTitle>
            <Link href="/maintenance">
              <span className="text-xs text-blue-600 hover:underline cursor-pointer">View log →</span>
            </Link>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {overdueCount > 0 && (
                <div className="flex items-center justify-between p-2 rounded-lg bg-red-50 border border-red-200">
                  <span className="text-sm font-medium text-red-800">{overdueCount} unit{overdueCount !== 1 ? 's' : ''} overdue for service</span>
                  <Badge variant="outline" className="bg-red-100 text-red-800 border-red-300">Overdue</Badge>
                </div>
              )}
              {dueSoonCount > 0 && (
                <div className="flex items-center justify-between p-2 rounded-lg bg-orange-50 border border-orange-200">
                  <span className="text-sm font-medium text-orange-800">{dueSoonCount} unit{dueSoonCount !== 1 ? 's' : ''} due within 30 days</span>
                  <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-300">Due Soon</Badge>
                </div>
              )}
              <div className="space-y-1 pt-1">
                {dueSoonList?.slice(0, 5).map((item) => {
                  const days = Number(item.daysUntilDue);
                  return (
                    <div key={item.id} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                      <div>
                        <span className="font-medium">{item.name}</span>
                        <span className="text-muted-foreground ml-2 text-xs font-mono">{item.equipmentId}</span>
                      </div>
                      <span className={cn(
                        "text-xs font-medium",
                        days < 0 ? "text-red-600" : days <= 7 ? "text-orange-600" : "text-yellow-600"
                      )}>
                        {days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Due today' : `${days}d`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top Job Sites & Equipment ROI */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top 5 Revenue-Generating Job Sites</CardTitle>
            <p className="text-sm text-muted-foreground">Lifetime revenue by customer</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {topJobSites.map((site, index) => (
                <div key={site.name} className="flex items-center justify-between border-b pb-3 last:border-0">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-bold text-sm">
                      #{index + 1}
                    </div>
                    <div>
                      <p className="font-medium">{site.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {site.equipmentCount} rental{site.equipmentCount !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-green-600">
                      ${site.revenue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      ${(site.revenue / site.equipmentCount).toFixed(0)}/rental
                    </p>
                  </div>
                </div>
              ))}
              {topJobSites.length === 0 && (
                <p className="text-center text-muted-foreground py-8">No job site data available</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Equipment ROI Analysis</CardTitle>
            <p className="text-sm text-muted-foreground">Top performing assets by revenue</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {equipment
                ?.sort((a, b) => {
                  const aRentals = rentals?.filter(r => r.equipmentId === a.id) || [];
                  const bRentals = rentals?.filter(r => r.equipmentId === b.id) || [];
                  const aRevenue = aRentals.reduce((sum, r) => {
                    if (!r.receiveDate) return sum;
                    const days = r.returnDate 
                      ? differenceInDays(new Date(r.returnDate), new Date(r.receiveDate)) + 1
                      : differenceInDays(today, new Date(r.receiveDate)) + 1;
                    return sum + (Number(a.dailyRate || 0) * days);
                  }, 0);
                  const bRevenue = bRentals.reduce((sum, r) => {
                    if (!r.receiveDate) return sum;
                    const days = r.returnDate 
                      ? differenceInDays(new Date(r.returnDate), new Date(r.receiveDate)) + 1
                      : differenceInDays(today, new Date(r.receiveDate)) + 1;
                    return sum + (Number(b.dailyRate || 0) * days);
                  }, 0);
                  return bRevenue - aRevenue;
                })
                .slice(0, 5)
                .map((equip, index) => {
                  const equipmentRentals = rentals?.filter(r => r.equipmentId === equip.id) || [];
                  const totalRevenue = equipmentRentals.reduce((sum, r) => {
                    if (!r.receiveDate) return sum;
                    const days = r.returnDate 
                      ? differenceInDays(new Date(r.returnDate), new Date(r.receiveDate)) + 1
                      : differenceInDays(today, new Date(r.receiveDate)) + 1;
                    return sum + (Number(equip.dailyRate || 0) * days);
                  }, 0);

                  return (
                    <div key={equip.id} className="flex items-center justify-between border-b pb-3 last:border-0">
                      <div className="flex items-center gap-4">
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-green-100 text-green-700 font-bold text-sm">
                          #{index + 1}
                        </div>
                        <div>
                          <p className="font-medium">{equip.name}</p>
                          <p className="text-xs text-muted-foreground font-mono">
                            {equip.equipmentId}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-blue-600">
                          ${totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {equipmentRentals.length} rental{equipmentRentals.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}