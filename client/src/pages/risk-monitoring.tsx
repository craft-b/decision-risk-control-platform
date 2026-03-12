import { useState } from "react";
import { useEquipment } from "@/hooks/use-equipment";
import { useCalculateRiskScore, useBatchRiskScore } from "@/hooks/use-risk-score";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RiskBadge } from "@/components/risk-badge";
import { Calculator, TrendingUp, AlertTriangle, Activity, RefreshCw } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { useQueryClient } from "@tanstack/react-query";

interface RiskScore {
  equipmentId: number;
  riskScore: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  drivers: string[];
  modelVersion: string;
}

export default function RiskAnalytics() {
  const { data: equipment, isLoading } = useEquipment();
  const batchScoreMutation = useBatchRiskScore();
  const queryClient = useQueryClient();
  const cachedScores = queryClient.getQueryData<RiskScore[]>(['risk-scores', 'batch']) ?? [];
  const [riskScores, setRiskScores] = useState<RiskScore[]>(cachedScores);

  const handleCalculateAll = async () => {
    if (!equipment) return;
    const equipmentIds = equipment.map(e => e.id);
    const results = await batchScoreMutation.mutateAsync(equipmentIds);
    setRiskScores(results);
    queryClient.setQueryData(['risk-scores', 'batch'], results);
  };

  // Calculate risk distribution
  const riskDistribution = [
    { name: "Low Risk", value: riskScores.filter(r => r.riskLevel === "LOW").length, color: "#22c55e" },
    { name: "Medium Risk", value: riskScores.filter(r => r.riskLevel === "MEDIUM").length, color: "#eab308" },
    { name: "High Risk", value: riskScores.filter(r => r.riskLevel === "HIGH").length, color: "#ef4444" },
  ];

  // Top 10 highest risk equipment
  const topRiskEquipment = [...riskScores]
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 10)
    .map(score => {
      const equip = equipment?.find(e => e.id === score.equipmentId);
      return {
        name: equip?.name || `EQ-${score.equipmentId}`,
        score: score.riskScore,
        level: score.riskLevel,
      };
    });

  const avgRiskScore = riskScores.length > 0
    ? Math.round(riskScores.reduce((sum, r) => sum + r.riskScore, 0) / riskScores.length)
    : 0;

  const highRiskCount = riskScores.filter(r => r.riskLevel === "HIGH").length;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Risk Analytics</h2>
          <p className="text-muted-foreground">Operational risk assessment for equipment fleet</p>
        </div>
        
        <Button 
          onClick={handleCalculateAll}
          disabled={batchScoreMutation.isPending || isLoading}
        >
          {batchScoreMutation.isPending ? (
            <>
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              Calculating...
            </>
          ) : (
            <>
              <Calculator className="mr-2 h-4 w-4" />
              Calculate All Risk Scores
            </>
          )}
        </Button>
      </div>

      {/* Info Alert */}
      <Alert>
        <Activity className="h-4 w-4" />
        <AlertDescription>
          Risk scores (0-100) assess failure probability based on equipment age, usage hours, maintenance history, and operational patterns.
          {riskScores.length > 0 && (
            <span className="ml-1 font-medium">Model: {riskScores[0]?.modelVersion ?? 'v1.4'}</span>
          )}
          {riskScores.length === 0 && <span className="ml-1 font-medium">Model: v1.4</span>}
        </AlertDescription>
      </Alert>

      {/* Stats Cards */}
      {riskScores.length > 0 && (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Equipment Scored</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{riskScores.length}</div>
                <p className="text-xs text-muted-foreground">
                  Out of {equipment?.length || 0} total
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Average Risk Score</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{avgRiskScore}</div>
                <p className="text-xs text-muted-foreground">
                  Fleet average (0-100 scale)
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">High Risk Assets</CardTitle>
                <AlertTriangle className="h-4 w-4 text-red-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600">{highRiskCount}</div>
                <p className="text-xs text-muted-foreground">
                  Requires immediate attention
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Low Risk Assets</CardTitle>
                <Activity className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  {riskDistribution[0].value}
                </div>
                <p className="text-xs text-muted-foreground">
                  Optimal operational status
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Charts Row */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
            <Card className="col-span-4">
              <CardHeader>
                <CardTitle>Top 10 Highest Risk Equipment</CardTitle>
                <CardDescription>Assets requiring priority attention</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topRiskEquipment}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                      <XAxis
                        dataKey="name"
                        stroke="#888888"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                        angle={-45}
                        textAnchor="end"
                        height={80}
                      />
                      <YAxis
                        stroke="#888888"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                        domain={[0, 100]}
                      />
                      <Tooltip
                        cursor={{ fill: 'transparent' }}
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      />
                      <Bar dataKey="score" radius={[4, 4, 0, 0]} barSize={30}>
                        {topRiskEquipment.map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={
                              entry.level === "HIGH" ? "#ef4444" :
                              entry.level === "MEDIUM" ? "#eab308" :
                              "#22c55e"
                            }
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="col-span-3">
              <CardHeader>
                <CardTitle>Risk Distribution</CardTitle>
                <CardDescription>Fleet risk breakdown</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[240px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={riskDistribution}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={70}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {riskDistribution.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-col gap-2 mt-4 pt-4 border-t">
                  {riskDistribution.map((entry) => (
                    <div key={entry.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
                        <span className="text-sm text-muted-foreground">{entry.name}</span>
                      </div>
                      <span className="text-sm font-semibold">{entry.value}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Detailed Table */}
          <Card>
            <CardHeader>
              <CardTitle>Detailed Risk Scores</CardTitle>
              <CardDescription>Complete equipment risk assessment with explanations</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Equipment</TableHead>
                    <TableHead>Risk Score</TableHead>
                    <TableHead>Risk Level</TableHead>
                    <TableHead>Key Risk Drivers</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...riskScores]
                    .sort((a, b) => b.riskScore - a.riskScore)
                    .map((score) => {
                      const equip = equipment?.find(e => e.id === score.equipmentId);
                      return (
                        <TableRow key={score.equipmentId}>
                          <TableCell>
                            <div className="font-medium">{equip?.name || `Equipment ${score.equipmentId}`}</div>
                            <div className="text-xs text-muted-foreground">{equip?.equipmentId}</div>
                          </TableCell>
                          <TableCell>
                            <div className="text-lg font-bold">{score.riskScore}</div>
                          </TableCell>
                          <TableCell>
                            <RiskBadge score={score.riskScore} level={score.riskLevel} size="sm" />
                          </TableCell>
                          <TableCell>
                            <ul className="text-xs space-y-1">
                              {score.drivers.slice(0, 3).map((driver, idx) => (
                                <li key={idx} className="text-muted-foreground">• {driver}</li>
                              ))}
                            </ul>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">
                              {equip?.status || 'N/A'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {/* Empty State */}
      {riskScores.length === 0 && !batchScoreMutation.isPending && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-20">
            <Calculator className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Risk Scores Yet</h3>
            <p className="text-muted-foreground text-center mb-6">
              Click "Calculate All Risk Scores" to run the risk assessment model on your equipment fleet.
            </p>
            <Button onClick={handleCalculateAll} disabled={isLoading}>
              <Calculator className="mr-2 h-4 w-4" />
              Get Started
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}