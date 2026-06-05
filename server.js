const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const app = express();

const DISCORD_CLIENT_ID     = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_BOT_TOKEN     = process.env.DISCORD_BOT_TOKEN;
const DISCORD_NOTIF_CHANNEL = process.env.DISCORD_NOTIF_CHANNEL;
const DISCORD_BUYER_ROLE    = process.env.DISCORD_BUYER_ROLE;
const DISCORD_GUILD_ID      = process.env.DISCORD_GUILD_ID;
const REDIRECT_URI          = process.env.REDIRECT_URI;
const FRONTEND_URL          = process.env.FRONTEND_URL;
const SESSION_SECRET        = process.env.SESSION_SECRET || 'secret';
const STRIPE_SECRET_KEY     = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

const ADMIN_DISCORD_IDS = process.env.ADMIN_DISCORD_IDS
  ? process.env.ADMIN_DISCORD_IDS.split(',').map(id => id.trim())
  : ['1063894863894040747', '1148182031642144809'];

app.set('trust proxy', 1);
app.use(cors({ origin: FRONTEND_URL, credentials: true }));

// Raw body pour Stripe webhook AVANT express.json()
app.use('/api/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: true, sameSite: 'none', maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use(express.static(path.join(__dirname, 'public')));

console.log('DISCORD_CLIENT_ID:', DISCORD_CLIENT_ID ? '✅ OK' : '❌ MANQUANT');
console.log('STRIPE_SECRET_KEY:', STRIPE_SECRET_KEY ? '✅ OK' : '❌ MANQUANT');

// ═══════════════════════════════════════
//  STRIPE — Créer une session de paiement
// ═══════════════════════════════════════
app.post('/api/create-checkout', async (req, res) => {
  const Stripe = require('stripe');
  const stripe = new Stripe(STRIPE_SECRET_KEY);
  const { productName, price, productId } = req.body;

  if (!productName || !price) return res.status(400).json({ error: 'Données manquantes' });

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: productName, description: 'Script FiveM — Téléchargement immédiat' },
          unit_amount: Math.round(price * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${FRONTEND_URL}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/?payment=cancelled`,
      metadata: { productId: productId || '', productName },
      phone_number_collection: { enabled: false },
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════
//  STRIPE — Webhook
// ═══════════════════════════════════════
app.post('/api/webhook', async (req, res) => {
  const Stripe = require('stripe');
  const stripe = new Stripe(STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature invalide:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_details?.email;
    const productName = session.metadata?.productName;
    const amount = (session.amount_total / 100).toFixed(2);
    console.log(`✅ Paiement confirmé — ${productName} — ${amount}€ — ${email}`);

    // Notif Discord
    if (DISCORD_NOTIF_CHANNEL && DISCORD_BOT_TOKEN) {
      try {
        await fetch(`https://discord.com/api/v10/channels/${DISCORD_NOTIF_CHANNEL}/messages`, {
          method: 'POST',
          headers: { 'Authorization': `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: `💰 Nouvelle vente ! **${productName}** — ${amount}€ — ${email}` })
        });
      } catch(e) { console.error('Discord notif error:', e.message); }
    }
  }

  res.json({ received: true });
});

// ═══════════════════════════════════════
//  DISCORD AUTH
// ═══════════════════════════════════════
async function notifierCommande(commande) {
  const { pseudo, avatar, articles, total, discordId } = commande;
  const embed = {
    title: '🛒 Nouvelle commande !',
    color: 0x5865F2,
    thumbnail: avatar ? { url: avatar } : undefined,
    fields: [
      { name: '👤 Acheteur', value: `<@${discordId}> (${pseudo})`, inline: true },
      { name: '💰 Total', value: `${total}€`, inline: true },
      { name: '📦 Articles', value: articles || 'Non spécifié', inline: false }
    ],
    timestamp: new Date().toISOString(),
    footer: { text: 'FiveM Store' }
  };
  await fetch(`https://discord.com/api/v10/channels/${DISCORD_NOTIF_CHANNEL}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] })
  });
}

async function donnerRoleAcheteur(discordId) {
  const res = await fetch(
    `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${discordId}/roles/${DISCORD_BUYER_ROLE}`,
    { method: 'PUT', headers: { 'Authorization': `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' } }
  );
  return res.ok;
}

app.get('/auth/discord', (req, res) => {
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'identify email'
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

app.get('/auth/discord/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect(`${FRONTEND_URL}?auth_error=access_denied`);
  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI
      })
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error) throw new Error(tokenData.error_description || tokenData.error);
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const discordUser = await userRes.json();
    req.session.user = {
      id: 'discord_' + discordUser.id,
      pseudo: discordUser.username,
      email: discordUser.email || '',
      avatar: discordUser.avatar
        ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
        : null,
      avatarInitials: (discordUser.username[0] || 'D').toUpperCase(),
      provider: 'discord',
      discordId: discordUser.id,
      createdAt: new Date().toISOString()
    };
    req.session.save(() => res.redirect(`${FRONTEND_URL}?auth_success=1`));
  } catch (err) {
    console.error('Discord OAuth error:', err);
    res.redirect(`${FRONTEND_URL}?auth_error=server_error`);
  }
});

app.get('/api/me', (req, res) => res.json({ user: req.session.user || null }));

app.get('/api/is-admin', (req, res) => {
  if (!req.session.user) return res.json({ admin: false });
  res.json({ admin: ADMIN_DISCORD_IDS.includes(req.session.user.discordId) });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => { res.clearCookie('connect.sid'); res.json({ ok: true }); });
});

app.post('/api/commande', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Non connecté' });
  const { articles, total } = req.body;
  const { pseudo, avatar, discordId } = req.session.user;
  try {
    await notifierCommande({ pseudo, avatar, articles, total, discordId });
    await donnerRoleAcheteur(discordId);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erreur commande:', err);
    res.status(500).json({ error: 'Erreur' });
  }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
