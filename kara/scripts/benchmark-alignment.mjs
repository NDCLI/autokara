#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const args = process.argv.slice(2)
if (args.includes('--help') || args.length === 0) {
  process.stdout.write('Usage: npm run benchmark:alignment -- <dataset.json> [report.json]\n')
  process.stdout.write('Dataset schema and annotation guidance: benchmarks/README.md\n')
  process.exit(args.length === 0 ? 2 : 0)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const inputPath = path.resolve(args[0])
const outputPath = path.resolve(args[1] ?? `${inputPath}.report.json`)
let server
try {
  const dataset = JSON.parse(await readFile(inputPath, 'utf8'))
  server = await createServer({
    configFile: false,
    root,
    logLevel: 'error',
    server: { middlewareMode: true },
    appType: 'custom',
  })
  const { benchmarkAlignment, validateBenchmarkDataset } = await server.ssrLoadModule('/src/engine/alignmentBenchmark.ts')
  validateBenchmarkDataset(dataset)
  const report = benchmarkAlignment(dataset)
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ current: report.aggregate, legacyBaseline: report.baseline.aggregate, delta: report.comparison }, null, 2)}\nReport: ${outputPath}\n`)
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await server?.close()
}
