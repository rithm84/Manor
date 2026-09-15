// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { isCreateShortcut, isSidebarShortcut, isTypingTarget, routeForShortcut } from './shortcuts'

function press(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', init)
}

describe('global shortcuts', () => {
  it('maps Cmd+1 through Cmd+9 to the sidebar pages in order and ignores other digits', () => {
    expect(routeForShortcut(press({ key: '1', code: 'Digit1', metaKey: true }))).toBe('/home')
    expect(routeForShortcut(press({ key: '4', code: 'Digit4', metaKey: true }))).toBe('/pomodoro')
    expect(routeForShortcut(press({ key: '9', code: 'Digit9', ctrlKey: true }))).toBe('/bookmarks')
    expect(routeForShortcut(press({ key: '0', code: 'Digit0', metaKey: true }))).toBeNull()
    expect(routeForShortcut(press({ key: '1', code: 'Digit1' }))).toBeNull()
    expect(routeForShortcut(press({ key: '1', code: 'Digit1', metaKey: true, shiftKey: true }))).toBeNull()
  })

  it('recognises Cmd+\\ and Cmd+N without Option or Shift', () => {
    expect(isSidebarShortcut(press({ key: '\\', code: 'Backslash', metaKey: true }))).toBe(true)
    expect(isSidebarShortcut(press({ key: '\\', code: 'Backslash' }))).toBe(false)
    expect(isCreateShortcut(press({ key: 'n', code: 'KeyN', metaKey: true }))).toBe(true)
    expect(isCreateShortcut(press({ key: 'N', code: 'KeyN', metaKey: true, shiftKey: true }))).toBe(false)
    expect(isCreateShortcut(press({ key: 'n', code: 'KeyN', metaKey: true, altKey: true }))).toBe(false)
  })

  it('treats fields and editors as typing targets', () => {
    const input = document.createElement('input')
    const editor = document.createElement('div')
    editor.contentEditable = 'true'
    document.body.append(editor)
    expect(isTypingTarget(input)).toBe(true)
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true)
    expect(isTypingTarget(editor)).toBe(true)
    expect(isTypingTarget(document.createElement('button'))).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
    editor.remove()
  })
})
