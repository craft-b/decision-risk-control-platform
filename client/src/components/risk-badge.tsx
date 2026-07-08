import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AlertTriangle, Shield, AlertCircle } from "lucide-react";

interface RiskBadgeProps {
  score: number;
  level: "LOW" | "MEDIUM" | "HIGH";
  size?: "sm" | "md" | "lg";
  showIcon?: boolean;
}

// Semantic risk badge — colors come from the risk tokens (DESIGN_SPEC §5:
// HIGH/MEDIUM/LOW are the only saturated hues in the UI and appear nowhere else).
export function RiskBadge({ score, level, size = "md", showIcon = true }: RiskBadgeProps) {
  const sizeClasses = {
    sm: "text-[10px] px-1.5 py-0.5",
    md: "text-xs px-2 py-1",
    lg: "text-sm px-3 py-1.5",
  };

  const iconSizes = {
    sm: "h-3 w-3",
    md: "h-3.5 w-3.5",
    lg: "h-4 w-4",
  };

  const Icon = level === "LOW" ? Shield : level === "MEDIUM" ? AlertCircle : AlertTriangle;

  return (
    <Badge
      variant="outline"
      className={cn(
        "font-semibold uppercase tracking-wider tabular-nums",
        sizeClasses[size],
        level === "LOW" && "bg-risk-low-surface text-risk-low border-risk-low",
        level === "MEDIUM" && "bg-risk-medium-surface text-risk-medium border-risk-medium",
        level === "HIGH" && "bg-risk-high-surface text-risk-high border-risk-high"
      )}
    >
      {showIcon && <Icon className={cn("mr-1", iconSizes[size])} />}
      {level} ({score})
    </Badge>
  );
}
