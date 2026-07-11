import { useState, useMemo } from "react";

export type SortDir = "asc" | "desc";

export interface SortState {
  key: string | null;
  dir: SortDir;
}

export const PAGE_SIZE = 10;

export function useTable<T>(
  data: T[] | undefined,
  options?: {
    defaultSortKey?: string | null;
    defaultDir?: SortDir;
    getters?: Record<string, (row: T) => any>;
  }
) {
  const { defaultSortKey = null, defaultDir = "desc", getters = {} } = options ?? {};
  const [sort, setSort] = useState<SortState>({ key: defaultSortKey, dir: defaultDir });
  const [page, setPage] = useState(0);

  const onSort = (key: string) => {
    setSort(prev =>
      prev.key !== key
        ? { key, dir: "asc" }
        : { key, dir: prev.dir === "asc" ? "desc" : "asc" }
    );
    setPage(0);
  };

  const sorted = useMemo(() => {
    if (!data?.length) return data ?? [];
    if (!sort.key) return data;
    const key = sort.key;
    return [...data].sort((a, b) => {
      const av = getters[key] ? getters[key](a) : getByPath(a, key);
      const bv = getters[key] ? getters[key](b) : getByPath(b, key);
      const cmp = compareValues(av, bv);
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [data, sort]);

  const totalPages = Math.max(1, Math.ceil((sorted.length || 0) / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const rows = sorted.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  return {
    sort,
    onSort,
    page: safePage,
    setPage,
    rows,
    totalPages,
    total: sorted.length,
  };
}

function getByPath(obj: any, path: string): any {
  return path.split(".").reduce((o, k) => o?.[k], obj);
}

function compareValues(a: any, b: any): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = String(a);
  const sb = String(b);
  const da = Date.parse(sa);
  const db = Date.parse(sb);
  if (!isNaN(da) && !isNaN(db)) return da - db;
  return sa.localeCompare(sb);
}
