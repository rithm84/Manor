import type { JobsSeed } from '../../../../shared/jobs'
import { jobRoles, jobTransitions, TODAY_ISO } from '../../data/mock'

export function createJobsSeed(): JobsSeed {
  return {
    today: TODAY_ISO,
    roles: jobRoles,
    transitions: jobTransitions
  }
}
