import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { PAGE_SIZE } from "@/hooks/use-table";
import { cn } from "@/lib/utils";

interface TablePaginationProps {
  page: number;
  totalPages: number;
  total: number;
  onPage: (p: number) => void;
  className?: string;
}

export function TablePagination({ page, totalPages, total, onPage, className }: TablePaginationProps) {
  if (totalPages <= 1 && total > 0) return null;

  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <div className={cn("flex items-center justify-between px-2 py-3 border-t text-sm", className)}>
      <span className="text-muted-foreground text-xs">
        {total === 0 ? "No results" : `${from}–${to} of ${total}`}
      </span>
      {totalPages > 1 && (
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={page === 0}
            onClick={() => onPage(0)}
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={page === 0}
            onClick={() => onPage(page - 1)}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="px-2 text-xs text-muted-foreground tabular-nums">
            {page + 1} / {totalPages}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={page >= totalPages - 1}
            onClick={() => onPage(page + 1)}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={page >= totalPages - 1}
            onClick={() => onPage(totalPages - 1)}
          >
            <ChevronsRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
