/* ============================================================
   Skills — Módulo central de habilidades del bot
   ============================================================
   Registra y coordina todas las skills disponibles.
   Detecta automáticamente cuándo activar una skill
   basándose en el contenido del mensaje.
   ============================================================ */

const CodeAnalyzer = require('./codeAnalyzer');
const CodeFixer = require('./codeFixer');
const CodeOptimizer = require('./codeOptimizer');
const WebPerformanceAnalyzer = require('./webPerformance');

class SkillManager {
  constructor(geminiApiKey) {
    this.analyzer = new CodeAnalyzer();
    this.fixer = new CodeFixer(geminiApiKey);
    this.optimizer = new CodeOptimizer(geminiApiKey);
    this.perfAnalyzer = new WebPerformanceAnalyzer(geminiApiKey);
    this.geminiApiKey = geminiApiKey;

    // Pre-compilar todas las regex de detección (se usan en cada mensaje)
    this._codeIndicators = [
      /function\s+\w+\s*\(/, /=>\s*\{/, /const\s+\w+\s*=/, /let\s+\w+\s*=/,
      /var\s+\w+\s*=/, /if\s*\(.+\)\s*\{/, /for\s*\(.+\)\s*\{/,
      /class\s+\w+/, /import\s+.+from/, /require\s*\(/,
      /def\s+\w+\s*\(/, /print\s*\(/, /from\s+\w+\s+import/,
      /<html|<div|<script/, /SELECT\s+.+FROM/i
    ];
    this._reTripleBacktick = /```(?:\w+)?\n?([\s\S]+?)```/;
    this._reSingleBacktick = /`([^`]{20,})`/;

    // Pre-compilar patrones de intenciones
    this._analyzePatterns = [
      /anali[zs]a(r)?(\s+este|\s+mi|\s+el)?\s*(código|code)/i,
      /rev[ií]sa(r)?(\s+este|\s+mi|\s+el)?\s*(código|code)/i,
      /qué\s+(tiene|error|problema|falla)/i,
      /tiene\s+(error|bug|problema|falla)/i,
      /busca(r)?\s+(error|bug|problema)/i,
      /está\s+bien\s+(este|mi|el)\s*(código|code)/i,
      /check\s+(this|my)?\s*code/i,
      /find\s+(error|bug|issue)/i,
      /what('s)?\s+wrong/i
    ];
    this._fixPatterns = [
      /arregla(r)?(\s+este|\s+mi|\s+el)?\s*(código|code)/i,
      /corr[eéi]g[ei](r)?(\s+este|\s+mi|\s+el)?\s*(código|code)/i,
      /fix(ea)?(\s+este|\s+mi|\s+el)?\s*(código|code)/i,
      /repara(r)?/i, /autofix/i, /auto[\s-]?arregla/i,
      /fix\s+(this|my|the)?\s*code/i, /soluciona(r)?/i
    ];
    this._optimizePatterns = [
      /optimi[zs]a(r)?(\.+este|\.+mi|\.+el)?\s*(código|code)/i,
      /ha[zs](lo)?\s+(más\s+)?(rápido|eficiente|veloz|ligero|liviano)/i,
      /mejora(r)?\s+(el\s+)?rendimiento/i,
      /limpia(r)?(\.+este|\.+mi|\.+el)?\s*(código|code)/i,
      /elimina(r)?\s+(lo\s+)?(innecesario|que\s+no\s+sirv|que\s+sobr|código\s+muerto)/i,
      /quita(r)?\s+(lo\s+)?innecesario/i,
      /reduce\s+(el\s+)?(código|tamaño|peso)/i,
      /clean\s*(up)?\s*(this|my|the)?\s*code/i,
      /optimize\s*(this|my|the)?\s*code/i,
      /make\s*(it)?\s*(faster|efficient|lighter)/i,
      /refactori[zs]a/i, /código\s+muerto/i, /dead\s*code/i,
      /performance/i, /rendimiento/i
    ];
    this._perfPatterns = [
      /rendimiento\s*(web|p[aá]gina|sitio|frontend)/i,
      /performance\s*(web|page|site|audit)/i,
      /web\s*vitals/i, /core\s*web/i,
      /velocidad\s*(de\s*)?(carga|p[aá]gina|web|sitio)/i,
      /page\s*speed/i, /lighthouse/i,
      /carga\s*(r[aá]pido|lento|pesad)/i,
      /optimi[zs]a(r)?\s*(la\s+)?(web|p[aá]gina|html|css|carga)/i,
      /pesa\s*(mucho|demasiado)/i, /muy\s*(lent|pesad)/i,
      /audit(or[ií]a)?\s*(de\s+)?(rendimiento|performance)/i,
      /lcp|fcp|cls|fid|inp|tti|tbt/i
    ];
  }

  /**
   * Detectar si un mensaje contiene código
   */
  detectCode(text) {
    if (!text || text.length < 15) return null;

    const tripleBacktick = text.match(this._reTripleBacktick);
    if (tripleBacktick) {
      const code = tripleBacktick[1].trim();
      return { hasCode: true, code, language: this.analyzer.detectLanguage(code) };
    }

    const singleBacktick = text.match(this._reSingleBacktick);
    if (singleBacktick) {
      const code = singleBacktick[1].trim();
      return { hasCode: true, code, language: this.analyzer.detectLanguage(code) };
    }

    let matchCount = 0;
    for (const p of this._codeIndicators) {
      if (p.test(text) && ++matchCount >= 2) {
        return { hasCode: true, code: text, language: this.analyzer.detectLanguage(text) };
      }
    }

    return null;
  }

  /**
   * Detectar si el usuario pide análisis/corrección de código
   */
  detectIntent(text) {
    const lowerText = text.toLowerCase();

    const wantsFix = this._fixPatterns.some(p => p.test(lowerText));
    const wantsOptimize = this._optimizePatterns.some(p => p.test(lowerText));
    const wantsPerformance = this._perfPatterns.some(p => p.test(lowerText));
    const wantsAnalysis = wantsFix || wantsOptimize || wantsPerformance || this._analyzePatterns.some(p => p.test(lowerText));

    return {
      wantsAnalysis,
      wantsFix,
      wantsOptimize,
      wantsPerformance,
      wantsAnalysisOnly: wantsAnalysis && !wantsFix && !wantsOptimize && !wantsPerformance
    };
  }

  /**
   * Procesar un mensaje — retorna respuesta de skill o null si no aplica
   */
  async processMessage(text) {
    const intent = this.detectIntent(text);
    const codeDetection = this.detectCode(text);

    // Si no quiere análisis ni tiene código, no hacer nada
    if (!intent.wantsAnalysis && !codeDetection) return null;

    // Si pide análisis pero no tiene código
    if (intent.wantsAnalysis && !codeDetection) {
      return {
        handled: true,
        response: '📝 Para analizar código, envíamelo entre triple backticks:\n\n```\ntu código aquí\n```\n\nO simplemente pégalo y dime "analiza este código" o "arregla este código".'
      };
    }

    // Si tiene código y quiere análisis/fix/optimize
    if (codeDetection) {
      const { code, language } = codeDetection;

      if (intent.wantsPerformance) {
        // Web performance audit
        const perfResult = await this.perfAnalyzer.deepAudit(code, language);
        return { handled: true, response: perfResult.summary, perfResult };
      } else if (intent.wantsOptimize) {
        // Optimizar código
        const optResult = await this.optimizer.fullOptimize(code, language, true);
        const optSummary = this.optimizer.buildOptimizeSummary(optResult);

        let response = optSummary;
        if (optResult.changed) {
          response += '\n\n📋 *Código optimizado:*\n```\n' + optResult.optimized + '\n```';
        }

        return { handled: true, response, optimizeResult: optResult };
      } else if (intent.wantsFix) {
        // Analizar + Corregir
        const analysis = await this.analyzer.fullAnalysis(code);
        const fixResult = await this.fixer.autoFix(code, language, analysis.issues, true);
        const fixSummary = this.fixer.buildFixSummary(fixResult);

        let response = analysis.summary + '\n\n' + fixSummary;
        if (fixResult.changed) {
          response += '\n```\n' + fixResult.fixed + '\n```';
        }

        return { handled: true, response, analysis, fixResult };
      } else {
        // Solo analizar
        const analysis = await this.analyzer.fullAnalysis(code);
        let response = analysis.summary;
        if (analysis.errors > 0) {
          response += '\n\n💡 Escribe "arregla el código" y te lo corrijo automáticamente.';
        }
        if (analysis.errors === 0) {
          response += '\n\n⚡ Escribe "optimiza el código" para mejorar rendimiento y limpiar código muerto.';
        }
        return { handled: true, response, analysis };
      }
    }

    return null;
  }
}

module.exports = SkillManager;
