# dsh-mcp-settings

Configure [Model Context Protocol](https://modelcontextprotocol.io) servers in
DeepSeek Harness from a first-level page in the Web UI, by editing the same
`cordis.patch.yml` a person would edit by hand.

The patch file stays the source of truth. This plugin is a view onto it: it reads
the `@deepseek-ai/dsh-mcp-client` rows already in the file into a form, and writes
the form's list back as rows. There is no second configuration to keep in sync,
and nothing to convert — a file you maintain by hand keeps working, comments and
`!!js` expressions included.

## What it gives you

- **A page, not a YAML file.** **MCP servers** in the sidebar opens a full central
  panel that lists every server with its transport, command, arguments,
  environment, headers, and tool-name namespace, and edits them in place.
- **Add by pasting YAML.** Add server opens a text box: paste the same
  `@deepseek-ai/dsh-mcp-client` row you would write by hand, and the page stages
  it. Removing a server deletes the row the list no longer names.
- **Switch servers on and off.** Every row has an enable switch. Turning it off
  keeps the server's configuration in the file but writes the Loader's row-level
  `disabled: true`, so none of that server's tools are offered to the model until
  it is switched back on.
- **No restart.** The profile already watches the file it booted from, so a new
  server's tools appear once its row lands, and a removed one's tools retire.
- **Your file, respected.** Comments, blank lines, key order and unrelated plugin
  rows survive every write. A row written by hand is shown read-only rather than
  silently rewritten.
- **`!!js` expressions kept.** A value like `cwd: !!js process.cwd()` round-trips
  as an expression instead of degrading to the literal text.

## Install

### From the registry

`dsh plugin` installs it into a profile as a bundle:

```sh
dsh plugin --profile <name> add dsh-mcp-settings
```

That appends the package to the profile's `dsh.profile.bundles` and activates
this package's [`cordis.patch.yml`](cordis.patch.yml), which inserts the
`mcp-settings` row addressed by package name. A tarball needs no registry at
all:

```sh
pnpm pack                                 # -> dsh-mcp-settings-0.1.0.tgz
dsh plugin --profile <name> add ./dsh-mcp-settings-0.1.0.tgz
```

Installing from a git host works too, but a git install fetches sources and runs
no build, so a tarball or a published package ships the prebuilt `lib/`.

### From a checkout

The plugin is built and loaded like any other profile plugin.

```sh
pnpm install
pnpm run link-deps     # link the harness packages this package compiles against
pnpm run build         # -> lib/index.js, lib/client.js, lib/types
```

`link-deps` exists because the `@deepseek-ai/*` packages are published as part of
the harness, not as general-purpose libraries. It links them from an installed
`dsh` and a source checkout; see [Building](#building).

Then add a row to the **active profile's** patch layer — for the Web profile,
`~/.dsh/profiles/web/cordis.patch.yml`; for the desktop app,
`~/.dsh/profiles/desktop/cordis.patch.yml`:

```yaml
- insert:
    - id: mcp-settings
      name: 'file:///absolute/path/to/dsh-mcp-settings/lib/index.js'
      config:
        # Where the MCP rows live. Omit to use the Harness home's cordis.patch.yml.
        patchFile: /home/you/.dsh/cordis.patch.yml
```

An installed copy is addressed by package name instead:

```yaml
    - id: mcp-settings
      name: 'dsh-mcp-settings'
```

Restart once so the new row is picked up; the **MCP servers** row then appears in
the sidebar. After that the page saves apply live.

The row has to live in the profile patch, not in `~/.dsh/cordis.patch.yml` and not
in a `--patch` overlay. The page stores its server list as this row's
configuration, and the settings service refuses a write that a higher layer would
override. In the home patch or an overlay, the plugin still reads and lists the
file — but Save cannot persist, and the Host logs
`overridden by a home patch or command-line overlay`.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `patchFile` | `$DSH_HOME/cordis.patch.yml` | Absolute path of the patch file this plugin edits. Point it at a profile's `cordis.patch.yml` to scope the servers to that profile. |
| `watchFile` | `true` | Follow edits made to that file outside this page and refresh the form from them. The composition reloads either way; this only affects what the page shows. |
| `servers` | `[]` | The staged server list. Owned by the Settings form — the plugin writes the file from it. |
| `expressions` | `{}` | `!!js` sources for staged rows. Written by the plugin; not meant to be edited. |

## Using it

Open **MCP servers** in the sidebar. The page is a first-level main panel, beside
**Plugins** and **Tasks**; it is not a Settings tab.

**Add server** opens a text box. Paste one or more rows, exactly as they appear
in the patch file — with the `- insert:` wrapper, as bare list items, or as a
single row:

```yaml
- insert:
    - id: mcp-example
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: example
        transport: stdio
        command: example-mcp-server
        args: [--stdio]
        cwd: !!js process.cwd()
```

`name` must be `@deepseek-ai/dsh-mcp-client`; `config.serverName` and
`config.transport` are required. `id` may be omitted, in which case it is derived
from the server name like any other row this plugin creates. A `!!js` leaf is
kept as an expression, not read back as the literal text. Config keys the editor
has no control for — `reconnect`, `maxInstructionBytes`, or a key a newer MCP
client adds — are kept verbatim.

The pasted rows are staged, not written: **Save** writes the file. **Edit** on a
staged row opens the field editor described below, if you want to adjust a value
before saving.

**Remove** deletes a row, and asks once to confirm.

The switch at the right of each row enables or disables that server. The setting
is staged like any other edit; click **Save** to write it to the file. A disabled
row remains visible and editable, so turning it back on does not require retyping
its configuration.

### Editing fields

The field editor has, per transport:

- **Server name** — the namespace in the model-facing tool names,
  `mcp__<serverName>__<tool>`. `[A-Za-z0-9_-]{1,32}`, unique among live servers.
- **Transport** — `stdio` launches a local process, `streamable-http` connects to
  a service that must already be running.
- **Command / Arguments / Working directory / Environment** (stdio) or
  **URL / Headers** (HTTP).

### Expressions

A `!!js` expression is evaluated when the plugin activates, so it can read the
environment or the current directory. Three ways to author one:

- Type `cwd = process.cwd()` in the **Expressions** field of the editor. Each line
  is `config path = expression`.
- Paste `!!js process.env.GITHUB_TOKEN` as part of an added row. The pasted value
  is staged as an expression and reaches the file still tagged.
- Write `!!js process.env.GITHUB_TOKEN` directly into the patch file. The page
  reads it back into the Expressions field, and saving leaves it an expression.

A value with no expression entry is written as a literal, even when it looks like
code — a `command` of `process.cwd()` stays that string. That is deliberate: the
only way to make something an expression is to say so.

## How it behaves

### Which rows it will touch

A row belongs to this plugin when its entry id starts with `mcp-`, or when the
staged list names exactly that id. Everything else is treated as hand-written:
displayed with its values, and left alone by every write. To take over a
hand-written row, give the new server its exact entry id.

Ownership is derived from the id rather than stored in the row because a marker
inside the configuration cannot survive the trip through a form: a form stages
plain values, and the plugin's own schema drops what it does not declare.

### What a write preserves

Saving rebuilds only the rows it owns, reusing the node each unchanged leaf
already had. In practice:

- Comments and blank lines, including the file's header and the note above a row
  that was removed, stay.
- `!!js` tags stay expressions.
- Config keys the editor does not expose are kept, including their `!!js` leaves.
- The loader row's `disabled` flag follows the row switch without moving into the
  MCP client's `config`.
- Rows for other plugins are untouched.
- A save that changes nothing writes nothing at all — the file's bytes are
  compared before it is replaced.

Flow style is not preserved: `args: [serve, --mcp]` is re-emitted as a block
sequence. Only rows this plugin owns are rewritten, and only when the staged list
differs from the file.

### First run

The patch file is the source of truth. On activation:

- If the profile stages no `servers` and the file has rows, the plugin publishes
  the file's rows into the settings form — that is what the page then lists. It
  **does not** write an empty list back: booting can never delete a server nobody
  removed.
- If the profile does stage servers, that staged list is written.
- If the two already agree, nothing is written.

The publish happens just after activation, not during it: a settings write makes
the profile reconcile, and reconciling waits for the activating fiber, so doing it
inside `apply` deadlocks startup. The page picks up the resulting revision by
itself.

From then on, a Save is the only thing that rewrites rows.

### Failure

A row that would not activate is rejected before it reaches the file — an invalid
`serverName`, a `stdio` server with no `command`, an HTTP server with no `url`, or
two servers resolving to one entry id. The write does not happen, so the file is
never left with a row the loader cannot mount.

## Troubleshooting

**No MCP servers entry in the sidebar.** The plugin row is missing from the
running profile's `cordis.patch.yml`, or the profile was not restarted after
adding it. (A client page cannot exist without the Host entry that serves it.)
Check the composition with:

```sh
DSH_HOME=~/.dsh dsh --profile web --dump-config | grep -A3 mcp-settings
```

**The page is there but the list is empty.** The Host knows no servers, which is
one of:

- `patchFile` points at a different file than the one holding the rows — check
  the path printed above the list, or the row's `config.patchFile`.
- The row is in the home patch or a `--patch` overlay, so the seed write was
  refused. Move it to the profile patch and restart; the Host log says
  `overridden by a home patch or command-line overlay`.
- The file has no `@deepseek-ai/dsh-mcp-client` row in an `insert` list. Rows that
  override an existing row (`- id: ...` without `insert`) declare no server.

The page renders whatever the Host publishes; the Host publishes whatever the
file declares. So "nothing shown" is always one of those two paths, never a
client rendering bug.

## Building

This package lives outside the `deepseek-harness` workspace, which shapes its
build in two ways.

**The Host half** is ordinary ESM. Everything under `@deepseek-ai/*` stays
external, so the plugin shares the running host's service instances — bundling
`@deepseek-ai/dsh-atomic-write` would give the plugin a second file lock that does
not exclude the host's. Pure libraries with no runtime identity (`js-yaml`,
`yaml`) are inlined, so the plugin does not depend on the harness shipping its own
transitive dependencies.

**The browser half is not ordinary ESM.** The client module system fetches
`lib/client.js` and evaluates it as a lazy-CJS *factory* that registers itself on
the page's module loader:

```js
window.__ModuleLoader__.load({ id: 'dsh-mcp-settings', factory: (require) => { … } })
```

Every specifier the page's platform table answers for must stay a `require()` —
API Gateway resolves `remote.<namespace>` from generated descriptors that only
exist for in-repo packages, so the page builds its UI from the platform seed
(`react`, `@deepseek-ai/dsh-client-store`, `@deepseek-ai/dsh-client-ui-slots`,
`@deepseek-ai/dsh-client-ui-primitives`, `@deepseek-ai/dsh-client-ui-dockkit`) and
persists through the shared settings namespace.

The harness keeps that preset in `packages/client/tsdown.client.ts` and publishes
it with nothing, so [`tsdown.config.ts`](tsdown.config.ts) restates the contract:
the banner, the intro/footer wrapper, the `esm`→`cjs` swap, and the externals
list. That config also aliases `yaml` to its browser build: the package's `node`
export condition wins the default resolution, and the Node build's
`require('process')` / `require('buffer')` are specifiers the page's table cannot
answer.

```sh
pnpm run typecheck   # tsc, both halves
pnpm run build       # declarations, then both bundles
pnpm test            # vitest
pnpm run watch       # rebuild on change
```

### Dependency resolution

`scripts/link-deps.mjs` and `scripts/link-checkout-scope.mjs` symlink the
`@deepseek-ai/*` packages this package imports. Two things make that necessary:

- Those packages ship with the harness rather than as standalone libraries, so
  there is nothing to resolve from a registry.
- The installed harness does not ship every package a client plugin compiles
  against. The static client libraries (`ui-slots`, `ui-primitives`,
  `client-store`) reach the browser through the frontend's platform module table
  and have no package of their own on disk; a checkout builds all of them.

Resolve the whole scope from **one** tree. A `declare module` augmentation merges
only with declarations written in the augmented module itself, so taking some
packages from a checkout and others from an install silently drops every service
merge — `ctx.slots` and `ctx.configForms` disappear, and the slot and locale
tables with them.

```sh
node scripts/link-deps.mjs                 # toolchain + dev loop
node scripts/link-checkout-scope.mjs       # every workspace package, for typechecking
```

## Layout

| Path | Role |
|---|---|
| [`src/patch-store.ts`](src/patch-store.ts) | The whole persistence layer: parse the patch file, read its MCP rows, and rewrite the ones this plugin owns without disturbing anything else. |
| [`src/yaml.ts`](src/yaml.ts) | `yaml` access that works whether the bundle loaded as ESM or CommonJS. |
| [`src/index.ts`](src/index.ts) | Host plugin: the `Config` schema the Settings form is derived from, the boot seed, and the reconcile loop between the form and the file. |
| [`src/contract.ts`](src/contract.ts) | The marker the two halves agree on, so the page can find its namespace by a value instead of guessing the entry id. |
| [`src/client/index.ts`](src/client/index.ts) | Browser plugin: registers the sidebar row and the main panel it opens, and finds its own entry id. |
| [`src/client/McpServersIcon.tsx`](src/client/McpServersIcon.tsx) | The sidebar row's glyph, drawn at the edge the sidebar asks for. |
| [`src/client/server-snippet.ts`](src/client/server-snippet.ts) | Parses the YAML a person pastes to add a server, keeping `!!js` leaves as expressions. |
| [`src/client/mcp-servers-controller.ts`](src/client/mcp-servers-controller.ts) | The page's state: reads the form, stages edits, and writes the whole list in one revision-fenced save. |
| [`src/client/McpServersPage.tsx`](src/client/McpServersPage.tsx) | The page itself, including the paste box behind Add server. |
| [`tests/patch-store.spec.ts`](tests/patch-store.spec.ts) | Fidelity tests: what survives a rewrite, and what does not. |
| [`tests/apply.spec.ts`](tests/apply.spec.ts) | `apply()` end to end over a real file: add, edit, save-driven removal, idempotence, rejection. |
| [`tests/wiring.spec.ts`](tests/wiring.spec.ts) | The links that make the page non-empty: namespace discovery, row-id addressing, boot seeding, and that boot never deletes a row. |
| [`tests/client-wiring.spec.ts`](tests/client-wiring.spec.ts) | The browser registration: the sidebar row and main panel share one id, and both wait until the Host serves the page's namespace. |
| [`tests/snippet.spec.ts`](tests/snippet.spec.ts) | What a pasted configuration may look like, what is refused, and what survives parsing. |
| [`tests/add-flow.spec.ts`](tests/add-flow.spec.ts) | The paste-to-YAML loop through the controller and the Host's normalization. |

## Known limits

- **The page is an editor, not a live monitor.** It shows what the patch file
  declares, not whether each server's connection succeeded. Connection state is in
  the host logs.
- **`watchFile` uses `fs.watch`.** On a network filesystem that may miss changes;
  the composition still reloads, since the launcher has its own watcher.
- **Flow style is not preserved** in the rows this plugin rewrites, as noted above.
- **One file per plugin instance.** Two rows editing one file would fight; two
  rows editing different files are fine.
- **The plugin row must be editable from the profile patch.** The page persists its
  list as that row's configuration, so a row supplied by the home patch or a
  `--patch` overlay can be listed but not saved.
- **The profile patch has to create the row, not just configure it.** The page
  saves its list as an id-targeted `mcp-settings` entry, which only *overrides* a
  row some layer already wrote. If that entry is the only `mcp-settings` row in
  the profile patch, the patch matches nothing, the loaders warn and skip it, and
  the plugin disappears from the sidebar with no error in the UI. Keep the
  `- insert:` row (or a bundle install) ahead of the config entry in the file.
- **`engines.dsh` has to admit the running harness.** A row whose range the
  runtime does not satisfy is denied by the compatibility preflight: it stays
  listed in **Plugins** as off and never mounts, so `MCP servers` never appears.
  Widen the range, then let the profile reload (or restart) so the row is judged
  again.
- **The page is written against this harness's client page services** — the
  `ctx.configForms` / `main` / `sidebar.panellist` surfaces it was built with. The
  entry id it edits is discovered from the settings describe answer, not assumed.

## License

Apache-2.0
