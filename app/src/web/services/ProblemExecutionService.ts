import { z } from 'zod'
import { problemLanguages, type ExecuteProblemInput, type ProblemEditorSession, type ProblemExecutionApi, type ProblemLanguage, type ProblemSubmission } from '../../shared/problemExecution'
import type { ManorGateway, JsonObject } from '../ManorGateway'
import { IntegrationService } from './IntegrationService'

const verdictSchema = z.enum(['accepted', 'wrong_answer', 'compile_error', 'runtime_error', 'time_limit', 'output_limit', 'execution_error'])
const resultSchema = z.object({ id: z.string(), passed: z.boolean(), hidden: z.boolean(), input: z.string().nullable(), expectedOutput: z.string().nullable(), output: z.string().nullable(), stdout: z.string().nullable().optional(), stderr: z.string().nullable(), durationMs: z.number(), verdict: verdictSchema })
const submissionSchema = z.object({ id: z.uuid(), problemId: z.string(), contentVersion: z.number().int(), testsetVersion: z.number().int().nullable(), language: z.enum(problemLanguages), mode: z.enum(['run', 'submit']), status: z.enum(['queued', 'running', 'completed', 'failed']), verdict: verdictSchema.nullable(), passedCases: z.number().int(), totalCases: z.number().int(), results: z.array(resultSchema), error: z.string().nullable(), sourceCode: z.string().nullable().optional(), createdAt: z.string(), finishedAt: z.string().nullable() })
const editorSchema = z.object({ id: z.uuid(), webSocketUrl: z.url(), token: z.string(), expiresAt: z.string(), workspaceUri: z.string(), documentUri: z.string() })

/** Calls owner-authorized execution endpoints. Answers and provider credentials never enter the client. */
export class ProblemExecutionService implements ProblemExecutionApi {
  private readonly integration: IntegrationService
  constructor(gateway: ManorGateway) { this.integration = new IntegrationService(gateway, 'problem-runner') }
  execute(input: ExecuteProblemInput): Promise<ProblemSubmission> { return this.integration.request('execute', { ...input } as JsonObject, submissionSchema) }
  submission(submissionId: string): Promise<ProblemSubmission> { return this.integration.request('submission', { submissionId }, submissionSchema) }
  submissions(problemId: string): Promise<readonly ProblemSubmission[]> { return this.integration.request('submissions', { problemId }, z.array(submissionSchema)) }
  editorSession(problemId: string, language: ProblemLanguage): Promise<ProblemEditorSession> { return this.integration.request('editor-session', { problemId, language }, editorSchema) }
  async closeEditorSession(sessionId: string): Promise<void> { await this.integration.request('close-editor-session', { sessionId }, z.object({ closed: z.literal(true) })) }
}
