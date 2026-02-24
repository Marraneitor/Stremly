/* ============================================================
   Skill: Code Fixer — Auto-corrección de código con Gemini AI
   ============================================================
   Corrige errores detectados por el analyzer usando:
   1. Fixes automáticos (regex + reglas)
   2. Gemini AI para errores complejos
   ============================================================ */

class CodeFixer {
  constructor(geminiApiKey) {
    this.geminiApiKey = geminiApiKey;
    this.GEMINI_MODEL = 'gemini-2.5-flash';
    this.geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${this.GEMINI_MODEL}:generateContent?key=${geminiApiKey}`;

    // Pre-compilar regex usadas en fixJavaScript
    this._reVar = /\bvar\s+(\w+)\s*=\s*/g;
    this._reLooseEq = /([^!=!])={2}([^=])/g;
    this._reLooseNeq = /!=([^=])/g;
    this._reMultiSemi = /;{2,}/g;
    this._reStatementKw = /^[\s]*(const|let|var|return|throw|await|yield)\b/;
    this._reBlockKw = /^\s*(if|else|for|while|switch|try|catch|finally|function|class)\b/;
    this._rePrintPy = /^(\s*)print\s+([^(].*?)$/gm;
    this._reTab = /\t/g;
    this._reBlankLines = /\n{4,}/g;
    this._reMdClean = /^```[\w]*\n?/gm;
    this._reMdEnd = /```$/gm;
  }

  // ── Fixes automáticos (sin IA) ─────────────────────────────

  /**
   * Corregir errores comunes de JavaScript
   */
  fixJavaScript(code, issues) {
    let fixed = code;
    const fixes = [];
    const issueRules = new Set(issues.map(i => i.rule).filter(Boolean));
    const issueMessages = issues.map(i => i.message || '');

    // Fix: var → let/const
    if (issueRules.has('no-var')) {
      fixed = fixed.replace(this._reVar, (match, varName) => {
        const reassigned = new RegExp(`\\b${varName}\\s*=(?!=)`, 'g');
        const matches = fixed.match(reassigned);
        if (matches && matches.length > 1) {
          fixes.push(`var ${varName} → let ${varName}`);
          return `let ${varName} = `;
        }
        fixes.push(`var ${varName} → const ${varName}`);
        return `const ${varName} = `;
      });
    }

    // Fix: == → ===  (single split + single pass)
    const needsEqFix = issueRules.has('eqeqeq') || issueMessages.some(m => m.includes('==='));
    const needsSemiFix = issueRules.has('semi');

    if (needsEqFix || needsSemiFix) {
      const lines = fixed.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (needsEqFix) {
          if (!/\/\//.test(lines[i].split('==')[0])) {
            if (/==[^=]/.test(lines[i]) && !/!=/.test(lines[i].split('==')[0])) {
              lines[i] = lines[i].replace(this._reLooseEq, '$1===$2');
              fixes.push(`Línea ${i + 1}: == → ===`);
            }
            if (/!=[^=]/.test(lines[i])) {
              lines[i] = lines[i].replace(this._reLooseNeq, '!==$1');
              fixes.push(`Línea ${i + 1}: != → !==`);
            }
          }
        }
        if (needsSemiFix) {
          const trimmed = lines[i].trimEnd();
          if (!trimmed || trimmed.endsWith(';') || trimmed.endsWith('{') ||
              trimmed.endsWith('}') || trimmed.endsWith(',') ||
              trimmed.endsWith('(') || trimmed.endsWith(':') ||
              trimmed.startsWith('//') || trimmed.startsWith('/*') ||
              trimmed.startsWith('*') || /^\s*$/.test(trimmed) ||
              this._reBlockKw.test(trimmed)) {
            continue;
          }
          if ((this._reStatementKw.test(trimmed) ||
              /\)\s*$/.test(trimmed) || /['"`]\s*$/.test(trimmed) ||
              /\d\s*$/.test(trimmed) || /\]\s*$/.test(trimmed)) &&
              !trimmed.endsWith(';')) {
            lines[i] = lines[i].replace(/\s*$/, ';');
            fixes.push(`Línea ${i + 1}: Punto y coma agregado`);
          }
        }
      }
      fixed = lines.join('\n');
    }

    // Fix: Eliminar extra semicolons
    if (issueRules.has('no-extra-semi')) {
      fixed = fixed.replace(this._reMultiSemi, ';');
      fixes.push('Eliminados punto y coma duplicados');
    }

    // Fix: Trailing whitespace (single pass)
    const tLines = fixed.split('\n');
    let trailingFixed = false;
    for (let i = 0; i < tLines.length; i++) {
      const trimmed = tLines[i].trimEnd();
      if (tLines[i] !== trimmed) {
        tLines[i] = trimmed;
        trailingFixed = true;
      }
    }
    if (trailingFixed) {
      fixed = tLines.join('\n');
      fixes.push('Eliminados espacios al final de líneas');
    }

    return { code: fixed, fixes, changed: fixed !== code };
  }

  /**
   * Corregir errores comunes de Python
   */
  fixPython(code, issues) {
    let fixed = code;
    const fixes = [];

    // Fix: print sin paréntesis
    if (issues.some(i => i.message?.includes('print') && i.message?.includes('paréntesis'))) {
      fixed = fixed.replace(this._rePrintPy, '$1print($2)');
      fixes.push('print → print()');
    }

    // Fix: Tabs → espacios
    if (fixed.includes('\t')) {
      fixed = fixed.replace(this._reTab, '    ');
      fixes.push('Tabs convertidos a 4 espacios');
    }

    // Fix: Trailing whitespace + líneas en blanco (single pass)
    const lines = fixed.split('\n');
    let trailingFixed = false;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimEnd();
      if (lines[i] !== trimmed) {
        lines[i] = trimmed;
        trailingFixed = true;
      }
    }
    if (trailingFixed) {
      fixed = lines.join('\n');
      fixes.push('Eliminados espacios al final de líneas');
    }

    const before = fixed;
    fixed = fixed.replace(this._reBlankLines, '\n\n\n');
    if (fixed !== before) fixes.push('Reducidas líneas en blanco excesivas');

    return { code: fixed, fixes, changed: fixed !== code };
  }

  // ── Fix con Gemini AI ──────────────────────────────────────

  /**
   * Corregir código usando Gemini AI
   */
  async fixWithAI(code, language, issues) {
    if (!this.geminiApiKey) {
      return { code, fixes: ['No se pudo usar IA — falta API key'], changed: false };
    }

    const issuesSummary = issues
      .filter(i => i.severity === 'error' || i.severity === 'warn')
      .slice(0, 15)
      .map(i => `Línea ${i.line}: [${i.severity}] ${i.message}`)
      .join('\n');

    const prompt = `Eres un experto en ${language}. Corrige TODOS los errores del siguiente código.

REGLAS:
- Devuelve SOLO el código corregido, sin explicaciones ni markdown
- No agregues \`\`\` ni bloques de código
- Mantén la estructura y lógica original
- Solo corrige errores, no refactorices innecesariamente

ERRORES DETECTADOS:
${issuesSummary}

CÓDIGO:
${code}`;

    try {
      const res = await fetch(this.geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: 'Eres un corrector de código experto. Devuelves SOLO código corregido, sin texto adicional ni bloques markdown.' }]
          },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 4096,
            temperature: 0.1,
            topP: 0.8
          }
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error('❌ Gemini fix error:', errText);
        return { code, fixes: ['Error al comunicar con Gemini AI'], changed: false };
      }

      const data = await res.json();
      let fixedCode = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

      // Limpiar markdown residual (regex pre-compiladas)
      fixedCode = fixedCode
        .replace(this._reMdClean, '')
        .replace(this._reMdEnd, '')
        .trim();

      if (!fixedCode || fixedCode === code) {
        return { code, fixes: ['La IA no encontró cambios necesarios'], changed: false };
      }

      return {
        code: fixedCode,
        fixes: ['Código corregido con Gemini AI'],
        changed: true,
        method: 'ai'
      };
    } catch (err) {
      console.error('❌ Error en fixWithAI:', err.message);
      return { code, fixes: [`Error IA: ${err.message}`], changed: false };
    }
  }

  // ── Pipeline completo ──────────────────────────────────────

  /**
   * Auto-corregir código: primero reglas, luego IA si quedan errores
   */
  async autoFix(code, language, issues, useAI = true) {
    let currentCode = code;
    const allFixes = [];

    // Paso 1: Fixes automáticos por reglas
    let rulesResult;
    if (language === 'javascript') {
      rulesResult = this.fixJavaScript(currentCode, issues);
    } else if (language === 'python') {
      rulesResult = this.fixPython(currentCode, issues);
    } else {
      rulesResult = { code: currentCode, fixes: [], changed: false };
    }

    if (rulesResult.changed) {
      currentCode = rulesResult.code;
      allFixes.push(...rulesResult.fixes);
    }

    // Paso 2: Si quedan errores graves y IA está habilitada, usar Gemini
    const remainingErrors = issues.filter(i => i.severity === 'error');
    if (useAI && remainingErrors.length > 0) {
      const aiResult = await this.fixWithAI(currentCode, language, issues);
      if (aiResult.changed) {
        currentCode = aiResult.code;
        allFixes.push(...aiResult.fixes);
      }
    }

    return {
      original: code,
      fixed: currentCode,
      changed: currentCode !== code,
      fixes: allFixes,
      language
    };
  }

  /**
   * Generar resumen legible del fix
   */
  buildFixSummary(result) {
    const parts = [];
    parts.push(`🔧 *Auto-corrección* (${result.language.toUpperCase()})`);
    parts.push('');

    if (!result.changed) {
      parts.push('ℹ️ No se necesitaron correcciones automáticas.');
      return parts.join('\n');
    }

    parts.push(`✅ *${result.fixes.length} corrección(es) aplicada(s):*`);
    for (const fix of result.fixes) {
      parts.push(`  • ${fix}`);
    }
    parts.push('');
    parts.push('📋 *Código corregido:*');

    return parts.join('\n');
  }
}

module.exports = CodeFixer;
