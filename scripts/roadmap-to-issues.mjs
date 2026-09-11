// Turns the work items in ROADMAP.md into GitHub issues, one per bullet.
//
// The roadmap is the plan of record, so the tracker is generated from it rather
// than typed alongside it. Re-running is safe: an issue whose title already
// exists is skipped, so adding a bullet later and running again creates only
// the new one.
//
//   node scripts/roadmap-to-issues.mjs            dry run, prints the plan
//   node scripts/roadmap-to-issues.mjs --create   creates milestones and issues
//
// Requires an authenticated gh for --create.

import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import process from 'node:process'

const GH = process.env.GH_PATH ?? 'gh'
const CREATE = process.argv.includes('--create')

// GitHub applies a secondary rate limit to content creation, separate from the
// hourly REST quota. Creating a hundred issues back to back trips it and the
// run dies halfway, leaving the tracker in a half-built state. A pause between
// creations costs a few minutes and avoids that entirely.
const PAUSE_MS = 1500
const wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

const lines = readFileSync('ROADMAP.md', 'utf8').split('\n')

/** @type {{number: string, title: string, items: {text: string, skills: string|null, group: string|null}[]}[]} */
const phases = []
let phase = null
let inWorkItems = false
let group = null

for (let i = 0; i < lines.length; i++) {
  const line = lines[i]

  const phaseHeading = line.match(/^## Phase (\d+) — (.+)$/)
  if (phaseHeading) {
    phase = { number: phaseHeading[1], title: phaseHeading[2].trim(), items: [] }
    phases.push(phase)
    inWorkItems = false
    group = null
    continue
  }

  if (!phase) continue

  if (/^## /.test(line)) {
    phase = null
    continue
  }

  if (/^### /.test(line)) {
    // Phase 9 lists its items directly under the phase heading; every other
    // phase puts them under "Lots de travail". Definition of Done and Risques
    // are not tickets.
    inWorkItems = /Lots de travail/i.test(line)
    group = null
    continue
  }

  // Phase 9 groups its items by priority instead of using a subheading.
  const priority = line.match(/^\*\*(Priorité [^*]+)\*\*/)
  if (priority) {
    inWorkItems = true
    group = priority[1].trim()
    continue
  }

  if (!inWorkItems) continue

  const bullet = line.match(/^- (?!\[)(.+)$/)
  if (!bullet) continue

  const skillsLine = lines[i + 1]?.match(/^\s+→ skills\s*:\s*(.+)$/)

  phase.items.push({
    text: bullet[1].trim(),
    skills: skillsLine ? skillsLine[1].trim() : null,
    group,
  })
}

// A GitHub issue title has to be short enough to scan in a list. The full
// sentence goes in the body.
function toTitle(text) {
  const plain = text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  const firstSentence = plain.split(/\.\s|\. —| — /)[0].trim()
  return firstSentence.length > 90 ? `${firstSentence.slice(0, 87)}…` : firstSentence
}

const plan = phases.map((p) => ({
  ...p,
  milestone: `Phase ${p.number} — ${p.title}`,
  issues: p.items.map((item) => ({
    title: `[P${p.number}] ${toTitle(item.text)}`,
    body: [
      item.text,
      '',
      item.skills ? `**Skills à charger** : ${item.skills}` : null,
      item.group ? `**Priorité** : ${item.group}` : null,
      '',
      `Issu de \`ROADMAP.md\`, Phase ${p.number} — ${p.title}.`,
      'La definition of done de la phase est dans ce même document.',
    ]
      .filter((l) => l !== null)
      .join('\n'),
    labels: [`phase-${p.number}`],
  })),
}))

const total = plan.reduce((n, p) => n + p.issues.length, 0)

if (!CREATE) {
  for (const p of plan) {
    console.log(`\n${p.milestone}  (${p.issues.length} tickets)`)
    for (const issue of p.issues) console.log(`  ${issue.title}`)
  }
  console.log(`\n${plan.length} jalons, ${total} tickets. Rien créé.`)
  console.log('Relancer avec --create pour les créer.')
  process.exit(0)
}

const gh = (args, allowFail = false) => {
  try {
    return execFileSync(GH, args, { encoding: 'utf8' }).trim()
  } catch (err) {
    if (allowFail) return null
    throw err
  }
}

const repo = gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'])
console.log(`Dépôt : ${repo}`)

// Existing titles, so a second run does not duplicate anything.
const existing = new Set(
  JSON.parse(
    gh(['issue', 'list', '--state', 'all', '--limit', '500', '--json', 'title']),
  ).map((i) => i.title),
)
console.log(`Tickets déjà présents : ${existing.size}`)

for (const p of plan) {
  gh(
    [
      'api',
      `repos/${repo}/milestones`,
      '-f',
      `title=${p.milestone}`,
      '-f',
      `description=Phase ${p.number} de ROADMAP.md`,
    ],
    true,
  )

  gh(['label', 'create', `phase-${p.number}`, '--color', 'ededed', '--force'], true)

  for (const issue of p.issues) {
    if (existing.has(issue.title)) {
      console.log(`  = ${issue.title}`)
      continue
    }
    const url = gh([
      'issue',
      'create',
      '--title',
      issue.title,
      '--body',
      issue.body,
      '--label',
      issue.labels.join(','),
      '--milestone',
      p.milestone,
    ])
    console.log(`  + ${url.split('\n').pop()}`)
    wait(PAUSE_MS)
  }
}

console.log('\nTerminé.')
