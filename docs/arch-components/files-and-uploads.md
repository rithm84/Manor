# Files and uploads

_Last updated: 2026-11-18_

[Back to Manor architecture](../ARCHITECTURE.md)

Files are note attachments, resume PDFs, and profile pictures. They live in the private `manor-files` Storage bucket with account-scoped policies; the database records each file's identity, owner, object path, content type, size, SHA-256, lifecycle state, and references. `FileService` (`ManorKit/Files/`) owns uploads and downloads in the app.

## Limits

The shared upload policy allows files up to 1,000,000,000 bytes and rejects empty files; profile pictures keep a separate 5 MiB server limit. The same ceiling is enforced by `supabase/functions/_shared/fileUploadPolicy.ts`, the allocation command, the finalizer, and the bucket configuration, so an oversized file gets an actionable size error before any bytes move.

## Upload flow

A file upload and a Postgres transaction can't be one atomic operation, so an upload is a sequence of durable steps:

1. **Stage.** The app clones the file into `Application Support/<bundle id>/FileUploads/<account id>/` and writes a JSON journal beside it, so a quit or a dropped connection never loses the upload.
2. **Hash.** SHA-256 is computed over 1 MiB slices without loading the file into memory.
3. **Allocate.** `allocate_file` through `manor_command`, with the file ID as the command ID, reserves an immutable path for the account, purpose, and parent.
4. **Transfer.** The app sends the bytes with TUS 1.0 resumable uploads to the project's direct Storage host in 6 MiB chunks, resuming from the server's offset with the journaled upload URL and fingerprint. Refreshed session credentials go with each request.
5. **Finalize.** The app calls the `file-finalize` Edge Function until the file is `ready`. The server verifies 32 MiB per call against the immutable object version, checking exact size and content type, with a private checkpoint of incremental SHA-256 state that only server credentials can read. A finished upload whose response was lost is verified without resending bytes.
6. **Attach.** A domain command references the ready file, such as a Notes save or `set_application_resume`.

Uploads resume automatically after sign-in (`FileService.resumePending`). Sign-out waits while any upload is pending, and a completed sign-out deletes the account's staged copies.

## Downloads

`accessURL` reads the file record and creates a signed URL valid for 15 minutes, cached in memory until a minute before it expires. Note images are cached by URL in an in-memory image cache.

## Note attachments

A note references a file as `manor-attachment://<file id>` in a media block's URL. Attachments are uploaded with the note as their parent and follow its lifecycle.

A media block's upload is linked to the block on the Mac (in the Notes draft store) from the moment the file is staged until the block holds the file. When the note opens again, after a lost connection or a relaunch, each linked upload resumes, or is recognized as finished when the server already holds the file as `ready`, and fills in its block. "Try again" resumes the same upload instead of asking for the file again, failed uploads retry when the connection returns, and deleting the block cancels its upload.

## Cleanup

A cleanup job removes abandoned allocations, and checkpoints are removed on completion or purge. Reference ownership and authorization are checked on both upload and attachment. Purging one record never deletes a file still referenced by another live record.
