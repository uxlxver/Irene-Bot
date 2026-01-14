const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { ActivityType } = require('discord.js');

// Load environment variables
require('dotenv').config();

// Constants
const TOKEN = process.env.DISCORD_TOKEN;
const PREFIX = process.env.PREFIX || '.';
const BOT_OWNER_ID = process.env.BOT_OWNER_ID || '637060183985487872';

// Currency emojis
const LOVE_QUARTZ = '<:LoveQuartz:1459653905586589847>';
const VITAL_CRYSTAL = '<:VitalCrystal:1459653872191537314>';

// Rarity emojis
const COMMON_EMOJI = '<:CommonRarity:1460028227832774834>';
const RARE_EMOJI = '<:RareRarity:1460028278587920404>';
const EPIC_EMOJI = '<:EpicRarity:1460028253057323098>';

// Ready/Not Ready emojis
const READY_HEART = '<:ReadyHeart:1460028170609885275>';
const NOT_READY_HEART = '<:NotReadyHeart:1460780856338809077>';

// Cooldown constants
const HUNT_COOLDOWN_MS = 30 * 60 * 1000;
const COOLDOWN_MS = 5 * 60 * 1000;
const DAILY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Validation
if (!TOKEN) {
  console.error('Missing DISCORD_TOKEN in environment. See .env.example');
  process.exit(1);
}

// Client initialization
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

// Data directory setup
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

// Import HTTP modules for image handling
const http = require('http');
const https = require('https');

// Load Cloudinary URLs
const cloudinaryUrlsPath = path.join(__dirname, 'cloudinary-urls.json');
let cloudinaryUrls = {};
try {
  if (fs.existsSync(cloudinaryUrlsPath)) {
    cloudinaryUrls = JSON.parse(fs.readFileSync(cloudinaryUrlsPath, 'utf8'));
  }
} catch (err) {
  console.warn('Could not load cloudinary-urls.json:', err.message);
}

// Function to get Cloudinary URL for an image
function getCloudinaryUrl(imageName) {
  if (!imageName) return null;
  return cloudinaryUrls[imageName] || null;
}

// ============= HELPER FUNCTIONS =============

// Resolve image path from several candidate locations
function resolveImagePath(imageName) {
  if (!imageName) return null;
  const candidates = [
    path.join(dataDir, 'images', imageName),
    path.join(__dirname, 'images', imageName),
    imageName
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Helper to resolve thumbnail (supports both HTTP URLs and local files)
function resolveThumbnail(imageName) {
  if (!imageName) return null;
  
  // If it's an HTTP URL, return as-is
  if (isHttpUrl(imageName)) {
    return imageName;
  }
  
  // Try to get Cloudinary URL first
  const cloudinaryUrl = getCloudinaryUrl(imageName);
  if (cloudinaryUrl) {
    return cloudinaryUrl;
  }
  
  // Try to resolve as local file
  const localPath = resolveImagePath(imageName);
  if (localPath && fs.existsSync(localPath)) {
    return localPath;
  }
  
  return null;
}

// Helper to support HTTP URLs
function isHttpUrl(s) {
  return typeof s === 'string' && /^https?:\/\//i.test(s);
}

// Normalize Imgur page/gallery URLs to a direct image link
function normalizeImgurUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();
    if (host === 'i.imgur.com') {
      if (/\.(png|jpe?g|gif|webp)$/i.test(u.pathname)) return urlStr;
      return urlStr;
    }
    if (host === 'imgur.com' || host.endsWith('.imgur.com')) {
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length === 0) return null;
      if (parts[0] === 'a' || parts[0] === 'gallery') return null;
      const id = parts[0];
      return `https://i.imgur.com/${id}.png`;
    }
    return urlStr;
  } catch (_) {
    return null;
  }
}

// Verify that a remote URL points to an image
function verifyImageUrl(urlStr, timeout = 3000) {
  return new Promise((resolve) => {
    if (!isHttpUrl(urlStr)) return resolve(null);
    try {
      const u = new URL(urlStr);
      const lib = u.protocol === 'https:' ? https : http;
      const opts = { method: 'HEAD', timeout };
      const req = lib.request(u, opts, (res) => {
        const ct = (res.headers['content-type'] || '').toLowerCase();
        if (res.statusCode >= 200 && res.statusCode < 400 && ct.startsWith('image/')) {
          res.resume();
          return resolve(urlStr);
        }
        if (res.statusCode === 405 || res.statusCode === 403 || !ct) {
          res.resume();
          const getReq = lib.request(u, { method: 'GET', timeout }, (getRes) => {
            const gct = (getRes.headers['content-type'] || '').toLowerCase();
            if (getRes.statusCode >= 200 && getRes.statusCode < 400 && gct.startsWith('image/')) {
              getRes.resume();
              return resolve(urlStr);
            }
            getRes.resume();
            return resolve(null);
          });
          getReq.on('error', () => resolve(null));
          getReq.end();
          return;
        }
        return resolve(null);
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.end();
    } catch (_) { resolve(null); }
  });
}

// Normalize + verify remote image URL
async function normalizeAndVerifyUrl(urlStr) {
  // Trust Cloudinary URLs (they're already verified)
  if (urlStr && urlStr.includes('cloudinary.com')) {
    return urlStr;
  }
  const norm = normalizeImgurUrl(urlStr) || urlStr;
  const ok = await verifyImageUrl(norm);
  return ok;
}

// Get rarity emoji
function rarityEmoji(rarity) {
  const r = (rarity || '').toLowerCase();
  if (r.startsWith('com')) return COMMON_EMOJI;
  if (r.startsWith('rar')) return RARE_EMOJI;
  if (r.startsWith('ep')) return EPIC_EMOJI;
  return '';
}

// String normalization helper
function normalizeStr(s) {
  if (!s) return '';
  return s.toString().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

// Get first letter safely
function firstLetterSafe(text) {
  if (!text) return 'X';
  const t = text.trim();
  if (t.length === 0) return 'X';
  return t.normalize('NFD').replace(/\p{Diacritic}/gu, '')[0].toUpperCase();
}

// Get rarity character
function rarityChar(rarity) {
  const r = (rarity || '').toLowerCase();
  if (r.startsWith('com')) return 'C';
  if (r.startsWith('rar')) return 'R';
  if (r.startsWith('ep') || r.startsWith('epi')) return 'E';
  return rarity ? rarity[0].toUpperCase() : 'U';
}

// Generate card code
function makeCardCode(card) {
  const n = firstLetterSafe(card.name || 'X');
  const g = firstLetterSafe(card.group || 'X');
  const e = firstLetterSafe(card.era || 'X');
  const r = rarityChar(card.rarity || 'U');
  const randomNum = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  return `${n}${g}${e}${r}#${randomNum}`;
}

// Format remaining time
function fmtRemaining(ms) {
  if (ms <= 0) return 'Pronto';
  const s = Math.ceil(ms / 1000);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

// ============= DATA MANAGEMENT =============

const cardsPath = path.join(dataDir, 'cards.json');
const collectionsPath = path.join(dataDir, 'collections.json');
const bagsPath = path.join(dataDir, 'bags.json');
const remindersPath = path.join(dataDir, 'reminders.json');
const maintenancePath = path.join(dataDir, 'maintenance.json');
const usersPath = path.join(dataDir, 'users.json');
const botPath = path.join(dataDir, 'bot.json');
const shopPath = path.join(dataDir, 'shop.json');
const marketPath = path.join(dataDir, 'market.json');

// Initialize data files
if (!fs.existsSync(cardsPath)) {
  console.warn('⚠️  cards.json not found! Please ensure data/cards.json exists.');
  const sample = [];
  fs.writeFileSync(cardsPath, JSON.stringify(sample, null, 2));
}

if (!fs.existsSync(remindersPath)) fs.writeFileSync(remindersPath, JSON.stringify({}, null, 2));
if (!fs.existsSync(collectionsPath)) fs.writeFileSync(collectionsPath, JSON.stringify({}, null, 2));
if (!fs.existsSync(bagsPath)) fs.writeFileSync(bagsPath, JSON.stringify({}, null, 2));
if (!fs.existsSync(usersPath)) fs.writeFileSync(usersPath, JSON.stringify({}, null, 2));
if (!fs.existsSync(botPath)) fs.writeFileSync(botPath, JSON.stringify({ totalDrops: 0 }, null, 2));
if (!fs.existsSync(shopPath)) fs.writeFileSync(shopPath, JSON.stringify({ lastUpdate: 0, cards: [] }, null, 2));
if (!fs.existsSync(marketPath)) fs.writeFileSync(marketPath, JSON.stringify({}, null, 2));

// Data read/write functions
function readCards() {
  try {
    const raw = JSON.parse(fs.readFileSync(cardsPath, 'utf8'));
    if (!Array.isArray(raw) || raw.length === 0) {
      console.warn('⚠️  WARNING: cards.json is empty or invalid!');
    }
    return raw.map(c => {
      const code = c.code || makeCardCode(c);
      return { ...c, code };
    });
  } catch (err) {
    console.error('❌ ERRO ao ler cards.json:', err.message);
    throw err;
  }
}

function readCollections() {
  return JSON.parse(fs.readFileSync(collectionsPath, 'utf8'));
}

function writeCollections(obj) {
  fs.writeFileSync(collectionsPath, JSON.stringify(obj, null, 2));
}

function readBags() {
  return JSON.parse(fs.readFileSync(bagsPath, 'utf8'));
}

function writeBags(obj) {
  fs.writeFileSync(bagsPath, JSON.stringify(obj, null, 2));
}

function readReminders() {
  return JSON.parse(fs.readFileSync(remindersPath, 'utf8'));
}

function writeReminders(obj) {
  fs.writeFileSync(remindersPath, JSON.stringify(obj, null, 2));
}

function readMaintenance() {
  if (!fs.existsSync(maintenancePath)) return { paused: false };
  return JSON.parse(fs.readFileSync(maintenancePath, 'utf8'));
}

function writeMaintenance(obj) {
  fs.writeFileSync(maintenancePath, JSON.stringify(obj, null, 2));
}

function readUsers() { 
  return JSON.parse(fs.readFileSync(usersPath, 'utf8')); 
}

function writeUsers(obj) { 
  fs.writeFileSync(usersPath, JSON.stringify(obj, null, 2)); 
}

function readBot() { 
  return JSON.parse(fs.readFileSync(botPath, 'utf8')); 
}

function writeBot(obj) { 
  fs.writeFileSync(botPath, JSON.stringify(obj, null, 2)); 
}

function readShop() { 
  return JSON.parse(fs.readFileSync(shopPath, 'utf8')); 
}

function writeShop(obj) { 
  fs.writeFileSync(shopPath, JSON.stringify(obj, null, 2)); 
}

function readMarket() { 
  return JSON.parse(fs.readFileSync(marketPath, 'utf8')); 
}

function writeMarket(obj) { 
  fs.writeFileSync(marketPath, JSON.stringify(obj, null, 2)); 
}

// ============= REMINDER SYSTEM =============

function scheduleReminders() {
  setInterval(() => {
    try {
      const reminders = readReminders();
      const now = Date.now();
      const toDelete = [];

      for (const [reminderId, reminder] of Object.entries(reminders)) {
        if (reminder.time <= now) {
          const { userId, type, guildId, channelId } = reminder;
          
          client.guilds.fetch(guildId).then(guild => {
            guild.channels.fetch(channelId).then(channel => {
              let message = '';
              if (type === 'drop') message = `${READY_HEART} ✦ Hey, <@${userId}>. You can **drew a card** from our tarot deck again with **.drop**!`;
              else if (type === 'daily') message = `${READY_HEART} ✦ Hey, <@${userId}>. Is another day full of magic! Claim your **daily rewards** with **.daily** now!`;
              else if (type === 'weekly') message = `${READY_HEART} ✦ Hey, <@${userId}>. The seven wonders are complete again! Claim your **weekly rewards** with **.weekly** now!`;
              else if (type === 'hunt') message = `${READY_HEART} ✦ Hey, <@${userId}>. Needing new crystals? Find some again with **.hunt** now!`;
              
              if (message) channel.send(message).catch(() => {});
            }).catch(() => {});
          }).catch(() => {});

          toDelete.push(reminderId);
        }
      }

      if (toDelete.length > 0) {
        for (const id of toDelete) delete reminders[id];
        writeReminders(reminders);
      }
    } catch (err) {
      console.error('Reminder error:', err);
    }
  }, 60000);
}

function scheduleRemindersIfNeeded() {
  if (!global.remindersScheduled) {
    scheduleReminders();
    global.remindersScheduled = true;
  }
}

// ============= BOT READY HANDLER =============

let __readyHandled = false;
function onClientReady() {
  if (__readyHandled) return;
  __readyHandled = true;
  console.log(`✅ Bot conectado como ${client.user.tag}`);
  
  try {
    console.log(`📂 Arquivo de cartas: ${cardsPath}`);
    const fileExists = fs.existsSync(cardsPath);
    console.log(`📂 Arquivo existe: ${fileExists}`);
    if (fileExists) {
      const fileSize = fs.statSync(cardsPath).size;
      console.log(`📂 Tamanho do arquivo: ${fileSize} bytes`);
    }
    
    const cards = readCards();
    console.log(`📇 ${cards.length} cartas carregadas`);
    
    let imageCount = 0;
    for (const card of cards) {
      if (card.image) imageCount++;
    }
    console.log(`🖼️  ${imageCount} cartas com imagens configuradas`);
  } catch (err) {
    console.error('Erro ao carregar cartas:', err.message);
  }
  // Set presence/status
  try {
    client.user.setPresence({ activities: [{ name: "I'm growing like a flower!", type: ActivityType.Playing }], status: 'online' });
  } catch (err) {
    console.error('Failed to set presence:', err && err.message ? err.message : err);
  }
}

client.once('ready', onClientReady);

// ============= MESSAGE HANDLER =============

const { handleMessage } = require('./commands');

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Check maintenance mode
  const maintenance = readMaintenance();
  if (maintenance.paused) {
    let usedPrefix = null;
    if (message.content.startsWith(PREFIX)) usedPrefix = PREFIX;
    else if (message.content.startsWith('.')) usedPrefix = '.';
    else return;

    const args = message.content.slice(usedPrefix.length).trim().split(/\s+/);
    const cmd = args.shift().toLowerCase();

    if (cmd === 'resume') {
      maintenance.paused = false;
      writeMaintenance(maintenance);
      message.reply('✅ Bot resumed!');
      return;
    }
    if (cmd === 'pause') {
      const isOwner = message.author.id === BOT_OWNER_ID;
      const isAdmin = message.member && message.member.permissions && message.member.permissions.has('Administrator');
      if (isOwner || isAdmin) {
        maintenance.paused = true;
        writeMaintenance(maintenance);
        message.reply('⏸️ Bot paused! Use **.resume** to re-enable the magic.');
      } else {
        message.reply('❌ Only **Sasa** can pause the bot!');
      }
      return;
    }
    message.reply('⚠️ Bot is in maintenance mode. Use **.resume** to re-enable the magic.');
    return;
  }

  // Accept PREFIX or dot (.) commands
  let usedPrefix = null;
  if (message.content.startsWith(PREFIX)) usedPrefix = PREFIX;
  else if (message.content.startsWith('.')) usedPrefix = '.';
  else return;

  const args = message.content.slice(usedPrefix.length).trim().split(/\s+/);
  const cmd = args.shift().toLowerCase();

  // Pass to command handler
  await handleMessage(message, cmd, args, usedPrefix, {
    client,
    readCards, readCollections, writeCollections,
    readBags, writeBags,
    readReminders, writeReminders,
    readUsers, writeUsers,
    readBot, writeBot,    readShop, writeShop,
    readMarket, writeMarket,    readMaintenance, writeMaintenance,
    resolveImagePath, resolveThumbnail, normalizeAndVerifyUrl, isHttpUrl, verifyImageUrl, normalizeImgurUrl, rarityEmoji,
    normalizeStr, fmtRemaining, makeCardCode, getCloudinaryUrl,
    LOVE_QUARTZ, VITAL_CRYSTAL, COMMON_EMOJI, RARE_EMOJI, EPIC_EMOJI,
    READY_HEART, NOT_READY_HEART, BOT_OWNER_ID,
    HUNT_COOLDOWN_MS, COOLDOWN_MS, DAILY_MS, WEEK_MS,
    EmbedBuilder, AttachmentBuilder
  });

  // Initialize reminders
  scheduleRemindersIfNeeded();
});

// ============= INTERACTION HANDLER (BUTTONS) =============

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  const { handleInteraction } = require('./commands');
  await handleInteraction(interaction, {
    readCards, readCollections, readMarket,
    rarityEmoji, EmbedBuilder, READY_HEART, NOT_READY_HEART, LOVE_QUARTZ, VITAL_CRYSTAL
  });
});

// ============= LOGIN =============

client.login(TOKEN);

// Export for commands.js
module.exports = {
  client,
  readCards, readCollections, writeCollections,
  readBags, writeBags,
  readReminders, writeReminders,
  readUsers, writeUsers,
  readBot, writeBot,
  readMaintenance, writeMaintenance,
  resolveImagePath, normalizeAndVerifyUrl, isHttpUrl, verifyImageUrl, normalizeImgurUrl, rarityEmoji,
  normalizeStr, fmtRemaining, makeCardCode,
  LOVE_QUARTZ, VITAL_CRYSTAL, COMMON_EMOJI, RARE_EMOJI, EPIC_EMOJI,
  READY_HEART, NOT_READY_HEART, BOT_OWNER_ID,
  HUNT_COOLDOWN_MS, COOLDOWN_MS, DAILY_MS, WEEK_MS,
  EmbedBuilder, AttachmentBuilder
};
