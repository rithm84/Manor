import type { ManorTable } from './ManorGateway'

/** Primary keys from the retained schema and web migrations, after owner filtering. */
export const tableOrder: Record<ManorTable, readonly string[]> = {
 profiles:['user_id'],tasks:['id'],contexts:['name'],scratch_blocks:['id'],saved_task_views:['id'],
 habits:['id'],habit_lifecycle:['habit_id','date'],habit_entries:['habit_id','date'],habit_freeze_intents:['habit_id','date'],habit_freeze_usage:['habit_id','date'],habit_freeze_grants:['date'],habit_month_pools:['month'],
 mood_focus_entries:['date'],note_folders:['id'],note_pages:['id'],note_attachments:['id'],note_versions:['note_id','revision'],note_suggestions:['id'],
 job_roles:['id'],job_stage_transitions:['id'],job_listings:['id'],leetcode_problems:['id'],leetcode_attempts:['id'],leetcode_notes:['id'],
 kb_entries:['id'],resumes:['id'],weekly_reviews:['id'],action_events:['id'],calendar_accounts:['id'],calendars:['account_id','id'],calendar_events:['account_id','calendar_id','id']
}
const groups: readonly {operations:readonly string[];tables:readonly ManorTable[]}[] = [
 {operations:['save_profile'],tables:['profiles']},
 {operations:['create_context','update_context','remove_context'],tables:['contexts','tasks']},
 {operations:['create_task','update_task','trash_task','restore_task','create_recurring_task','convert_task_to_series','skip_task_occurrence','update_future_task_occurrences'],tables:['tasks']},
 {operations:['save_scratch_block','delete_scratch_block'],tables:['scratch_blocks']},
 {operations:['save_task_view','delete_task_view'],tables:['saved_task_views']},
 {operations:['create_note_folder','update_note_folder'],tables:['note_folders']},
 {operations:['create_note','update_note','move_note','archive_note','trash_note','restore_note','restore_note_version','edit_note_blocks','move_note_block','move_note_blocks'],tables:['note_pages','note_versions','note_suggestions']},
 {operations:['remove_note_folder'],tables:['note_folders','note_pages','note_versions']},
 {operations:['purge_note'],tables:['note_pages','note_versions','note_suggestions','note_attachments']},
 {operations:['touch_note'],tables:['note_pages']},
 {operations:['propose_note_edits'],tables:['note_suggestions']},
 {operations:['resolve_note_suggestions'],tables:['note_pages','note_versions','note_suggestions']},
 {operations:['create_application','update_application','change_application_stage','trash_application','restore_application','add_job_listing'],tables:['job_roles','job_stage_transitions']},
 {operations:['create_habit','update_habit','set_habit_status','log_habit','clear_habit_entry','apply_habit_freeze','clear_habit_freeze','reorder_habits'],tables:['habits','habit_lifecycle','habit_entries','habit_freeze_intents','habit_freeze_usage','habit_freeze_grants','habit_month_pools']},
 {operations:['commit_debrief','correct_mood_focus_history'],tables:['mood_focus_entries']},
 {operations:['create_attempt','update_attempt','delete_attempt'],tables:['leetcode_attempts','leetcode_problems']},
 {operations:['save_mistake','delete_mistake'],tables:['leetcode_notes']},
 {operations:['save_capture','remove_capture','queue_embedding'],tables:['kb_entries']},
 {operations:['save_weekly_review'],tables:['weekly_reviews']},
 {operations:['allocate_file'],tables:[]},
 {operations:['remove_resume'],tables:['resumes','job_roles']}
]
export function affectedTables(operation:string):readonly ManorTable[]|null {
 const match=groups.find(group=>group.operations.includes(operation))
 return match===undefined?null:[...match.tables,'action_events']
}
