import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from "recharts";
import { DollarSign, Wrench, TrendingUp, BarChart2 } from "lucide-react";
import { useTable } from "@/hooks/use-table";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { TablePagination } from "@/components/ui/table-pagination";

function useMaintCostReport() {
  return useQuery({
    queryKey: ['/api/reports/maintenance-costs'],
    queryFn: async () => {
      const res = await fetch('/api/reports/maintenance-costs', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch maintenance cost report');
      return res.json() as Promise<{
        byEquipment: any[];
        byCategory: any[];
        byMonth: any[];
        summary: { totalEvents: number; totalCost: number; avgCostPerEvent: number };
      }>;
    },
    staleTime: 5 * 60 * 1000,
  });
}

const CATEGORY_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6'];

export default function MaintenanceCostReport() {
  const { data, isLoading } = useMaintCostReport();

  const { sort, onSort, page, setPage, rows: pagedEquipment, totalPages, total } = useTable(
    data?.byEquipment,
    {
      defaultSortKey: "totalCost",
      defaultDir: "desc",
      getters: {
        totalCost: (r) => Number(r.totalCost),
        avgCostPerEvent: (r) => Number(r.avgCostPerEvent),
        eventCount: (r) => Number(r.eventCount),
      },
    }
  );

  const summary = data?.summary;
  const byMonth = (data?.byMonth ?? []).map((d: any) => ({
    month: d.month,
    cost: Number(d.totalCost),
    events: Number(d.eventCount),
  }));

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Maintenance Cost Report</h2>
        <p className="text-muted-foreground">Fleet maintenance spend analysis — 12-month rolling view</p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-l-4 border-l-red-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Maintenance Spend</CardTitle>
            <DollarSign className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              ${Number(summary?.totalCost ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <p className="text-xs text-muted-foreground">All-time total</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-blue-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Events</CardTitle>
            <Wrench className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {Number(summary?.totalEvents ?? 0).toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">All maintenance records</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-green-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Cost / Event</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              ${Number(summary?.avgCostPerEvent ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <p className="text-xs text-muted-foreground">Per maintenance event</p>
          </CardContent>
        </Card>
      </div>

      {/* Monthly Trend Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart2 className="h-5 w-5" />
            Monthly Maintenance Spend (12 Months)
          </CardTitle>
          <CardDescription>Cost trend over the last 12 months</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byMonth}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="month" stroke="#888888" fontSize={12} tickLine={false} />
                <YAxis stroke="#888888" fontSize={12} tickLine={false} tickFormatter={(v) => `$${v >= 1000 ? `${(v/1000).toFixed(1)}k` : v}`} />
                <Tooltip
                  formatter={(value: any, name: string) => [
                    name === 'cost' ? `$${Number(value).toFixed(2)}` : value,
                    name === 'cost' ? 'Spend' : 'Events',
                  ]}
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Bar dataKey="cost" fill="#ef4444" radius={[4, 4, 0, 0]} name="cost" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* By Category + By Equipment */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Cost by Category</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={(data?.byCategory ?? []).map((d: any, i: number) => ({ ...d, totalCost: Number(d.totalCost), color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }))} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                  <XAxis type="number" stroke="#888888" fontSize={12} tickLine={false} tickFormatter={(v) => `$${v >= 1000 ? `${(v/1000).toFixed(1)}k` : v}`} />
                  <YAxis type="category" dataKey="category" stroke="#888888" fontSize={11} tickLine={false} width={90} />
                  <Tooltip formatter={(v: any) => [`$${Number(v).toFixed(2)}`, 'Total Cost']} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                  <Bar dataKey="totalCost" radius={[0, 4, 4, 0]}>
                    {(data?.byCategory ?? []).map((_: any, i: number) => (
                      <Cell key={i} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top Cost Equipment</CardTitle>
            <CardDescription>Highest maintenance spend units</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(data?.byEquipment ?? []).slice(0, 6).map((item: any, index: number) => (
                <div key={item.id} className="flex items-center justify-between py-1.5 border-b last:border-0">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-red-100 text-red-700 font-bold text-xs flex items-center justify-center">
                      {index + 1}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">{item.category} · {item.eventCount} events</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-red-600">${Number(item.totalCost).toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">${Number(item.avgCostPerEvent).toFixed(2)}/event</p>
                  </div>
                </div>
              ))}
              {(data?.byEquipment ?? []).length === 0 && !isLoading && (
                <p className="text-center text-muted-foreground py-8">No maintenance cost data available</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Full Equipment Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Equipment — Maintenance Spend</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTableHead sortKey="name" sort={sort} onSort={onSort}>Equipment</SortableTableHead>
                <SortableTableHead sortKey="category" sort={sort} onSort={onSort}>Category</SortableTableHead>
                <SortableTableHead sortKey="eventCount" sort={sort} onSort={onSort} align="right">Events</SortableTableHead>
                <SortableTableHead sortKey="totalCost" sort={sort} onSort={onSort} align="right">Total Cost</SortableTableHead>
                <SortableTableHead sortKey="avgCostPerEvent" sort={sort} onSort={onSort} align="right">Avg / Event</SortableTableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading...</TableCell>
                </TableRow>
              ) : pagedEquipment.map((item: any) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="font-medium">{item.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{item.equipmentId}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{item.category}</Badge>
                  </TableCell>
                  <TableCell className="text-right">{item.eventCount}</TableCell>
                  <TableCell className="text-right font-medium text-red-600">
                    ${Number(item.totalCost).toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    ${Number(item.avgCostPerEvent).toFixed(2)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination page={page} totalPages={totalPages} total={total} onPage={setPage} />
        </CardContent>
      </Card>
    </div>
  );
}
