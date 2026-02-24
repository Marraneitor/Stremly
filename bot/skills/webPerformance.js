/* ============================================================
   Skill: Web Performance Analyzer
   ============================================================
   Analiza código web (HTML/CSS/JS) para detectar problemas de
   rendimiento y peso excesivo. Experta en:
   
   - Detectar render-blocking resources
   - Imágenes sin lazy loading
   - Scripts síncronos que bloquean el render
   - CSS no optimizado (selectores pesados, propiedades costosas)
   - DOM excesivo / deep nesting
   - Reflows y repaints innecesarios
   - Memory leaks (event listeners, closures, intervals)
   - Bundle size y tree-shaking oportunidades
   - Core Web Vitals (LCP, FID, CLS) sugerencias
   - Caching y compresión headers
   - Font loading optimization
   ============================================================ */

class WebPerformanceAnalyzer {
  constructor(geminiApiKey) {
    this.geminiApiKey = geminiApiKey;
    this.GEMINI_MODEL = 'gemini-2.0-flash';
    this.geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${this.GEMINI_MODEL}:generateContent?key=${geminiApiKey}`;

    // Pre-compiled regex patterns for static analysis
    this._patterns = {
      // HTML issues
      renderBlocking: /<link\s[^>]*rel=["']stylesheet["'][^>]*(?!media=)[^>]*>/gi,
      syncScript: /<script\s+src=["'][^"']+["']\s*(?!async|defer)[^>]*>/gi,
      imgNoLazy: /<img\s+(?![^>]*loading=["']lazy["'])[^>]*src=["'][^"']+["'][^>]*>/gi,
      imgNoSize: /<img\s+(?![^>]*(?:width|height)=)[^>]*>/gi,
      inlineStyle: /style=["'][^"']{100,}["']/gi,
      deepNesting: /(<div[^>]*>[\s\S]*?){8,}/gi,
      noViewport: /<meta\s+name=["']viewport["']/i,
      noCharset: /<meta\s+charset/i,
      largeDom: /<(?:div|span|p|li|td|section|article|aside|header|footer|nav)\b/gi,
      preconnect: /<link\s[^>]*rel=["']preconnect["'][^>]*>/gi,
      
      // CSS issues
      importCss: /@import\s+(?:url\()?["'][^"']+["']/gi,
      universalSelector: /\*\s*\{/g,
      deepSelector: /(?:[.#\w-]+\s+){5,}[.#\w-]+/g,
      expensiveProps: /(?:box-shadow|filter|backdrop-filter|opacity|transform)\s*:/gi,
      animationAll: /transition\s*:.*\ball\b/gi,
      noWillChange: /animation\s*:/gi,
      unusedMediaQuery: /@media[^{]+\{\s*\}/g,
      importantOveruse: /!important/g,
      
      // JS issues
      documentWrite: /document\.write\s*\(/g,
      syncXHR: /new\s+XMLHttpRequest[\s\S]*?\.open\s*\(\s*["'](?:GET|POST)["']\s*,\s*[^,]+\s*,\s*false/gi,
      globalVar: /^\s*var\s+\w+\s*=/gm,
      innerHTML: /\.innerHTML\s*[+]?=/g,
      forceLayout: /(?:offset(?:Width|Height|Top|Left|Parent)|client(?:Width|Height)|scroll(?:Width|Height|Top|Left)|getComputedStyle|getBoundingClientRect)/g,
      memoryLeak: /(?:setInterval|addEventListener)\s*\(/g,
      noCleanup: /setInterval\s*\(/g,
      largeEventHandler: /(?:addEventListener|onclick|onscroll|onresize)\s*[=(]/g,
      evalUsage: /\beval\s*\(/g,
      consoleLog: /console\.\w+\s*\(/g,
      nestedLoop: /for\s*\([^)]+\)[\s\S]*?for\s*\([^)]+\)/g,
      blockingFetch: /await\s+fetch/g
    };

    // Weight thresholds
    this.thresholds = {
      maxDomElements: 800,
      maxCssSelectors: 200,
      maxInlineStyles: 5,
      maxImportant: 10,
      maxConsoleLog: 5,
      maxGlobalVars: 3,
      maxDeepSelectors: 3,
      bundleSizeKB: 150
    };
  }

  /**
   * Full performance audit for web code
   */
  async fullAudit(code, language) {
    const issues = [];
    const metrics = { score: 100 };

    if (language === 'html' || code.includes('<html') || code.includes('<head')) {
      this._auditHTML(code, issues, metrics);
    }
    if (language === 'css' || code.includes('{') && (code.includes(':') && code.includes(';'))) {
      this._auditCSS(code, issues, metrics);
    }
    if (language === 'javascript' || language === 'js' || code.includes('function') || code.includes('=>')) {
      this._auditJS(code, issues, metrics);
    }

    // Size analysis
    const sizeKB = (new TextEncoder().encode(code).length / 1024).toFixed(1);
    metrics.sizeKB = parseFloat(sizeKB);
    if (metrics.sizeKB > this.thresholds.bundleSizeKB) {
      issues.push({
        severity: 'warning',
        category: 'size',
        message: `Archivo de ${sizeKB}KB — considera code-splitting o minificación`,
        impact: 'LCP, TTI'
      });
      metrics.score -= 5;
    }

    metrics.score = Math.max(0, Math.min(100, metrics.score));
    metrics.issueCount = issues.length;

    return { issues, metrics, summary: this._buildSummary(issues, metrics) };
  }

  _auditHTML(code, issues, metrics) {
    // Render-blocking stylesheets
    const blocking = code.match(this._patterns.renderBlocking) || [];
    const hasLoadTrick = /media=["']print["'].*onload/i.test(code);
    if (blocking.length > 2 && !hasLoadTrick) {
      issues.push({ severity: 'error', category: 'render-blocking',
        message: `${blocking.length} hojas de estilo bloquean el render — usa media="print" onload="this.media='all'" o preload`,
        impact: 'FCP, LCP' });
      metrics.score -= 10;
    }

    // Sync scripts
    const syncScripts = code.match(this._patterns.syncScript) || [];
    if (syncScripts.length > 0) {
      issues.push({ severity: 'warning', category: 'script-blocking',
        message: `${syncScripts.length} script(s) sin async/defer bloquean el parser`,
        impact: 'TTI, TBT' });
      metrics.score -= 5 * syncScripts.length;
    }

    // Images without lazy loading
    const noLazy = code.match(this._patterns.imgNoLazy) || [];
    if (noLazy.length > 2) {
      issues.push({ severity: 'warning', category: 'images',
        message: `${noLazy.length} imágenes sin loading="lazy"`,
        impact: 'LCP, bandwidth' });
      metrics.score -= 3;
    }

    // DOM size
    const domElements = (code.match(this._patterns.largeDom) || []).length;
    if (domElements > this.thresholds.maxDomElements) {
      issues.push({ severity: 'warning', category: 'dom-size',
        message: `~${domElements} elementos DOM — más de ${this.thresholds.maxDomElements} afecta rendimiento`,
        impact: 'TBT, memory' });
      metrics.score -= 5;
    }
    metrics.domElements = domElements;

    // Missing viewport
    if (!this._patterns.noViewport.test(code)) {
      issues.push({ severity: 'error', category: 'meta',
        message: 'Falta meta viewport — afecta mobile rendering',
        impact: 'CLS, mobile UX' });
      metrics.score -= 10;
    }

    // Preconnect hints
    const preconnects = (code.match(this._patterns.preconnect) || []).length;
    if (preconnects === 0 && blocking.length > 0) {
      issues.push({ severity: 'info', category: 'resource-hints',
        message: 'Agrega <link rel="preconnect"> para dominios de terceros',
        impact: 'FCP' });
    }

    // Inline styles
    const inlineStyles = (code.match(this._patterns.inlineStyle) || []).length;
    if (inlineStyles > this.thresholds.maxInlineStyles) {
      issues.push({ severity: 'info', category: 'maintainability',
        message: `${inlineStyles} estilos inline extensos — muévelos a CSS externo`,
        impact: 'cache, maintainability' });
    }
  }

  _auditCSS(code, issues, metrics) {
    // @import usage
    const imports = code.match(this._patterns.importCss) || [];
    if (imports.length > 0) {
      issues.push({ severity: 'error', category: 'css-blocking',
        message: `${imports.length} @import(s) crean cascada de requests — usa <link> o concat`,
        impact: 'FCP, LCP' });
      metrics.score -= 8;
    }

    // Universal selector
    const universal = code.match(this._patterns.universalSelector) || [];
    if (universal.length > 2) {
      issues.push({ severity: 'warning', category: 'css-performance',
        message: `${universal.length} selectores universales (*) — costosos en DOM grande`,
        impact: 'Style recalc' });
      metrics.score -= 3;
    }

    // Deep selectors
    const deep = code.match(this._patterns.deepSelector) || [];
    if (deep.length > this.thresholds.maxDeepSelectors) {
      issues.push({ severity: 'warning', category: 'css-specificity',
        message: `${deep.length} selectores profundos (5+ niveles) — simplifica con BEM o clases directas`,
        impact: 'Style matching' });
      metrics.score -= 3;
    }

    // transition: all
    const transAll = code.match(this._patterns.animationAll) || [];
    if (transAll.length > 0) {
      issues.push({ severity: 'warning', category: 'animation',
        message: `${transAll.length} transition(s) con "all" — especifica la propiedad exacta`,
        impact: 'Compositor, CLS' });
      metrics.score -= 2;
    }

    // !important overuse
    const importants = (code.match(this._patterns.importantOveruse) || []).length;
    if (importants > this.thresholds.maxImportant) {
      issues.push({ severity: 'info', category: 'css-quality',
        message: `${importants}x !important — indica problemas de especificidad`,
        impact: 'Maintainability' });
    }
    metrics.importantCount = importants;
  }

  _auditJS(code, issues, metrics) {
    // document.write
    if (this._patterns.documentWrite.test(code)) {
      issues.push({ severity: 'error', category: 'js-blocking',
        message: 'document.write() bloquea el parser completamente',
        impact: 'FCP, TTI' });
      metrics.score -= 15;
    }

    // eval()
    if (this._patterns.evalUsage.test(code)) {
      issues.push({ severity: 'error', category: 'security',
        message: 'eval() es un riesgo de seguridad y no se puede optimizar por V8',
        impact: 'TTI, security' });
      metrics.score -= 10;
    }

    // innerHTML in loops (force reflow)
    const innerHTMLCount = (code.match(this._patterns.innerHTML) || []).length;
    if (innerHTMLCount > 10) {
      issues.push({ severity: 'warning', category: 'dom-manipulation',
        message: `${innerHTMLCount}x innerHTML — en loops usa DocumentFragment o template strings acumuladas`,
        impact: 'Reflow, TBT' });
      metrics.score -= 5;
    }

    // Force layout reads
    const forceLayout = (code.match(this._patterns.forceLayout) || []).length;
    if (forceLayout > 5) {
      issues.push({ severity: 'warning', category: 'layout-thrashing',
        message: `${forceLayout} lecturas de layout — agruparlas evita layout thrashing`,
        impact: 'FID, TBT' });
      metrics.score -= 4;
    }

    // Memory leaks: setInterval without clear
    const intervals = (code.match(this._patterns.noCleanup) || []).length;
    if (intervals > 2) {
      issues.push({ severity: 'warning', category: 'memory',
        message: `${intervals} setInterval(s) — asegura clearInterval para evitar memory leaks`,
        impact: 'Memory, long tasks' });
      metrics.score -= 3;
    }

    // Global vars
    const globals = (code.match(this._patterns.globalVar) || []).length;
    if (globals > this.thresholds.maxGlobalVars) {
      issues.push({ severity: 'info', category: 'scope',
        message: `${globals} variables globales con var — usa const/let o módulos`,
        impact: 'Scope pollution' });
    }

    // console.log in production
    const consoleLogs = (code.match(this._patterns.consoleLog) || []).length;
    if (consoleLogs > this.thresholds.maxConsoleLog) {
      issues.push({ severity: 'info', category: 'cleanup',
        message: `${consoleLogs} console.log — elimínalos en producción`,
        impact: 'Bundle size, minor perf' });
    }
    metrics.consoleCount = consoleLogs;

    // Nested loops
    const nested = (code.match(this._patterns.nestedLoop) || []).length;
    if (nested > 2) {
      issues.push({ severity: 'warning', category: 'complexity',
        message: `${nested} loops anidados — considera usar Map/Set para O(n) lookup`,
        impact: 'TBT, long tasks' });
      metrics.score -= 4;
    }
  }

  _buildSummary(issues, metrics) {
    const scoreEmoji = metrics.score >= 90 ? '🟢' : metrics.score >= 70 ? '🟡' : metrics.score >= 50 ? '🟠' : '🔴';
    const errors = issues.filter(i => i.severity === 'error').length;
    const warnings = issues.filter(i => i.severity === 'warning').length;
    const infos = issues.filter(i => i.severity === 'info').length;

    let summary = `${scoreEmoji} *Performance Score: ${metrics.score}/100*\n`;
    summary += `📊 ${metrics.sizeKB || '?'}KB | ${metrics.domElements || '?'} DOM elements\n`;
    summary += `🔴 ${errors} errores | ⚠️ ${warnings} warnings | ℹ️ ${infos} sugerencias\n\n`;

    if (errors > 0) {
      summary += '*🔴 Errores críticos:*\n';
      issues.filter(i => i.severity === 'error').forEach(i => {
        summary += `• ${i.message} _(${i.impact})_\n`;
      });
      summary += '\n';
    }

    if (warnings > 0) {
      summary += '*⚠️ Mejoras importantes:*\n';
      issues.filter(i => i.severity === 'warning').forEach(i => {
        summary += `• ${i.message} _(${i.impact})_\n`;
      });
      summary += '\n';
    }

    if (infos > 0) {
      summary += '*ℹ️ Sugerencias:*\n';
      issues.filter(i => i.severity === 'info').forEach(i => {
        summary += `• ${i.message} _(${i.impact})_\n`;
      });
      summary += '\n';
    }

    if (metrics.score >= 90) {
      summary += '✅ *¡Excelente rendimiento!* Solo pequeñas mejoras opcionales.';
    } else if (metrics.score >= 70) {
      summary += '👍 *Buen rendimiento.* Atiende los warnings para llegar a 90+.';
    } else {
      summary += '⚡ *Necesita optimización.* Enfócate en los errores críticos primero.';
    }

    return summary;
  }

  /**
   * AI-powered deep analysis using Gemini
   */
  async deepAudit(code, language) {
    const staticResult = await this.fullAudit(code, language);

    try {
      const prompt = `Eres un experto en Web Performance y Core Web Vitals. Analiza este código ${language || 'web'} y da recomendaciones CONCRETAS de rendimiento.

Enfócate en:
1. Render-blocking resources
2. JavaScript execution time
3. DOM size y complejidad
4. Layout shifts (CLS)  
5. Largest Contentful Paint (LCP)
6. First Input Delay (FID) / Interaction to Next Paint (INP)
7. Memory leaks
8. Oportunidades de caching
9. Compresión y minificación
10. Lazy loading oportunidades

Código:
\`\`\`${language || ''}
${code.substring(0, 8000)}
\`\`\`

Responde en español, máximo 600 palabras. Usa formato con emojis y bullet points. Da código de ejemplo para las 3 mejoras más impactantes.`;

      const res = await fetch(this.geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 1200, temperature: 0.3 }
        })
      });

      if (res.ok) {
        const data = await res.json();
        const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (aiText) {
          staticResult.summary += '\n\n🤖 *Análisis IA profundo:*\n' + aiText;
        }
      }
    } catch (e) {
      // AI analysis failed silently, static analysis still available
    }

    return staticResult;
  }
}

module.exports = WebPerformanceAnalyzer;
