import { useEffect, useRef, useState } from 'react'
import type { ReactElement, ReactNode, RefObject, SVGProps } from 'react'
import {
  Sankey,
  Tooltip
} from 'recharts'
import type { SankeyLinkProps, SankeyNodeProps } from 'recharts'

import type { JobStageTransition, JobStage } from '../../../../shared/jobs'
import { EmptyState } from '../../components/ui'
import { jobFlowData, jobStageOptions, stageLabel } from './jobsModel'

interface StageTone {
  strong: string
  tint: string
}

interface ChartSize {
  width: number
  height: number
}

interface FlowNodeProps extends SankeyNodeProps {
  chartWidth: number
}

const STAGE_TONES: Readonly<Record<JobStage, StageTone>> = {
  to_apply: { strong: '#6e6975', tint: '#f5f4f1' },
  applied: { strong: '#3d7a52', tint: '#e6f2ea' },
  oa: { strong: '#8f6a0e', tint: '#f8efd8' },
  interview_1: { strong: '#6f5680', tint: '#efe9f4' },
  interview_2: { strong: '#6f5680', tint: '#efe9f4' },
  interview_3: { strong: '#6f5680', tint: '#efe9f4' },
  offer: { strong: '#3d7a52', tint: '#e6f2ea' },
  rejected: { strong: '#b0434b', tint: '#f9e6e7' }
}

export interface JobsFlowProps {
  transitions: readonly JobStageTransition[]
}

function stageFromName(name: string): JobStage {
  const option = jobStageOptions.find((candidate) => candidate.label === name)
  if (option === undefined) {
    throw new Error(`Jobs Sankey node ${name} has no stage mapping`)
  }
  return option.value
}

function FlowNode({ x, y, width, height, payload, chartWidth }: FlowNodeProps): ReactNode {
  const stage = stageFromName(payload.name)
  const tone = STAGE_TONES[stage]
  const rightEdge = x + width
  const alignRight = rightEdge + 88 > chartWidth
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={3} fill={tone.strong} />
      <text
        x={alignRight ? x - 8 : rightEdge + 8}
        y={y + height / 2 - 2}
        textAnchor={alignRight ? 'end' : 'start'}
        fill="var(--ink)"
        fontSize={12}
        fontWeight={600}
      >
        {payload.name}
      </text>
      <text
        x={alignRight ? x - 8 : rightEdge + 8}
        y={y + height / 2 + 13}
        textAnchor={alignRight ? 'end' : 'start'}
        fill="var(--ink-muted)"
        fontSize={12}
      >
        {payload.value} moved
      </text>
    </g>
  )
}

function useChartSize(): {
  chartRef: RefObject<HTMLDivElement | null>
  size: ChartSize | null
} {
  const chartRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState<ChartSize | null>(null)

  useEffect(() => {
    const chart = chartRef.current
    if (chart === null) return

    const measure = (): void => {
      const next = {
        width: Math.floor(chart.clientWidth),
        height: Math.floor(chart.clientHeight)
      }
      if (next.width <= 0 || next.height <= 0) return
      setSize((current) =>
        current?.width === next.width && current.height === next.height ? current : next
      )
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(chart)
    return (): void => observer.disconnect()
  }, [])

  return { chartRef, size }
}

function FlowLink({
  sourceX,
  targetX,
  sourceY,
  targetY,
  sourceControlX,
  targetControlX,
  sourceRelativeY,
  targetRelativeY,
  linkWidth,
  payload
}: SankeyLinkProps): ReactElement<SVGProps<SVGPathElement>> {
  const targetStage = stageFromName(payload.target.name)
  const tone = STAGE_TONES[targetStage]
  const sourcePoint = sourceY + sourceRelativeY
  const targetPoint = targetY + targetRelativeY
  return (
    <path
      d={`M${sourceX},${sourcePoint} C${sourceControlX},${sourcePoint} ${targetControlX},${targetPoint} ${targetX},${targetPoint}`}
      fill="none"
      stroke={tone.strong}
      strokeOpacity={0.28}
      strokeWidth={Math.max(1, linkWidth)}
    />
  )
}

export function JobsFlow({ transitions }: JobsFlowProps): ReactNode {
  const { chartRef, size } = useChartSize()
  const flow = jobFlowData(transitions)
  if (flow.links.length === 0) {
    return (
      <div className="jobs-flow-empty">
        <EmptyState
          icon={null}
          title="No pipeline movement yet"
          message="Advance an applied role to build the flow."
        />
      </div>
    )
  }

  const chartData = {
    nodes: flow.nodes.map((node) => ({ ...node })),
    links: flow.links.map((link) => ({
      source: link.source,
      target: link.target,
      value: link.value
    }))
  }
  const horizontalMargin = size === null
    ? 80
    : Math.min(104, Math.max(72, Math.round(size.width * 0.1)))

  return (
    <div className="jobs-flow">
      <div ref={chartRef} className="jobs-flow-chart" role="img" aria-label="Application stage flow" aria-describedby="jobs-flow-summary">
        {size !== null ? (
          <Sankey
            accessibilityLayer
            width={size.width}
            height={size.height}
            data={chartData}
            node={(props) => <FlowNode {...props} chartWidth={size.width} />}
            link={FlowLink}
            nodePadding={size.height < 300 ? 18 : 28}
            nodeWidth={12}
            margin={{ top: 22, right: horizontalMargin, bottom: 22, left: horizontalMargin }}
          >
            <Tooltip
              contentStyle={{
                background: 'var(--surface-card)',
                border: '1px solid var(--hairline)',
                borderRadius: 8,
                boxShadow: 'var(--shadow-overlay)',
                color: 'var(--ink-body)',
                fontSize: 12
              }}
            />
          </Sankey>
        ) : null}
      </div>
      <div id="jobs-flow-summary" className="jobs-flow-a11y">
        <p>Application stage changes</p>
        <ul>
          {flow.links.map((link) => (
            <li key={`${link.sourceStage}-${link.targetStage}`}>
              {stageLabel(link.sourceStage)} to {stageLabel(link.targetStage)}: {link.value} {link.value === 1 ? 'role' : 'roles'}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
