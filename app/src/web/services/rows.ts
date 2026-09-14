import { dateInTimezone } from '../../shared/timezone'
import { z } from 'zod'
import { ManorRequestError } from '../ManorGateway'
import type { CommandResult, JsonObject, JsonValue, ManorGateway } from '../ManorGateway'
import type { DerivedName } from '../mirror/MirrorStore'

export const revisionSchema = z.number().int().positive()

export function camelRow(row: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), value]))
}

export function commandRecord(result: CommandResult): JsonObject {
  if (result.record === null || result.record === undefined) throw new Error(`${result.operation} returned no committed record`)
  return result.record
}

export function rowRevision(row: JsonObject): number {
  return revisionSchema.parse(row.revision)
}

/**
 * An account-derived RPC read. It depends only on account data and the current day, so the mirror can
 * serve it from the value it cached under the cursor and day it was computed for.
 */
export function derivedRead(gateway: ManorGateway, name: DerivedName, label: string): Promise<JsonValue> {
  return gateway.cachedDerived(name, async () => {
    const { data, error } = await gateway.client.rpc(name)
    if (error !== null) throw new ManorRequestError(label, error.code, error.message)
    return z.json().parse(data)
  })
}

export async function accountToday(gateway: ManorGateway): Promise<{ today: string; timezone: string }> {
  const profiles = await gateway.rows('profiles')
  if (profiles.length !== 1) throw new Error('The account profile is missing. Complete account setup before opening Manor.')
  const timezone = z.string().min(1).parse(profiles[0].timezone)
  const today = dateInTimezone(new Date(), timezone)
  return { today, timezone }
}
