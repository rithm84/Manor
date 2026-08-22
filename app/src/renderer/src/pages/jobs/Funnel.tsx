import { ChevronRight } from 'lucide-react'
import { Fragment } from 'react'
import type { ReactNode } from 'react'

import type { JobsFunnel } from '../../data/mock'

export interface FunnelProps {
  funnel: JobsFunnel
}

interface FunnelStep {
  key: 'applied' | 'oa' | 'interview' | 'offer'
  label: string
  value: number
}

function pluralize(value: number, singular: string, plural: string): string {
  return value === 1 ? singular : plural
}

/** The season at a glance: counts with slim proportional underlines. */
export function Funnel({ funnel }: FunnelProps): ReactNode {
  const steps: readonly FunnelStep[] = [
    { key: 'applied', label: 'Applied', value: funnel.applied },
    { key: 'oa', label: pluralize(funnel.oa, 'OA', 'OAs'), value: funnel.oa },
    {
      key: 'interview',
      label: pluralize(funnel.interview, 'Interview', 'Interviews'),
      value: funnel.interview
    },
    { key: 'offer', label: pluralize(funnel.offer, 'Offer', 'Offers'), value: funnel.offer }
  ]
  const max = Math.max(funnel.applied, 1)

  return (
    <div className="funnel" aria-label="Application funnel">
      {steps.map((step, index) => (
        <Fragment key={step.key}>
          {index > 0 ? <ChevronRight size={12} className="funnel-sep" /> : null}
          <div className={`funnel-step funnel-step--${step.key}`}>
            <span className="funnel-top">
              <span className="funnel-num">{step.value}</span>
              <span className="funnel-label">{step.label}</span>
            </span>
            <span className="funnel-bar">
              <span
                className="funnel-fill"
                style={{ width: `${Math.max((step.value / max) * 100, 4)}%` }}
              />
            </span>
          </div>
        </Fragment>
      ))}
    </div>
  )
}
