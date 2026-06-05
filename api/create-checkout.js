import Stripe from 'stripe';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const { productName, price, productId } = req.body;

  if (!productName || !price) {
    return res.status(400).json({ error: 'Données manquantes' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: productName,
            description: 'Script FiveM — Téléchargement immédiat après paiement',
          },
          unit_amount: Math.round(price * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: 'https://fivemshop.fr/?payment=success&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://fivemshop.fr/?payment=cancelled',
      metadata: {
        productId: productId || '',
        productName: productName,
      },
      phone_number_collection: { enabled: false },
    });

    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('Erreur Stripe:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
