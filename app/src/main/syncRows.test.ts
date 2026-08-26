import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { HomeState } from '../shared/home'
import type { MoodFocusEntry } from '../shared/moodFocus'
import { HomeStore } from './homeStore'
import { HabitStore } from './habitStore'
import type { HabitSyncState } from './habitStore'
import { JobStore } from './jobStore'
import type { JobsSyncState } from './jobStore'
import { LeetCodeStore } from './leetCodeStore'
import type { LeetCodeSyncState } from './leetCodeStore'
import { MoodFocusStore } from './moodFocusStore'
import { NotesStore } from './notesStore'
import type { NotesState } from '../shared/notes'
import {
  habitRowsOf,
  habitSyncStateOf,
  homeRowsOf,
  homeStateOf,
  jobsRowsOf,
  jobsSyncStateOf,
  leetCodeRowsOf,
  leetCodeSyncStateOf,
  moodFocusEntriesOf,
  moodFocusRowsOf,
  notesRowsOf,
  notesStateOf
} from './syncRows'

const USER_ID = '120c6ee7-1c98-4365-940e-c41ecad100a9'
const NOW = '2026-08-25T10:00:00.000Z'

const HOME_STATE: HomeState = {
  tasks: [
    {
      id: 'task-airtel',
      title: 'Renew the plan',
      context: 'Personal',
      estimateMinutes: 30,
      priority: 'High',
      status: 'In Progress',
      due: '2026-08-26',
      tags: ['errand'],
      recurrence: null
    }
  ],
  contexts: [{ name: 'Personal', color: 'success', icon: 'house' }],
  scratchBlocks: [
    {
      id: 'evt-scratch-mon',
      taskId: 'task-airtel',
      date: '2026-08-25',
      start: '14:00',
      end: '15:30',
      portion: 'first half',
      createdAt: NOW,
      expiresAt: '2026-08-27T00:00:00.000Z'
    },
    {
      id: 'evt-freestanding',
      taskId: null,
      date: '2026-08-25',
      start: '16:00',
      end: '17:00',
      portion: '',
      createdAt: NOW,
      expiresAt: '2026-08-27T00:00:00.000Z'
    }
  ],
  savedTaskViews: [
    {
      id: 'view-personal-week',
      name: 'Personal this week',
      rules: [
        { id: 'rule-context', property: 'context', value: 'Personal' },
        { id: 'rule-due', property: 'due', operator: 'within', from: '2026-08-25', to: '2026-08-31' }
      ]
    }
  ]
}

const HABIT_STATE: HabitSyncState = {
  habits: [
    {
      id: 'habit-water',
      name: 'Water',
      kind: 'quantized',
      targetLabel: '4 bottles',
      createdOn: '2026-08-01',
      createdAt: NOW
    }
  ],
  lifecycle: [{ habitId: 'habit-water', date: '2026-08-01', status: 'active', createdAt: NOW }],
  entries: [{ habitId: 'habit-water', date: '2026-08-24', value: 100, createdAt: NOW, updatedAt: NOW }],
  freezes: [{ habitId: 'habit-water', date: '2026-08-23' }],
  grants: [{ date: '2026-08-24' }],
  finalizedDays: ['2026-08-23', '2026-08-24'],
  monthCapacities: { '2026-08': 1 }
}

const MOOD_ENTRIES: readonly MoodFocusEntry[] = [
  {
    date: '2026-08-24',
    mood: 'Good',
    focus: 'High',
    note: 'Long study block',
    noteSource: 'manual',
    createdAt: NOW,
    updatedAt: NOW
  },
  {
    date: '2026-08-25',
    mood: null,
    focus: 'Resting',
    note: null,
    noteSource: null,
    createdAt: NOW,
    updatedAt: NOW
  }
]

const LEETCODE_STATE: LeetCodeSyncState = {
  problems: [
    { id: 'neetcode-1-1', topic: 'Arrays & Hashing', name: 'Contains Duplicate', difficulty: 'Easy', curriculumOrder: 0 }
  ],
  attempts: [
    {
      id: 'imported-neetcode-1-1',
      problemId: 'neetcode-1-1',
      date: '2026-08-24',
      solution: 'class Solution:\n    pass\n',
      createdAt: NOW,
      updatedAt: NOW
    }
  ]
}

const JOBS_STATE: JobsSyncState = {
  roles: [
    {
      id: 'job-anthropic',
      company: 'Anthropic',
      role: 'SWE Intern, Agents',
      location: 'San Francisco, CA',
      postingLink: 'https://www.anthropic.com/careers',
      datePosted: '2026-08-20',
      stage: 'applied',
      appliedDate: '2026-08-24',
      oaDueDate: null,
      interview1Date: null,
      interview2Date: null,
      interview3Date: null,
      decisionDate: null,
      resumeId: null,
      createdAt: NOW,
      updatedAt: NOW
    }
  ],
  transitions: [
    {
      id: 'job-anthropic-transition-applied',
      roleId: 'job-anthropic',
      fromStage: 'to_apply',
      toStage: 'applied',
      changedAt: NOW
    }
  ]
}

const NOTES_STATE: NotesState = {
  folders: [
    { id: 'folder-cs225', name: 'CS 225', parentFolderId: null, createdAt: NOW, updatedAt: NOW }
  ],
  pages: [
    {
      id: 'doc-avl',
      title: 'AVL rotations',
      folderId: 'folder-cs225',
      parentPageId: null,
      contentJson: '[{"id":"block-a","type":"paragraph","content":"left rotate"}]',
      favorite: true,
      status: 'active',
      createdAt: NOW,
      updatedAt: NOW,
      lastOpenedAt: NOW,
      archivedAt: null,
      deletedAt: null
    }
  ]
}

describe('sync row mappers round-trip local state through the cloud shapes', () => {
  it('home', () => {
    expect(homeStateOf(homeRowsOf(HOME_STATE, USER_ID))).toEqual(HOME_STATE)
  })

  it('habits', () => {
    expect(habitSyncStateOf(habitRowsOf(HABIT_STATE, USER_ID))).toEqual(HABIT_STATE)
  })

  it('mood and focus', () => {
    expect(moodFocusEntriesOf(moodFocusRowsOf(MOOD_ENTRIES, USER_ID))).toEqual(MOOD_ENTRIES)
  })

  it('leetcode', () => {
    expect(leetCodeSyncStateOf(leetCodeRowsOf(LEETCODE_STATE, USER_ID))).toEqual(LEETCODE_STATE)
  })

  it('jobs', () => {
    expect(jobsSyncStateOf(jobsRowsOf(JOBS_STATE, USER_ID))).toEqual(JOBS_STATE)
  })

  it('notes', () => {
    expect(notesStateOf(notesRowsOf(NOTES_STATE, USER_ID))).toEqual(NOTES_STATE)
  })

  it('stamps every pushed row with the owning user id', () => {
    const rows = homeRowsOf(HOME_STATE, USER_ID)
    const stamped = [...rows.tasks, ...rows.contexts, ...rows.scratchBlocks, ...rows.savedTaskViews]
    expect(stamped.every((row) => row.user_id === USER_ID)).toBe(true)
  })
})

const closers: Array<{ close: () => void }> = []

afterEach(() => {
  closers.splice(0).forEach((store) => store.close())
})

function track<Store extends { close: () => void }>(store: Store): Store {
  closers.push(store)
  return store
}

describe('store replaceAll hydrates local state from a cloud pull', () => {
  it('HomeStore replaces rows and marks the store initialized', () => {
    const store = track(new HomeStore(':memory:'))
    expect(store.initialized()).toBe(false)
    const state = store.replaceAll(HOME_STATE, NOW)
    expect(state.tasks).toEqual(HOME_STATE.tasks)
    expect(state.scratchBlocks).toHaveLength(2)
    expect(store.initialized()).toBe(true)
    // A later load() must not re-seed over pulled state.
    const loaded = store.load(
      { tasks: [], contexts: [], scratchBlocks: [], savedTaskViews: [] },
      NOW
    )
    expect(loaded.tasks).toEqual(HOME_STATE.tasks)
  })

  it('HabitStore round-trips a sync snapshot', () => {
    const store = track(new HabitStore(':memory:'))
    store.replaceAll(HABIT_STATE, '2026-08-25')
    expect(store.snapshot()).toEqual(HABIT_STATE)
    expect(store.initialized()).toBe(true)
  })

  it('MoodFocusStore round-trips entries', () => {
    const store = track(new MoodFocusStore(':memory:'))
    store.replaceAll(MOOD_ENTRIES, '2026-08-25')
    expect(store.snapshot()).toEqual(MOOD_ENTRIES)
  })

  it('LeetCodeStore round-trips problems and attempts with a zeroed legacy summary', () => {
    const store = track(new LeetCodeStore(':memory:'))
    const state = store.replaceAll(LEETCODE_STATE, '2026-08-25')
    expect(store.snapshot()).toEqual(LEETCODE_STATE)
    expect(state.summary.totalProblems).toBe(1)
    expect(state.summary.legacyProgress).toEqual([])
  })

  it('JobStore round-trips roles and transitions', () => {
    const store = track(new JobStore(':memory:'))
    store.replaceAll(JOBS_STATE, '2026-08-25')
    expect(store.snapshot()).toEqual(JOBS_STATE)
  })

  it('NotesStore keeps local-only attachments of pages that survive the pull', () => {
    const root = mkdtempSync(join(tmpdir(), 'manor-sync-notes-'))
    const store = track(new NotesStore(join(root, 'notes.sqlite'), join(root, 'attachments')))
    store.load({
      folders: NOTES_STATE.folders,
      pages: [
        ...NOTES_STATE.pages,
        {
          id: 'doc-doomed',
          title: 'Deleted elsewhere',
          folderId: null,
          parentPageId: null,
          contentJson: '[]',
          favorite: false,
          status: 'active',
          createdAt: NOW,
          updatedAt: NOW,
          lastOpenedAt: NOW,
          archivedAt: null,
          deletedAt: null
        }
      ]
    })
    const attachment = store.uploadAttachment(
      { noteId: 'doc-avl', name: 'diagram.png', mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]) },
      NOW
    )
    const pulled = store.replaceAll({
      folders: NOTES_STATE.folders,
      pages: [{ ...NOTES_STATE.pages[0], title: 'AVL rotations (cloud)' }]
    })
    expect(pulled.pages).toHaveLength(1)
    expect(pulled.pages[0].title).toBe('AVL rotations (cloud)')
    expect(store.resolveAttachment(attachment.id)).toMatch(/^data:image\/png;base64,/)
  })
})
