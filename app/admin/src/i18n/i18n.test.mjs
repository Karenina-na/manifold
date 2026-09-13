import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import en from './en.ts'
import { activeLocale, formatDate, formatDateTime, formatNumber } from './format.ts'
import { parseLocale, resolveLocale, toDayjsLocale, toVditorLocale } from './locale.ts'
import zhCN from './zh-CN.ts'

function leafKeys(value, prefix = '') {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return child && typeof child === 'object' ? leafKeys(child, path) : [path]
  })
}

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function uiSourceFiles() {
  const files = []
  const collect = (directory) => {
    for (const entry of fs.readdirSync(path.join(sourceRoot, directory), { withFileTypes: true })) {
      const relativePath = path.join(directory, entry.name)
      if (entry.isDirectory()) collect(relativePath)
      else if (entry.name.endsWith('.tsx')) files.push(relativePath)
    }
  }
  for (const directory of ['app', 'components', 'features', 'workspaces']) collect(directory)
  return files.sort()
}

function sourceFile(filename) {
  const absolutePath = path.join(sourceRoot, filename)
  return ts.createSourceFile(filename, fs.readFileSync(absolutePath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

function sourcePosition(source, node) {
  const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source))
  return `${source.fileName}:${line + 1}:${character + 1}`
}

function expressionLiterals(node, includeTemplates = false) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [{ node, text: node.text }]
  if (ts.isParenthesizedExpression(node)) return expressionLiterals(node.expression, includeTemplates)
  if (ts.isConditionalExpression(node)) {
    return [...expressionLiterals(node.whenTrue, includeTemplates), ...expressionLiterals(node.whenFalse, includeTemplates)]
  }
  if (ts.isBinaryExpression(node)) {
    if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return expressionLiterals(node.right, includeTemplates)
    if (node.operatorToken.kind === ts.SyntaxKind.BarBarToken || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      return [...expressionLiterals(node.left, includeTemplates), ...expressionLiterals(node.right, includeTemplates)]
    }
  }
  if (includeTemplates && ts.isTemplateExpression(node)) {
    return [{ node, text: [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join('${…}') }]
  }
  return []
}

function visibleCopyViolations(source) {
  const allowedStaticText = new Set(['manifold', 'm', 'manifold.', 'PDF', 'WEB', 'CV'])
  const translatedAttributes = new Set(['alt', 'aria-label', 'description', 'label', 'placeholder', 'title'])
  const violations = []
  const inspect = (literal, context) => {
    const text = literal.text.trim()
    const fixedUrl = /^\$\{…\}\/[a-z/.-]+\$\{…\}$/.test(text)
    if (/[A-Za-z\u4e00-\u9fff]/.test(text) && !allowedStaticText.has(text) && !fixedUrl) {
      violations.push(`${sourcePosition(source, literal.node)} has untranslated ${context} ${JSON.stringify(text)}`)
    }
  }
  const visit = (node) => {
    if (ts.isJsxText(node)) inspect({ node, text: node.text }, 'JSX text')
    if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      for (const literal of expressionLiterals(node.expression, true)) inspect(literal, 'JSX expression text')
    }
    if (ts.isJsxAttribute(node) && translatedAttributes.has(node.name.text) && node.initializer) {
      if (ts.isStringLiteral(node.initializer)) inspect({ node: node.initializer, text: node.initializer.text }, node.name.text)
      if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        for (const literal of expressionLiterals(node.initializer.expression, true)) inspect(literal, node.name.text)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return violations
}

function staticTranslationKeys(source) {
  const keys = []
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't') {
      const [keyNode] = node.arguments
      if (keyNode) keys.push(...expressionLiterals(keyNode))
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return keys
}

test('normalizes supported locale variants and rejects unsupported locales', () => {
  assert.equal(parseLocale('en-US'), 'en')
  assert.equal(parseLocale('EN_us'), 'en')
  assert.equal(parseLocale('zh-Hans-CN'), 'zh-CN')
  assert.equal(parseLocale('zh_TW'), 'zh-CN')
  assert.equal(parseLocale('fr-FR'), null)
  assert.equal(resolveLocale('fr-FR', 'zh-CN'), 'zh-CN')
  assert.equal(resolveLocale('en-GB', 'zh-CN'), 'en')
  assert.equal(activeLocale('zh-CN'), 'zh-CN')
  assert.equal(toDayjsLocale('zh-CN'), 'zh-cn')
  assert.equal(toVditorLocale('en'), 'en_US')
})

test('English and Simplified Chinese resources have identical leaf keys', () => {
  assert.deepEqual(leafKeys(en).sort(), leafKeys(zhCN).sort())
})

test('decorative Admin kickers stay in English across locales', () => {
  const kickerKeys = [
    ['login', 'kicker'],
    ['errorBoundary', 'kicker'],
    ['comments', 'moderationKicker'],
    ['security', 'kicker'],
    ['dashboard', 'kicker'],
    ['profile', 'pageKicker'],
    ['settings', 'kicker'],
    ['writings', 'kicker'],
    ['thoughts', 'kicker'],
    ['media', 'kicker'],
    ['dashboard', 'ranking'],
    ['dashboard', 'community'],
    ['dashboard', 'audit'],
    ['dashboard', 'trend'],
    ['dashboard', 'system'],
    ['profile', 'preview'],
    ['profile', 'identity'],
    ['profile', 'links'],
    ['profile', 'interests'],
    ['profile', 'cv'],
    ['profile', 'series'],
    ['profile', 'contact'],
    ['settings', 'identity'],
    ['settings', 'navigation'],
    ['settings', 'comments'],
    ['settings', 'homepage'],
    ['thoughts', 'provenance'],
    ['media', 'usedBy'],
  ]

  for (const [section, key] of kickerKeys) {
    assert.equal(zhCN[section][key], en[section][key], `${section}.${key} should stay stable`)
  }
})

test('Profile does not expose redundant resume or legacy-period hints', () => {
  const source = fs.readFileSync(path.join(sourceRoot, 'workspaces', 'ProfileWorkspace.tsx'), 'utf8')

  assert.doesNotMatch(source, /resumeDescription|legacyPeriod/)
  assert.equal(leafKeys(en).includes('profile.resumeDescription'), false)
  assert.equal(leafKeys(en).includes('profile.legacyPeriod'), false)
  assert.equal(leafKeys(zhCN).includes('profile.resumeDescription'), false)
  assert.equal(leafKeys(zhCN).includes('profile.legacyPeriod'), false)
})

test('every Admin page keeps user-facing copy behind the translation boundary', () => {
  const violations = uiSourceFiles().flatMap((filename) => visibleCopyViolations(sourceFile(filename)))

  assert.deepEqual(violations, [])
})

test('the Admin copy audit checks JSX expression and accessible-attribute literals', () => {
  const source = ts.createSourceFile('fixture.tsx', `
    function Fixture({ condition }) {
      return <><span>{"Visible copy"}</span><span>{condition ? "First choice" : "Second choice"}</span><button aria-label={"Direct label"} /></>
    }
  `, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

  assert.deepEqual(visibleCopyViolations(source).map((violation) => violation.replace(/^fixture\.tsx:\d+:\d+ has untranslated /, '')), [
    'JSX expression text "Visible copy"',
    'JSX expression text "First choice"',
    'JSX expression text "Second choice"',
    'aria-label "Direct label"',
  ])
})

test('every static Admin translation key exists in both locale resources', () => {
  const enKeys = new Set(leafKeys(en))
  const zhKeys = new Set(leafKeys(zhCN))
  const missing = []

  for (const filename of uiSourceFiles()) {
    const source = sourceFile(filename)
    for (const { node, text: key } of staticTranslationKeys(source)) {
      const hasEnglish = enKeys.has(key) || enKeys.has(`${key}_one`)
      const hasChinese = zhKeys.has(key) || zhKeys.has(`${key}_one`)
      if (!hasEnglish || !hasChinese) {
        missing.push(`${sourcePosition(source, node)} uses missing key ${key}`)
      }
    }
  }

  assert.deepEqual(missing, [])
})

test('the Admin key audit reads conditional and no-substitution template keys', () => {
  const source = ts.createSourceFile('fixture.tsx', 't(condition ? "media.loadError" : "media.notFound"); t(`common.loading`)', ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  assert.deepEqual(staticTranslationKeys(source).map(({ text }) => text), ['media.loadError', 'media.notFound', 'common.loading'])
})

test('date, time, and number helpers honor the requested locale', () => {
  const value = new Date(2024, 0, 2, 15, 4)
  assert.equal(formatDate(value, 'en'), new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric' }).format(value))
  assert.equal(formatDate(value, 'zh-CN'), new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(value))
  assert.equal(formatDateTime(value, 'zh-CN'), new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(value))
  assert.notEqual(formatDate(value, 'en'), formatDate(value, 'zh-CN'))
  const currency = { style: 'currency', currency: 'USD' }
  assert.notEqual(formatNumber(12345.6, 'en', currency), formatNumber(12345.6, 'zh-CN', currency))
  assert.equal(formatDate('not-a-date', 'en'), '—')
})
