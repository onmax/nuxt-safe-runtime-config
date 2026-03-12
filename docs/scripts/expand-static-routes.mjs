import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const outputs = [
  resolve('.docs/.output/public'),
  resolve('.docs/.vercel/output/static'),
]

for (const outputDir of outputs) {
  if (!existsSync(outputDir)) {
    continue
  }

  for (const htmlPath of collectHtmlFiles(outputDir)) {
    const relativePath = htmlPath.slice(outputDir.length + 1)

    if (isSpecialRootHtml(relativePath)) {
      continue
    }

    const routeDir = join(outputDir, relativePath.slice(0, -'.html'.length))
    mkdirSync(routeDir, { recursive: true })
    cpSync(htmlPath, join(routeDir, 'index.html'))
  }
}

function collectHtmlFiles(rootDir, currentDir = rootDir, acc = []) {
  for (const entry of readdirSync(currentDir)) {
    const entryPath = join(currentDir, entry)
    const stats = statSync(entryPath)

    if (stats.isDirectory()) {
      collectHtmlFiles(rootDir, entryPath, acc)
      continue
    }

    if (entryPath.endsWith('.html')) {
      acc.push(entryPath)
    }
  }

  return acc
}

function isSpecialRootHtml(relativePath) {
  return ['index.html', '200.html', '404.html'].includes(relativePath)
}
