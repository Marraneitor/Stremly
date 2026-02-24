/**
 * Vercel Serverless Function — Create Stripe Checkout Session
 * POST /api/create-checkout-session
 * Body: { plan: "lite"|"premium" (optional), currency: "mxn"|"usd"|..., uid, email }
 *
 * Crea un checkout de suscripción para el plan seleccionado.
 * Precios base en MXN y conversión aproximada para otras monedas.
 *
 * Env vars:
 * - STRIPE_SECRET_KEY (required)
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Precios base (MXN)
const PLAN_PRICE_MXN = {
  lite: 50,
  premium: 100,
};

// Conversión aproximada desde MXN -> moneda
const CURRENCIES = {
  mxn: { rate: 1,      minorUnits: 2 },
  usd: { rate: 0.057,  minorUnits: 2 },
  eur: { rate: 0.052,  minorUnits: 2 },
  brl: { rate: 0.29,   minorUnits: 2 },
  cop: { rate: 236,    minorUnits: 0 },
  ars: { rate: 60,     minorUnits: 2 },
  pen: { rate: 0.21,   minorUnits: 2 },
  clp: { rate: 54,     minorUnits: 0 },
};

function computeUnitAmount({ mxnAmount, currency }) {
  const cfg = CURRENCIES[currency] || CURRENCIES.mxn;
  const converted = mxnAmount * cfg.rate;
  const factor = Math.pow(10, cfg.minorUnits);
  return Math.round(converted * factor);
}

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: 'Stripe not configured. Set STRIPE_SECRET_KEY environment variable.' });
    }

    const origin = req.headers.origin || req.headers.referer || 'https://streamly-alpha.vercel.app';
    const baseUrl = String(origin).replace(/\/$/, '');

    const body = req.body || {};
    const plan = String(body.plan || 'premium').toLowerCase();
    const currency = String(body.currency || 'mxn').toLowerCase();
    const uid = body.uid ? String(body.uid) : null;
    const email = body.email ? String(body.email) : null;

    if (!PLAN_PRICE_MXN[plan]) {
      return res.status(400).json({ error: 'Invalid plan' });
    }
    if (!CURRENCIES[currency]) {
      return res.status(400).json({ error: 'Invalid currency' });
    }

    const unit_amount = computeUnitAmount({ mxnAmount: PLAN_PRICE_MXN[plan], currency });

    const planNames = { lite: 'Lite', premium: 'Premium' };
    const planLabel = planNames[plan] || plan;

    // Create a Checkout Session with an inline price (no pre-created price needed)
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      client_reference_id: uid || undefined,
      customer_email: email || undefined,
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: `Streamly — Plan ${planLabel}`,
              description: plan === 'premium'
                ? 'Clientes ilimitados + herramientas premium.'
                : 'Hasta 49 clientes + reportes y calendario.',
              images: [],
            },
            unit_amount,
            recurring: {
              interval: 'month',
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        uid: uid || '',
        plan,
        currency,
      },
      success_url: `${baseUrl}/app?checkout=success`,
      cancel_url: `${baseUrl}/app?checkout=cancelled`,
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
