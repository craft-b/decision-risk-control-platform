import { useModelMetrics } from "@/hooks/use-predictive-maintenance";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
  Cell,
} from "recharts";
import {
  Activity,
  TrendingUp,
  Target,
  AlertCircle,
  CheckCircle2,
  Brain,
  Database,
  Zap,
  Loader2
} from "lucide-react";

export default function MLPerformanceDashboard() {
  const { data: modelMetrics, isLoading, error } = useModelMetrics();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-muted-foreground">Loading model metrics...</p>
        </div>
      </div>
    );
  }

  if (error || !modelMetrics) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Alert className="max-w-md border-red-200 bg-red-50">
          <AlertCircle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-800">
            Failed to load model metrics. Please try again later.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Prepare confusion matrix data for visualization
  const confusionData = [
    {
      actual: "HIGH",
      predictedHIGH: modelMetrics.confusionMatrix.HIGH.predictedHIGH,
      predictedMEDIUM: modelMetrics.confusionMatrix.HIGH.predictedMEDIUM,
      predictedLOW: modelMetrics.confusionMatrix.HIGH.predictedLOW,
    },
    {
      actual: "MEDIUM",
      predictedHIGH: modelMetrics.confusionMatrix.MEDIUM.predictedHIGH,
      predictedMEDIUM: modelMetrics.confusionMatrix.MEDIUM.predictedMEDIUM,
      predictedLOW: modelMetrics.confusionMatrix.MEDIUM.predictedLOW,
    },
    {
      actual: "LOW",
      predictedHIGH: modelMetrics.confusionMatrix.LOW.predictedHIGH,
      predictedMEDIUM: modelMetrics.confusionMatrix.LOW.predictedMEDIUM,
      predictedLOW: modelMetrics.confusionMatrix.LOW.predictedLOW,
    },
  ];

  // Calculate overall metrics
  const avgPrecision = (
    (modelMetrics.precision.HIGH + modelMetrics.precision.MEDIUM + modelMetrics.precision.LOW) / 3
  ).toFixed(3);
  
  const avgRecall = (
    (modelMetrics.recall.HIGH + modelMetrics.recall.MEDIUM + modelMetrics.recall.LOW) / 3
  ).toFixed(3);

  const avgF1 = (
    (modelMetrics.f1Score.HIGH + modelMetrics.f1Score.MEDIUM + modelMetrics.f1Score.LOW) / 3
  ).toFixed(3);

  // Class performance data
  const classPerformance = [
    { class: "HIGH", precision: modelMetrics.precision.HIGH, recall: modelMetrics.recall.HIGH, f1: modelMetrics.f1Score.HIGH },
    { class: "MEDIUM", precision: modelMetrics.precision.MEDIUM, recall: modelMetrics.recall.MEDIUM, f1: modelMetrics.f1Score.MEDIUM },
    { class: "LOW", precision: modelMetrics.precision.LOW, recall: modelMetrics.recall.LOW, f1: modelMetrics.f1Score.LOW },
  ];

  // Dynamic insight values
  const lowPrecision  = (modelMetrics.precision.LOW   * 100).toFixed(0);
  const lowRecall     = (modelMetrics.recall.LOW       * 100).toFixed(0);
  const highRecall    = (modelMetrics.recall.HIGH      * 100).toFixed(0);
  const mediumRecall  = (modelMetrics.recall.MEDIUM    * 100).toFixed(0);
  const topFeature    = modelMetrics.featureImportance[0]?.feature ?? 'Equipment Age';
  const secondFeature = modelMetrics.featureImportance[1]?.feature ?? 'Usage Hours';
  const topTwo        = (
    (modelMetrics.featureImportance[0]?.importance ?? 0) +
    (modelMetrics.featureImportance[1]?.importance ?? 0)
  ) * 100;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold tracking-tight">ML Model Performance</h2>
        <p className="text-muted-foreground">
          Predictive maintenance model evaluation and monitoring
        </p>
      </div>

      {/* Model Status Alert */}
      <Alert className="border-green-200 bg-green-50">
        <CheckCircle2 className="h-4 w-4 text-green-600" />
        <AlertDescription className="text-green-800">
          <strong>Model Status: Production</strong> • Last updated {new Date(modelMetrics.trainedAt).toLocaleDateString()} • 
          Overall accuracy: {(modelMetrics.accuracy * 100).toFixed(1)}%
        </AlertDescription>
      </Alert>

      {/* Key Metrics Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-l-4 border-l-blue-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Overall Accuracy</CardTitle>
            <Target className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {(modelMetrics.accuracy * 100).toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">
              Correct predictions across all classes
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-green-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Precision</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {(parseFloat(avgPrecision) * 100).toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">
              Positive prediction accuracy
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-purple-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Recall</CardTitle>
            <Activity className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">
              {(parseFloat(avgRecall) * 100).toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">
              Actual positive capture rate
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-orange-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg F1 Score</CardTitle>
            <Zap className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              {(parseFloat(avgF1) * 100).toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">
              Harmonic mean of precision & recall
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 1: Feature Importance & Class Performance */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Feature Importance</CardTitle>
            <CardDescription>
              Which features drive failure predictions (higher = more influential)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[350px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={modelMetrics.featureImportance} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={true} vertical={false} />
                  <XAxis type="number" domain={[0, 0.3]} tickFormatter={(value) => `${(value * 100).toFixed(0)}%`} />
                  <YAxis type="category" dataKey="feature" width={150} fontSize={12} />
                  <Tooltip
                    formatter={(value: number) => `${(value * 100).toFixed(1)}%`}
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Bar dataKey="importance" radius={[0, 4, 4, 0]}>
                    {modelMetrics.featureImportance.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={`hsl(${220 - index * 20}, 70%, 50%)`} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 space-y-2 text-xs text-muted-foreground">
              {modelMetrics.featureImportance.slice(0, 3).map((feat, idx) => (
                <div key={idx}>
                  <strong>{feat.feature}:</strong> {feat.description}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Per-Class Performance</CardTitle>
            <CardDescription>
              Precision, recall, and F1 score by risk level
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[350px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={classPerformance}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="class" />
                  <YAxis domain={[0, 1]} tickFormatter={(value) => `${(value * 100).toFixed(0)}%`} />
                  <Tooltip
                    formatter={(value: number) => `${(value * 100).toFixed(1)}%`}
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Legend />
                  <Bar dataKey="precision" fill="#3b82f6" name="Precision" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="recall" fill="#10b981" name="Recall" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="f1" fill="#8b5cf6" name="F1 Score" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-4 text-center text-xs">
              <div>
                <div className="font-medium">Precision</div>
                <div className="text-muted-foreground">Predicted positive accuracy</div>
              </div>
              <div>
                <div className="font-medium">Recall</div>
                <div className="text-muted-foreground">Actual positive capture</div>
              </div>
              <div>
                <div className="font-medium">F1 Score</div>
                <div className="text-muted-foreground">Balanced performance</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2: Confusion Matrix & Prediction History */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Confusion Matrix</CardTitle>
            <CardDescription>
              Actual vs predicted classifications (test set)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="p-3 text-left text-xs font-medium text-muted-foreground">Actual \ Predicted</th>
                      <th className="p-3 text-center text-xs font-medium text-red-700">HIGH</th>
                      <th className="p-3 text-center text-xs font-medium text-orange-700">MEDIUM</th>
                      <th className="p-3 text-center text-xs font-medium text-green-700">LOW</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {confusionData.map((row, idx) => (
                      <tr key={idx}>
                        <td className={`p-3 text-sm font-medium ${
                          row.actual === 'HIGH' ? 'text-red-700' :
                          row.actual === 'MEDIUM' ? 'text-orange-700' :
                          'text-green-700'
                        }`}>
                          {row.actual}
                        </td>
                        <td className={`p-3 text-center text-sm font-bold ${row.actual === 'HIGH' ? 'bg-red-50' : ''}`}>
                          {row.predictedHIGH}
                        </td>
                        <td className={`p-3 text-center text-sm font-bold ${row.actual === 'MEDIUM' ? 'bg-orange-50' : ''}`}>
                          {row.predictedMEDIUM}
                        </td>
                        <td className={`p-3 text-center text-sm font-bold ${row.actual === 'LOW' ? 'bg-green-50' : ''}`}>
                          {row.predictedLOW}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5" />
                  <div><strong>Diagonal values</strong> (highlighted) represent correct predictions</div>
                </div>
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-orange-600 mt-0.5" />
                  <div><strong>Off-diagonal values</strong> show misclassifications - lower is better</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Prediction Distribution Over Time</CardTitle>
            <CardDescription>
              Monthly breakdown of risk classifications
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={modelMetrics.predictionHistory}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="high" stroke="#ef4444" strokeWidth={2} name="High Risk" />
                  <Line type="monotone" dataKey="medium" stroke="#f97316" strokeWidth={2} name="Medium Risk" />
                  <Line type="monotone" dataKey="low" stroke="#22c55e" strokeWidth={2} name="Low Risk" />
                  <Line type="monotone" dataKey="total" stroke="#64748b" strokeWidth={2} strokeDasharray="5 5" name="Total" />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 text-xs text-muted-foreground">
              Shows the distribution of risk predictions across the fleet over time. 
              Trends can indicate seasonal patterns or fleet aging effects.
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Model Metadata */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-blue-600" />
              <CardTitle>Model Information</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between items-center pb-3 border-b">
                <span className="text-sm text-muted-foreground">Model Version</span>
                <Badge variant="outline" className="bg-blue-50 text-blue-700">
                  {modelMetrics.version}
                </Badge>
              </div>
              <div className="flex justify-between items-center pb-3 border-b">
                <span className="text-sm text-muted-foreground">Algorithm</span>
                <span className="text-sm font-medium">{modelMetrics.hyperparameters.algorithm}</span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b">
                <span className="text-sm text-muted-foreground">Training Date</span>
                <span className="text-sm font-medium">
                  {new Date(modelMetrics.trainedAt).toLocaleDateString()}
                </span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b">
                <span className="text-sm text-muted-foreground">Training Dataset Size</span>
                <span className="text-sm font-medium">{modelMetrics.datasetSize.toLocaleString()} samples</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Status</span>
                <Badge className="bg-green-100 text-green-800 border-green-300">Production</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-purple-600" />
              <CardTitle>Hyperparameters</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between items-center pb-3 border-b">
                <span className="text-sm text-muted-foreground">Number of Estimators</span>
                <span className="text-sm font-mono font-medium">{modelMetrics.hyperparameters.nEstimators}</span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b">
                <span className="text-sm text-muted-foreground">Max Depth</span>
                <span className="text-sm font-mono font-medium">{modelMetrics.hyperparameters.maxDepth}</span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b">
                <span className="text-sm text-muted-foreground">Min Samples Split</span>
                <span className="text-sm font-mono font-medium">{modelMetrics.hyperparameters.minSamplesSplit}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Class Weight</span>
                <span className="text-sm font-mono font-medium">{modelMetrics.hyperparameters.classWeight}</span>
              </div>
            </div>
            <div className="mt-4 p-3 bg-slate-50 rounded-lg text-xs text-muted-foreground">
              <strong>Note:</strong> Class weights are balanced to handle imbalanced training data and 
              prevent bias toward majority classes.
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Key Insights */}
      <Card className="border-blue-200 bg-blue-50">
        <CardHeader>
          <CardTitle className="text-blue-900">Key Model Insights</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-blue-900">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div>
              <strong>Strong LOW risk detection:</strong> {lowPrecision}% precision and {lowRecall}% recall
              indicates reliable identification of equipment in good condition, minimizing unnecessary maintenance.
            </div>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div>
              <strong>High recall for HIGH risk ({highRecall}%):</strong> The model successfully catches most
              critical failure cases, which is crucial for safety and preventing downtime.
            </div>
          </div>
          <div className="flex items-start gap-2">
            {parseFloat(mediumRecall) >= 80
              ? <CheckCircle2 className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
              : <AlertCircle  className="h-5 w-5 text-orange-600 mt-0.5 flex-shrink-0" />
            }
            <div>
              <strong>MEDIUM class recall ({mediumRecall}%):</strong>{" "}
              {parseFloat(mediumRecall) >= 80
                ? "Good coverage of medium-risk equipment across the fleet."
                : "Some MEDIUM risk equipment may be misclassified. Consider collecting more training data in this range."
              }
            </div>
          </div>
          <div className="flex items-start gap-2">
            <TrendingUp className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div>
              <strong>Top predictive features:</strong> {topFeature} and {secondFeature} contribute{" "}
              {topTwo.toFixed(0)}% of prediction power, validating the importance of these maintenance factors.
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}