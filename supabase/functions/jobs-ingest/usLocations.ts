/* Whether a SimplifyJobs location string names somewhere in the United
   States. The source mixes formats: "San Jose, CA", bare "NYC", "United
   States", "Remote in USA", and foreign entries like "Toronto, ON, Canada"
   or "London, UK". Anything not recognised as US is treated as foreign, so
   a new format shows up as a missing row rather than a wrong one. */

const STATE_CODES: ReadonlySet<string> = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL',
  'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT',
  'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI',
  'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'PR', 'VI', 'GU', 'AS', 'MP'
])

const STATE_NAMES: ReadonlySet<string> = new Set([
  'ALABAMA', 'ALASKA', 'ARIZONA', 'ARKANSAS', 'CALIFORNIA', 'COLORADO',
  'CONNECTICUT', 'DELAWARE', 'FLORIDA', 'GEORGIA', 'HAWAII', 'IDAHO',
  'ILLINOIS', 'INDIANA', 'IOWA', 'KANSAS', 'KENTUCKY', 'LOUISIANA', 'MAINE',
  'MARYLAND', 'MASSACHUSETTS', 'MICHIGAN', 'MINNESOTA', 'MISSISSIPPI',
  'MISSOURI', 'MONTANA', 'NEBRASKA', 'NEVADA', 'NEW HAMPSHIRE', 'NEW JERSEY',
  'NEW MEXICO', 'NEW YORK', 'NORTH CAROLINA', 'NORTH DAKOTA', 'OHIO',
  'OKLAHOMA', 'OREGON', 'PENNSYLVANIA', 'RHODE ISLAND', 'SOUTH CAROLINA',
  'SOUTH DAKOTA', 'TENNESSEE', 'TEXAS', 'UTAH', 'VERMONT', 'VIRGINIA',
  'WASHINGTON', 'WEST VIRGINIA', 'WISCONSIN', 'WYOMING', 'PUERTO RICO',
  'WASHINGTON DC'
])

/** City shorthands the source uses without a state. */
const US_SHORTHANDS: ReadonlySet<string> = new Set([
  'NYC', 'SF', 'SOUTH SF', 'LA', 'SFO', 'DC', 'BAY AREA'
])

/** Names that appear as a whole word and settle it on their own. */
const US_WORDS: ReadonlySet<string> = new Set(['US', 'USA', 'U.S.', 'U.S.A.'])

export function isUnitedStatesLocation(location: string): boolean {
  const text = location.trim()
  if (text === '') return false
  const upper = text.toUpperCase()
  if (US_SHORTHANDS.has(upper) || STATE_NAMES.has(upper)) return true
  if (upper.includes('UNITED STATES')) return true
  // "Remote in US", "Remote in USA": a standalone US token anywhere.
  for (const word of upper.split(/[\s,]+/)) {
    if (US_WORDS.has(word)) return true
  }
  const parts = upper.split(',').map((part) => part.trim())
  const last = parts[parts.length - 1]
  if (parts.length >= 2 && (STATE_CODES.has(last) || STATE_NAMES.has(last))) return true
  return false
}

/** A listing counts as US when any one of its locations is. */
export function hasUnitedStatesLocation(locations: readonly string[]): boolean {
  return locations.some((location) => isUnitedStatesLocation(location))
}

/** The repo's own hardware buckets, which Manor does not track. */
export function isHardwareCategory(category: string): boolean {
  return category.trim().toUpperCase().startsWith('HARDWARE')
}
