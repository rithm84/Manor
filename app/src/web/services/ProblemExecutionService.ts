import { FunctionRegion } from '@supabase/supabase-js'
import { z } from 'zod'
import { problemLanguages, type ExecuteProblemInput, type ProblemEditorSession, type ProblemExecutionApi, type ProblemLanguage, type ProblemSubmission } from '../../shared/problemExecution'
import type { ManorGateway, JsonObject } from '../ManorGateway'
import { IntegrationService } from './IntegrationService'

const verdictSchema = z.enum(['accepted', 'wrong_answer', 'compile_error', 'runtime_error', 'time_limit', 'output_limit', 'execution_error'])
const resultSchema = z.object({ id: z.string(), passed: z.boolean(), hidden: z.boolean(), input: z.string().nullable(), expectedOutput: z.string().nullable(), output: z.string().nullable(), stdout: z.string().nullable().optional(), stderr: z.string().nullable(), memoryKb: z.number().nullable().optional(), durationMs: z.number(), verdict: verdictSchema })
const submissionSchema = z.object({ id: z.uuid(), problemId: z.string(), contentVersion: z.number().int(), testsetVersion: z.number().int().nullable(), language: z.enum(problemLanguages), mode: z.enum(['run', 'submit']), status: z.enum(['queued', 'running', 'completed', 'failed']), verdict: verdictSchema.nullable(), passedCases: z.number().int(), totalCases: z.number().int(), results: z.array(resultSchema), error: z.string().nullable(), sourceCode: z.string().nullable().optional(), createdAt: z.string(), finishedAt: z.string().nullable() })
const editorSchema = z.object({ id: z.uuid(), webSocketUrls: z.record(z.enum(problemLanguages), z.url()), token: z.string(), expiresAt: z.string(), workspaceUri: z.string() })

/**
 * Calls owner-authorized execution endpoints. Full testsets and provider credentials never enter the client; failed submissions disclose one counterexample.
 *
 * The runner makes several database and sandbox round trips per request, so it runs in AWS us-east-1, beside the
 * Blaxel sandboxes in Ashburn and near both Supabase databases in us-east-2, rather than in the region nearest the
 * caller, which would pay a long trip for each of them.
 */
export class ProblemExecutionService implements ProblemExecutionApi {
  private readonly integration: IntegrationService
  constructor(gateway: ManorGateway) { this.integration = new IntegrationService(gateway, 'problem-runner', FunctionRegion.UsEast1) }
  execute(input: ExecuteProblemInput): Promise<ProblemSubmission> { return this.integration.request('execute', { ...input } as JsonObject, submissionSchema) }
  submission(submissionId: string): Promise<ProblemSubmission> { return this.integration.request('submission', { submissionId }, submissionSchema) }
  submissions(problemId: string): Promise<readonly ProblemSubmission[]> { return this.integration.request('submissions', { problemId }, z.array(submissionSchema)) }
  editorSession(problemId: string | null, language: ProblemLanguage): Promise<ProblemEditorSession> { return this.integration.request('editor-session', { problemId, language }, editorSchema) }
}
