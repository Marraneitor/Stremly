/* ============================================================
   Skill: Code Analyzer — Análisis estático de código
   ============================================================
   Detecta errores de sintaxis, problemas comunes y genera
   reportes de calidad para JS, Python, HTML, CSS y más.
   ============================================================ */

const { ESLint } = require('eslint');
const acorn = require('acorn');

// Pre-compilar todas las regex para evitar recompilación por llamada
const RE_PYTHON    = /^(import |from |def |class |print\(|if __name__|elif |except:)/m;
const RE_HTML      = /^<!DOCTYPE|<html|<head|<body|<div/mi;
const RE_CSS_BLOCK = /^[.#@][a-zA-Z][\s\S]*\{[\s\S]*\}/m;
const RE_CSS_NEG   = /function|const|let|var/;
const RE_SQL       = /^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\s/mi;
const RE_JSON_HINT = /^\s*[{[]/;
const RE_INDENT    = /^(\s+)/;
const RE_PRINT_PY2 = /^\s*print\s+[^(]/;
const RE_COMMENT   = /^\s*#/;
const RE_PY_BLOCK  = /^\s*(if|elif|else|for|while|def|class|try|except|finally|with)\b/;
const RE_PY_COLON  = /#.*$/;
const RE_EVAL      = /\beval\s*\(/;
const RE_INNERHTML = /\.innerHTML\s*=/;
const RE_LOOSE_EQ  = /[^!=]==[^=]/;
const RE_CONSOLE   = /console\.(log|debug|info)\(/;
const RE_EXCEPT_GEN= /^\s*except\s*:/;
const RE_IMPORT_STAR= /from\s+\S+\s+import\s+\*/;
const RE_MUTABLE_DEFAULT = /def\s+\w+\([^)]*=\s*(\[\]|\{\})/;
const RE_TODO      = /(TODO|FIXME|HACK|XXX)\b:?\s*(.+)/i;

class CodeAnalyzer {
  constructor() {
    this.eslint = new ESLint({
      useEslintrc: false,
      overrideConfig: {
        env: { browser: true, node: true, es2021: true },
        parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
        rules: {
          'no-unused-vars': 'warn',
          'no-undef': 'error',
          'no-console': 'off',
          'semi': ['warn', 'always'],
          'no-extra-semi': 'warn',
          'no-unreachable': 'error',
          'no-constant-condition': 'warn',
          'no-dupe-keys': 'error',
          'no-dupe-args': 'error',
          'no-duplicate-case': 'error',
          'no-empty': 'warn',
          'no-func-assign': 'error',
          'no-inner-declarations': 'error',
          'no-irregular-whitespace': 'warn',
          'no-sparse-arrays': 'warn',
          'use-isnan': 'error',
          'valid-typeof': 'error',
          'eqeqeq': 'warn',
          'no-eval': 'error',
          'no-implied-eval': 'error',
          'no-redeclare': 'error',
          'no-self-assign': 'warn',
          'no-self-compare': 'warn',
          'no-throw-literal': 'warn',
          'prefer-const': 'warn',
          'no-var': 'warn'
        }
      }
    });
  }

  /**
   * Detectar el lenguaje del código
   */
  detectLanguage(code) {
    if (RE_PYTHON.test(code)) return 'python';
    if (RE_HTML.test(code)) return 'html';
    if (RE_CSS_BLOCK.test(code) && !RE_CSS_NEG.test(code)) return 'css';
    if (RE_SQL.test(code)) return 'sql';
    // JSON: verificar solo si parece JSON (empieza con { o [) para evitar JSON.parse costoso
    if (RE_JSON_HINT.test(code)) {
      try { JSON.parse(code); return 'json'; } catch (_) {}
    }
    return 'javascript';
  }

  /**
   * Análisis de sintaxis JavaScript con Acorn
   */
  analyzeSyntaxJS(code) {
    const errors = [];
    try {
      acorn.parse(code, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        locations: true,
        allowReturnOutsideFunction: true,
        allowImportExportEverywhere: true
      });
    } catch (e) {
      errors.push({
        type: 'syntax',
        severity: 'error',
        line: e.loc?.line || 0,
        column: e.loc?.column || 0,
        message: e.message
      });
    }
    return errors;
  }

  /**
   * Análisis de sintaxis Python básico
   */
  analyzeSyntaxPython(code) {
    const errors = [];
    const lines = code.split('\n');

    // Single-pass: verificar indentación, paréntesis, print, bloques
    let usesSpaces = false, usesTabs = false;
    const stack = [];
    const pairs = { '(': ')', '[': ']', '{': '}' };
    const closers = new Set([')', ']', '}']);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Indentación
      const indent = line.match(RE_INDENT);
      if (indent) {
        if (indent[1].includes(' ')) usesSpaces = true;
        if (indent[1].includes('\t')) usesTabs = true;
      }

      // Paréntesis/corchetes
      for (const ch of line) {
        if (ch === '(' || ch === '[' || ch === '{') stack.push({ ch, line: lineNum });
        else if (closers.has(ch)) {
          const last = stack.pop();
          if (!last || pairs[last.ch] !== ch) {
            errors.push({ type: 'syntax', severity: 'error', line: lineNum, message: `Paréntesis/corchete sin cerrar o mal cerrado: '${ch}'` });
          }
        }
      }

      // print sin paréntesis
      if (RE_PRINT_PY2.test(line) && !RE_COMMENT.test(line)) {
        errors.push({ type: 'compatibility', severity: 'warn', line: lineNum, message: "'print' sin paréntesis — usa print() para Python 3" });
      }

      // Bloques sin dos puntos
      if (RE_PY_BLOCK.test(line)) {
        const stripped = line.replace(RE_PY_COLON, '').trimEnd();
        if (stripped && !stripped.endsWith(':') && !stripped.endsWith('\\')) {
          errors.push({ type: 'syntax', severity: 'warn', line: lineNum, message: "Posible ':' faltante al final del bloque" });
        }
      }
    }

    if (usesSpaces && usesTabs) {
      errors.unshift({ type: 'style', severity: 'error', line: 0, message: 'Mezcla de tabs y espacios en indentación' });
    }
    for (const unclosed of stack) {
      errors.push({ type: 'syntax', severity: 'error', line: unclosed.line, message: `'${unclosed.ch}' abierto pero nunca cerrado` });
    }

    return errors;
  }

  /**
   * Análisis con ESLint (JavaScript)
   */
  async analyzeWithESLint(code) {
    try {
      const results = await this.eslint.lintText(code, { filePath: 'code.js' });
      const issues = [];

      for (const result of results) {
        for (const msg of result.messages) {
          issues.push({
            type: 'lint',
            severity: msg.severity === 2 ? 'error' : 'warn',
            line: msg.line,
            column: msg.column,
            message: msg.message,
            rule: msg.ruleId || ''
          });
        }
      }
      return issues;
    } catch (err) {
      return [{ type: 'lint', severity: 'error', line: 0, message: `Error ejecutando ESLint: ${err.message}` }];
    }
  }

  /**
   * Análisis de patrones problemáticos comunes
   */
  analyzePatterns(code, language) {
    const issues = [];
    const lines = code.split('\n');
    const isJS = language === 'javascript';
    const isPy = language === 'python';

    // Single-pass: todas las verificaciones en un solo recorrido
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      if (isJS) {
        const preEval = line.split('eval')[0];
        if (RE_EVAL.test(line) && !/\/\//.test(preEval)) {
          issues.push({ type: 'security', severity: 'error', line: lineNum, message: 'Uso de eval() es peligroso — riesgo de inyección de código' });
        }
        if (RE_INNERHTML.test(line) && !/\/\//.test(line.split('innerHTML')[0])) {
          issues.push({ type: 'security', severity: 'warn', line: lineNum, message: 'innerHTML puede ser vulnerable a XSS — considera textContent o sanitización' });
        }
        if (RE_LOOSE_EQ.test(line) && !/\/\//.test(line.split('==')[0])) {
          issues.push({ type: 'quality', severity: 'warn', line: lineNum, message: 'Usa === en vez de == para comparaciones estrictas' });
        }
        if (RE_CONSOLE.test(line)) {
          issues.push({ type: 'quality', severity: 'info', line: lineNum, message: 'console.log() encontrado — quitar en producción' });
        }
      }

      if (isPy) {
        if (RE_EXCEPT_GEN.test(line)) {
          issues.push({ type: 'quality', severity: 'warn', line: lineNum, message: 'except genérico — usa except Exception o más específico' });
        }
        if (RE_IMPORT_STAR.test(line)) {
          issues.push({ type: 'quality', severity: 'warn', line: lineNum, message: 'import * contamina el namespace — importa solo lo necesario' });
        }
        if (RE_MUTABLE_DEFAULT.test(line)) {
          issues.push({ type: 'bug', severity: 'error', line: lineNum, message: 'Argumento mutable por defecto — usa None y asigna dentro de la función' });
        }
      }

      // Genéricos
      if (line.length > 150) {
        issues.push({ type: 'style', severity: 'info', line: lineNum, message: `Línea muy larga (${line.length} chars) — considera dividirla` });
      }
      const todoMatch = line.match(RE_TODO);
      if (todoMatch) {
        issues.push({ type: 'info', severity: 'info', line: lineNum, message: `${todoMatch[1]} encontrado: ${todoMatch[2].trim().substring(0, 60)}` });
      }
    }

    return issues;
  }

  /**
   * Análisis completo del código
   */
  async fullAnalysis(code) {
    const language = this.detectLanguage(code);
    let syntaxErrors = [];
    let lintIssues = [];
    let patternIssues = [];

    // Análisis de sintaxis
    if (language === 'javascript') {
      syntaxErrors = this.analyzeSyntaxJS(code);
      if (syntaxErrors.length === 0) {
        lintIssues = await this.analyzeWithESLint(code);
      }
    } else if (language === 'python') {
      syntaxErrors = this.analyzeSyntaxPython(code);
    }

    // Análisis de patrones
    patternIssues = this.analyzePatterns(code, language);

    const allIssues = [...syntaxErrors, ...lintIssues, ...patternIssues];
    const errors = allIssues.filter(i => i.severity === 'error');
    const warnings = allIssues.filter(i => i.severity === 'warn');
    const infos = allIssues.filter(i => i.severity === 'info');

    return {
      language,
      totalIssues: allIssues.length,
      errors: errors.length,
      warnings: warnings.length,
      infos: infos.length,
      issues: allIssues,
      summary: this.buildSummary(language, errors, warnings, infos)
    };
  }

  /**
   * Construir resumen legible
   */
  buildSummary(language, errors, warnings, infos) {
    const parts = [];
    parts.push(`🔍 *Análisis de código* (${language.toUpperCase()})`);
    parts.push('');

    if (errors.length === 0 && warnings.length === 0) {
      parts.push('✅ ¡Código limpio! No se encontraron errores ni advertencias.');
    } else {
      if (errors.length > 0) {
        parts.push(`❌ *${errors.length} error(es):*`);
        for (const e of errors.slice(0, 10)) {
          parts.push(`  Línea ${e.line}: ${e.message}`);
        }
        if (errors.length > 10) parts.push(`  ... y ${errors.length - 10} más`);
        parts.push('');
      }
      if (warnings.length > 0) {
        parts.push(`⚠️ *${warnings.length} advertencia(s):*`);
        for (const w of warnings.slice(0, 8)) {
          parts.push(`  Línea ${w.line}: ${w.message}`);
        }
        if (warnings.length > 8) parts.push(`  ... y ${warnings.length - 8} más`);
        parts.push('');
      }
    }

    if (infos.length > 0) {
      parts.push(`ℹ️ ${infos.length} nota(s) informativas`);
    }

    return parts.join('\n');
  }
}

module.exports = CodeAnalyzer;
