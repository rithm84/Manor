import { Flame, Smartphone, TrendingDown, Utensils } from 'lucide-react'
import type { ReactNode } from 'react'

import { EmptyState } from '../components/ui'
import {
  calorieTargetDeficit,
  calorieWeek,
  calorieWeekAvgIn,
  fitnessIngestion,
  muscleGroups
} from '../data/mock'
import { CalorieBars } from './fitness/CalorieBars'
import { MuscleWeek } from './fitness/MuscleWeek'
import './fitness/fitness.css'

/** "Last clip processed 11:42 PM" -> product voice, keeping the mock's time. */
function phoneUpdateLabel(raw: string): string {
  return raw.replace('Last clip processed', 'Updated from your phone at')
}

interface StatTile {
  label: string
  value: string
  icon: ReactNode
  tone: 'in' | 'out' | 'deficit'
}

export function FitnessPage(): ReactNode {
  if (calorieWeek.length === 0) {
    return (
      <div className="fitness">
        <h1 className="page-title">Fitness</h1>
        <EmptyState
          icon={<Smartphone size={20} />}
          title="Waiting on the first night"
          message="Calories and workouts arrive from your phone while you sleep. Tomorrow morning this page fills in."
        />
      </div>
    )
  }

  const yesterday = calorieWeek[calorieWeek.length - 1]
  const hitCount = muscleGroups.filter((group) => group.hitThisWeek).length
  const tiles: readonly StatTile[] = [
    {
      label: 'Calories in',
      value: yesterday.caloriesIn.toLocaleString('en-US'),
      icon: <Utensils size={15} />,
      tone: 'in'
    },
    {
      label: 'Calories out',
      value: yesterday.caloriesOut.toLocaleString('en-US'),
      icon: <Flame size={15} />,
      tone: 'out'
    },
    {
      label: 'Deficit',
      value: calorieTargetDeficit.toLocaleString('en-US'),
      icon: <TrendingDown size={15} />,
      tone: 'deficit'
    }
  ]

  return (
    <div className="fitness">
      <header className="fitness-header">
        <h1 className="page-title">Fitness</h1>
        <span className="fitness-status">
          <Smartphone size={13} />
          {phoneUpdateLabel(fitnessIngestion.lastProcessedLabel)}
        </span>
      </header>

      <section className="fitness-section">
        <h2 className="fitness-section-title">Yesterday</h2>
        <div className="fitness-tiles">
          {tiles.map((tile) => (
            <div key={tile.label} className={`fitness-tile ui-card is-${tile.tone}`}>
              <span className="fitness-tile-label">
                {tile.icon}
                {tile.label}
              </span>
              <span className="fitness-tile-value tnum">{tile.value}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="fitness-grid">
        <section className="fitness-panel ui-card">
          <h2 className="fitness-section-title">The last seven days</h2>
          <CalorieBars days={calorieWeek} averageIn={calorieWeekAvgIn} />
        </section>

        <section className="fitness-panel ui-card">
          <div className="fitness-panel-head">
            <h2 className="fitness-section-title">Muscle groups</h2>
            <span className="fitness-panel-sub tnum">
              {hitCount} of {muscleGroups.length} this week
            </span>
          </div>
          <MuscleWeek groups={muscleGroups} />
        </section>
      </div>
    </div>
  )
}
