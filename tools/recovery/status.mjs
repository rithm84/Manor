import { z } from 'zod'
import { command, commandOptions, required } from './common.mjs'
required('RESTIC_REPOSITORY'); required('RESTIC_PASSWORD_FILE')
const snapshots = z.array(z.object({ id: z.string(), time: z.iso.datetime({ offset: true }) })).parse(JSON.parse(await command('restic', ['snapshots', '--host', 'manor-recovery', '--tag', 'manor-daily', '--json'], commandOptions())))
const latest = snapshots.sort((a,b) => b.time.localeCompare(a.time))[0]
if (!latest) throw new Error('No verified Manor recovery snapshot exists')
const ageHours = (Date.now() - Date.parse(latest.time)) / 3600000
if (ageHours > 30) throw new Error(`Latest Manor file backup is ${ageHours.toFixed(1)} hours old; daily recovery target missed`)
console.log(JSON.stringify({ event: 'manor_backup_current', snapshot: latest.id, ageHours: Math.round(ageHours * 10) / 10 }))
