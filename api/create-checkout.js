const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', 'https://fivemshop.fr');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { productName, price, productId } = req.body;

  if (!productName || !price) {
    return res.status(400).json({ error: 'Données manquantes' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: productName,
              description: 'Script FiveM — Téléchargement immédiat après paiement',
            },
            unit_amount: Math.round(price * 100), // en centimes
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      // Page de succès — Stripe redirige ici après paiement
      success_url: `https://fivemshop.fr/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      // Page d'annulation
      cancel_url: `https://fivemshop.fr/?payment=cancelled`,
      metadata: {
        productId: productId || '',
        productName: productName,
      },
      // Produit numérique — pas de livraison
      shipping_address_collection: undefined,
      phone_number_collection: { enabled: false },
    });

    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('Erreur Stripe checkout :', err.message);
    return res.status(500).json({ error: 'Erreur lors de la création du paiement' });
  }
};
