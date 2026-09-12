import { edit, object, uuid, type ManorTool } from './toolDefinitions.ts'

function lifecycleBatch(name: string, description: string, operations: { [module: string]: string }): ManorTool {
  return {
    name,
    description,
    inputSchema: object({ items: { type: 'array', minItems: 1, maxItems: 50, items: object({ command_id: uuid, module: { type: 'string', enum: Object.keys(operations) }, ...edit }, ['command_id', 'module', 'id', 'expected_revision']) } }, ['items']),
    execution: { kind: 'lifecycle_batch', operations },
    readOnly: false
  }
}

export const lifecycleTools: readonly ManorTool[] = [
  lifecycleBatch('trash_records', 'Atomically move 1 to 50 tasks, applications, or Notes to seven-day Trash. Supply each current revision and a retry-stable command ID. Trashing a note includes descendants; select only hierarchy roots.', { tasks: 'trash_task', applications: 'trash_application', notes: 'trash_note' }),
  lifecycleBatch('restore_records', 'Atomically restore 1 to 50 recoverable tasks, applications, or Notes at their current revisions. Notes restoration preserves descendant relationships; select only hierarchy roots.', { tasks: 'restore_task', applications: 'restore_application', notes: 'restore_note' }),
  lifecycleBatch('archive_records', 'Atomically archive 1 to 50 Notes at their current revisions. Archival preserves document content and is distinct from Trash.', { notes: 'archive_note' }),
  lifecycleBatch('unarchive_records', 'Atomically return 1 to 50 archived Notes to active status at their current revisions, using the Notes restoration command.', { notes: 'restore_note' })
]
