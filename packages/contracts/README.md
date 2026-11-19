# @designsystem/contracts

The shape of every D1 table one app owns and another reads, as valibot
schemas. Today that is music's `listens` and summary rows, and budget's
own reads of `salary_history` and `debts`.

- Each schema has every column of its table, in the table's order. A reader
  takes the columns its own SELECT names with `v.pick` (or `v.omit`) and reads
  through `queryRows` from `@designsystem/config/d1-query`, so a row that does
  not match is an error at the read, not `undefined` on a page.
- `npm test` reads each owner's `db/<owner>.sql` and checks every
  contract against it, column for column: name, `TEXT` as `string`,
  `INTEGER`/`REAL` as `number`, and `NOT NULL` as not nullable. A change to
  the owner's schema fails here before it reaches a reader in production.
- A new table another app reads gets its contract here first; the owner and
  every reader import it.

## Files of the home apps (`apper-*.ts`)

The other kind of contract: the JSON files the exporters of the Nextcloud repository write for the home apps (`Apper/<file>.json`, also as a host copy the media server
reads, `docs/MEDIA-SERVER.md`). One module per file (`apper-abonnement.ts`, `apper-status.ts`), named for the file, exporting its valibot schema; the app that reads it
imports the schema and serves it through `jsonFile(<file>, <schema>)` (`@designsystem/config/apper-files`). The exporter owns the file and its keys, so the schema follows it
(Norwegian keys stay; translate at the page), takes the fields a page uses strictly and ignores a field it does not know, and makes optional whatever an older file lacks.
`apper-files.test.ts` checks each schema against made-up fixtures, and, with `APPER_DIR=~/Dokumenter/nextcloud/export/apper`, against the files really written.
Next: `penger` needs nothing more than `abonnement`; `adguard`, `adguard-details`, `nett`, then the RSS files follow with their apps.
