import test from "node:test";
import assert from "node:assert/strict";

import {
  createTerminalFilesystem,
  completeTerminalInput,
  executeTerminalCommand,
  loadAllTerminalContent,
} from "./terminal-filesystem.ts";

const filesystem = createTerminalFilesystem({
  displayName: "Wei Zixiang",
  handle: "@weizi",
  description: "A public digital garden.",
  focus: "Building Manifold",
  contents: [
    {
      kind: "ARTICLE",
      slug: "stable-apis",
      title: "Stable APIs",
      summary: "Interfaces that age well.",
      tags: ["architecture", "api"],
      publishedAt: "2026-09-12T08:00:00Z",
      href: "/writing/stable-apis",
    },
    {
      kind: "THOUGHT",
      slug: "small-notes",
      title: null,
      summary: "Small notes compound.",
      tags: ["notes"],
      publishedAt: "2026-09-11T08:00:00Z",
      href: "/thoughts/small-notes",
    },
  ],
  links: [{ label: "GitHub", href: "https://github.com/example" }],
});

const context = {
  filesystem,
  cwd: "/Users/weizi",
  home: "/Users/weizi",
  username: "weizi",
  hostname: "manifold-mac",
  now: new Date("2026-09-13T09:30:00+08:00"),
};

test("Tab completes commands and unique paths from the current virtual directory", () => {
  assert.equal(completeTerminalInput("ca", context), "cat");
  assert.equal(completeTerminalInput("cd w", context), "cd writings/");
  assert.equal(completeTerminalInput("cat writings/st", context), "cat writings/stable-apis.md");
  assert.equal(completeTerminalInput("cat ../a", { ...context, cwd: "/Users/weizi/writings" }), "cat ../about.md");
  assert.equal(completeTerminalInput("cat z", context), null);
});

test("site content becomes files in the simulated macOS home directory", () => {
  const root = executeTerminalCommand("ls", { ...context, cwd: "/Users/weizi" });
  assert.deepEqual(root.lines.map((line) => line.text), [
    "about.md",
    "links/",
    "now.txt",
    "thoughts/",
    "writings/",
  ]);

  const writings = executeTerminalCommand("ls ~/writings", { ...context, cwd: "/Users/weizi" });
  assert.deepEqual(writings.lines.map((line) => line.text), ["stable-apis.md"]);
});

test("site link labels cannot create paths outside the links directory", () => {
  const safeFilesystem = createTerminalFilesystem({
    displayName: "Wei Zixiang",
    handle: "@weizi",
    description: "A public digital garden.",
    focus: "Building Manifold",
    contents: [],
    links: [{ label: "Work/GitHub", href: "https://github.com/example" }],
  });
  const links = executeTerminalCommand("ls links", { ...context, filesystem: safeFilesystem, cwd: "/Users/weizi" });
  assert.deepEqual(links.lines.map((line) => line.text), ["Work-GitHub.url"]);
  assert.equal(safeFilesystem.has("/Users/weizi/links/Work/GitHub.url"), false);
});

test("all public content pages are mounted for both content kinds", async () => {
  const calls = [];
  const contents = await loadAllTerminalContent(async (kind, page) => {
    calls.push(`${kind}:${page}`);
    return {
      data: [{
        kind,
        slug: `${kind.toLowerCase()}-${page}`,
        title: `${kind} ${page}`,
        summary: "Summary",
        tags: [],
        publishedAt: "2026-09-13T00:00:00Z",
        href: `/${kind.toLowerCase()}/${page}`,
      }],
      totalPages: kind === "ARTICLE" ? 2 : 3,
    };
  });

  assert.deepEqual(calls, ["ARTICLE:1", "THOUGHT:1", "ARTICLE:2", "THOUGHT:2", "THOUGHT:3"]);
  assert.equal(contents.length, 5);
});

test("unsafe site link schemes remain readable but cannot be opened or clicked", () => {
  const unsafeFilesystem = createTerminalFilesystem({
    displayName: "Wei Zixiang",
    handle: "@weizi",
    description: "A public digital garden.",
    focus: "Building Manifold",
    contents: [],
    links: [{ label: "Unsafe", href: "javascript:alert(1)" }],
  });
  const unsafeContext = { ...context, filesystem: unsafeFilesystem, cwd: "/Users/weizi" };
  const file = executeTerminalCommand("cat links/Unsafe.url", unsafeContext);
  assert.equal(file.lines[0].type, undefined);
  assert.equal(file.lines[0].href, undefined);
  assert.equal(executeTerminalCommand("open links/Unsafe.url", unsafeContext).lines[0].type, "error");
});

test("cd resolves parent, home, and absolute paths without escaping the virtual root", () => {
  assert.equal(executeTerminalCommand("cd thoughts", { ...context, cwd: "/Users/weizi" }).cwd, "/Users/weizi/thoughts");
  assert.equal(executeTerminalCommand("cd ..", { ...context, cwd: "/Users/weizi/thoughts" }).cwd, "/Users/weizi");
  assert.equal(executeTerminalCommand("cd /Applications", { ...context, cwd: "/Users/weizi" }).cwd, "/Applications");
  assert.equal(executeTerminalCommand("cd ../../../../", { ...context, cwd: "/Users/weizi" }).cwd, "/");
});

test("cat renders site metadata and open exposes the matching site URL", () => {
  const article = executeTerminalCommand("cat writings/stable-apis.md", { ...context, cwd: "/Users/weizi" });
  assert.match(article.lines.map((line) => line.text).join("\n"), /# Stable APIs/);
  assert.match(article.lines.map((line) => line.text).join("\n"), /Interfaces that age well\./);
  assert.match(article.lines.map((line) => line.text).join("\n"), /architecture, api/);

  const opened = executeTerminalCommand("open thoughts/small-notes.md", { ...context, cwd: "/Users/weizi" });
  assert.deepEqual(opened.action, { type: "open", href: "/thoughts/small-notes" });
});

test("macOS identity commands use the simulated host", () => {
  assert.equal(executeTerminalCommand("pwd", { ...context, cwd: "/Users/weizi/writings" }).lines[0].text, "/Users/weizi/writings");
  assert.equal(executeTerminalCommand("whoami", { ...context, cwd: "/Users/weizi" }).lines[0].text, "weizi");
  assert.match(executeTerminalCommand("uname -a", { ...context, cwd: "/Users/weizi" }).lines[0].text, /^Darwin manifold-mac /);
  assert.equal(executeTerminalCommand("date", { ...context, cwd: "/Users/weizi", timeZone: "UTC" }).lines[0].text, "Sun Sep 13 01:30:00 UTC 2026");
});

test("invalid targets produce zsh-compatible errors", () => {
  const missingDirectory = executeTerminalCommand("cd nowhere", { ...context, cwd: "/Users/weizi" });
  assert.equal(missingDirectory.cwd, "/Users/weizi");
  assert.equal(missingDirectory.lines[0].text, "cd: no such file or directory: nowhere");
  assert.equal(missingDirectory.lines[0].type, "error");

  const directoryAsFile = executeTerminalCommand("cat writings", { ...context, cwd: "/Users/weizi" });
  assert.equal(directoryAsFile.lines[0].text, "cat: writings: Is a directory");
});
