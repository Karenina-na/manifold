export type TerminalLine = {
  text: string;
  type?: "default" | "error" | "success" | "system" | "link";
  href?: string;
};

export type TerminalAction =
  | { type: "clear" }
  | { type: "close" }
  | { type: "open"; href: string }
  | { type: "theme"; mode?: "light" | "dark" };

type TerminalNode =
  | { kind: "directory"; children: string[] }
  | { kind: "file"; lines: TerminalLine[]; href?: string };

export type TerminalFilesystem = Map<string, TerminalNode>;

export type TerminalContent = {
  kind: "ARTICLE" | "THOUGHT";
  slug: string;
  title: string | null;
  summary: string;
  tags: string[];
  publishedAt: string;
  href: string;
};

type TerminalFilesystemInput = {
  displayName: string;
  handle?: string;
  description: string;
  focus: string;
  contents: TerminalContent[];
  links: Array<{ label: string; href: string }>;
};

export type TerminalContext = {
  filesystem: TerminalFilesystem;
  cwd: string;
  home: string;
  username: string;
  hostname: string;
  now?: Date;
  timeZone?: string;
};

export type TerminalCommandResult = {
  cwd: string;
  lines: TerminalLine[];
  action?: TerminalAction;
};

export const TERMINAL_COMMANDS = [
  "help",
  "ls",
  "pwd",
  "cd",
  "cat",
  "open",
  "whoami",
  "uname",
  "date",
  "theme",
  "clear",
  "exit",
] as const;

type TerminalContentPage = { data: TerminalContent[]; totalPages: number };

export async function loadAllTerminalContent(
  loadPage: (kind: TerminalContent["kind"], page: number) => Promise<TerminalContentPage>,
) {
  const loadKind = async (kind: TerminalContent["kind"]) => {
    const firstPage = await loadPage(kind, 1);
    const contents = [...firstPage.data];
    for (let page = 2; page <= firstPage.totalPages; page += 1) {
      contents.push(...(await loadPage(kind, page)).data);
    }
    return contents;
  };
  const [writings, thoughts] = await Promise.all([loadKind("ARTICLE"), loadKind("THOUGHT")]);
  return [...writings, ...thoughts];
}

function homeUsername(handle: string | undefined) {
  const normalized = handle?.replace(/^@/, "").replace(/[^a-zA-Z0-9._-]/g, "");
  return normalized || "manifold";
}

function addDirectory(filesystem: TerminalFilesystem, path: string, children: string[] = []) {
  filesystem.set(path, { kind: "directory", children });
}

function addFile(filesystem: TerminalFilesystem, path: string, lines: TerminalLine[], href?: string) {
  filesystem.set(path, { kind: "file", lines, href });
}

function safeNavigationHref(href: string) {
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:" ? href : undefined;
  } catch {
    return undefined;
  }
}

function contentFileLines(content: TerminalContent): TerminalLine[] {
  const title = content.title || content.slug;
  const section = content.kind === "ARTICLE" ? "writing" : "thought";
  return [
    { text: `# ${title}`, type: "system" },
    { text: "" },
    { text: content.summary || "—" },
    { text: "" },
    { text: `type: ${section}` },
    { text: `published: ${content.publishedAt.slice(0, 10)}` },
    { text: `tags: ${content.tags.length ? content.tags.join(", ") : "—"}` },
    { text: `url: ${content.href}`, type: "link", href: content.href },
  ];
}

export function createTerminalFilesystem(input: TerminalFilesystemInput): TerminalFilesystem {
  const filesystem: TerminalFilesystem = new Map();
  const username = homeUsername(input.handle);
  const home = `/Users/${username}`;
  const writings = input.contents.filter((item) => item.kind === "ARTICLE");
  const thoughts = input.contents.filter((item) => item.kind === "THOUGHT");
  const linkFiles = input.links.map((item, index) => ({
    ...item,
    filename: `${item.label.replace(/[\\/:]/g, "-").trim() || `link-${index + 1}`}.url`,
  }));

  addDirectory(filesystem, "/", ["Applications", "Library", "System", "Users"]);
  addDirectory(filesystem, "/Applications", ["Safari.app"]);
  addDirectory(filesystem, "/Applications/Safari.app");
  addDirectory(filesystem, "/Library");
  addDirectory(filesystem, "/System", ["Library"]);
  addDirectory(filesystem, "/System/Library");
  addDirectory(filesystem, "/Users", [username]);
  addDirectory(filesystem, home, ["about.md", "links", "now.txt", "thoughts", "writings"]);
  addDirectory(filesystem, `${home}/writings`, writings.map((item) => `${item.slug}.md`));
  addDirectory(filesystem, `${home}/thoughts`, thoughts.map((item) => `${item.slug}.md`));
  addDirectory(filesystem, `${home}/links`, linkFiles.map((item) => item.filename));

  addFile(filesystem, `${home}/about.md`, [
    { text: `# ${input.displayName}`, type: "system" },
    { text: "" },
    { text: input.description },
  ]);
  addFile(filesystem, `${home}/now.txt`, [{ text: input.focus, type: "success" }]);

  for (const content of input.contents) {
    const directory = content.kind === "ARTICLE" ? "writings" : "thoughts";
    const href = safeNavigationHref(content.href);
    const lines = contentFileLines(content).map((line) => line.href && !href ? { text: line.text } : line);
    addFile(filesystem, `${home}/${directory}/${content.slug}.md`, lines, href);
  }
  for (const link of linkFiles) {
    const href = safeNavigationHref(link.href);
    addFile(filesystem, `${home}/links/${link.filename}`, [{ text: link.href, ...(href ? { type: "link" as const, href } : {}) }], href);
  }

  return filesystem;
}

function tokenize(input: string) {
  const tokens: string[] = [];
  let current = "";
  let quote = "";
  for (const character of input.trim()) {
    if ((character === '"' || character === "'") && (!quote || quote === character)) {
      quote = quote ? "" : character;
    } else if (/\s/.test(character) && !quote) {
      if (current) tokens.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function resolvePath(cwd: string, home: string, target = "~") {
  const expanded = target === "~" ? home : target.startsWith("~/") ? `${home}/${target.slice(2)}` : target;
  const parts = (expanded.startsWith("/") ? expanded : `${cwd}/${expanded}`).split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  return `/${resolved.join("/")}`;
}

function completePathInput(input: string, context: Pick<TerminalContext, "filesystem" | "cwd" | "home">) {
  const tokens = tokenize(input);
  const command = tokens[0]?.toLowerCase();
  if (!command || !["cd", "cat", "ls", "open"].includes(command) || tokens.length !== 2) return null;

  const target = tokens[1];
  const slashIndex = target.lastIndexOf("/");
  const parentInput = slashIndex >= 0 ? target.slice(0, slashIndex + 1) : ".";
  const namePrefix = slashIndex >= 0 ? target.slice(slashIndex + 1) : target;
  const parentPath = resolvePath(context.cwd, context.home, parentInput);
  const parent = context.filesystem.get(parentPath);
  if (!parent || parent.kind !== "directory") return null;

  const matches = parent.children.filter((name) => name.toLowerCase().startsWith(namePrefix.toLowerCase()));
  if (matches.length !== 1) return null;
  const matchPath = parentPath === "/" ? `/${matches[0]}` : `${parentPath}/${matches[0]}`;
  const matchNode = context.filesystem.get(matchPath);
  const suffix = matchNode?.kind === "directory" ? "/" : "";
  const completedTarget = `${slashIndex >= 0 ? target.slice(0, slashIndex + 1) : ""}${matches[0]}${suffix}`;
  return `${input.slice(0, input.lastIndexOf(target))}${completedTarget}`;
}

export function completeTerminalInput(
  input: string,
  context: Pick<TerminalContext, "filesystem" | "cwd" | "home">,
) {
  if (!input.trim() || /\s$/.test(input)) return null;
  const tokens = tokenize(input);
  if (tokens.length === 1) {
    const prefix = tokens[0].toLowerCase();
    const matches = TERMINAL_COMMANDS.filter((command) => command.startsWith(prefix));
    return matches.length === 1 ? matches[0] : null;
  }
  return completePathInput(input, context);
}

function macDate(date: Date, timeZone?: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone,
    timeZoneName: "short",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("weekday")} ${value("month")} ${value("day")} ${value("hour")}:${value("minute")}:${value("second")} ${value("timeZoneName")} ${value("year")}`;
}

function error(cwd: string, text: string): TerminalCommandResult {
  return { cwd, lines: [{ text, type: "error" }] };
}

export function executeTerminalCommand(rawInput: string, context: TerminalContext): TerminalCommandResult {
  const [rawCommand = "", ...rawArgs] = tokenize(rawInput);
  const command = rawCommand.toLowerCase();
  const args = rawArgs.filter((arg) => !arg.startsWith("-") || command !== "ls");
  const target = args[0];

  switch (command) {
    case "pwd":
      return { cwd: context.cwd, lines: [{ text: context.cwd }] };
    case "whoami":
      return { cwd: context.cwd, lines: [{ text: context.username }] };
    case "uname":
      return {
        cwd: context.cwd,
        lines: [{ text: rawArgs.includes("-a")
          ? `Darwin ${context.hostname} 24.6.0 Darwin Kernel Version 24.6.0: arm64`
          : "Darwin" }],
      };
    case "date":
      return { cwd: context.cwd, lines: [{ text: macDate(context.now ?? new Date(), context.timeZone) }] };
    case "ls": {
      const path = resolvePath(context.cwd, context.home, target ?? ".");
      const node = context.filesystem.get(path);
      if (!node) return error(context.cwd, `ls: ${target ?? path}: No such file or directory`);
      if (node.kind === "file") return { cwd: context.cwd, lines: [{ text: target ?? path }] };
      const lines = [...node.children].sort((a, b) => a.localeCompare(b)).map((name) => {
        const childPath = path === "/" ? `/${name}` : `${path}/${name}`;
        return { text: `${name}${context.filesystem.get(childPath)?.kind === "directory" ? "/" : ""}`, type: "system" as const };
      });
      return { cwd: context.cwd, lines };
    }
    case "cd": {
      const path = resolvePath(context.cwd, context.home, target);
      const node = context.filesystem.get(path);
      if (!node) return error(context.cwd, `cd: no such file or directory: ${target ?? "~"}`);
      if (node.kind !== "directory") return error(context.cwd, `cd: not a directory: ${target}`);
      return { cwd: path, lines: [] };
    }
    case "cat": {
      if (!target) return error(context.cwd, "cat: missing file operand");
      const path = resolvePath(context.cwd, context.home, target);
      const node = context.filesystem.get(path);
      if (!node) return error(context.cwd, `cat: ${target}: No such file or directory`);
      if (node.kind === "directory") return error(context.cwd, `cat: ${target}: Is a directory`);
      return { cwd: context.cwd, lines: node.lines };
    }
    case "open": {
      if (!target) return error(context.cwd, "Usage: open <file>");
      const path = resolvePath(context.cwd, context.home, target);
      const node = context.filesystem.get(path);
      if (!node) return error(context.cwd, `The file ${target} does not exist.`);
      if (node.kind === "directory") return { cwd: path, lines: [{ text: `Opened ${path}`, type: "success" }] };
      if (!node.href) return error(context.cwd, `There is no application set to open ${target}.`);
      return { cwd: context.cwd, lines: [{ text: `Opening ${target}`, type: "success" }], action: { type: "open", href: node.href } };
    }
    case "theme": {
      const mode = rawArgs[0]?.toLowerCase();
      if (mode && mode !== "light" && mode !== "dark") return error(context.cwd, "Usage: theme [light|dark]");
      const normalizedMode = mode === "light" || mode === "dark" ? mode : undefined;
      return { cwd: context.cwd, lines: [], action: { type: "theme", mode: normalizedMode } };
    }
    case "clear":
      return { cwd: context.cwd, lines: [], action: { type: "clear" } };
    case "exit":
    case "quit":
      return { cwd: context.cwd, lines: [], action: { type: "close" } };
    case "help":
      return { cwd: context.cwd, lines: [
        { text: "Manifold macOS shell", type: "system" },
        { text: "ls [path]       list files" },
        { text: "cd [path]       change directory" },
        { text: "cat <file>      read a site file" },
        { text: "open <file>     open its page in the browser" },
        { text: "pwd · whoami · uname -a · date" },
        { text: "theme [mode] · clear · exit" },
      ] };
    case "":
      return { cwd: context.cwd, lines: [] };
    default:
      return error(context.cwd, `zsh: command not found: ${rawCommand}`);
  }
}

export function terminalUsername(handle?: string) {
  return homeUsername(handle);
}
