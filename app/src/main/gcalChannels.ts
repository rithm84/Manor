import type { BridgeChannelHandler } from './bridgeChannels'
import { GcalService } from './gcalService'
import type { GcalServiceConfig } from './gcalService'

function requireId(value: unknown, what: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new TypeError(`${what} must be a non-empty string`)
  }
  return value
}

function requireDates(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new TypeError('Calendar events need an array of YYYY-MM-DD dates')
  }
  return value as readonly string[]
}

export function createGcalChannels(config: GcalServiceConfig): Record<string, BridgeChannelHandler> {
  const service = new GcalService(config)
  return {
    'gcal:begin-connect': async () => service.beginConnect(),
    'gcal:complete-connect': async () => service.completeConnect(),
    'gcal:accounts': async () => service.accounts(),
    'gcal:calendars': async () => service.calendars(),
    'gcal:set-calendar-enabled': async (args) => {
      const calendarId = requireId(args[0], 'Calendar id')
      const accountId = requireId(args[1], 'Account id')
      if (typeof args[2] !== 'boolean') {
        throw new TypeError('Calendar enabled flag must be a boolean')
      }
      await service.setCalendarEnabled(calendarId, accountId, args[2])
      return null
    },
    'gcal:disconnect': async (args) => {
      await service.disconnect(requireId(args[0], 'Account id'))
      return null
    },
    'gcal:events-for': async (args) => service.eventsFor(requireDates(args[0]))
  }
}
