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

const ADMIN_DISCORD_IDS = process.env.ADMIN_DISCORD_IDS
  ? process.env.ADMIN_DISCORD_IDS.split(',').map(id => id.trim())
  : ['1063894863894040747', '1148182031642144809'];

app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

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
    res.redirect(`${FRONTEND_URL}?auth_success=1`);
  } catch (err) {
    console.error('Discord OAuth error:', err);
    res.redirect(`${FRONTEND_URL}?auth_error=server_error`);
  }
});

app.get('/api/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

app.get('/api/is-admin', (req, res) => {
  if (!req.session.user) return res.json({ admin: false, reason: 'not_logged_in' });
  const isAdmin = ADMIN_DISCORD_IDS.includes(req.session.user.discordId);
  res.json({ admin: isAdmin, discordId: req.session.user.discordId });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

app.post('/api/commande', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Non connecté' });
  const { articles, total } = req.body;
  const { pseudo, avatar, discordId } = req.session.user;
  try {
    await notifierCommande({ pseudo, avatar, articles, total, discordId });
    await donnerRoleAcheteur(discordId);
    res.json({ ok: true, message: 'Commande enregistrée, rôle attribué ✅' });
  } catch (err) {
    console.error('Erreur commande:', err);
    res.status(500).json({ error: 'Erreur lors du traitement de la commande' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
