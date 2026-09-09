import type {
  DueFilterOperator,
  MasterFilterProperty,
  MasterFilterRule,
  Task
} from '../../../shared/home'

export function taskMatchesRules(task: Task, rules: readonly MasterFilterRule[]): boolean {
  return rules.every((rule) => {
    if (rule.property === 'context') return task.context === rule.value
    if (rule.property === 'status') return task.status === rule.value
    if (rule.property === 'priority') return task.priority === rule.value
    if (rule.operator === 'within') return task.due >= rule.from && task.due <= rule.to
    if (rule.operator === 'before') return task.due < rule.date
    if (rule.operator === 'on') return task.due === rule.date
    return task.due > rule.date
  })
}

export function filterTasks(
  tasks: readonly Task[],
  rules: readonly MasterFilterRule[]
): readonly Task[] {
  return tasks.filter((task) => taskMatchesRules(task, rules))
}

export function makeFilterRule(
  property: MasterFilterProperty,
  today: string,
  firstContext: string
): MasterFilterRule {
  const id = crypto.randomUUID()
  if (property === 'context') return { id, property, value: firstContext }
  if (property === 'status') return { id, property, value: 'Not started' }
  if (property === 'priority') return { id, property, value: 'Low' }
  return { id, property, operator: 'on', date: today }
}

export function changeRuleProperty(
  rule: MasterFilterRule,
  property: MasterFilterProperty,
  today: string,
  firstContext: string
): MasterFilterRule {
  return { ...makeFilterRule(property, today, firstContext), id: rule.id }
}

export function changeDueOperator(
  rule: Extract<MasterFilterRule, { property: 'due' }>,
  operator: DueFilterOperator,
  today: string
): Extract<MasterFilterRule, { property: 'due' }> {
  if (operator === 'within') {
    const date = rule.operator === 'within' ? rule.from : rule.date
    return { id: rule.id, property: 'due', operator, from: date, to: date }
  }
  const date = rule.operator === 'within' ? rule.from : rule.date
  return { id: rule.id, property: 'due', operator, date: date || today }
}
