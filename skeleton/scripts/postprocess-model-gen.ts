/**
 * Post-processor for openapi-typescript generated model-gen.ts
 *
 * Fixes circular type references that TypeScript cannot resolve as inline type aliases.
 * e.g. EIP712TypedValue -> EIP712TypeObject -> EIP712TypedValue (circular)
 *
 * Strategy: detect schemas that reference themselves (directly or via sibling schemas),
 * then rewrite only those schemas as standalone recursive type aliases placed outside
 * the components interface so TypeScript can handle the recursion.
 */
import * as fs from "fs";
import * as path from "path";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: ts-node postprocess-model-gen.ts <path-to-model-gen.ts>");
  process.exit(1);
}

const absolutePath = path.resolve(filePath);
let content = fs.readFileSync(absolutePath, "utf-8");

// ---------------------------------------------------------------------------
// 1. Parse all schema members from `schemas: { ... }` including multi-line ones.
//    Members are at 8-space indent; we detect each member start and collect
//    only the lines that belong to its definition (excluding comments/blanks
//    that belong to the next member).
// ---------------------------------------------------------------------------
interface SchemaDef {
  name: string;
  fullText: string;   // the complete member text including indentation
  body: string;        // the type expression after "Name: "
  deps: string[];      // schema names referenced via components["schemas"]["X"]
}

const lines = content.split("\n");
const schemas = new Map<string, SchemaDef>();

// Find the `schemas: {` section inside `components`
let schemasStart = -1;
let schemasEnd = -1;
for (let i = 0; i < lines.length; i++) {
  if (/^ {4}schemas: \{/.test(lines[i]) || lines[i].trimEnd() === "    schemas: {") {
    schemasStart = i + 1;
  }
}

if (schemasStart === -1) {
  console.log("Could not find schemas section. No changes needed.");
  process.exit(0);
}

// Find all top-level schema members (indented 8 spaces, name followed by colon)
const memberStarts: number[] = [];
for (let i = schemasStart; i < lines.length; i++) {
  if (/^ {4}\};?$/.test(lines[i]) || /^ {4}\}/.test(lines[i])) {
    schemasEnd = i;
    break;
  }
  if (/^ {8}\w+:/.test(lines[i]) && !/^ {8} /.test(lines[i])) {
    memberStarts.push(i);
  }
}

if (schemasEnd === -1) schemasEnd = lines.length;

// For each member, find the true end of its definition: scan backwards from
// the next member start to skip blank lines and JSDoc comment blocks.
function findMemberEnd(start: number, rawEnd: number): number {
  let end = rawEnd;
  // Walk backwards past blank lines
  while (end > start && lines[end - 1].trim() === "") end--;
  // Walk backwards past JSDoc comment lines (they belong to the next member)
  // A JSDoc comment block: lines matching `         * ...` or `        /**` or `         */`
  let commentEnd = end;
  while (commentEnd > start) {
    const line = lines[commentEnd - 1];
    if (/^ {8,}\*/.test(line) || /^ {8}\/\*\*/.test(line)) {
      commentEnd--;
    } else {
      break;
    }
  }
  // Only strip the comment if we actually found one (commentEnd < end)
  if (commentEnd < end && commentEnd > start) {
    end = commentEnd;
  }
  // Strip trailing blanks again after removing comment
  while (end > start && lines[end - 1].trim() === "") end--;
  return end;
}

// Parse each member
for (let idx = 0; idx < memberStarts.length; idx++) {
  const start = memberStarts[idx];
  const rawEnd = idx + 1 < memberStarts.length ? memberStarts[idx + 1] : schemasEnd;
  const end = findMemberEnd(start, rawEnd);

  const memberLines = lines.slice(start, end);
  const fullText = memberLines.join("\n");

  // Extract name
  const nameMatch = lines[start].match(/^ {8}(\w+):/);
  if (!nameMatch) continue;
  const name = nameMatch[1];

  // Extract body (everything after "Name: " on the first line, plus continuation lines)
  const firstLineBody = lines[start].replace(/^ {8}\w+:\s*/, "");
  const restLines = memberLines.slice(1);
  const body = [firstLineBody, ...restLines].join("\n").replace(/;\s*$/, "").trim();

  // Find deps
  const deps: string[] = [];
  const refPattern = /components\["schemas"\]\["(\w+)"\]/g;
  let refMatch: RegExpExecArray | null;
  while ((refMatch = refPattern.exec(fullText)) !== null) {
    deps.push(refMatch[1]);
  }

  schemas.set(name, { name, fullText, body, deps });
}

// ---------------------------------------------------------------------------
// 2. Find all schemas involved in cycles via DFS
// ---------------------------------------------------------------------------
function findCyclicSchemas(): Set<string> {
  const cyclic = new Set<string>();
  const visited = new Set<string>();
  const stack = new Set<string>();

  function dfs(name: string): boolean {
    if (stack.has(name)) {
      cyclic.add(name);
      return true;
    }
    if (visited.has(name)) return false;
    visited.add(name);
    stack.add(name);

    const schema = schemas.get(name);
    if (schema) {
      for (const dep of schema.deps) {
        if (dfs(dep)) {
          cyclic.add(name);
        }
      }
    }

    stack.delete(name);
    return false;
  }

  for (const name of schemas.keys()) {
    dfs(name);
  }
  return cyclic;
}

const cyclicNames = findCyclicSchemas();

if (cyclicNames.size === 0) {
  console.log("No circular type references found. No changes needed.");
  process.exit(0);
}

console.log(`Found circular schemas: ${[...cyclicNames].join(", ")}`);

// ---------------------------------------------------------------------------
// 3. Recursively inline non-cyclic component refs so the extracted types are
//    fully self-contained (no references to `components` which is out of scope).
//    Cyclic refs become forward-references to other extracted type aliases.
// ---------------------------------------------------------------------------

function aliasName(schemaName: string): string {
  return `Recursive${schemaName}`;
}

function resolveBody(body: string, resolving = new Set<string>()): string {
  return body.replace(/components\["schemas"\]\["(\w+)"\]/g, (_m, refName: string) => {
    if (cyclicNames.has(refName)) {
      return aliasName(refName);
    }
    const dep = schemas.get(refName);
    if (dep && !resolving.has(refName)) {
      resolving.add(refName);
      const resolved = resolveBody(dep.body, resolving);
      resolving.delete(refName);
      return `(${resolved})`;
    }
    return _m;
  });
}

const extractedTypes: string[] = [];

for (const name of cyclicNames) {
  const schema = schemas.get(name);
  if (!schema) continue;

  const resolvedBody = resolveBody(schema.body);
  extractedTypes.push(`type ${aliasName(name)} = ${resolvedBody};`);

  // Replace the inline member with a single-line reference to the extracted type
  content = content.replace(schema.fullText, `        ${name}: ${aliasName(name)};`);
}

// ---------------------------------------------------------------------------
// 4. Insert extracted type aliases before `export interface paths {`
// ---------------------------------------------------------------------------
const insertionPoint = "export interface paths {";
const typeBlock = [
  "/** Extracted recursive types to break circular references in generated schemas */",
  ...extractedTypes,
  "",
].join("\n");

content = content.replace(insertionPoint, typeBlock + insertionPoint);

fs.writeFileSync(absolutePath, content, "utf-8");
console.log(`Patched ${absolutePath} — extracted ${extractedTypes.length} recursive type(s).`);
