const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

// Vercel : désactive le bodyParser pour lire le raw body (requis par Stripe)
export const config = {
  api: { bodyParser: false },
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Méthode non autorisée');

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Signature webhook invalide :', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // ══════════════════════════════════════════════
  //  Traitement des événements
  // ══════════════════════════════════════════════
  switch (event.type) {

    case 'checkout.session.completed': {
      const session = event.data.object;

      const customerEmail = session.customer_details?.email;
      const productName   = session.metadata?.productName;
      const productId     = session.metadata?.productId;
      const amount        = (session.amount_total / 100).toFixed(2);

      console.log('✅ Paiement confirmé !');
      console.log(`   Email   : ${customerEmail}`);
      console.log(`   Produit : ${productName} (ID: ${productId})`);
      console.log(`   Montant : ${amount} €`);

      // ✏️ ICI : ajoute tes actions après paiement
      // Exemples :
      //   - Envoyer un email avec le lien de téléchargement
      //   - Enregistrer la commande dans Upstash (ta DB)
      //   - Envoyer une notif Discord
      //
      // Exemple Discord webhook :
      // await fetch(process.env.DISCORD_WEBHOOK_URL, {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({
      //     content: `💰 Nouvelle vente ! **${productName}** — ${amount}€ — ${customerEmail}`
      //   })
      // });

      break;
    }

    case 'payment_intent.payment_failed': {
      const intent = event.data.object;
      console.warn('❌ Paiement échoué :', intent.id);
      break;
    }

    default:
      console.log(`ℹ️ Événement ignoré : ${event.type}`);
  }

  return res.status(200).json({ received: true });
};
