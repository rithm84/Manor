import type { ReactNode } from 'react'
import type { ProblemRecord } from '../../../shared/problemLibrary'
import { Tooltip } from '../../components/ui'

/** Official difficulties use a soft fill; an inferred one keeps its hue with an outline and says so on hover. */
export function ProblemDifficulty({ problem }: { problem: Pick<ProblemRecord, 'difficulty' | 'sourceMetadata'> }): ReactNode {
  if (problem.difficulty === null) return <span className="problem-empty-value">Not specified</span>
  const className = `problem-difficulty is-${problem.difficulty.toLowerCase()}`
  if (problem.sourceMetadata?.difficultySource !== 'estimated') return <span className={className}>{problem.difficulty}</span>
  return <Tooltip label="Estimated difficulty" side="top"><span className={`${className} is-estimated`} aria-label={`${problem.difficulty}, estimated difficulty`}>{problem.difficulty}</span></Tooltip>
}
