const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'server', 'skills.js');
let content = fs.readFileSync(filePath, 'utf8');

// Step 1: Change the import for './config.js' to import { readFile, writeFile } from 'node:fs/promises'
// We'll replace the line: import { DATA_DIR, readJson, writeJsonAtomic } from './config.js'
// with: import { readFile, writeFile } from 'node:fs/promises'
// But note we also have: import path from 'node:path' and import { randomUUID } from 'node:crypto'
// We want to keep those and add the fs/promises import.

// Let's split the content into lines.
const lines = content.split('\n');

// Find the line that imports from './config.js'
let configImportIndex = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("from './config.js'")) {
    configImportIndex = i;
    break;
  }
}

if (configImportIndex === -1) {
  console.error("Could not find the import line for './config.js'");
  process.exit(1);
}

// We'll replace that line with: import { readFile, writeFile } from 'node:fs/promises'
// But note: we already have an import for readFile from 'node:fs/promises'? Let's check.
// Actually, the current line is: import { DATA_DIR, readJson, writeJsonAtomic } from './config.js'
// We want to remove DATA_DIR, readJson, writeJsonAtomic and add readFile and writeFile from 'node:fs/promises'
// However, we already have an import for readFile from 'node:fs/promises' at the top? Let's see the original:

// Original imports:
// import path from 'node:path'
// import { randomUUID } from 'node:crypto'
// import { DATA_DIR, readJson, writeJsonAtomic } from './config.js'

// We want to change to:
// import path from 'node:path'
// import { randomUUID } from 'node:crypto'
// import { readFile, writeFile } from 'node:fs/promises'

// So we replace the line at configImportIndex.
lines[configImportIndex] = "import { readFile, writeFile } from 'node:fs/promises'";

// Step 2: Remove the SKILLS_FILE constant line.
// Find the line: const SKILLS_FILE = path.join(DATA_DIR, 'skills.json');
let skillsFileIndex = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("const SKILLS_FILE = path.join(DATA_DIR, 'skills.json');")) {
    skillsFileIndex = i;
    break;
  }
}

if (skillsFileIndex !== -1) {
  // Remove that line
  lines.splice(skillsFileIndex, 1);
} else {
  console.warn("Could not find the SKILLS_FILE line to remove");
}

// Step 3: Add the LOCAL_SKILLS_REPO_PATH constant after the imports.
// We'll insert it after the last import line.
// Let's find the last import line (the line that ends with a semicolon and is an import, but we can just insert after the config import line we just changed).
// We'll insert after the line we just changed (which is now at configImportIndex).
// But note: we removed the SKILLS_FILE line, so the indices might have shifted.
// Let's recalc: we removed a line at skillsFileIndex, which was after configImportIndex? Let's assume it was after.

// Instead, let's find the line after the imports by looking for a line that is not an import and not empty.
// We'll do a simpler approach: insert the constant after the last import line we know.
// We know the imports are at the top. We'll insert after the line we changed (the fs/promises import) and after the other two imports.

// Let's just insert after the line we changed (configImportIndex) and then skip any empty lines.
// We'll insert at configImportIndex + 1, but we have to account for the removal of the SKILLS_FILE line.

// Let's rebuild the array and then insert the constant after the imports by finding the first non-import, non-empty line after the imports.

// We'll do: after we have made the changes above (replaced the import and removed the SKILLS_FILE line),
// we now find the position to insert the constant.

// Let's join the lines back and then split again to have a clean state? Or we can just continue.

// We'll insert the constant after the last of the three imports we know.
// We know the three imports are:
//   import path from 'node:path'
//   import { randomUUID } from 'node:crypto'
//   import { readFile, writeFile } from 'node:fs/promises'
// They might not be consecutive now because we removed a line in between? Actually, we removed the SKILLS_FILE line which was after the config import.

// Let's just insert the constant after the line we changed (the fs/promises import) and then if there's an empty line, we can put it there.

// We'll insert at configImportIndex + 1.
lines.splice(configImportIndex + 1, 0, "const LOCAL_SKILLS_REPO_PATH = join(process.cwd(), 'local_skills_repo', 'skills.json');");

// Step 4: Replace the loadUserSkills function.
// We need to find the function and replace its body.
let loadUserSkillsStart = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim().startsWith("async function loadUserSkills()")) {
    loadUserSkillsStart = i;
    break;
  }
}

if (loadUserSkillsStart === -1) {
  console.error("Could not find loadUserSkills function");
  process.exit(1);
}

// Find the end of the function by counting braces.
let braceCount = 0;
let loadUserSkillsEnd = -1;
for (let i = loadUserSkillsStart; i < lines.length; i++) {
  braceCount += (lines[i].match(/{/g) || []).length;
  braceCount -= (lines[i].match(/}/g) || []).length;
  if (braceCount === 0 && i > loadUserSkillsStart) {
    loadUserSkillsEnd = i;
    break;
  }
}

if (loadUserSkillsEnd === -1) {
  console.error("Could not find the end of loadUserSkills function");
  process.exit(1);
}

// Replace the function body.
const newLoadUserSkills = [
  "async function loadUserSkills() {",
  "  try {",
  "    const data = await readFile(LOCAL_SKILLS_REPO_PATH, 'utf8');",
  "    const json = JSON.parse(data);",
  "    return Array.isArray(json) ? json : [];",
  "  } catch (err) {",
  "    console.warn('Failed to load user skills from local skills repo:', err);",
  "    return [];",
  "  }",
  "}"
];
lines.splice(loadUserSkillsStart, loadUserSkillsEnd - loadUserSkillsStart + 1, ...newLoadUserSkills);

// Step 5: Replace the saveUserSkills function.
let saveUserSkillsStart = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim().startsWith("async function saveUserSkills(skills)")) {
    saveUserSkillsStart = i;
    break;
  }
}

if (saveUserSkillsStart === -1) {
  console.error("Could not find saveUserSkills function");
  process.exit(1);
}

// Find the end of the function.
braceCount = 0;
let saveUserSkillsEnd = -1;
for (let i = saveUserSkillsStart; i < lines.length; i++) {
  braceCount += (lines[i].match(/{/g) || []).length;
  braceCount -= (lines[i].match(/}/g) || []).length;
  if (braceCount === 0 && i > saveUserSkillsStart) {
    saveUserSkillsEnd = i;
    break;
  }
}

if (saveUserSkillsEnd === -1) {
  console.error("Could not find the end of saveUserSkills function");
  process.exit(1);
}

// Replace the function body.
const newSaveUserSkills = [
  "async function saveUserSkills(skills) {",
  "  try {",
  "    await writeFile(LOCAL_SKILLS_REPO_PATH, JSON.stringify(skills, null, 2));",
  "  } catch (err) {",
  "    console.error('Failed to save user skills to local skills repo:', err);",
  "  }",
  "}"
];
lines.splice(saveUserSkillsStart, saveUserSkillsEnd - saveUserSkillsStart + 1, ...newSaveUserSkills);

// Write the file back.
const newContent = lines.join('\n');
fs.writeFileSync(filePath, newContent, 'utf8');
console.log('Updated server/skills.js to use local skills repository');
