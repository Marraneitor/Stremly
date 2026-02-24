/**
 * Vercel Serverless Function — Health / Build Info
 * GET /api/health
 *
 * Devuelve información mínima para depurar:
 * - buildId (frontend/backend)
 * - si existen env vars requeridas (sin exponer valores)
 */

module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const buildId = '2026-02-24-checkoutfix';

  return res.status(200).json({
    ok: true,
    buildId,
    env: {
      STRIPE_SECRET_KEY: Boolean(process.env.STRIPE_SECRET_KEY),
      STRIPE_WEBHOOK_SECRET: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
      FIREBASE_SERVICE_ACCOUNT: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT),
      GEMINI_API_KEY: Boolean(process.env.GEMINI_API_KEY)
    }
  });
};
