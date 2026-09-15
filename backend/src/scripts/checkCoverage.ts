/**
 * Fails when test coverage falls under the roadmap's objective: 70 % of lines
 * overall, 90 % in src/services/, where the send engine, the template and the
 * CSV import live.
 *
 * Reads the lcov report Node's test runner writes. Node maps coverage back to
 * TypeScript through source maps, and every line with no JavaScript behind it
 * comes back uncovered: comments, `import type`, interfaces, type aliases. A
 * file that is half documentation would read as half untested. Those lines are
 * set aside here, using the TypeScript parser rather than guesswork, so the
 * percentage measures code.
 *
 * Usage: npx tsx src/scripts/checkCoverage.ts [coverage/lcov.info]
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import ts from 'typescript'

interface Threshold {
  label: string
  lines: number
  includes: (file: string) => boolean
}

const THRESHOLDS: Threshold[] = [
  // Command-line scripts are thin wrappers over tested services.
  { label: 'all files', lines: 70, includes: (file) => !file.startsWith('src/scripts/') },
  {
    label: 'src/services/',
    lines: 90,
    includes: (file) => file.startsWith('src/services/'),
  },
]

/** Reads a file this script was pointed at: the report, or a source the report names. */
function read(file: string): string {
  // The paths come from the command line and from the coverage report of this
  // repository, never from a request.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return readFileSync(file, 'utf8')
}

/** Lines of a TypeScript file that compile to nothing. */
function linesWithoutCode(file: string): Set<number> {
  const source = read(file)
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const skipped = new Set<number>()

  const lineOf = (position: number) =>
    tree.getLineAndCharacterOfPosition(position).line + 1

  const visit = (node: ts.Node): void => {
    if (
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      (ts.isImportDeclaration(node) &&
        node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword) ||
      (ts.isExportDeclaration(node) && node.isTypeOnly)
    ) {
      for (
        let line = lineOf(node.getStart(tree));
        line <= lineOf(node.getEnd());
        line++
      ) {
        skipped.add(line)
      }
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)

  // Blank lines and lines that hold only a comment.
  source.split('\n').forEach((text, index) => {
    const trimmed = text.trim()
    if (
      trimmed === '' ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*')
    ) {
      skipped.add(index + 1)
    }
  })

  return skipped
}

interface FileCoverage {
  file: string
  total: number
  covered: number
}

function readReport(lcovPath: string): FileCoverage[] {
  const files: FileCoverage[] = []

  for (const record of read(lcovPath).split('end_of_record')) {
    const sourceLine = /^SF:(.+)$/m.exec(record)?.[1]
    if (!sourceLine) {
      continue
    }

    const absolute = path.resolve(sourceLine.trim())
    const file = path.relative(process.cwd(), absolute).split(path.sep).join('/')

    if (file.endsWith('.test.ts') || file.startsWith('..')) {
      continue
    }

    const skipped = linesWithoutCode(absolute)
    let total = 0
    let covered = 0

    for (const [, line, hits] of record.matchAll(/^DA:(\d+),(\d+)/gm)) {
      if (skipped.has(Number(line))) {
        continue
      }
      total++
      if (Number(hits) > 0) {
        covered++
      }
    }

    files.push({ file, total, covered })
  }

  return files
}

const percent = (covered: number, total: number) =>
  total === 0 ? 100 : (covered / total) * 100

const files = readReport(process.argv[2] ?? 'coverage/lcov.info')
let failed = false

for (const threshold of THRESHOLDS) {
  const scope = files.filter(({ file }) => threshold.includes(file))
  const total = scope.reduce((sum, entry) => sum + entry.total, 0)
  const covered = scope.reduce((sum, entry) => sum + entry.covered, 0)
  const value = percent(covered, total)
  const ok = value >= threshold.lines

  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${threshold.label.padEnd(14)} ${value.toFixed(2)} % of lines (objective ${String(threshold.lines)} %)`,
  )

  // The files under the objective, worst first, so a failure says where to look.
  for (const entry of scope
    .filter((candidate) => percent(candidate.covered, candidate.total) < threshold.lines)
    .sort((a, b) => percent(a.covered, a.total) - percent(b.covered, b.total))) {
    console.log(
      `       ${percent(entry.covered, entry.total).toFixed(1).padStart(5)} %  ${entry.file}`,
    )
  }

  failed ||= !ok
}

process.exitCode = failed ? 1 : 0
