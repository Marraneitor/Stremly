/**
 * Vercel Serverless Function — Gift Subscription
 * POST /api/gift-subscription
 *
 * Permite al owner regalar una suscripción Pro a cualquier usuario registrado.
 *
 * Body JSON: { targetUid, durationType }
 *   targetUid    — UID del usuario en Firestore
 *   durationType — 'day' | 'week' | 'month'
 *
 * Auth: Authorization: Bearer <Firebase ID token> del owner.
 *
 * Env vars requeridas:
 *   FIREBASE_SERVICE_ACCOUNT (JSON string)
 */

const admin = require('firebase-admin');

const OWNER_EMAIL = 'yoelskygold@gmail.com';

function getFirebaseAdmin() {
  if (admin.apps && admin.apps.length) return admin;

  const json = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!json) throw new Error('FIREBASE_SERVICE_ACCOUNT not configured');

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(json);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON');
  }

  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  return admin;
}

function getBearerToken(req) {
  const m = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function calcExpiry(durationType) {
  const now = new Date();
  switch (durationType) {
    case 'day':   now.setDate(now.getDate() + 1);   break;
    case 'week':  now.setDate(now.getDate() + 7);   break;
    case 'month': now.setMonth(now.getMonth() + 1); break;
    default:
      throw new Error("durationType debe ser 'day', 'week' o 'month'");
  }
  return now;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  try {
    const fb    = getFirebaseAdmin();
    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ error: 'Missing bearer token' });

    const decoded     = await fb.auth().verifyIdToken(token);
    const callerEmail = (decoded.email || '').toLowerCase();

    if (callerEmail !== OWNER_EMAIL.toLowerCase()) {
      return res.status(403).json({ error: 'Forbidden: solo el owner puede regalar suscripciones' });
    }

    const { targetUid, durationType } = req.body || {};

    if (!targetUid)   return res.status(400).json({ error: 'targetUid es requerido' });
    if (!durationType) return res.status(400).json({ error: 'durationType es requerido (day|week|month)' });

    const expiresAt = calcExpiry(durationType);

    // Verificar que el usuario existe
    const userDoc = await fb.firestore().collection('usuarios').doc(targetUid).get();
    if (!userDoc.exists) {
      // Intentar con Auth por si no tiene doc en Firestore todavía
      try {
        await fb.auth().getUser(targetUid);
      } catch {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }
    }

    await fb.firestore().collection('usuarios').doc(targetUid).set({
      plan:            'pro',
      plan_activo:     true,
      gift:            true,
      gift_expires_at: admin.firestore.Timestamp.fromDate(expiresAt),
      gift_granted_by: callerEmail,
      gift_granted_at: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    const durationLabel = { day: '1 día', week: '1 semana', month: '1 mes' }[durationType];

    console.log(`[gift-subscription] owner=${callerEmail} → uid=${targetUid} plan=pro duration=${durationType} expires=${expiresAt.toISOString()}`);

    return res.status(200).json({
      ok:          true,
      targetUid,
      durationType,
      durationLabel,
      expiresAt:   expiresAt.toISOString(),
    });

  } catch (err) {
    console.error('gift-subscription error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
