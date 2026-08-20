import { getTableColumns, getTableName, isTable } from "drizzle-orm";

export type TableCatalog = Record<string, string[]>;

/** SQL table name → sorted SQL column names, from a drizzle schema module. */
export function declaredTableCatalog(
  schema: Record<string, unknown>
): TableCatalog {
  const catalog: TableCatalog = {};
  for (const value of Object.values(schema)) {
    if (!isTable(value)) continue;
    const columns = Object.values(getTableColumns(value))
      .map((column) => column.name)
      .sort();
    catalog[getTableName(value)] = columns;
  }
  return catalog;
}

export function catalogTableNames(catalog: TableCatalog): string[] {
  return Object.keys(catalog).sort();
}
