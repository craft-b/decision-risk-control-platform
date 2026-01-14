import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AlertTriangle, Shield, AlertCircle } from "lucide-react";

interface RiskBadgeProps {
  score: number;
  level: "LOW" | "MEDIUM" | "HIGH";
  size?: "sm" | "md" | "lg";
  showIcon?: boolean;
}

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
        "font-semibold uppercase tracking-wider",
        sizeClasses[size],
        level === "LOW" && "bg-green-50 text-green-700 border-green-200",
        level === "MEDIUM" && "bg-yellow-50 text-yellow-700 border-yellow-200",
        level === "HIGH" && "bg-red-50 text-red-700 border-red-200"
      )}
    >
      {showIcon && <Icon className={cn("mr-1", iconSizes[size])} />}
      {level} ({score})
    </Badge>
  );
}