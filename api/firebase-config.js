/* ============================================================
   Vercel Serverless Function — Firebase Config
   ============================================================
   Sirve la configuración de Firebase desde variables de entorno
   para no exponer las claves directamente en el código fuente.
   ============================================================ */

module.exports = function handler(req, res) {
  // Solo permitir GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validar que el origen sea permitido (CORS)
  const allowedOrigins = [
    process.env.ALLOWED_ORIGIN || 'https://streamly-alpha.vercel.app',
    'https://streamly.vercel.app',
    'http://localhost:8080',
    'http://localhost:3000'
  ];

  const origin = req.headers.origin || req.headers.referer || '';
  const isAllowed = allowedOrigins.some(o => origin.startsWith(o));

  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');

  // Verificar que las variables existan
  if (!process.env.FIREBASE_API_KEY) {
    return res.status(500).json({ error: 'Firebase config not set in environment' });
  }

  return res.status(200).json({
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    measurementId: process.env.FIREBASE_MEASUREMENT_ID
  });
}
