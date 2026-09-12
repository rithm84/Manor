import { Select as BaseSelect } from '@base-ui/react/select'
import { Check, ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { Pill } from './Pill'
import type { PillColorway } from './Pill'

export interface SelectOption { value: string; label: string; leading?: ReactNode; tone?: PillColorway }
export interface SelectProps { value: string | null; options: readonly SelectOption[]; onChange: (value: string) => void; placeholder: string; ariaLabel: string }

function label(option: SelectOption): ReactNode {
  return option.tone === undefined
    ? <span className="ui-select-option-label">{option.leading}<span>{option.label}</span></span>
    : <Pill variant="tag" colorway={option.tone} label={option.label} icon={option.leading} />
}

/** Keyboard/typeahead selection with portal-aware focus and collision handling. */
export function Select({ value, options, onChange, placeholder, ariaLabel }: SelectProps): ReactNode {
  const selected = options.find(option => option.value === value)
  return <BaseSelect.Root value={value} items={options} onValueChange={(next) => { if (next !== null) onChange(next) }}>
    <BaseSelect.Trigger className="ui-select-trigger" aria-label={selected ? `${ariaLabel}: ${selected.label}` : ariaLabel}>
      {selected ? label(selected) : <span className="ui-select-placeholder">{placeholder}</span>}
      <BaseSelect.Icon><ChevronDown size={14} /></BaseSelect.Icon>
    </BaseSelect.Trigger>
    <BaseSelect.Portal>
      <BaseSelect.Positioner className="ui-popover-positioner" sideOffset={6} align="start" alignItemWithTrigger={false}>
        <BaseSelect.Popup className="ui-select-menu" aria-label={ariaLabel}>
          <BaseSelect.List>
            {options.map(option => <BaseSelect.Item key={option.value} value={option.value} className="ui-select-option">
              <BaseSelect.ItemText>{label(option)}</BaseSelect.ItemText>
              <BaseSelect.ItemIndicator className="ui-option-check"><Check size={14} /></BaseSelect.ItemIndicator>
            </BaseSelect.Item>)}
          </BaseSelect.List>
        </BaseSelect.Popup>
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  </BaseSelect.Root>
}
