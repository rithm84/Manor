import { command, domainQuery, edit, id, revision, type ManorTool, type ToolSchema } from './toolDefinitions.ts'
const module: ToolSchema = { type: 'string', enum: ['tasks', 'notes', 'applications', 'knowledge'] }
/** Relationships contain endpoint identities only; reads resolve current owned metadata. */
export const relatedTools: readonly ManorTool[] = [
  command('link_records', 'Create an explicit undirected relationship between two available owned records using their current revisions. Self-links and duplicate pairs are rejected; no record content is copied.', { ...edit, source_module: module, source_id: id, source_expected_revision: revision, target_module: module, target_id: id, target_expected_revision: revision }, ['id', 'expected_revision', 'source_module', 'source_id', 'source_expected_revision', 'target_module', 'target_id', 'target_expected_revision']),
  command('unlink_records', 'Remove an explicit relationship at its current relationship revision without modifying either endpoint.', edit, ['id', 'expected_revision']),
  domainQuery('get_related_records', 'manor_related_query', 'Read explicit links in either direction with current owned endpoint metadata and revisions. Excludes Trash and purged records; returns no inferred associations. Cursor is the stable relationship ID.', { module, id, limit: { type: 'integer', minimum: 1, maximum: 200 }, cursor: id }, ['module', 'id', 'limit']),
  domainQuery('read_knowledge', 'manor_related_query', 'Read one current owned Knowledge capture with exact saved content and revision. Deleted and purged captures are unavailable.', { id }, ['id']),
]
