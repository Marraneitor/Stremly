/**
 * Vercel Serverless Function — Stripe Webhook
 * POST /api/stripe-webhook
 *
 * Activa automáticamente el plan del usuario en Firestore
 * cuando Stripe confirma el pago.
 *
 * Env vars requeridas:
 * - STRIPE_SECRET_KEY
 * - STRIPE_WEBHOOK_SECRET
 * - FIREBASE_SERVICE_ACCOUNT (JSON string)
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require('firebase-admin');

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function getFirebaseAdmin() {
  if (admin.apps && admin.apps.length) return admin;

  const json = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!json) throw new Error('FIREBASE_SERVICE_ACCOUNT not configured');

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(json);
  } catch (e) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON');
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  return admin;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).send('Stripe not configured');
  }
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(500).send('Webhook secret not configured');
  }

  let event;
  try {
    const rawBody = await getRawBody(req);
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      const uid = (session.metadata && session.metadata.uid) || session.client_reference_id || null;
      const plan = (session.metadata && session.metadata.plan) || null;

      if (!uid || !plan) {
        console.warn('Missing uid/plan in checkout session metadata');
        return res.status(200).json({ received: true, skipped: true });
      }

      const fb = getFirebaseAdmin();
      const db = fb.firestore();

      await db.collection('usuarios').doc(uid).set(
        {
          plan,
          plan_status: 'active',
          stripe_customer_id: session.customer || null,
          stripe_subscription_id: session.subscription || null,
          plan_updated_at: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return res.status(200).json({ received: true });
    }

    // No-op for other event types
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(500).send('Webhook handler failed');
  }
};
