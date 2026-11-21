/** 파일 이름 → 문서 보기의 판정(순수). 언어 이름은 `highlight.ts` 에 등록한 lowlight 이름이다. 모르는 확장자는 글 파일로 보지 않는다(보수적). */

const BY_EXT: Record<string, string> = {
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  ksh: "bash",
  ps1: "powershell",
  psm1: "powershell",
  psd1: "powershell",
  bat: "dos",
  cmd: "dos",
  py: "python",
  pyw: "python",
  pyi: "python",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript",
  json: "json",
  jsonc: "json",
  json5: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  cnf: "ini",
  properties: "ini",
  service: "ini",
  timer: "ini",
  socket: "ini",
  desktop: "ini",
  rs: "rust",
  go: "go",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  hxx: "cpp",
  java: "java",
  sql: "sql",
  xml: "xml",
  html: "xml",
  htm: "xml",
  xhtml: "xml",
  svg: "xml",
  xsd: "xml",
  xsl: "xml",
  plist: "xml",
  csproj: "xml",
  svelte: "xml",
  vue: "xml",
  css: "css",
  dockerfile: "dockerfile",
  mk: "makefile",
  mak: "makefile",
  diff: "diff",
  patch: "diff",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
};

/** 확장자보다 먼저 본다 */
const BY_NAME: Record<string, string> = {
  dockerfile: "dockerfile",
  containerfile: "dockerfile",
  makefile: "makefile",
  gnumakefile: "makefile",
  ".bashrc": "bash",
  ".bash_profile": "bash",
  ".bash_login": "bash",
  ".bash_logout": "bash",
  ".bash_aliases": "bash",
  ".zshrc": "bash",
  ".zshenv": "bash",
  ".zprofile": "bash",
  ".zlogin": "bash",
  ".zlogout": "bash",
  ".profile": "bash",
  ".kshrc": "bash",
  ".gitconfig": "ini",
  ".editorconfig": "ini",
  ".npmrc": "ini",
  ".pypirc": "ini",
  "nginx.conf": "nginx",
  pkgbuild: "bash",
};

const TEXT_EXT = new Set([
  "txt",
  "text",
  "log",
  "out",
  "env",
  "csv",
  "tsv",
  "rst",
  "adoc",
  "asciidoc",
  "org",
  "tex",
  "srt",
  "vtt",
  "lock",
  "sum",
  "mod",
  "gradle",
  "tf",
  "tfvars",
  "hcl",
  "pub",
  "pem",
  "crt",
  "csr",
  "gitignore",
  "gitattributes",
  "gitmodules",
  "dockerignore",
  "npmignore",
  "prettierignore",
  "eslintignore",
  "fish",
  "vim",
  "rb",
  "php",
  "lua",
  "pl",
  "swift",
  "kt",
  "kts",
  "scala",
  "cs",
  "fs",
  "r",
  "dart",
  "scss",
  "sass",
  "less",
  "graphql",
  "proto",
]);

const TEXT_NAME = new Set([
  "license",
  "licence",
  "copying",
  "readme",
  "changelog",
  "changes",
  "history",
  "authors",
  "contributors",
  "notice",
  "todo",
  "version",
  "codeowners",
  "procfile",
  "gemfile",
  "rakefile",
  "vagrantfile",
  "jenkinsfile",
  "brewfile",
  "hosts",
  "fstab",
  "crontab",
  "known_hosts",
  "authorized_keys",
  "ssh_config",
  "sshd_config",
  ".env",
  ".vimrc",
  ".inputrc",
  ".tmux.conf",
  ".nvmrc",
  ".node-version",
  ".python-version",
  ".tool-versions",
]);

function baseName(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return path.slice(i + 1).toLowerCase();
}

/** `.bashrc` 처럼 점으로 시작하고 점이 하나뿐이면 그 이름 전체가 확장자다 */
function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1);
}

export function langOf(path: string): string | null {
  const name = baseName(path);
  if (name === "") return null;
  const byName = BY_NAME[name];
  if (byName) return byName;
  if (name.startsWith("dockerfile.") || name.startsWith("containerfile.")) return "dockerfile";
  if (name.endsWith(".conf") && /[/\\]nginx[/\\]/i.test(path)) return "nginx";
  return BY_EXT[extOf(name)] ?? null;
}

export function isTextLike(path: string): boolean {
  if (langOf(path) !== null) return true;
  const name = baseName(path);
  if (name === "") return false;
  if (TEXT_NAME.has(name)) return true;
  if (name.startsWith(".env.")) return true;
  const stem = name.split(".")[0];
  if (stem !== "" && TEXT_NAME.has(stem) && ["", "old", "orig", "bak", "local", "example", "sample"].includes(name.slice(stem.length + 1))) return true;
  return TEXT_EXT.has(extOf(name));
}

export function isMarkdown(path: string): boolean {
  const ext = extOf(baseName(path));
  return ext === "md" || ext === "markdown" || ext === "mdx";
}
