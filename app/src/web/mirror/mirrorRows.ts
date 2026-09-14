import type { JsonObject, JsonValue, ManorTable, RowFilter } from '../ManorGateway'
import { tableOrder } from '../gatewayQueries'

/** Postgres orders text with the database collation, which is closest to an English dictionary order here. */
const collator = new Intl.Collator('en')

/** Postgres sorts ascending with nulls last, and a missing column in a stored row reads as a null. */
function compareValues(left: JsonValue | undefined, right: JsonValue | undefined): number {
  const a = left ?? null
  const b = right ?? null
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  return collator.compare(String(a), String(b))
}

/**
 * The mirror's answer to a read: the same equality filters and the same ascending key order the server
 * query applies, so a page cannot tell which side served it.
 */
export function selectMirrorRows(table: ManorTable, rows: readonly JsonObject[], filters: readonly RowFilter[]): JsonObject[] {
  const columns = tableOrder[table]
  return rows
    .filter((row) => filters.every((filter) => row[filter.column] === filter.value))
    .sort((left, right) => {
      for (const column of columns) {
        const order = compareValues(left[column], right[column])
        if (order !== 0) return order
      }
      return 0
    })
}
