# Jobs

_Last updated: 2026-11-17_

[Back to Manor architecture](../ARCHITECTURE.md)

Jobs combines a shared listings catalog with each account's application pipeline. The behavior is in the PRD's [Jobs](../PRD.md#jobs) section.

## Data

- **`job_listings`** is the shared catalog, written only by the `jobs-ingest` worker and readable by every account. It has no change-feed trigger, so the [local mirror](local-mirror-and-sync.md) replaces it at launch and every hour.
- **`job_roles`** are an account's applications, with the editable schema from the PRD, the current stage, and a reference to the resume version used.
- **`job_stage_transitions`** records each stage change, which drives the Flow chart and lets a backwards correction remove undone hops.
- **`resumes`** are versions of a private PDF in `manor-files`, each named by its file.

## Commands

The app writes roles with `create_application`, `update_application`, `change_application_stage`, `trash_application`, `restore_application`, and `add_job_listing`, which adds a listing to the pipeline by its stable listing ID and keeps its full location list and cycle. `remove_resume` deletes a resume version; the server refuses while any application records it. A stage move from the board opens the role dialog as an unsaved draft; **Save** sends the stage and dates together in one command.

## Presentation

`ManorKit/Domain/Jobs/` holds the pure logic: `JobModels` and `JobPresentation` for stages, dates, and card text; `JobFeed` for filtering and paging Listings; and `JobFlow`, which turns transitions into the Flow chart's nodes (Applied, No response yet, Responded, OA, three interviews, Offer, and Rejected) and ribbon widths. The page (`Manor/Modules/Jobs/`) has the Pipeline board with Flow beneath it and the Listings browser; `ResumeField` uploads through [files and uploads](files-and-uploads.md).

## Ingestion

`jobs-ingest` runs every six hours. It reads SimplifyJobs' structured `listings.json`, keeps visible, open, non-hardware listings with at least one US location and a Fall 2026 or later cycle when one is given, deduplicates entries, and groups equivalent company, role, location, and cycle listings with an openings count. Ingestion never adds anything to a pipeline.
