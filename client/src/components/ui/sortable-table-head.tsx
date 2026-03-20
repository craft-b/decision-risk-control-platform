import { TableHead } from "@/components/ui/table";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SortState } from "@/hooks/use-table";

interface SortableTableHeadProps {
  sortKey: string;
  sort: SortState;
  onSort: (key: string) => void;
  children: React.ReactNode;
  className?: string;
  align?: "left" | "right";
}

export function SortableTableHead({
  sortKey,
  sort,
  onSort,
  children,
  className,
  align,
}: SortableTableHeadProps) {
  const isActive = sort.key === sortKey;

  return (
    <TableHead
      className={cn(
        "cursor-pointer select-none whitespace-nowrap",
        align === "right" && "text-right",
        className
      )}
      onClick={() => onSort(sortKey)}
    >
      <div className={cn("flex items-center gap-1", align === "right" && "justify-end")}>
        <span>{children}</span>
        {isActive ? (
          sort.dir === "asc" ? (
            <ChevronUp className="h-3.5 w-3.5 text-foreground/70 shrink-0" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-foreground/70 shrink-0" />
          )
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
        )}
      </div>
    </TableHead>
  );
}
