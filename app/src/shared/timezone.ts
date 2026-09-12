/** Date and wall-clock labels follow the saved account timezone. */
export function dateInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes): string => {
    const value = parts.find((item) => item.type === type)?.value
    if (value === undefined) throw new Error(`Date formatter omitted ${type}`)
    return value
  }
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function timeInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
}
