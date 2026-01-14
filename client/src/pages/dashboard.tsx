import { useEquipment } from "@/hooks/use-equipment";
import { useRentals } from "@/hooks/use-rentals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Legend,
  Cell
} from "recharts";
import { DollarSign, TrendingUp, Percent, AlertCircle, Calendar } from "lucide-react";
import { format, startOfWeek, addDays, isSameDay, startOfMonth, subMonths, differenceInDays } from "date-fns";

export default function Dashboard() {
  const { data: equipment } = useEquipment();
  const { data: rentals } = useRentals();

  const today = new Date();
  const weekStart = startOfWeek(today, { weekStartsOn: 0 });
  
  // Calculate Week-to-Date Revenue (actual days with active rentals)
  const weekToDateRevenue = rentals
    ?.filter(r => r.status === 'ACTIVE')
    .reduce((total, rental) => {
      const receiveDate = rental.receiveDate ? new Date(rental.receiveDate) : null;
      if (!receiveDate) return total;
      
      // Calculate days this rental has been active this week
      const rentalStart = receiveDate > weekStart ? receiveDate : weekStart;
      const daysActive = differenceInDays(today, rentalStart) + 1;
      const dailyRate = Number(rental.equipment?.dailyRate || 0);
      
      return total + (dailyRate * Math.max(0, daysActive));
    }, 0) || 0;

  // Calculate Monthly Revenue (last 30 days of completed rentals)
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 30);
  
  const monthlyRevenue = rentals
    ?.filter(r => {
      if (r.status === 'ACTIVE') {
        const receiveDate = r.receiveDate ? new Date(r.receiveDate) : null;
        if (!receiveDate) return false;
        const daysActive = differenceInDays(today, receiveDate);
        return daysActive > 0;
      }
      if (r.status === 'COMPLETED' && r.returnDate) {
        const returnDate = new Date(r.returnDate);
        return returnDate >= thirtyDaysAgo;
      }
      return false;
    })
    .reduce((total, rental) => {
      const dailyRate = Number(rental.equipment?.dailyRate || 0);
      if (rental.status === 'COMPLETED' && rental.receiveDate && rental.returnDate) {
        const days = differenceInDays(new Date(rental.returnDate), new Date(rental.receiveDate)) + 1;
        return total + (dailyRate * days);
      } else if (rental.status === 'ACTIVE' && rental.receiveDate) {
        const days = differenceInDays(today, new Date(rental.receiveDate)) + 1;
        return total + (dailyRate * days);
      }
      return total;
    }, 0) || 0;

  // Utilization Rate
  const totalEquipment = equipment?.length || 0;
  const rentedEquipment = equipment?.filter(e => e.status === 'RENTED').length || 0;
  const utilizationRate = totalEquipment > 0 ? (rentedEquipment / totalEquipment) * 100 : 0;

  // Outstanding AR (completed rentals assumed unpaid - would need payment tracking)
  const outstandingAR = rentals
    ?.filter(r => r.status === 'COMPLETED')
    .reduce((total, rental) => {
      if (!rental.receiveDate || !rental.returnDate) return total;
      const days = differenceInDays(new Date(rental.returnDate), new Date(rental.receiveDate)) + 1;
      const dailyRate = Number(rental.equipment?.dailyRate || 0);
      return total + (dailyRate * days);
    }, 0) || 0;

  // Generate daily revenue breakdown by job site for this week
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  
  const dailyRevenueByJobSite = weekDays.map(date => {
    const dayName = format(date, 'EEE');
    const isPast = date < today && !isSameDay(date, today);
    const isToday = isSameDay(date, today);
    
    // Only calculate for past days and today
    if (!isPast && !isToday) {
      return { name: dayName, date: format(date, 'MMM d'), total: 0 };
    }

    // Group by job site
    const siteRevenue: Record<string, number> = {};
    rentals?.filter(r => r.status === 'ACTIVE').forEach(rental => {
      const receiveDate = rental.receiveDate ? new Date(rental.receiveDate) : null;
      if (!receiveDate || receiveDate > date) return;
      
      const siteName = rental.jobSite?.name || rental.jobSite?.jobId || 'Unknown';
      const dailyRate = Number(rental.equipment?.dailyRate || 0);
      
      if (!siteRevenue[siteName]) {
        siteRevenue[siteName] = 0;
      }
      siteRevenue[siteName] += dailyRate;
    });

    return {
      name: dayName,
      date: format(date, 'MMM d'),
      ...siteRevenue,
      total: Object.values(siteRevenue).reduce((sum: number, val: number) => sum + val, 0)
    };
  });

  // Get unique job sites for chart legend
  const jobSites = Array.from(new Set(
    rentals
      ?.filter(r => r.status === 'ACTIVE')
      .map(r => r.jobSite?.name || r.jobSite?.jobId || 'Unknown') || []
  ));

  // Colors for different job sites
  const siteColors = [
    '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', 
    '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16'
  ];

  // Month-over-month trend (last 6 months)
  const monthlyTrend = Array.from({ length: 6 }, (_, i) => {
    const monthDate = subMonths(startOfMonth(today), 5 - i);
    const monthName = format(monthDate, 'MMM');
    
    // Calculate revenue for this month (simplified - would need actual historical data)
    const monthRevenue = rentals
      ?.filter(r => {
        if (r.returnDate) {
          const returnDate = new Date(r.returnDate);
          return returnDate.getMonth() === monthDate.getMonth() && 
                 returnDate.getFullYear() === monthDate.getFullYear();
        }
        return false;
      })
      .reduce((total, rental) => {
        if (!rental.receiveDate || !rental.returnDate) return total;
        const days = differenceInDays(new Date(rental.returnDate), new Date(rental.receiveDate)) + 1;
        const dailyRate = Number(rental.equipment?.dailyRate || 0);
        return total + (dailyRate * days);
      }, 0) || 0;

    return {
      month: monthName,
      revenue: monthRevenue,
      target: 50000 // Mock target line
    };
  });

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
            <p className="text-xs text-muted-foreground">Rolling 30-day total</p>
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
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid gap-4 lg:grid-cols-7">
        <Card className="col-span-4 shadow-sm">
          <CardHeader>
            <CardTitle>Daily Revenue by Job Site (This Week)</CardTitle>
            <p className="text-sm text-muted-foreground">Stacked view of revenue sources per day</p>
          </CardHeader>
          <CardContent className="pl-2">
            <div className="h-[350px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyRevenueByJobSite}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis 
                    dataKey="name" 
                    stroke="#888888" 
                    fontSize={12} 
                    tickLine={false} 
                    axisLine={false}
                  />
                  <YAxis
                    stroke="#888888"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `$${value}`}
                  />
                  <Tooltip 
                    cursor={{fill: 'rgba(59, 130, 246, 0.1)'}}
                    contentStyle={{ 
                      borderRadius: '8px', 
                      border: 'none', 
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                      backgroundColor: 'white'
                    }}
                    formatter={(value) => `$${value.toLocaleString()}`}
                    labelFormatter={(label, payload) => {
                      if (payload && payload[0]) {
                        return payload[0].payload.date;
                      }
                      return label;
                    }}
                  />
                  <Legend 
                    verticalAlign="top" 
                    height={36}
                    iconType="circle"
                    wrapperStyle={{ fontSize: '12px' }}
                  />
                  {jobSites.map((site, index) => (
                    <Bar 
                      key={site}
                      dataKey={site} 
                      stackId="a"
                      fill={siteColors[index % siteColors.length]}
                      radius={index === jobSites.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-3 shadow-sm">
          <CardHeader>
            <CardTitle>Revenue Trend (6 Months)</CardTitle>
            <p className="text-sm text-muted-foreground">Monthly performance vs target</p>
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
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' 
                    }}
                    formatter={(value) => `$${value.toLocaleString()}`}
                  />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="revenue" 
                    stroke="#3b82f6" 
                    strokeWidth={3}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                    name="Actual Revenue"
                  />
                  <Line 
                    type="monotone" 
                    dataKey="target" 
                    stroke="#94a3b8" 
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                    name="Target"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

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