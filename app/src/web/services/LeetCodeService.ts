import { z } from 'zod'
import { parseLeetCodeProblem, parseLeetCodeAttempt, parseLeetCodeNote, parseLeetCodeSummary, parseAddLeetCodeAttemptMutation, parseUpdateLeetCodeAttemptMutation, parseLeetCodeNoteText } from '../../shared/leetcode'
import type { LeetCodeApi, LeetCodeState, AddLeetCodeAttemptMutation, UpdateLeetCodeAttemptMutation, UpdateLeetCodeNoteMutation, LeetCodeFreezeMutation } from '../../shared/leetcode'
import type { ManorGateway } from '../ManorGateway'
import { camelRow, derivedRead, rowRevision } from './rows'

export class LeetCodeService implements LeetCodeApi {
  private readonly gateway: ManorGateway
  constructor(gateway: ManorGateway) { this.gateway = gateway }
  async load(): Promise<LeetCodeState> {
    const [problems, attempts, notes, summary] = await Promise.all([
      this.gateway.rows('leetcode_problems'), this.gateway.rows('leetcode_attempts'), this.gateway.rows('leetcode_notes'),
      derivedRead(this.gateway, 'manor_leetcode_summary', 'Read LeetCode summary')
    ])
    return { problems: problems.map((row) => parseLeetCodeProblem(camelRow(row))).sort((a,b) => a.curriculumOrder - b.curriculumOrder),
      attempts: attempts.map((row) => ({ ...parseLeetCodeAttempt(camelRow(row)), revision: rowRevision(row) })),
      notes: notes.map((row) => ({ ...parseLeetCodeNote(camelRow(row)), revision: rowRevision(row) })), summary: parseLeetCodeSummary(summary) }
  }
  async applyFreeze(mutation: LeetCodeFreezeMutation): Promise<LeetCodeState> {
    await this.gateway.command('apply_leetcode_freeze', { date: z.iso.date().parse(mutation.date), expected_revision: z.number().int().nonnegative().parse(mutation.expectedRevision) }, crypto.randomUUID())
    return this.load()
  }
  async clearFreeze(mutation: LeetCodeFreezeMutation): Promise<LeetCodeState> {
    await this.gateway.command('clear_leetcode_freeze', { date: z.iso.date().parse(mutation.date), expected_revision: z.number().int().nonnegative().parse(mutation.expectedRevision) }, crypto.randomUUID())
    return this.load()
  }
  async addAttempt(input: AddLeetCodeAttemptMutation): Promise<LeetCodeState> {
    const mutation = parseAddLeetCodeAttemptMutation(input)
    await this.gateway.command('create_attempt', { id: crypto.randomUUID(), expected_revision: 0, problem_id: mutation.problemId, date: mutation.date, solution: mutation.solution }, crypto.randomUUID())
    return this.load()
  }
  async updateAttempt(input: UpdateLeetCodeAttemptMutation): Promise<LeetCodeState> {
    const mutation = parseUpdateLeetCodeAttemptMutation(input)
    await this.gateway.command('update_attempt', { id: mutation.attemptId, expected_revision: z.number().int().positive().parse(input.expectedRevision), date: mutation.date, solution: mutation.solution }, crypto.randomUUID())
    return this.load()
  }
  async deleteAttempt(attemptId: string): Promise<LeetCodeState> {
    await this.gateway.command('delete_attempt', { id: attemptId, expected_revision: this.gateway.revision('leetcode_attempts', attemptId) }, crypto.randomUUID())
    return this.load()
  }
  async addNote(text: string): Promise<LeetCodeState> {
    await this.gateway.command('save_mistake', { id: crypto.randomUUID(), expected_revision: 0, text: parseLeetCodeNoteText(text) }, crypto.randomUUID())
    return this.load()
  }
  async updateNote(mutation: UpdateLeetCodeNoteMutation): Promise<LeetCodeState> {
    await this.gateway.command('save_mistake', { id: mutation.noteId, expected_revision: z.number().int().positive().parse(mutation.expectedRevision), text: parseLeetCodeNoteText(mutation.text) }, crypto.randomUUID())
    return this.load()
  }
  async deleteNote(noteId: string): Promise<LeetCodeState> {
    await this.gateway.command('delete_mistake', { id: noteId, expected_revision: this.gateway.revision('leetcode_notes', noteId) }, crypto.randomUUID())
    return this.load()
  }
}
