import { Table, TableBody, TableCell, TableHead, TableRow } from "@mui/material";
import { type ReactNode } from "react";
import { EmptyState } from "./EmptyState";

/**
 * DataTable — a thin, typed wrapper over the themed MUI Table. Define columns
 * with explicit `render` functions (no implicit `any` row indexing) and pass a
 * `getRowKey`. For ad-hoc tables, use the re-exported Table primitives directly.
 */
export interface DataColumn<T> {
  readonly key: string;
  readonly header: ReactNode;
  readonly render: (row: T) => ReactNode;
  readonly align?: "left" | "right" | "center";
  readonly width?: number | string;
}

export interface DataTableProps<T> {
  readonly columns: ReadonlyArray<DataColumn<T>>;
  readonly rows: readonly T[];
  readonly getRowKey: (row: T, index: number) => string;
  readonly emptyMessage?: ReactNode;
}

export function DataTable<T>({ columns, rows, getRowKey, emptyMessage = "No rows" }: DataTableProps<T>) {
  if (rows.length === 0) {
    return <EmptyState title={emptyMessage} />;
  }

  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          {columns.map((column) => (
            <TableCell key={column.key} align={column.align} sx={{ width: column.width }}>
              {column.header}
            </TableCell>
          ))}
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={getRowKey(row, index)} hover>
            {columns.map((column) => (
              <TableCell key={column.key} align={column.align}>
                {column.render(row)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
