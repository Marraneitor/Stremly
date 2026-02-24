/* ============================================================
   Vercel Serverless Function — Chatbot (Gemini AI)
   ============================================================
   Recibe un mensaje y contexto, llama a Gemini 2.5 Flash
   y devuelve la respuesta del bot.
   ============================================================ */

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    setCorsHeaders(req, res);
    return res.status(200).end();
  }

  // Solo POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  setCorsHeaders(req, res);

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Gemini API key not configured' });
  }

  const { message, config } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const systemPrompt = buildSystemPrompt(config || {});
  const maxTokens = config?.maxTokens || 512;

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
          { role: 'user', parts: [{ text: message }] }
        ],
        generationConfig: {
          maxOutputTokens: maxTokens,
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
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text
      || config?.fallbackMsg
      || 'Lo siento, no pude generar una respuesta.';

    return res.status(200).json({ reply });
  } catch (err) {
    console.error('Chatbot error:', err);
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

function buildSystemPrompt(config) {
  const parts = [
    'Eres un asistente virtual de atención al cliente por WhatsApp.',
    'Responde SIEMPRE en español.',
    'Sé conciso y directo en tus respuestas (formato WhatsApp, no uses Markdown).'
  ];

  if (config.businessName) {
    parts.push(`El nombre del negocio es: "${config.businessName}".`);
  }
  if (config.schedule) {
    parts.push(`Los horarios de atención son: ${config.schedule}.`);
  }
  if (config.personality) {
    parts.push(`Tu personalidad y forma de actuar: ${config.personality}`);
  }
  if (config.context) {
    parts.push(`Contexto del negocio e información importante:\n${config.context}`);
  }
  if (config.fallbackMsg) {
    parts.push(`Si no sabes algo o la pregunta está fuera de contexto, responde: "${config.fallbackMsg}".`);
  }

  parts.push('No inventes información que no esté en el contexto. Si no sabes, dilo.');
  parts.push('No reveles que eres una IA a menos que te pregunten directamente.');

  return parts.join('\n');
}
