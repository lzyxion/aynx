/**
 * **파일 이름 → 문서 보기의 판정** — 순수 모듈 (문서 보기 타일 계약 §2 · §5).
 *
 * - [`langOf`] — 구문 강조 언어(`highlight.ts` 에 등록한 lowlight 이름) 또는 `null`(평문).
 * - [`isTextLike`] — 더블클릭/Enter 가 **미리 보기**로 갈 파일인가. 언어 표에 있거나 아래 텍스트 확장자·이름
 *   목록에 있으면 참. **모르는 확장자는 거짓**(보수적 — 기존 동작: 원격=외부 편집, 로컬=OS 기본 앱).
 * - [`isMarkdown`] — `.md` `.markdown` `.mdx`.
 *
 * 인자는 이름이나 경로(`/` · `\` 둘 다) 아무거나. 대소문자는 보지 않는다.
 */

/** 확장자(점 없이, 소문자) → 언어 */
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

/** 파일 이름(소문자, 확장자 포함) → 언어 — 확장자보다 먼저 본다 */
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

/** 강조는 없지만 글자로 보이는 확장자 */
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

/** 강조는 없지만 글자로 보이는 이름(소문자) — 확장자가 없거나 확장자로는 모르는 것 */
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

/** 경로의 마지막 조각(소문자) */
function baseName(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return path.slice(i + 1).toLowerCase();
}

/** 점 뒤의 확장자(소문자, 점 없이). `.bashrc` 처럼 점으로 시작하고 점이 하나뿐이면 그 이름 전체가 확장자다 */
function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1);
}

/** 이름·경로 → 강조 언어(`highlight.ts` 의 등록 이름) 또는 `null` */
export function langOf(path: string): string | null {
  const name = baseName(path);
  if (name === "") return null;
  const byName = BY_NAME[name];
  if (byName) return byName;
  // `Dockerfile.dev` · `dev.Dockerfile`
  if (name.startsWith("dockerfile.") || name.startsWith("containerfile.")) return "dockerfile";
  // `/etc/nginx/**/*.conf` 는 nginx
  if (name.endsWith(".conf") && /[/\\]nginx[/\\]/i.test(path)) return "nginx";
  return BY_EXT[extOf(name)] ?? null;
}

/** 미리 보기로 열 파일인가 — 언어 표 또는 텍스트 목록 */
export function isTextLike(path: string): boolean {
  if (langOf(path) !== null) return true;
  const name = baseName(path);
  if (name === "") return false;
  if (TEXT_NAME.has(name)) return true;
  // `.env.local` · `README.old` 같은 꼬리 붙은 이름
  if (name.startsWith(".env.")) return true;
  const stem = name.split(".")[0];
  if (stem !== "" && TEXT_NAME.has(stem) && ["", "old", "orig", "bak", "local", "example", "sample"].includes(name.slice(stem.length + 1))) return true;
  return TEXT_EXT.has(extOf(name));
}

/** 마크다운 파일인가(렌더 보기가 되는 것) */
export function isMarkdown(path: string): boolean {
  const ext = extOf(baseName(path));
  return ext === "md" || ext === "markdown" || ext === "mdx";
}
