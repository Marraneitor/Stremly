/* ============================================================
   Skill: Code Optimizer — Optimización y limpieza de código
   ============================================================
   Hace el código más eficiente, elimina lo innecesario y
   sugiere mejoras de rendimiento usando análisis estático
   + Gemini AI.
   
   Capacidades:
   - Detectar código muerto (variables/funciones sin usar)
   - Simplificar lógica redundante
   - Optimizar loops y estructuras de datos
   - Eliminar imports/requires no usados
   - Reducir complejidad ciclomática
   - Sugerir alternativas más performantes
   - Minificar/compactar código
   ============================================================ */

class CodeOptimizer {
  constructor(geminiApiKey) {
    this.geminiApiKey = geminiApiKey;
    this.GEMINI_MODEL = 'gemini-2.5-flash';
    this.geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${this.GEMINI_MODEL}:generateContent?key=${geminiApiKey}`;

    // Pre-compilar regex frecuentemente usadas
    this._reConsole = /console\.(log|debug|info|warn|error|trace)\s*\(/;
    this._reConsoleName = /console\.(\w+)/;
    this._reReturn = /^\s*return\b/;
    this._reComment = /^\s*\/\//;
    this._reMdClean = /^```[\w]*\n?/gm;
    this._reMdEnd = /```$/gm;
    this._reBlankLines = /\n{4,}/g;
    this._reImportPy = /^(?:import\s+(\w+)|from\s+\S+\s+import\s+(.+))$/gm;
    this._reAssignPy = /^(\s*)(\w+)\s*=\s*(?!.*def |.*class )/gm;
    this._rePassPy = /^\s*pass\s*$/;
    this._reForPy = /for\s+\w+\s+in\s+/;
    this._reInListPy = /\bif\b.+\bin\s+\[/;
    this._reGlobalPy = /^\s*global\s+/;
    this._rePyTrue = /==\s*True\b/;
    this._rePyFalse = /==\s*False\b/;
    this._rePyLenZero = /len\(.+\)\s*==\s*0/;
    this._rePyTypeEq = /type\(.+\)\s*==/;
  }

  /**
   * Construir índice de líneas para lookup O(1) de número de línea por offset
   * Evita el patrón O(n²) de code.substring(0, index).split('\n').length
   */
  _buildLineIndex(code) {
    const offsets = [0];
    for (let i = 0; i < code.length; i++) {
      if (code[i] === '\n') offsets.push(i + 1);
    }
    return offsets;
  }

  _getLineNum(lineIndex, offset) {
    // Búsqueda binaria para encontrar la línea
    let lo = 0, hi = lineIndex.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineIndex[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1; // 1-indexed
  }

  // ═══════════════════════════════════════════════════════════
  //  ANÁLISIS ESTÁTICO DE OPTIMIZACIÓN
  // ═══════════════════════════════════════════════════════════

  /**
   * Detectar código muerto en JavaScript
   */
  detectDeadCodeJS(code) {
    const issues = [];
    const lines = code.split('\n');
    const lineIndex = this._buildLineIndex(code);

    // 1. Variables declaradas pero nunca usadas
    const declRegex = /(?:const|let|var)\s+(\w+)\s*=/g;
    let match;
    while ((match = declRegex.exec(code)) !== null) {
      const varName = match[1];
      const lineNum = this._getLineNum(lineIndex, match.index);
      const usageRegex = new RegExp(`\\b${varName}\\b`, 'g');
      const usages = code.match(usageRegex);
      if (usages && usages.length <= 1) {
        issues.push({
          type: 'dead-code', severity: 'warn', line: lineNum,
          message: `Variable '${varName}' declarada pero nunca usada — eliminar`,
          fixable: true, suggestion: 'remove-line'
        });
      }
    }

    // 2. Funciones declaradas pero nunca llamadas
    const funcRegex = /function\s+(\w+)\s*\(/g;
    while ((match = funcRegex.exec(code)) !== null) {
      const funcName = match[1];
      const lineNum = this._getLineNum(lineIndex, match.index);
      const callRegex = new RegExp(`\\b${funcName}\\b`, 'g');
      const calls = code.match(callRegex);
      if (calls && calls.length <= 1) {
        issues.push({
          type: 'dead-code', severity: 'warn', line: lineNum,
          message: `Función '${funcName}()' declarada pero nunca llamada — considerar eliminar`,
          fixable: false
        });
      }
    }

    // 3. console.log + 4. Imports/requires no usados + 5. Código después de return
    // Todo en un solo recorrido de líneas
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // console.log en producción
      if (this._reConsole.test(line) && !/\/\//.test(line.split('console')[0])) {
        const nameMatch = line.match(this._reConsoleName);
        issues.push({
          type: 'cleanup', severity: 'info', line: i + 1,
          message: `console.${nameMatch ? nameMatch[1] : 'log'}() — eliminar en producción`,
          fixable: true, suggestion: 'remove-line'
        });
      }

      // Código después de return
      if (this._reReturn.test(line) && !this._reComment.test(line)) {
        let braceDepth = 0;
        for (let j = i + 1; j < lines.length; j++) {
          const trimmed = lines[j].trim();
          if (trimmed === '}') {
            if (braceDepth === 0) break;
            braceDepth--;
          } else if (trimmed.endsWith('{')) {
            braceDepth++;
          } else if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('*') && braceDepth === 0) {
            issues.push({
              type: 'dead-code', severity: 'warn', line: j + 1,
              message: 'Código inalcanzable después de return — eliminar',
              fixable: true, suggestion: 'remove-line'
            });
            break;
          }
        }
      }
    }

    // 4. Imports/requires no usados
    const reqRegex = /(?:const|let|var)\s+(?:\{([^}]+)\}|(\w+))\s*=\s*require\s*\(['"]([^'"]+)['"]\)/g;
    while ((match = reqRegex.exec(code)) !== null) {
      const lineNum = this._getLineNum(lineIndex, match.index);
      const names = match[1]
        ? match[1].split(',').map(n => n.trim().split(/\s+as\s+/).pop().trim()).filter(Boolean)
        : match[2] ? [match[2]] : [];
      
      for (const name of names) {
        const usageRegex = new RegExp(`\\b${name}\\b`, 'g');
        const usages = code.match(usageRegex);
        if (usages && usages.length <= 1) {
          issues.push({
            type: 'dead-import', severity: 'warn', line: lineNum,
            message: `'${name}' importado de '${match[3]}' pero nunca usado — eliminar`,
            fixable: true, suggestion: 'remove-line'
          });
        }
      }
    }

    return issues;
  }

  /**
   * Detectar código muerto en Python
   */
  detectDeadCodePython(code) {
    const issues = [];
    const lines = code.split('\n');
    const lineIndex = this._buildLineIndex(code);

    // 1. Imports no usados
    this._reImportPy.lastIndex = 0;
    let match;
    while ((match = this._reImportPy.exec(code)) !== null) {
      const lineNum = this._getLineNum(lineIndex, match.index);
      const names = match[1] ? [match[1]] : match[2].split(',').map(n => n.trim().split(/\s+as\s+/).pop().trim());
      
      for (const name of names) {
        if (name === '*') continue;
        const usageRegex = new RegExp(`\\b${name}\\b`, 'g');
        const usages = code.match(usageRegex);
        if (usages && usages.length <= 1) {
          issues.push({ type: 'dead-import', severity: 'warn', line: lineNum, message: `Import '${name}' nunca usado — eliminar`, fixable: true });
        }
      }
    }

    // 2. Variables asignadas pero no usadas
    const skipVars = new Set(['self', 'cls', 'True', 'False', 'None']);
    this._reAssignPy.lastIndex = 0;
    while ((match = this._reAssignPy.exec(code)) !== null) {
      const varName = match[2];
      if (varName.startsWith('_') || skipVars.has(varName)) continue;
      const lineNum = this._getLineNum(lineIndex, match.index);
      const usageRegex = new RegExp(`\\b${varName}\\b`, 'g');
      const usages = code.match(usageRegex);
      if (usages && usages.length <= 1) {
        issues.push({ type: 'dead-code', severity: 'warn', line: lineNum, message: `Variable '${varName}' asignada pero nunca usada`, fixable: true });
      }
    }

    // 3. pass redundante (single pass)
    for (let i = 0; i < lines.length; i++) {
      if (this._rePassPy.test(lines[i]) && i > 0 && i + 1 < lines.length) {
        const indent = lines[i].match(/^(\s*)/)[1].length;
        const nextIndent = lines[i + 1].match(/^(\s*)/)?.[1]?.length || 0;
        const nextTrimmed = lines[i + 1].trim();
        if (nextTrimmed && nextIndent >= indent) {
          issues.push({ type: 'cleanup', severity: 'info', line: i + 1, message: "'pass' redundante — hay código después en el mismo bloque", fixable: true });
        }
      }
    }

    return issues;
  }

  // ═══════════════════════════════════════════════════════════
  //  DETECCIÓN DE PATRONES INEFICIENTES
  // ═══════════════════════════════════════════════════════════

  /**
   * Detectar patrones de rendimiento en JavaScript
   */
  detectPerformanceIssuesJS(code) {
    const issues = [];
    const lines = code.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // 1. Array.push en loop → preallocate o map/filter
      if (/for\s*\(/.test(trimmed) || /\.forEach\s*\(/.test(trimmed)) {
        // Buscar .push() dentro del loop
        let depth = 0;
        for (let j = i; j < Math.min(i + 20, lines.length); j++) {
          if (lines[j].includes('{')) depth++;
          if (lines[j].includes('}')) depth--;
          if (/\.push\s*\(/.test(lines[j]) && depth > 0) {
            issues.push({
              type: 'performance',
              severity: 'info',
              line: i + 1,
              message: 'Loop con .push() → considerar .map() o .filter() para mejor rendimiento'
            });
            break;
          }
          if (depth <= 0 && j > i) break;
        }
      }

      // 2. Concatenación de strings en loop → usar array.join() o template literals
      if (/for\s*\(/.test(trimmed)) {
        let depth = 0;
        for (let j = i; j < Math.min(i + 15, lines.length); j++) {
          if (lines[j].includes('{')) depth++;
          if (lines[j].includes('}')) depth--;
          if (/\+\s*=\s*['"`]/.test(lines[j]) && depth > 0) {
            issues.push({
              type: 'performance',
              severity: 'warn',
              line: j + 1,
              message: 'Concatenación de strings en loop — usar array + .join() es más eficiente'
            });
            break;
          }
          if (depth <= 0 && j > i) break;
        }
      }

      // 3. document.querySelector repetido → cachear en variable
      if (/document\.(querySelector|getElementById|getElementsBy)/.test(trimmed)) {
        const selectorMatch = trimmed.match(/document\.\w+\(['"]([^'"]+)['"]\)/);
        if (selectorMatch) {
          const selector = selectorMatch[1];
          const selectorRegex = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
          const occurrences = code.match(selectorRegex);
          if (occurrences && occurrences.length > 1) {
            issues.push({
              type: 'performance',
              severity: 'warn',
              line: i + 1,
              message: `Selector '${selector}' usado ${occurrences.length}x — cachear en una variable`
            });
          }
        }
      }

      // 4. Nested loops O(n²) 
      if (/for\s*\(/.test(trimmed) || /\.forEach\s*\(/.test(trimmed)) {
        let depth = 0;
        for (let j = i + 1; j < Math.min(i + 30, lines.length); j++) {
          if (lines[j].includes('{')) depth++;
          if (lines[j].includes('}')) depth--;
          if ((/for\s*\(/.test(lines[j].trim()) || /\.forEach\s*\(/.test(lines[j].trim())) && depth > 0) {
            issues.push({
              type: 'performance',
              severity: 'warn',
              line: i + 1,
              message: 'Loops anidados (O(n²)) — considerar Map/Set o restructurar para O(n)'
            });
            break;
          }
          if (depth <= 0) break;
        }
      }

      // 5. JSON.parse(JSON.stringify()) para clonar → structuredClone()
      if (/JSON\.parse\s*\(\s*JSON\.stringify\s*\(/.test(trimmed)) {
        issues.push({
          type: 'performance',
          severity: 'info',
          line: i + 1,
          message: 'JSON.parse(JSON.stringify()) es lento para clonar — usar structuredClone()'
        });
      }

      // 6. setTimeout/setInterval con string
      if (/set(Timeout|Interval)\s*\(\s*['"]/.test(trimmed)) {
        issues.push({
          type: 'performance',
          severity: 'warn',
          line: i + 1,
          message: 'setTimeout/setInterval con string usa eval internamente — pasar una función'
        });
      }

      // 7. async/await dentro de loop → Promise.all
      if ((/for\s*\(/.test(trimmed) || /\.forEach\s*\(/.test(trimmed)) && /async/.test(trimmed)) {
        issues.push({
          type: 'performance',
          severity: 'warn',
          line: i + 1,
          message: 'await en loop ejecuta secuencialmente — considerar Promise.all() para paralelizar'
        });
      }
      if (/for\s*\(/.test(trimmed) || /while\s*\(/.test(trimmed)) {
        let depth = 0;
        for (let j = i; j < Math.min(i + 15, lines.length); j++) {
          if (lines[j].includes('{')) depth++;
          if (lines[j].includes('}')) depth--;
          if (/\bawait\b/.test(lines[j]) && depth > 0 && j !== i) {
            issues.push({
              type: 'performance',
              severity: 'warn',
              line: j + 1,
              message: 'await dentro de loop — las operaciones se ejecutan en serie, considerar Promise.all()'
            });
            break;
          }
          if (depth <= 0 && j > i) break;
        }
      }

      // 8. new RegExp() repetido en loop → compilar fuera
      if (/new\s+RegExp\s*\(/.test(trimmed)) {
        // Verificar si está dentro de un loop
        let inLoop = false;
        for (let j = Math.max(0, i - 10); j < i; j++) {
          if (/for\s*\(|while\s*\(|\.forEach|\.map|\.filter|\.reduce/.test(lines[j])) {
            inLoop = true;
            break;
          }
        }
        if (inLoop) {
          issues.push({
            type: 'performance',
            severity: 'warn',
            line: i + 1,
            message: 'new RegExp() dentro de loop — compilar la regex fuera del loop'
          });
        }
      }

      // 9. Array spread en loop para acumular
      if (/=\s*\[\.\.\./.test(trimmed)) {
        let inLoop = false;
        for (let j = Math.max(0, i - 10); j < i; j++) {
          if (/for\s*\(|while\s*\(|\.forEach/.test(lines[j])) { inLoop = true; break; }
        }
        if (inLoop) {
          issues.push({
            type: 'performance',
            severity: 'warn',
            line: i + 1,
            message: 'Spread [...arr, item] en loop crea nuevo array cada vez — usar .push()'
          });
        }
      }
    }

    return issues;
  }

  /**
   * Detectar patrones de rendimiento en Python
   */
  detectPerformanceIssuesPython(code) {
    const issues = [];
    const lines = code.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();

      // 1. append en loop → list comprehension
      if (this._reForPy.test(trimmed)) {
        for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
          if (/\.append\s*\(/.test(lines[j])) {
            issues.push({ type: 'performance', severity: 'info', line: i + 1, message: 'Loop con .append() → usar list comprehension es más rápido' });
            break;
          }
        }
      }

      // 2. + para concatenar strings en loop
      if (this._reForPy.test(trimmed)) {
        for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
          if (/\+\s*=\s*['"]/.test(lines[j]) || /=\s*\w+\s*\+\s*['"]/.test(lines[j])) {
            issues.push({ type: 'performance', severity: 'warn', line: j + 1, message: 'Concatenación de strings en loop — usar "".join() o f-strings' });
            break;
          }
        }
      }

      // 3. in con lista → usar set
      if (this._reInListPy.test(trimmed)) {
        issues.push({ type: 'performance', severity: 'info', line: i + 1, message: '"in" con lista literal — usar set {} para búsqueda O(1)' });
      }

      // 4. global keyword
      if (this._reGlobalPy.test(trimmed)) {
        issues.push({ type: 'quality', severity: 'warn', line: i + 1, message: 'Uso de global — evitar estado global, pasar como parámetro' });
      }

      // 5. Nested loops
      if (this._reForPy.test(trimmed)) {
        const indent = lines[i].match(/^(\s*)/)[1].length;
        for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
          const jIndent = lines[j].match(/^(\s*)/)?.[1]?.length || 0;
          if (jIndent <= indent && lines[j].trim()) break;
          if (this._reForPy.test(lines[j].trim()) && jIndent > indent) {
            issues.push({ type: 'performance', severity: 'warn', line: i + 1, message: 'Loops anidados O(n²) — considerar dict/set para lookup O(1)' });
            break;
          }
        }
      }
    }

    return issues;
  }

  // ═══════════════════════════════════════════════════════════
  //  DETECCIÓN DE REDUNDANCIAS Y SIMPLIFICACIONES
  // ═══════════════════════════════════════════════════════════

  /**
   * Detectar código redundante/simplificable
   */
  detectRedundancy(code, language) {
    const issues = [];
    const lines = code.split('\n');

    if (language === 'javascript') {
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();

        // if (x) return true; else return false; → return x;
        if (/if\s*\(.+\)\s*\{?\s*return\s+true/.test(trimmed)) {
          if (i + 1 < lines.length && /return\s+false/.test(lines[i + 1].trim()) ||
              i + 2 < lines.length && /return\s+false/.test(lines[i + 2].trim())) {
            issues.push({
              type: 'simplify',
              severity: 'info',
              line: i + 1,
              message: 'if/return true/false → simplificar a return (condición)'
            });
          }
        }

        // x === true → x / x === false → !x
        if (/===?\s*true\b/.test(trimmed) || /===?\s*false\b/.test(trimmed)) {
          issues.push({
            type: 'simplify',
            severity: 'info',
            line: i + 1,
            message: 'Comparación explícita con true/false — simplificar'
          });
        }

        // typeof x !== 'undefined' && x !== null → x != null
        if (/typeof\s+\w+\s*!==?\s*['"]undefined['"].*&&.*!==?\s*null/.test(trimmed)) {
          issues.push({
            type: 'simplify',
            severity: 'info',
            line: i + 1,
            message: 'typeof + null check → simplificar con x != null (cubre ambos)'
          });
        }

        // .then().catch() → async/await con try/catch
        if (/\.then\s*\(/.test(trimmed) && !trimmed.startsWith('//')) {
          issues.push({
            type: 'modernize',
            severity: 'info',
            line: i + 1,
            message: '.then() → considerar async/await para código más legible'
          });
        }

        // Array duplicado: [...new Set(arr)]
        // (no es issue, solo lo detectamos para informar que es correcto)

        // Doble negación !!x → Boolean(x) (más claro)
        if (/!![\w.]/.test(trimmed)) {
          issues.push({
            type: 'simplify',
            severity: 'info',
            line: i + 1,
            message: '!!value → Boolean(value) es más explícito y legible'
          });
        }

        // .length === 0 → !arr.length
        if (/\.length\s*===?\s*0/.test(trimmed)) {
          issues.push({
            type: 'simplify',
            severity: 'info',
            line: i + 1,
            message: '.length === 0 → !arr.length (más conciso)'
          });
        }

        // Funciones vacías
        if (/function\s*\w*\s*\([^)]*\)\s*\{\s*\}/.test(trimmed) || /\([^)]*\)\s*=>\s*\{\s*\}/.test(trimmed)) {
          issues.push({
            type: 'cleanup',
            severity: 'warn',
            line: i + 1,
            message: 'Función vacía — ¿código pendiente o innecesario?'
          });
        }
      }
    }

    if (language === 'python') {
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();

        // if x == True → if x
        if (this._rePyTrue.test(trimmed) || /is\s+True\b/.test(trimmed)) {
          issues.push({ type: 'simplify', severity: 'info', line: i + 1, message: '== True → simplificar a if x' });
        }
        if (this._rePyFalse.test(trimmed) || /is\s+False\b/.test(trimmed)) {
          issues.push({ type: 'simplify', severity: 'info', line: i + 1, message: '== False → simplificar a if not x' });
        }

        // len(x) == 0 → not x
        if (this._rePyLenZero.test(trimmed)) {
          issues.push({ type: 'simplify', severity: 'info', line: i + 1, message: 'len(x) == 0 → simplificar a not x' });
        }

        // type(x) == → isinstance()
        if (this._rePyTypeEq.test(trimmed)) {
          issues.push({ type: 'simplify', severity: 'warn', line: i + 1, message: 'type() == → usar isinstance() que maneja herencia' });
        }
      }
    }

    // Genérico: líneas duplicadas exactas
    const lineMap = new Map();
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.length < 20 || trimmed.startsWith('//') || trimmed.startsWith('#') || 
          trimmed === '{' || trimmed === '}' || trimmed === '') continue;
      
      if (lineMap.has(trimmed)) {
        const first = lineMap.get(trimmed);
        if (first.count === 1) {
          issues.push({
            type: 'duplicate',
            severity: 'info',
            line: i + 1,
            message: `Línea duplicada (igual a línea ${first.line}) — extraer a función reutilizable`
          });
        }
        first.count++;
      } else {
        lineMap.set(trimmed, { line: i + 1, count: 1 });
      }
    }

    return issues;
  }

  // ═══════════════════════════════════════════════════════════
  //  MÉTRICAS DE CÓDIGO
  // ═══════════════════════════════════════════════════════════

  /**
   * Calcular métricas de complejidad y tamaño
   */
  calculateMetrics(code, language) {
    const lines = code.split('\n');
    const nonEmpty = lines.filter(l => l.trim() !== '');
    const comments = lines.filter(l => {
      const t = l.trim();
      return t.startsWith('//') || t.startsWith('#') || t.startsWith('/*') || t.startsWith('*');
    });

    // Complejidad ciclomática básica
    let complexity = 1;
    const complexityKeywords = language === 'python'
      ? /\b(if|elif|for|while|except|and|or)\b/g
      : /\b(if|else\s+if|for|while|case|catch|\?\?|\|\||&&|\?)\b/g;
    
    const matches = code.match(complexityKeywords);
    if (matches) complexity += matches.length;

    // Profundidad máxima de anidamiento
    let maxDepth = 0, currentDepth = 0;
    for (const line of lines) {
      if (language === 'python') {
        const indent = line.match(/^(\s*)/)[1].length;
        const depth = Math.floor(indent / 4);
        maxDepth = Math.max(maxDepth, depth);
      } else {
        for (const ch of line) {
          if (ch === '{') { currentDepth++; maxDepth = Math.max(maxDepth, currentDepth); }
          if (ch === '}') currentDepth--;
        }
      }
    }

    // Ratio de comentarios
    const commentRatio = nonEmpty.length > 0 ? (comments.length / nonEmpty.length * 100).toFixed(1) : 0;

    // Longitud promedio de funciones
    let funcCount = 0, totalFuncLines = 0;
    if (language === 'javascript') {
      const funcStarts = [];
      for (let i = 0; i < lines.length; i++) {
        if (/function\s+\w+|=>\s*\{|(\w+)\s*\([^)]*\)\s*\{/.test(lines[i])) {
          funcStarts.push(i);
          funcCount++;
        }
      }
      // Estimación simple
      if (funcCount > 0) totalFuncLines = nonEmpty.length;
    }

    return {
      totalLines: lines.length,
      codeLines: nonEmpty.length - comments.length,
      commentLines: comments.length,
      blankLines: lines.length - nonEmpty.length,
      commentRatio: `${commentRatio}%`,
      cyclomaticComplexity: complexity,
      maxNestingDepth: maxDepth,
      functions: funcCount,
      avgFunctionLength: funcCount > 0 ? Math.round(totalFuncLines / funcCount) : 0,
      complexityRating: complexity <= 5 ? '🟢 Baja' : complexity <= 10 ? '🟡 Media' : complexity <= 20 ? '🟠 Alta' : '🔴 Muy alta'
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  OPTIMIZACIÓN CON GEMINI AI
  // ═══════════════════════════════════════════════════════════

  /**
   * Optimizar código usando Gemini AI
   */
  async optimizeWithAI(code, language, issues) {
    if (!this.geminiApiKey) {
      return { code, optimizations: ['No hay API key de Gemini configurada'], changed: false };
    }

    const issuesSummary = issues
      .slice(0, 20)
      .map(i => `Línea ${i.line}: [${i.type}] ${i.message}`)
      .join('\n');

    const prompt = `Eres un experto en optimización de código ${language}.

TAREA: Optimiza el siguiente código para máximo rendimiento y limpieza.

REGLAS ESTRICTAS:
- Devuelve SOLO el código optimizado, sin explicaciones ni markdown
- No agregues \`\`\` ni bloques de código
- Elimina código muerto (variables/funciones no usadas, imports innecesarios)
- Simplifica lógica redundante
- Optimiza loops y estructuras de datos
- Usa las mejores prácticas modernas del lenguaje
- Mantén la funcionalidad exacta — solo optimiza el rendimiento
- Elimina console.log/print de debug
- Si un loop se puede reemplazar por un método funcional (.map, .filter, etc), hazlo
- Si hay operaciones async en loop, usa Promise.all cuando sea posible

PROBLEMAS DETECTADOS:
${issuesSummary || 'Ninguno detectado automáticamente — busca optimizaciones generales.'}

CÓDIGO ORIGINAL:
${code}`;

    try {
      const res = await fetch(this.geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: 'Eres un optimizador de código experto. Devuelves SOLO código optimizado, sin texto adicional ni bloques markdown. Tu prioridad: rendimiento, limpieza, legibilidad.' }]
          },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 8192,
            temperature: 0.1,
            topP: 0.8
          }
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error('❌ Gemini optimize error:', errText);
        return { code, optimizations: ['Error comunicando con Gemini AI'], changed: false };
      }

      const data = await res.json();
      let optimizedCode = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

      // Limpiar markdown residual (regex pre-compiladas)
      optimizedCode = optimizedCode
        .replace(this._reMdClean, '')
        .replace(this._reMdEnd, '')
        .trim();

      if (!optimizedCode || optimizedCode === code) {
        return { code, optimizations: ['El código ya está optimizado'], changed: false };
      }

      // Calcular mejoras
      const originalLines = code.split('\n').filter(l => l.trim()).length;
      const optimizedLines = optimizedCode.split('\n').filter(l => l.trim()).length;
      const reduction = originalLines - optimizedLines;

      const optimizations = ['Código optimizado con Gemini AI'];
      if (reduction > 0) {
        optimizations.push(`${reduction} líneas eliminadas (${Math.round(reduction / originalLines * 100)}% más compacto)`);
      }

      return {
        code: optimizedCode,
        optimizations,
        changed: true,
        method: 'ai',
        stats: { originalLines, optimizedLines, reduction }
      };
    } catch (err) {
      console.error('❌ Error en optimizeWithAI:', err.message);
      return { code, optimizations: [`Error IA: ${err.message}`], changed: false };
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  FIX AUTOMÁTICO SIN IA
  // ═══════════════════════════════════════════════════════════

  /**
   * Aplicar optimizaciones automáticas (sin IA)
   */
  autoOptimize(code, language, issues) {
    let optimized = code;
    const applied = [];

    // Eliminar líneas marcadas como removibles
    const linesToRemove = new Set();
    for (const issue of issues) {
      if (issue.fixable && issue.suggestion === 'remove-line' && issue.line > 0) {
        linesToRemove.add(issue.line - 1); // 0-indexed
      }
    }

    if (linesToRemove.size > 0) {
      const lines = optimized.split('\n');
      optimized = lines.filter((_, i) => !linesToRemove.has(i)).join('\n');
      applied.push(`${linesToRemove.size} línea(s) de código muerto eliminada(s)`);
    }

    // Eliminar líneas en blanco excesivas
    const before = optimized;
    optimized = optimized.replace(this._reBlankLines, '\n\n\n');
    if (optimized !== before) {
      applied.push('Líneas en blanco excesivas reducidas');
    }

    // Eliminar trailing whitespace
    const lines = optimized.split('\n');
    let trailingFixed = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] !== lines[i].trimEnd()) {
        lines[i] = lines[i].trimEnd();
        trailingFixed = true;
      }
    }
    if (trailingFixed) {
      optimized = lines.join('\n');
      applied.push('Espacios en blanco al final de líneas eliminados');
    }

    return { code: optimized, optimizations: applied, changed: optimized !== code };
  }

  // ═══════════════════════════════════════════════════════════
  //  PIPELINE COMPLETO
  // ═══════════════════════════════════════════════════════════

  /**
   * Análisis completo de optimización
   */
  analyzeOptimization(code, language) {
    let deadCode = [];
    let perfIssues = [];

    if (language === 'javascript') {
      deadCode = this.detectDeadCodeJS(code);
      perfIssues = this.detectPerformanceIssuesJS(code);
    } else if (language === 'python') {
      deadCode = this.detectDeadCodePython(code);
      perfIssues = this.detectPerformanceIssuesPython(code);
    }

    const redundancy = this.detectRedundancy(code, language);
    const metrics = this.calculateMetrics(code, language);
    const allIssues = [...deadCode, ...perfIssues, ...redundancy];

    return { issues: allIssues, metrics, deadCode, perfIssues, redundancy };
  }

  /**
   * Pipeline completo: analizar + optimizar
   */
  async fullOptimize(code, language, useAI = true) {
    const analysis = this.analyzeOptimization(code, language);
    let currentCode = code;
    const allOptimizations = [];

    // Paso 1: Fixes automáticos
    const autoResult = this.autoOptimize(currentCode, language, analysis.issues);
    if (autoResult.changed) {
      currentCode = autoResult.code;
      allOptimizations.push(...autoResult.optimizations);
    }

    // Paso 2: Optimización con IA si hay issues o se solicita
    let aiResult = null;
    if (useAI && (analysis.issues.length > 0 || analysis.metrics.cyclomaticComplexity > 10)) {
      aiResult = await this.optimizeWithAI(currentCode, language, analysis.issues);
      if (aiResult.changed) {
        currentCode = aiResult.code;
        allOptimizations.push(...aiResult.optimizations);
      }
    }

    return {
      original: code,
      optimized: currentCode,
      changed: currentCode !== code,
      optimizations: allOptimizations,
      analysis,
      language
    };
  }

  /**
   * Construir resumen legible
   */
  buildOptimizeSummary(result) {
    const parts = [];
    const { analysis, optimizations, changed } = result;
    const m = analysis.metrics;

    parts.push(`⚡ *Optimización de código* (${result.language.toUpperCase()})`);
    parts.push('');

    // Métricas
    parts.push(`📊 *Métricas:*`);
    parts.push(`  Líneas de código: ${m.codeLines}`);
    parts.push(`  Complejidad: ${m.cyclomaticComplexity} ${m.complexityRating}`);
    parts.push(`  Profundidad máxima: ${m.maxNestingDepth} niveles`);
    parts.push(`  Comentarios: ${m.commentRatio}`);
    parts.push('');

    // Issues encontrados
    const { deadCode, perfIssues, redundancy } = analysis;
    if (deadCode.length > 0) {
      parts.push(`🗑️ *Código muerto (${deadCode.length}):*`);
      for (const d of deadCode.slice(0, 5)) {
        parts.push(`  Línea ${d.line}: ${d.message}`);
      }
      if (deadCode.length > 5) parts.push(`  ... y ${deadCode.length - 5} más`);
      parts.push('');
    }

    if (perfIssues.length > 0) {
      parts.push(`🐌 *Rendimiento (${perfIssues.length}):*`);
      for (const p of perfIssues.slice(0, 5)) {
        parts.push(`  Línea ${p.line}: ${p.message}`);
      }
      if (perfIssues.length > 5) parts.push(`  ... y ${perfIssues.length - 5} más`);
      parts.push('');
    }

    if (redundancy.length > 0) {
      parts.push(`♻️ *Simplificable (${redundancy.length}):*`);
      for (const r of redundancy.slice(0, 5)) {
        parts.push(`  Línea ${r.line}: ${r.message}`);
      }
      if (redundancy.length > 5) parts.push(`  ... y ${redundancy.length - 5} más`);
      parts.push('');
    }

    if (analysis.issues.length === 0) {
      parts.push('✅ ¡Código eficiente! No se encontraron problemas de rendimiento ni código muerto.');
      parts.push('');
    }

    // Resultado de optimización
    if (changed) {
      parts.push(`🔧 *${optimizations.length} optimización(es) aplicada(s):*`);
      for (const opt of optimizations) {
        parts.push(`  • ${opt}`);
      }
    } else {
      parts.push('ℹ️ No se aplicaron cambios automáticos.');
    }

    return parts.join('\n');
  }
}

module.exports = CodeOptimizer;
