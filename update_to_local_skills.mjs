import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const filePath = join(process.cwd(), 'server', 'index.js');
let content = await readFile(filePath, 'utf8');

// Find the SKILLS_CACHE_TTL line
const skillsCacheTTLLine = 'const SKILLS_CACHE_TTL = 5 * 60 * 1000 // 5 minutes';
const skillsCacheTTLIndex = content.indexOf(skillsCacheTTLLine);
if (skillsCacheTTLIndex === -1) {
  console.error('Could not find SKILLS_CACHE_TTL line');
  process.exit(1);
}

// Find the end of that line (after the newline)
const lineEndIndex = content.indexOf('\n', skillsCacheTTLIndex);
if (lineEndIndex === -1) {
  console.error('Could not find end of SKILLS_CACHE_TTL line');
  process.exit(1);
}
// Move to the next character after the newline
let insertPoint = lineEndIndex + 1;

// Find the start of the MIME constant after the SKILLS_CACHE_TTL line
const mimeStart = content.indexOf('const MIME = {', insertPoint);
if (mimeStart === -1) {
  console.error('Could not find MIME constant');
  process.exit(1);
}

// The new code to insert between the SKILLS_CACHE_TTL line and the MIME constant
const newCode = `

async function loadSkillsFromLocalRepo() {
  try {
    const localRepoPath = join(process.cwd(), 'local_skills_repo');
    const skillsPath = join(localRepoPath, 'skills.json');
    const data = await readFile(skillsPath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Failed to load skills from local repository:', err);
    return null;
  }
}

async function getSkills() {
  const now = Date.now();
  if (skillsCache && (now - skillsCacheTimestamp) < SKILLS_CACHE_TTL) {
    return skillsCache;
  }
  const fetchedSkills = await loadSkillsFromLocalRepo();
  if (fetchedSkills) {
    skillsCache = fetchedSkills;
    skillsCacheTimestamp = now;
    return skillsCache;
  }
  // Fallback to curated list
  return CURATED_SKILLS;
}`;

// Replace the section between the end of SKILLS_CACHE_TTL line and the start of MIME constant
content = content.slice(0, insertPoint) + newCode + content.slice(mimeStart);

// Write the file back
await writeFile(filePath, content, 'utf8');
console.log('Updated server/index.js to use local skills repository');
