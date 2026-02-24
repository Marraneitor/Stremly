/* ============================================================
   Vercel Serverless Function — Improve Bot Context with AI
   ============================================================
   Recibe el contexto crudo del cliente y lo mejora/estructura
   usando Gemini 2.0 Flash para optimizar el rendimiento del bot.
   ============================================================ */

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    setCorsHeaders(req, res);
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  setCorsHeaders(req, res);

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Gemini API key not configured' });
  }

  const { context } = req.body;
  if (!context || !context.trim()) {
    return res.status(400).json({ error: 'Context is required' });
  }

  const systemPrompt = buildImprovementPrompt();

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [
          { role: 'user', parts: [{ text: context }] }
        ],
        generationConfig: {
          maxOutputTokens: 2048,
          temperature: 0.7,
          topP: 0.9
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
        ]
      })
    });

    if (!geminiRes.ok) {
      const err = await geminiRes.text();
      console.error('Gemini API error:', err);
      return res.status(502).json({ error: 'Error communicating with AI', details: err });
    }

    const data = await geminiRes.json();
    const improvedContext = data?.candidates?.[0]?.content?.parts?.[0]?.text
      || null;

    if (!improvedContext) {
      return res.status(502).json({ error: 'No se pudo generar una mejora. Intenta de nuevo.' });
    }

    return res.status(200).json({ improvedContext });
  } catch (err) {
    console.error('Improve context error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function setCorsHeaders(req, res) {
  const allowedOrigins = [
    process.env.ALLOWED_ORIGIN || 'https://streamly-alpha.vercel.app',
    'https://streamly.vercel.app',
    'http://localhost:8080',
    'http://localhost:3000'
  ];
  const origin = req.headers.origin || '';
  if (allowedOrigins.some(o => origin.startsWith(o))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function buildImprovementPrompt() {
  return `Eres un experto en diseño de instrucciones para chatbots de ventas por WhatsApp.

Tu tarea: Recibir el contexto crudo que un cliente escribió para configurar su chatbot de ventas y MEJORARLO, estructurándolo y optimizándolo para que el bot atienda mucho mejor.

REGLAS ESTRICTAS:
- Responde SOLO con el contexto mejorado, listo para copiar y pegar. NO agregues explicaciones, introducciones ni comentarios.
- NO uses formato Markdown (ni #, ni **, ni \`\`\`). Usa solo texto plano con emojis como separadores de sección.
- Mantén TODA la información original del cliente (precios, productos, nombres). NO inventes datos.
- Si el cliente no mencionó algo, NO lo agregues con datos inventados. Solo agrega la SECCIÓN vacía como guía.
- Escribe en español.

ESTRUCTURA QUE DEBES APLICAR:

1. 🏪 IDENTIDAD Y PERSONALIDAD DEL NEGOCIO
   - Nombre del negocio (si lo mencionó)
   - Tono y personalidad: Definir si es profesional, amigable, entusiasta o directo
   - Restricciones de lenguaje: Uso moderado de emojis, gramática impecable, mensajes cortos (formato WhatsApp, máximo 3-4 líneas)

2. 📋 CATÁLOGO DE PRODUCTOS/SERVICIOS
   - Organizar los productos en una lista limpia y estandarizada
   - Formato: "- Producto: $Precio /periodo"
   - Si hay categorías, agruparlos

3. 📝 DATOS QUE EL BOT DEBE PEDIR AL CLIENTE
   - Lista clara de datos necesarios para procesar una venta
   - Ejemplo: Nombre, WhatsApp, plataforma deseada, método de pago

4. 💳 POLÍTICAS Y PROCESO
   - Métodos de pago aceptados (si los mencionó)
   - Proceso de entrega/activación
   - Horarios de atención
   - Garantías o condiciones

5. 🤖 COMPORTAMIENTO DEL BOT
   - Mensaje de bienvenida sugerido
   - Si el cliente pregunta por algo no listado: "Responde amablemente que consultarás disponibilidad con un agente humano"
   - Manejo de objeciones o preguntas frecuentes implícitas

6. 🎯 CIERRE DE VENTA
   - Instrucción: "Siempre intenta cerrar la conversación pidiendo el método de pago preferido o confirmando el pedido"
   - Guiar al cliente hacia la acción de compra de forma natural

7. ⚠️ RESTRICCIONES
   - No compartir contraseñas ni credenciales
   - No inventar información que no esté en el contexto
   - No revelar que es una IA (a menos que pregunten directamente)
   - Mensaje de fallback cuando no sepa responder

IMPORTANTE: Conserva los precios EXACTOS y productos del cliente. Solo reorganiza, mejora la redacción y agrega estructura.`;
}
