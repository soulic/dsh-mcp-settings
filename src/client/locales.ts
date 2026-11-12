/**
 * MCP servers page copy.
 *
 * Both dictionaries are registered in one call, so a language switch re-renders
 * from the locale revision without a reload. Keys are camelCase and the typed
 * dictionary makes a missing translation a compile error.
 */


/**
 * Every key the MCP servers page needs.
 *
 * Declared before the dictionaries so each one can be checked against it; a
 * union derived from a dictionary would be circular, because the dictionary is
 * itself annotated with that union.
 */
export type McpServersLocaleKey =
  | 'title' | 'intro' | 'unavailable' | 'watchOff' | 'empty' | 'newServer'
  | 'externalTag' | 'externalHint'
  | 'enabled' | 'disabled' | 'enableTools' | 'disableTools'
  | 'transport' | 'transportStdio' | 'transportHttp'
  | 'serverName' | 'serverNameHint' | 'entryId' | 'entryIdHint'
  | 'command' | 'commandHint' | 'args' | 'argsHint' | 'cwd' | 'cwdHint' | 'env' | 'envHint'
  | 'url' | 'urlHint' | 'headers' | 'headersHint'
  | 'timeout' | 'timeoutHint' | 'failOnStartupError' | 'failOnStartupErrorHint'
  | 'expressions' | 'expressionsHint' | 'keptFields'
  | 'edit' | 'close' | 'remove' | 'confirmRemove' | 'add'
  | 'pasteLabel' | 'pasteHint' | 'pasteAdd' | 'pasteCancel'
  | 'pasteEmpty' | 'pasteBadYaml' | 'pasteBadShape' | 'pasteNotMcp' | 'pasteMissingConfig'
  | 'pasteMissingServerName' | 'pasteBadServerName' | 'pasteMissingTransport' | 'pasteBadTransport'
  | 'pasteMissingCommand' | 'pasteMissingUrl' | 'pasteDuplicate'
  | 'save' | 'saving' | 'discard' | 'saveFailed' | 'applyHint'

/** Chinese copy, the primary locale. */
export const zh: Record<McpServersLocaleKey, string> = {
  title: 'MCP 服务器',
  intro: '在此配置 MCP 服务器。保存后写入补丁文件，DSH 会自行热应用。文件：',
  unavailable: '本次运行未提供 MCP 服务器设置，或该插件尚未作为 profile 条目启动。',
  watchOff: '文件监听已关闭：在别处修改补丁文件后，需要刷新此页才能看到。',
  empty: '还没有配置任何 MCP 服务器。',
  newServer: '新服务器',
  externalTag: '手工行',
  externalHint: '这一行由你手工写在补丁文件里。为避免覆盖你的改动，本页只展示、不修改它的字段；右上角的开关仍可启用或禁用这个服务器。',
  enabled: '已启用',
  disabled: '已禁用',
  enableTools: '启用这个服务器的全部 MCP 工具',
  disableTools: '禁用这个服务器的全部 MCP 工具',
  transport: '传输方式',
  transportStdio: 'stdio（本地进程）',
  transportHttp: 'Streamable HTTP',
  serverName: '服务器名（serverName）',
  serverNameHint: '工具名前缀：mcp__<服务器名>__<工具名>。只能用字母、数字、下划线和短横线，最长 32 字符。',
  entryId: '条目 id',
  entryIdHint: '补丁文件里这一行的 id，留空则按服务器名自动生成。',
  command: '命令',
  commandHint: '要启动的可执行文件，不经 shell 解析。',
  args: '参数',
  argsHint: '每行一个参数，按顺序传给命令。',
  cwd: '工作目录',
  cwdHint: '子进程的工作目录；留空则由 DSH 决定。',
  env: '环境变量',
  envHint: '每行一个 KEY=value。DSH 会先剥离凭据类环境变量，这里补回需要的那几个。',
  url: '地址',
  urlHint: 'MCP 端点 URL，该服务需要已经在运行。',
  headers: '请求头',
  headersHint: '每行一个 Name=value，随 MCP 请求发送。',
  timeout: '调用超时（毫秒）',
  timeoutHint: '单次工具调用的超时；留空使用默认的 60000。',
  failOnStartupError: '首次连接失败即拒绝启动',
  failOnStartupErrorHint: '关闭时连接失败只记录日志并自动重连。',
  expressions: '表达式（!!js）',
  expressionsHint: '每行「config 路径 = 表达式」，例如 cwd = process.cwd()。这类值在加载时求值，适合引用环境变量或当前目录。',
  keptFields: '这些字段本页没有编辑控件，但会原样保留：',
  pasteLabel: '配置内容',
  pasteHint: '粘贴一段补丁配置：可以是完整的 - insert: 块，也可以是一行或多行带 name、config 的服务器配置。!!js 表达式会原样保留；添加后仍需点「保存」才会写入文件。',
  pasteAdd: '添加',
  pasteCancel: '取消',
  pasteEmpty: '请先粘贴配置内容。',
  pasteBadYaml: 'YAML 解析失败：',
  pasteBadShape: '无法识别这段配置：请粘贴 - insert: 片段，或带 name、config 的服务器行。',
  pasteNotMcp: '这一行的 name 不是 @deepseek-ai/dsh-mcp-client：',
  pasteMissingConfig: '这一行缺少 config：',
  pasteMissingServerName: 'config 缺少 serverName：',
  pasteBadServerName: 'serverName 必须匹配 [A-Za-z0-9_-]{1,32}：',
  pasteMissingTransport: 'config 缺少 transport：',
  pasteBadTransport: 'transport 只能是 stdio 或 streamable-http：',
  pasteMissingCommand: 'stdio 服务器需要 command：',
  pasteMissingUrl: 'streamable-http 服务器需要 url：',
  pasteDuplicate: '条目 id 已存在：',
  edit: '编辑',
  close: '收起',
  remove: '删除',
  confirmRemove: '确认删除',
  add: '添加服务器',
  save: '保存',
  saving: '保存中…',
  discard: '放弃修改',
  saveFailed: '保存未生效，请检查填写内容后重试。',
  applyHint: '保存会改写补丁文件里对应的行；DSH 监听该文件，新的服务器会直接生效，无需重启。',
}

/** English copy. */
export const en: Record<McpServersLocaleKey, string> = {
  title: 'MCP servers',
  intro: 'Configure MCP servers here. Saving writes the patch file, and DSH applies it without a restart. File:',
  unavailable: 'This run serves no MCP server settings, or the plugin has not started as a profile row yet.',
  watchOff: 'File watching is off: after editing the patch file elsewhere, reload this page to see the change.',
  empty: 'No MCP server is configured yet.',
  newServer: 'New server',
  externalTag: 'hand-written',
  externalHint: 'This row was written by hand in the patch file. To avoid overwriting your work, this page shows its fields read-only; the switch still enables or disables the server.',
  enabled: 'Enabled',
  disabled: 'Disabled',
  enableTools: 'Enable all MCP tools from this server',
  disableTools: 'Disable all MCP tools from this server',
  transport: 'Transport',
  transportStdio: 'stdio (local process)',
  transportHttp: 'Streamable HTTP',
  serverName: 'Server name (serverName)',
  serverNameHint: 'Tool-name prefix: mcp__<serverName>__<tool>. Letters, digits, underscore and dash only, 32 characters at most.',
  entryId: 'Entry id',
  entryIdHint: 'The id of this row in the patch file; left empty, it is derived from the server name.',
  command: 'Command',
  commandHint: 'Executable to launch, passed without a shell.',
  args: 'Arguments',
  argsHint: 'One argument per line, passed in order.',
  cwd: 'Working directory',
  cwdHint: 'Working directory for the child process; empty lets DSH decide.',
  env: 'Environment',
  envHint: 'One KEY=value per line. DSH strips credential-looking variables first; add back the ones the server needs.',
  url: 'URL',
  urlHint: 'MCP endpoint URL; that service must already be running.',
  headers: 'Headers',
  headersHint: 'One Name=value per line, attached to MCP requests.',
  timeout: 'Call timeout (ms)',
  timeoutHint: 'Timeout per tool call; empty uses the 60000 default.',
  failOnStartupError: 'Reject startup when the first connection fails',
  failOnStartupErrorHint: 'Off logs the failure and reconnects instead.',
  expressions: 'Expressions (!!js)',
  expressionsHint: 'One "config path = expression" per line, for example cwd = process.cwd(). These are evaluated at load, so they can read the environment or the current directory.',
  keptFields: 'These fields have no control here, but are kept as written:',
  pasteLabel: 'Configuration',
  pasteHint: 'Paste a patch fragment: a full - insert: block, or one or more server rows with name and config. !!js expressions are kept as expressions; click Save afterwards to write the file.',
  pasteAdd: 'Add',
  pasteCancel: 'Cancel',
  pasteEmpty: 'Paste a configuration first.',
  pasteBadYaml: 'The YAML did not parse: ',
  pasteBadShape: 'Not a configuration this page recognizes: paste an - insert: fragment, or a server row with name and config.',
  pasteNotMcp: 'This row\'s name is not @deepseek-ai/dsh-mcp-client: ',
  pasteMissingConfig: 'This row has no config: ',
  pasteMissingServerName: 'config has no serverName: ',
  pasteBadServerName: 'serverName must match [A-Za-z0-9_-]{1,32}: ',
  pasteMissingTransport: 'config has no transport: ',
  pasteBadTransport: 'transport must be stdio or streamable-http: ',
  pasteMissingCommand: 'A stdio server needs a command: ',
  pasteMissingUrl: 'A streamable-http server needs a url: ',
  pasteDuplicate: 'That entry id is already taken: ',
  edit: 'Edit',
  close: 'Close',
  remove: 'Remove',
  confirmRemove: 'Confirm remove',
  add: 'Add server',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  saveFailed: 'The save did not land. Check the values and try again.',
  applyHint: 'Saving rewrites the matching rows in the patch file; DSH watches that file, so a new server starts without a restart.',
}
