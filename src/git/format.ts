// Pure so the webview can bundle it too: previews and execution share one formatter.

/** Renders args the way a user would type them, so every action can preview its exact command. */
export function formatCommand(args: readonly string[]): string {
  const quoted = args.map((arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `"${arg.replace(/(["\\$`])/g, "\\$1")}"`));
  return ["git", ...quoted].join(" ");
}
