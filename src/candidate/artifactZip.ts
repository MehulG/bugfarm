import { constants } from "node:fs";
import { access, lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { deflateRawSync } from "node:zlib";

type ZipEntry = {
  name: string;
  data: Buffer;
  mode?: number;
};

const CRC_TABLE = createCrcTable();

export async function createCandidateRepoZip(artifactPath: string): Promise<Buffer> {
  const candidateRepoPath = path.join(artifactPath, "candidate-repo");
  const taskPath = path.join(artifactPath, "candidate", "TASK.md");
  const entries: ZipEntry[] = [];

  await access(candidateRepoPath, constants.R_OK);

  const originalReadme = await readOptionalFile(path.join(candidateRepoPath, "README.md"));
  const task = await readOptionalFile(taskPath);

  entries.push({
    name: "README.md",
    data: Buffer.from(buildCandidateReadme(task, originalReadme), "utf8"),
    mode: 0o100644,
  });
  entries.push({
    name: "AI_ASSISTANT.md",
    data: Buffer.from(buildAiAssistantReadme(), "utf8"),
    mode: 0o100644,
  });

  for (const file of await walkFiles(candidateRepoPath)) {
    const relative = toZipPath(path.relative(candidateRepoPath, file));
    if (relative === "README.md" || relative.startsWith(".git/")) {
      continue;
    }

    const stats = await lstat(file);
    if (!stats.isFile()) {
      continue;
    }

    entries.push({
      name: relative,
      data: await readFile(file),
      mode: stats.mode,
    });
  }

  return writeZip(entries);
}

function buildCandidateReadme(task?: string, originalReadme?: string): string {
  const parts: string[] = [];

  if (task?.trim()) {
    parts.push(`# Assessment Instructions\n\n${task.trim()}\n\n## AI Assistance\n\nCline is preconfigured in the editor sidebar. You can also use \`bugfarm-ai "your question"\` in the terminal. See \`AI_ASSISTANT.md\` for details.\n`);
  } else {
    parts.push("# Assessment Instructions\n\nFix the issue in this repository.\n\n## AI Assistance\n\nCline is preconfigured in the editor sidebar. You can also use `bugfarm-ai \"your question\"` in the terminal. See `AI_ASSISTANT.md` for details.\n");
  }

  if (originalReadme?.trim()) {
    parts.push(`---\n\n# Repository README\n\n${originalReadme.trim()}\n`);
  }

  return `${parts.join("\n")}\n`;
}

function buildAiAssistantReadme(): string {
  return `# AI Assistant

AI help is available in this workspace without using any personal API key.

## Cline Sidebar

Cline is preconfigured in the left activity bar. Open Cline and start typing
your question or requested code change.

It uses a session-scoped BugFarm proxy token. The real provider API key is not
available inside this workspace.

## Terminal Assistant

Use:

\`\`\`sh
bugfarm-ai "explain this repository"
bugfarm-ai "where should I start debugging?"
bugfarm-ai "suggest a patch for the failing behavior"
\`\`\`

If Cline ever asks for setup again, choose "Bring my own API key" and use:

- Provider: OpenAI Compatible
- Base URL: value of \`$AI_PROXY_URL\`
- API key: value of \`$AI_PROXY_TOKEN\`
- Model ID: \`bugfarm-ai\`

These values are scoped to this assessment workspace. They are not real provider
API keys.
`;
}

async function walkFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await walkFiles(fullPath)));
      continue;
    }

    if (entry.isFile()) {
      output.push(fullPath);
    }
  }

  return output.sort();
}

async function readOptionalFile(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function toZipPath(value: string): string {
  return value.split(path.sep).join("/");
}

function writeZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data);
    const crc = crc32(entry.data);
    const mode = entry.mode ?? 0o100644;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(((mode & 0xffff) << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function crc32(input: Buffer): number {
  let crc = 0xffffffff;

  for (const byte of input) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function createCrcTable(): number[] {
  const table: number[] = [];

  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }

  return table;
}
