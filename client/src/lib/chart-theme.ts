// Shared Recharts theme — the single source of chart styling (DESIGN_SPEC §5).
//
// Rules encoded here:
//  - Data hues come from validated CSS variables (--chart-1..3), so light and
//    dark mode each get their own validated steps automatically.
//  - Categorical hues are assigned in FIXED order, never cycled. A chart with
//    one measure uses CHART.data — a single hue, not a rainbow.
//  - Risk colors are semantic-only and shared with the badge/token system.
//  - Grid and axes are recessive (≈40% neutral); marks are thin (2px lines,
//    4px rounded bar data-ends); tooltips wear card tokens.
import type { CSSProperties } from "react";

export const CHART = {
  /** Single-series data hue (magnitude / trend charts) */
  data: "hsl(var(--chart-1))",
  /** Fixed categorical order for multi-measure charts — never cycle */
  categorical: [
    "hsl(var(--chart-1))",
    "hsl(var(--chart-2))",
    "hsl(var(--chart-3))",
  ],
  /** Semantic risk (status) colors — reserved, never used as "series 4" */
  risk: {
    high: "hsl(var(--risk-high))",
    medium: "hsl(var(--risk-medium))",
    low: "hsl(var(--risk-low))",
  },
  /** Recessive neutral for totals / reference series */
  neutral: "hsl(var(--muted-foreground))",

  grid: {
    stroke: "hsl(var(--chart-grid) / 0.25)",
    strokeDasharray: "3 3",
  },
  axis: {
    stroke: "hsl(var(--chart-grid) / 0.4)",
    fontSize: 11,
    tick: { fill: "hsl(var(--chart-axis))", fontSize: 11 },
  },

  /** Mark specs */
  barRadius: [4, 4, 0, 0] as [number, number, number, number],
  barRadiusHorizontal: [0, 4, 4, 0] as [number, number, number, number],
  line: { strokeWidth: 2, dot: false as const, activeDot: { r: 4 } },

  /** Tooltip = card tokens */
  tooltip: {
    contentStyle: {
      backgroundColor: "hsl(var(--popover))",
      color: "hsl(var(--popover-foreground))",
      border: "1px solid hsl(var(--border))",
      borderRadius: "8px",
      boxShadow: "0 4px 12px -2px rgb(0 0 0 / 0.12)",
      fontSize: "12px",
      fontFamily: "var(--font-mono)",
    } satisfies CSSProperties,
    labelStyle: {
      color: "hsl(var(--muted-foreground))",
      fontFamily: "var(--font-sans)",
      fontWeight: 500,
      marginBottom: 4,
    } satisfies CSSProperties,
    cursor: { fill: "hsl(var(--muted) / 0.6)" },
  },
};

/** $1,234 / $12.3k axis + tooltip money formatting */
export const fmtMoney = (v: number) =>
  `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export const fmtMoneyCompact = (v: number) =>
  v >= 1000 ? `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `$${v}`;
