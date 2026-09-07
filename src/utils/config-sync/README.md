# Configuration sync

`createConfigSync(adapter)` runs the shared configuration sync flow. The engine owns
sync decisions, merged-config validation, and local config writes. Adapters own
remote transport, remote config parsing/migration, and sync baseline persistence.
The engine does not import Google Drive authentication, storage, or UI state.

## Adapter contract

- `readRemote()` returns a migrated `ConfigValueAndMeta` and a stable `targetId`.
  The identity distinguishes accounts or destination files. It must not contain a
  password or access token.
- `writeRemote(config)` writes the same configuration envelope used by Google Drive.
- `readBaseline()` reads this adapter's last-synced config and metadata.
- `writeBaseline(value, meta)` persists the baseline only after the preceding
  writes succeed. Each sync source must own separate baseline storage.

The adapter must keep its destination consistent throughout an operation. When
calling `syncMergedConfig(config, targetId)`, use the identity of the target whose
conflict is being resolved. The engine does not pin accounts, lock remote files,
or detect changes made while a conflict dialog is open.

## Preserved behavior

- Without a matching baseline, download an existing remote config or upload the
  local config if the adapter reports no remote config.
- Compare `lastModifiedAt` against the matching baseline to determine sync direction.
- Return `base`, `local`, and `remote` when both sides changed to different values.
- Keep the existing field-selection semantics in `conflict-merge.ts`, including
  confirmation of one-sided field changes within a three-way conflict.
- Write merged configs locally before uploading. If upload fails, the local write
  remains, but the baseline is not advanced.
- Preserve the existing missing-remote and migration-error behavior of the Google
  Drive adapter. New adapters must define their own remote error handling.

`src/utils/google-drive/sync.ts` maps the Google email to `targetId` in memory and
maps it back to `email` when persisting. Existing storage keys, metadata fields,
remote file format, and exported sync entrypoints are unchanged.

## Conflict UI

The provider-independent atoms live in `src/utils/atoms/config-sync.ts`. Give each
sync source its own Jotai store and mount the shared dialog under that store's
`Provider`. Initialize `unresolvedConfigsAtom` for the conflict and reset
`resolutionsAtom` when closing it.

The shared dialog lives in
`src/entrypoints/options/pages/preference/config/config-sync/`. It renders the
resolution controls and accepts confirmation/cancellation callbacks and pending
state. The Google Drive wrapper retains authentication checks and submission.
Existing `googleDrive.unresolved` translation keys are deliberately retained to
avoid unrelated locale churn. Their displayed conflict text is provider-neutral.

This extraction does not implement WebDAV, automatic sync, conditional remote
writes, or a new persistence schema. It intentionally does not require a release
changeset because it preserves the existing user-facing feature.
