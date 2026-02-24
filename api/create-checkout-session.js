/**
 * Vercel Serverless Function — Create Stripe Checkout Session
 * POST /api/create-checkout-session
 * Body: { currency: "mxn" | "usd" | "eur" | ... }
 *
 * Uses Stripe Price objects created dynamically, or a single price_id
 * for the base MXN subscription and converts display-only for other currencies.
 * 
 * Stripe actually charges in MXN (99 MXN). The currency switcher on the
 * landing page is for DISPLAY purposes. We create the checkout in MXN.
 * If you want multi-currency billing, create separate Stripe Prices per currency.
 * 
 * Environment variable required: STRIPE_SECRET_KEY
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Base price in MXN (smallest unit = centavos)
const PRICE_MXN_CENTS = 9900; // $99.00 MXN

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
    const baseUrl = origin.replace(/\/$/, '');

    // Create a Checkout Session with an inline price (no pre-created price needed)
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'mxn',
            product_data: {
              name: 'Streamly — Plan Completo',
              description: 'Gestión de cuentas de streaming + Bot WhatsApp con IA. Clientes ilimitados.',
              images: [],
            },
            unit_amount: PRICE_MXN_CENTS,
            recurring: {
              interval: 'month',
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}/index.html?checkout=success`,
      cancel_url: `${baseUrl}/landing.html?checkout=cancelled`,
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
