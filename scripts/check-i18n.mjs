import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { diffCatalog, pendingTranslations, readJson, targetLanguages, validateCatalogs } from './i18n-catalogs.mjs';

const base = process.argv[2];
function fromBase(path) {
  if (!base || /^0{40}$/.test(base)) return {};
  try {
    return JSON.parse(execFileSync('git', ['show', `${base}:${path}`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    const paths = execFileSync('git', ['ls-tree', '--name-only', base, '--', path], { encoding: 'utf8' });
    if (paths.trim()) throw new Error(`Cannot read ${path} at ${base}`);
    return {};
  }
}

const en = readJson('i18n/en.json');
const coverage = readJson('i18n/coverage.json');
const reviewed = readJson('i18n/reviewed.json');
const catalogs = Object.fromEntries(targetLanguages.map((locale) => [locale, readJson(`i18n/${locale}.json`)]));
const baseCoverage = fromBase('i18n/coverage.json');
const baseLanguages = Object.keys(fromBase('i18n/reviewed.json'));
const errors = validateCatalogs(en, catalogs, reviewed, coverage, baseCoverage, baseLanguages);
for (const module of Object.keys(baseCoverage)) {
  if (!Object.hasOwn(coverage, module)) errors.push(`Coverage was removed for ${module}`);
}

const files = execFileSync('git', ['ls-files', '-z', '--', '*.tsx', '*.ts', '*.mjs'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const visibleProperties = /^(?:title|label|description|aria-label|ariaLabel|placeholder|alt|tooltip|aria-description|message)$/;
for (const file of files) {
  const module = Object.values(coverage).find(({ paths }) => paths.some((path) => path.endsWith('/') ? file.startsWith(path) : file === path));
  if (!module && !['App.tsx', 'electron.mjs', 'electron/exrIpc.mjs', 'components/Footer.tsx', 'components/ProPlanSelector.tsx', 'components/RatingStars.tsx', 'components/Sidebar.tsx', 'hooks/useImageLoader.ts'].includes(file)) continue;
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const exceptions = new Set(module?.literalExceptions);
  function report(node, error) {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    errors.push(`${file}:${line + 1}: ${error}`);
  }
  function literal(node) {
    if (!node) return;
    if (ts.isConditionalExpression(node)) {
      literal(node.whenTrue);
      literal(node.whenFalse);
      return;
    }
    if (ts.isBinaryExpression(node) && [
      ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken,
    ].includes(node.operatorToken.kind)) {
      literal(node.right);
      return;
    }
    if (ts.isTemplateExpression(node)) {
      for (const part of [node.head, ...node.templateSpans.map((span) => span.literal)]) literal(part);
      return;
    }
    if (!ts.isJsxText(node) && !ts.isStringLiteralLike(node) && !ts.isTemplateLiteralToken(node)) return;
    const value = node.text.trim().replace(/\s+/g, ' ');
    if (/\p{L}/u.test(value) && !exceptions.has(value) && !/^https?:\/\//.test(value)) {
      report(node, `Move interface text into a catalog: ${value}`);
    }
  }
  function visit(node) {
    if (ts.isCallExpression(node) && node.arguments.length) {
      const first = node.arguments[0];
      const key = ts.isStringLiteralLike(first) ? first.text : undefined;
      if (key && /^[a-zA-Z-]+\.[a-zA-Z]/.test(key) && ['t', 'translate', 'translateApp', 'folderText'].includes(node.expression.getText(source)) && !Object.hasOwn(en, key)) {
        report(first, `Unknown message: ${key}`);
      }
    }
    if (module) {
      if (ts.isJsxText(node)) literal(node);
      if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent)) literal(node.expression);
      if (ts.isJsxAttribute(node) && visibleProperties.test(node.name.getText(source))) {
        literal(node.initializer && ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer);
      }
      if (ts.isPropertyAssignment(node) && visibleProperties.test(node.name.getText(source))) literal(node.initializer);
      if (ts.isJsxAttribute(node) && node.parent.parent.tagName.getText(source) === 'IntegrationCard' && node.name.getText(source) === 'name') {
        literal(node.initializer);
      }
      if (ts.isCallExpression(node) && /^(?:window\.)?(?:alert|confirm)$/.test(node.expression.getText(source))) {
        literal(node.arguments[0]);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

const diff = diffCatalog(fromBase('i18n/en.json'), en);
const summary = [
  '### Translation catalog',
  ...Object.entries(diff).flatMap(([status, keys]) => [`- ${status}: ${keys.length}`, ...keys.map((key) => `  - ${key}`)]),
  ...pendingTranslations(en, catalogs, reviewed, coverage).map(({ key, locale }) => `- Pending review: ${locale} · ${key}`),
];
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join('\n') + '\n');
console.log(summary.join('\n'));
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
}
