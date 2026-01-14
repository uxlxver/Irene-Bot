module.exports = {
  handleMessage,
  handleInteraction
};

const fs = require('fs');
const path = require('path');

async function handleMessage(message, cmd, args, usedPrefix, ctx) {
  const {
    client,
    readCards, readCollections, writeCollections,
    readBags, writeBags,
    readReminders, writeReminders,
    readUsers, writeUsers,
    readBot, writeBot,
    readShop, writeShop,
    readMarket, writeMarket,
    readMaintenance, writeMaintenance,
    resolveImagePath, resolveThumbnail, normalizeAndVerifyUrl, isHttpUrl, verifyImageUrl, normalizeImgurUrl, rarityEmoji,
    normalizeStr, fmtRemaining, makeCardCode, getCloudinaryUrl,
    LOVE_QUARTZ, VITAL_CRYSTAL,
    READY_HEART, NOT_READY_HEART, BOT_OWNER_ID,
    HUNT_COOLDOWN_MS, COOLDOWN_MS, DAILY_MS, WEEK_MS,
    EmbedBuilder, AttachmentBuilder
  } = ctx;

  // Helpers
  function addReminder(userId, type, delayMs, guildId, channelId) {
    try {
      const reminders = readReminders();
      const reminderId = `${userId}-${type}-${Date.now()}`;
      reminders[reminderId] = { userId, type, time: Date.now() + delayMs, guildId, channelId };
      writeReminders(reminders);
    } catch (err) { console.error('Error scheduling reminder:', err); }
  }

  // Helper to set thumbnail (with support for Cloudinary URLs and local images)
  function setThumbnailOrAttachment(embed, imageName) {
    if (!imageName) return { embed, files: [] };
    
    // Try to resolve as HTTP URL first
    if (isHttpUrl(imageName)) {
      embed.setThumbnail(imageName);
      return { embed, files: [] };
    }
    
    // Try to get Cloudinary URL
    const cloudinaryUrl = getCloudinaryUrl(imageName);
    if (cloudinaryUrl) {
      embed.setThumbnail(cloudinaryUrl);
      return { embed, files: [] };
    }
    
    // Try to resolve as local file
    const localPath = resolveImagePath(imageName);
    if (localPath && fs.existsSync(localPath)) {
      const baseName = path.basename(localPath);
      const attachment = new AttachmentBuilder(localPath);
      embed.setThumbnail(`attachment://${baseName}`);
      return { embed, files: [attachment] };
    }
    
    // If not found, don't set thumbnail (avoid validation error)
    return { embed, files: [] };
  }

  // Maintenance check handled in main.js, but keep pause/resume commands
  if (cmd === 'pause') {
    const ownerId = process.env.BOT_OWNER_ID;
    const isOwner = ownerId && message.author.id === ownerId;
    if (!isOwner) { message.reply('❌ Only the bot owner can pause the bot.'); return; }
    const maintenance = readMaintenance();
    maintenance.paused = true; writeMaintenance(maintenance); message.reply('⏸️ Bot paused. Use **.resume** to re-enable the magic.');
    return;
  }
  if (cmd === 'resume') {
    const ownerId = process.env.BOT_OWNER_ID;
    const isOwner = ownerId && message.author.id === ownerId;
    if (!isOwner) { message.reply('❌ Only the bot owner can resume the bot.'); return; }
    const maintenance = readMaintenance(); maintenance.paused = false; writeMaintenance(maintenance); message.reply('✅ Bot resumed!'); return;
  }

  // .drop
  if (cmd === 'drop' || cmd === 'd' || cmd === 'dr') {
    const cards = readCards();
    
    // Implement rarity probabilities
    const rand = Math.random() * 100;
    let filteredByRarity;
    
    if (rand < 50) {
      // 50% common
      filteredByRarity = cards.filter(c => (c.rarity || '').toLowerCase() === 'common');
    } else if (rand < 80) {
      // 30% rare
      filteredByRarity = cards.filter(c => (c.rarity || '').toLowerCase() === 'rare');
    } else {
      // 20% epic
      filteredByRarity = cards.filter(c => (c.rarity || '').toLowerCase() === 'epic');
    }
    
    const pick = filteredByRarity.length > 0 ? filteredByRarity[Math.floor(Math.random() * filteredByRarity.length)] : cards[Math.floor(Math.random() * cards.length)];

    const collections = readCollections();
    const users = readUsers();
    const botStats = readBot();
    const uid = message.author.id;

    const now = Date.now();
    const userRec = users[uid] || {};
    const last = userRec.lastDrop || 0;
    if (now - last < COOLDOWN_MS) { const remainSec = Math.ceil((COOLDOWN_MS - (now - last)) / 1000); message.reply(`${NOT_READY_HEART} ✦ Wait **${remainSec} seconds** to use **${usedPrefix}drop** again.`); return; }

    userRec.lastDrop = now; users[uid] = userRec; writeUsers(users);
    addReminder(uid, 'drop', COOLDOWN_MS, message.guildId, message.channelId);

    if (!collections[uid]) collections[uid] = {};
    if (!collections[uid][pick.code]) collections[uid][pick.code] = 0;
    collections[uid][pick.code] += 1;
    writeCollections(collections);

    botStats.totalDrops = (botStats.totalDrops || 0) + 1; writeBot(botStats);

    const embed = new EmbedBuilder()
      .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
      .setTitle(`✦ You drew a card!`)
      .setDescription(`Among all the cards in the tarot deck, this one **chose you**!\n\nㆍ**Name:** *${pick.name}*\nㆍ**Group:** *${pick.group}*\nㆍ**Era:** *${pick.era}*\nㆍ**Rarity:** *${pick.rarity}*\nㆍ**Code:** ${pick.code}`)
      .setFooter({ text: '✦ Come back in 5 minutes for more magic!' })
      .setColor('#ea8bb9');

    const { embed: embedWithThumb, files: thumbFiles } = setThumbnailOrAttachment(embed, 'cards.png');

    if (pick.image) {
      if (isHttpUrl(pick.image)) {
        try {
          const remote = await normalizeAndVerifyUrl(pick.image);
          if (remote) { embedWithThumb.setImage(remote); message.reply({ embeds: [embedWithThumb], files: thumbFiles }); return; }
        } catch (err) { console.error(err); }
      }
      const imgPath = resolveImagePath(pick.image);
      if (imgPath) { const attachment = new AttachmentBuilder(imgPath); embedWithThumb.setImage(`attachment://${path.basename(imgPath)}`); message.reply({ embeds: [embedWithThumb], files: [...thumbFiles, attachment] }); return; }
    }

    message.reply({ embeds: [embedWithThumb], files: thumbFiles });
    return;
  }

  // inventory
  if (cmd === 'inventory' || cmd === 'inv' || cmd === 'i') {
    const cards = readCards();
    const collections = readCollections();
    let filterArgs = Array.from(args);
    let targetUid = message.author.id;
    if (filterArgs.length > 0) {
      const maybe = filterArgs[0];
      const mentionMatch = maybe.match(/^<@!?(\d+)>$/);
      if (mentionMatch) { targetUid = mentionMatch[1]; filterArgs.shift(); }
      else if (/^\d{17,19}$/.test(maybe)) { targetUid = maybe; filterArgs.shift(); }
    }

    const filters = {};
    for (const a of filterArgs) {
      const eq = a.indexOf('='); if (eq === -1) continue; const k = a.slice(0, eq).toLowerCase(); const v = a.slice(eq + 1);
      if (['era','rar','rarity', 'na', 'name','gr','group'].includes(k)) {
        let key = k; if (k === 'na') key = 'name'; if (k === 'gr') key = 'group'; if (k === 'rar') key = 'rarity'; filters[key] = normalizeStr(v);
      }
    }

    const userCol = collections[targetUid] || {};
    if (Object.keys(userCol).length === 0) { if (targetUid === message.author.id) { message.reply(`${NOT_READY_HEART} ✦ Your tarot deck is empty. Use **.drop** to get new cards!`); } else { message.reply(`${NOT_READY_HEART} ✦ Empty inventory or user not found.`); } return; }

    function cardMatchesFilters(card) { for (const k of Object.keys(filters)) { const want = filters[k]; const actual = normalizeStr(card[k] || ''); if (!actual.includes(want)) return false; } return true; }

    const lines = [];
    for (const card of cards) {
      const count = userCol[card.code] || 0; if (count <= 0) continue; if (!cardMatchesFilters(card)) continue; const dupeTag = count > 1 ? ' (dupe)' : ''; const rareEmoji = rarityEmoji(card.rarity);
      lines.push(`ㆍ**Name:** ${card.name}\nㆍ**Group:** ${card.group}\nㆍ**Era:** ${card.era}\nㆍ**Rarity:** ${rareEmoji} (${card.rarity})\nㆍ**Amount:** ${count}x${dupeTag}\nㆍ**Code:** ${card.code}\n`);
    }

    if (lines.length === 0) { message.reply(`${NOT_READY_HEART} ✦ There is no tarot cards matching these filters!`); return; }

    let headerName = message.author.username;
    if (targetUid !== message.author.id) { try { const u = await client.users.fetch(targetUid); headerName = u.username; } catch (_) { headerName = targetUid; } }

    const cardsPerPage = 5; let currentPage = 1; const totalPages = Math.ceil(lines.length / cardsPerPage);

    async function showPage(pageNum) {
      const start = (pageNum - 1) * cardsPerPage; const end = start + cardsPerPage; const pageLines = lines.slice(start, end);
      const embed = new EmbedBuilder()
        .setTitle(`✦ ${headerName}'s Magic Deck of Cards`)
        .setDescription(`${READY_HEART}ㆍPage ${pageNum}/${totalPages} (${lines.length} cards in total)\n\n${pageLines.join('\n')}`)
        .setColor('#ea8bb9')
        .setFooter({ text: `✦ Cards shown: ${start + 1}-${Math.min(end, lines.length)}` });

      const buttons = [];
      if (pageNum > 1) buttons.push({ customId: `inv_prev_${targetUid}_${pageNum - 1}`, label: 'Previous' });
      if (pageNum < totalPages) buttons.push({ customId: `inv_next_${targetUid}_${pageNum + 1}`, label: 'Next' });

      if (buttons.length > 0) {
        // Build ActionRow and ButtonBuilder lazily to avoid requiring builders here (handled in main.js interaction update)
        const row = { type: 1, components: buttons.map(b => ({ type: 2, custom_id: b.customId, label: b.label, style: 1 })) };
        message.reply({ embeds: [embed], components: [row] });
      } else {
        message.reply({ embeds: [embed] });
      }
    }

    await showPage(currentPage);
    return;
  }

  // removefav
  if (cmd === 'removefav' || cmd === 'unsetfav') {
    const users = readUsers(); const uid = message.author.id; const userRec = users[uid] || { loveQuartz: 0, vitalCrystal: 0 };
    if (!userRec.favorite) { message.reply(`${NOT_READY_HEART} ✦ You do not have a favorite tarot card yet!`); return; }
    delete userRec.favorite; users[uid] = userRec; writeUsers(users);
    message.reply({ embeds: [new EmbedBuilder().setTitle('✦ Favorite card removed succesfully!').setColor('#ea8bb9')] }); return;
  }

  // removedesc
  if (cmd === 'removedesc' || cmd === 'cleardesc') {
    const users = readUsers(); const uid = message.author.id; const userRec = users[uid] || { loveQuartz: 0, vitalCrystal: 0 };
    if (!userRec.description) { message.reply(`${NOT_READY_HEART} ✦ You do not have a description yet!`); return; }
    delete userRec.description; users[uid] = userRec; writeUsers(users);
    message.reply({ embeds: [new EmbedBuilder().setTitle('✦ Description removed succesfully!').setColor('#ea8bb9')] }); return;
  }

  // hunt
  if (cmd === 'hunt' || cmd === 'h') {
    const users = readUsers(); const uid = message.author.id; const now = Date.now(); const userRec = users[uid] || { loveQuartz: 0, vitalCrystal: 0 }; const last = userRec.lastHunt || 0;
    if (now - last < HUNT_COOLDOWN_MS) { const remHunt = HUNT_COOLDOWN_MS - (now - last); const huntTime = Math.floor((now + remHunt) / 1000); 
    const embed = new EmbedBuilder()
    .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
    .setTitle('✦ Hunt is not available yet!')
    .setDescription(`ㆍThe **magic cave** is regenerating its **precious crystals**! Come back <t:${huntTime}:R> and you can hunt again.`)
    .setFooter({ text: '✦ Wait a little more!' })
    .setColor('#ea8bb9');
    const { embed: embedWithThumb, files: thumbFiles } = setThumbnailOrAttachment(embed, 'cooldown.png');
    await message.reply({ embeds: [embedWithThumb], files: thumbFiles }); return; }
    // 25% chance to get 5 vital crystals instead
    const getVitals = Math.random() < 0.25;
    if (getVitals) {
      userRec.vitalCrystal = (userRec.vitalCrystal || 0) + 5;
      userRec.lastHunt = now;
      users[uid] = userRec;
      writeUsers(users);
      addReminder(uid, 'hunt', HUNT_COOLDOWN_MS, message.guildId, message.channelId);
      const huntEmbed = new EmbedBuilder().setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() }).setTitle('✦ It is a blessed hunt!').setDescription(`ㆍYou hunted for **precious crystals** in the **magic cave** and found **5**${VITAL_CRYSTAL}!\nㆍNow you have ${userRec.vitalCrystal}${VITAL_CRYSTAL} in total.\nㆍYou can hunt again in <t:${Math.floor((now + HUNT_COOLDOWN_MS) / 1000)}:R>!`).setFooter({ text: '✦ What blessed luck!' }).setColor('#ea8bb9');
      const { embed: huntEmbedWithThumb, files: huntThumbFiles } = setThumbnailOrAttachment(huntEmbed, 'hunt.png');
      message.reply({ embeds: [huntEmbedWithThumb], files: huntThumbFiles }); return;
    }
    userRec.loveQuartz = (userRec.loveQuartz || 0) + 1000; userRec.lastHunt = now; users[uid] = userRec; writeUsers(users); addReminder(uid, 'hunt', HUNT_COOLDOWN_MS, message.guildId, message.channelId);
    const huntEmbed = new EmbedBuilder().setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() }).setTitle('✦ It is a successful hunt!').setDescription(`ㆍYou hunted for **precious crystals** in the **magic cave** and found **1000**${LOVE_QUARTZ}!\nㆍNow you have ${userRec.loveQuartz}${LOVE_QUARTZ} in total.\nㆍYou can hunt again in <t:${Math.floor((now + HUNT_COOLDOWN_MS) / 1000)}:R>!`).setFooter({ text: '✦ Take care of your crystals!' }).setColor('#ea8bb9');
    const { embed: huntEmbedWithThumb, files: huntThumbFiles } = setThumbnailOrAttachment(huntEmbed, 'hunt.png');
    message.reply({ embeds: [huntEmbedWithThumb], files: huntThumbFiles }); return;
  }

  // balance
  if (cmd === 'balance' || cmd === 'bal') {
    const users = readUsers(); const collections = readCollections(); const uid = message.author.id; const userRec = users[uid] || { loveQuartz: 0, vitalCrystal: 0 }; const col = collections[uid] || {}; const totalCards = Object.values(col).reduce((s, n) => s + (n || 0), 0);
    let displayName = message.author.username;
    if (args.length > 0) { const maybe = args[0]; const mentionMatch = maybe.match(/^<@!?(\d+)>$/); if (mentionMatch) { try { const u = await client.users.fetch(mentionMatch[1]); displayName = u.username; } catch (_) { displayName = mentionMatch[1]; } } else if (/^\d{17,19}$/.test(maybe)) { try { const u = await client.users.fetch(maybe); displayName = u.username; } catch (_) { displayName = maybe; } } }
    const embed = new EmbedBuilder().setAuthor({ name: displayName, iconURL: message.author.displayAvatarURL() })
    .setTitle('✦ This is your magic wallet!')
    .setDescription(`ㆍYou have **${userRec.loveQuartz || 0}${LOVE_QUARTZ}** and **${userRec.vitalCrystal || 0}${VITAL_CRYSTAL}** to spend on your **glittering adventures**!\nㆍFor now, your **tarot deck** has **${totalCards} cards collected**.`)
    .setFooter({ text: '✦ Keep your journey with Irene for more!' })
    .setColor('#ea8bb9');
    message.reply({ embeds: [embed] }); return;
  }

  // profile
  if (cmd === 'profile' || cmd === 'p') {
    const users = readUsers(); const collections = readCollections(); let targetUid = message.author.id; if (args.length > 0) { const maybe = args[0]; const mentionMatch = maybe.match(/^<@!?(\d+)>$/); if (mentionMatch) targetUid = mentionMatch[1]; else if (/^\d{17,19}$/.test(maybe)) targetUid = maybe; }
    const userRec = users[targetUid] || { loveQuartz: 0, vitalCrystal: 0 }; const col = collections[targetUid] || {}; const totalCards = Object.values(col).reduce((s, n) => s + (n || 0), 0);
    let displayName = message.author.username; if (targetUid !== message.author.id) { try { const u = await client.users.fetch(targetUid); displayName = u.username; } catch (_) { displayName = targetUid; } }

    let favText = `${NOT_READY_HEART} ✦ *This user does not have a favorite yet!*`; let favImage = null;
    if (userRec.favorite) { const cards = readCards(); const fav = cards.find(c => c.code === userRec.favorite); if (fav) { favText = `${fav.name} — ${fav.group} (${fav.rarity})`; if (fav.image) { if (isHttpUrl(fav.image)) { const remote = await normalizeAndVerifyUrl(fav.image); if (remote) favImage = remote; } else { const p = resolveImagePath(fav.image); if (p) favImage = p; } } } }

    const embed = new EmbedBuilder().setAuthor({ name: displayName, iconURL: message.author.displayAvatarURL() })
    .setTitle(`✦ ${displayName}'s Enchanted Profile`)
    .setDescription(`ㆍThis user have **${userRec.loveQuartz || 0}${LOVE_QUARTZ}** and **${userRec.vitalCrystal || 0}${VITAL_CRYSTAL}**!\n\nㆍTheir **tarot deck** has **${totalCards} cards collected**, so good!\n\nㆍ**They want to say:** ${userRec.description || `*No description set!*`}\n\nㆍNow, look at their **favorite card**: ${favText}`)
    .setFooter({ text: '✦ Irene loved this beautiful profile!' })
    .setColor('#ea8bb9');

    const { embed: embedWithThumb, files: thumbFiles } = setThumbnailOrAttachment(embed, 'cards.png');

    if (favImage && /^https?:\/\//.test(favImage)) { embedWithThumb.setImage(favImage); message.reply({ embeds: [embedWithThumb], files: thumbFiles }); } else if (favImage && fs.existsSync(favImage)) { const attachment = new AttachmentBuilder(favImage); embedWithThumb.setImage(`attachment://${path.basename(favImage)}`); message.reply({ embeds: [embedWithThumb], files: [...thumbFiles, attachment] }); } else { message.reply({ embeds: [embedWithThumb], files: thumbFiles }); }
    return;
  }

  // setfav
  if (cmd === 'setfav' || cmd === 'favorite' || cmd === 'fav') {
    const users = readUsers(); const collections = readCollections(); const uid = message.author.id; const userCol = collections[uid] || {}; const cardId = args[0]; if (!cardId) { message.reply('Use: .setfav <cardId>'); return; }
    const cards = readCards(); const card = cards.find(c => c.code === cardId.toUpperCase()); if (!card) { message.reply(`${NOT_READY_HEART} ✦ Card not found. Use **.cards** to search for the IDs!`); return; }
    const owned = userCol[card.code] || 0; if (owned <= 0) { message.reply(`${NOT_READY_HEART}✦ You need to have this card in your inventory to set it as a favorite!`); return; }
    const userRec = users[uid] || { loveQuartz: 0, vitalCrystal: 0 }; userRec.favorite = card.code; users[uid] = userRec; writeUsers(users);
    const embed = new EmbedBuilder()
    .setTitle(`✦ Favorite set`)
    .setDescription(`ㆍ${card.name} has been set as your favorite card!`)
    .setColor('#ea8bb9'); message.reply({ embeds: [embed] }); return;
  }

  // gift
  if (cmd === 'gift' || cmd === 'g') {
    const users = readUsers(); const collections = readCollections(); const uid = message.author.id; const targetStr = args[0]; const cardCode = args[1]; const amountStr = args[2] || '1';
    if (!targetStr || !cardCode) { message.reply(`${NOT_READY_HEART} ✦ Use: **.gift <@user|id> <cardCode> [amount]**`); return; }
    let targetUid = null; const mentionMatch = targetStr.match(/^<@!?(\d+)>$/); if (mentionMatch) targetUid = mentionMatch[1]; else if (/^\d{17,19}$/.test(targetStr)) targetUid = targetStr; else { message.reply(`${NOT_READY_HEART} ✦ Invalid user. Use mention or user ID.`); return; }
    if (targetUid === uid) { message.reply(`${NOT_READY_HEART} ✦ You cannot gift cards to yourself!`); return; }
    const amount = Math.max(1, parseInt(amountStr)); if (isNaN(amount)) { message.reply(`${NOT_READY_HEART} ✦ Invalid amount.`); return; }
    const cards = readCards(); const card = cards.find(c => c.code === cardCode.toUpperCase()); if (!card) { message.reply(`${NOT_READY_HEART} ✦ Card \`${cardCode}\` not found.`); return; }
    const senderCol = collections[uid] || {}; const owned = senderCol[card.code] || 0; if (owned < amount) { message.reply(`${NOT_READY_HEART} ✦ You only have ${owned} of this card, but tried to gift ${amount}.`); return; }
    senderCol[card.code] = owned - amount; collections[uid] = senderCol; const recipientCol = collections[targetUid] || {}; recipientCol[card.code] = (recipientCol[card.code] || 0) + amount; collections[targetUid] = recipientCol; writeCollections(collections);
    let recipientName = targetUid; try { const u = await client.users.fetch(targetUid); recipientName = u.username; } catch (_) {}
    const embed = new EmbedBuilder()
    .setTitle('✦ The magic was shared!')
    .setDescription(`ㆍYou gifted ${amount}x **${card.name}** to **${recipientName}** succesfuly.\n\nㆍ**Card code:** \`${card.code}\`\nㆍ**Quantity gifted:** ${amount}`)
    .setFooter({ text: '✦ What a kind heart!' })
    .setColor('#ea8bb9'); message.reply({ embeds: [embed] }); return;
  }

  // pay
  if (cmd === 'pay') {
    const users = readUsers(); const uid = message.author.id; const targetStr = args[0]; const amountStr = args[1];
    if (!targetStr || !amountStr) { message.reply(`${READY_HEART} ✦ Use: .pay <@user|id> <amount>`); return; }
    let targetUid = null; const mentionMatch = targetStr.match(/^<@!?(\d+)>$/); if (mentionMatch) targetUid = mentionMatch[1]; else if (/^\d{17,19}$/.test(targetStr)) targetUid = targetStr; else { message.reply(`${NOT_READY_HEART} ✦ Invalid user. Use mention or user ID.`); return; }
    if (targetUid === uid) { message.reply(`${NOT_READY_HEART} ✦ You cannot pay ${LOVE_QUARTZ} to yourself!`); return; }
const amount = Math.max(1, parseInt(amountStr)); if (isNaN(amount)) { message.reply(`${NOT_READY_HEART} ✦ Invalid amount!`); return; }
    const senderRec = users[uid] || { loveQuartz: 0, vitalCrystal: 0 }; if ((senderRec.loveQuartz || 0) < amount) { message.reply(`${NOT_READY_HEART} ✦ You only have ${senderRec.loveQuartz || 0} ${LOVE_QUARTZ}, but tried to pay ${amount}!`); return; }
    senderRec.loveQuartz -= amount; users[uid] = senderRec; const recipientRec = users[targetUid] || { loveQuartz: 0, vitalCrystal: 0 }; recipientRec.loveQuartz = (recipientRec.loveQuartz || 0) + amount; users[targetUid] = recipientRec; writeUsers(users);
    let recipientName = targetUid; try { const u = await client.users.fetch(targetUid); recipientName = u.username; } catch (_) {}
    const embed = new EmbedBuilder().setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
    .setTitle('✦ Your magic payment was done!')
    .setDescription(`ㆍYou paid **${amount}**${LOVE_QUARTZ} to **${recipientName}** succesfuly.\n\nㆍNow you have **${senderRec.loveQuartz}${LOVE_QUARTZ}** left!`)
    .setFooter({ text: '✦ I hope they use it well!' })
    .setColor('#ea8bb9'); message.reply({ embeds: [embed] }); return;
  }

  // setdesc
  if (cmd === 'setdesc' || cmd === 'description' || cmd === 'desc') {
    const users = readUsers(); const uid = message.author.id; const text = args.join(' ').trim(); if (!text) { message.reply(`${NOT_READY_HEART} ✦ Use **.setdesc <your description>**`); return; }
    const userRec = users[uid] || { loveQuartz: 0, vitalCrystal: 0 }; userRec.description = text.slice(0, 200); users[uid] = userRec; writeUsers(users);
    const embed = new EmbedBuilder()
    .setTitle('✦ Description has been updated!')
    .setDescription(`ㆍ**Your text:** ${userRec.description}`)
    .setColor('#ea8bb9'); message.reply({ embeds: [embed] }); return;
  }

  // daily
  if (cmd === 'daily') {
    const users = readUsers(); const collections = readCollections(); const uid = message.author.id; const now = Date.now(); const userRec = users[uid] || { loveQuartz: 0, vitalCrystal: 0 }; const last = userRec.lastDaily || 0;
    if (now - last < DAILY_MS) { const remain = fmtRemaining(DAILY_MS - (now - last)); 
    const tempEmbed = new EmbedBuilder().setTitle('✦ Daily is not ready yet!').setDescription(`ㆍ**Irene** is still working on a **magic reward** for you. Come back in ${remain} and use **.daily** again!`).setColor('#ea8bb9').setFooter({ text: '✦ Wait a little more!' });
    const { embed: tempEmbedWithThumb, files: tempThumbFiles } = setThumbnailOrAttachment(tempEmbed, 'cooldown.png');
    message.reply({ embeds: [tempEmbedWithThumb], files: tempThumbFiles }); return; }
    userRec.loveQuartz = (userRec.loveQuartz || 0) + 1500; userRec.lastDaily = now; const cards = readCards(); const pick = cards[Math.floor(Math.random() * cards.length)]; const uidCol = collections[uid] || {}; if (!uidCol[pick.code]) uidCol[pick.code] = 0; uidCol[pick.code] += 1; collections[uid] = uidCol; users[uid] = userRec; writeUsers(users); writeCollections(collections);
    const embed = new EmbedBuilder()
    .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
    .setTitle('✦ Daily Oracle')
    .setDescription(`ㆍIrene did the **daily tarot reading** for you! The oracle said **you're in luck**, so you got **1500**${LOVE_QUARTZ} and **${pick.name}**!\n\nㆍ**Card details:** ${pick.group} — ${pick.rarity} (\`${pick.code}\`)\nㆍ**Total balance:** ${userRec.loveQuartz}${LOVE_QUARTZ}`)
    .setFooter({ text: '✦ Come back tomorrow for more!' })
    .setColor('#ea8bb9');
    const { embed: embedWithThumb, files: thumbFiles } = setThumbnailOrAttachment(embed, 'daily.png');
    addReminder(uid, 'daily', DAILY_MS, message.guildId, message.channelId);
    if (pick.image) { if (isHttpUrl(pick.image)) { const remote = await normalizeAndVerifyUrl(pick.image); if (remote) { embedWithThumb.setImage(remote); message.reply({ embeds: [embedWithThumb], files: thumbFiles }); return; } } const imgPath = resolveImagePath(pick.image); if (imgPath) { const attachment = new AttachmentBuilder(imgPath); embedWithThumb.setImage(`attachment://${path.basename(imgPath)}`); message.reply({ embeds: [embedWithThumb], files: [...thumbFiles, attachment] }); } else { message.reply({ embeds: [embedWithThumb], files: thumbFiles }); } } else { message.reply({ embeds: [embedWithThumb], files: thumbFiles }); }
    return;
  }

  // weekly
  if (cmd === 'weekly') {
    const users = readUsers(); const collections = readCollections(); const uid = message.author.id; const now = Date.now(); const userRec = users[uid] || { loveQuartz: 0, vitalCrystal: 0 }; const last = userRec.lastWeekly || 0; if (now - last < WEEK_MS) { const remain = fmtRemaining(WEEK_MS - (now - last)); 
    const tempEmbed = new EmbedBuilder().setTitle('✦ Weekly is not available yet!').setDescription(`ㆍThe **magic council** is still sending your reward. Come back in ${remain} and use **.weekly** again!`).setFooter({text: '✦ Wait a little more!'}).setColor('#ea8bb9');
    const { embed: tempEmbedWithThumb, files: tempThumbFiles } = setThumbnailOrAttachment(tempEmbed, 'cooldown.png');
    message.reply({ embeds: [tempEmbedWithThumb], files: tempThumbFiles }); return; }
    userRec.loveQuartz = (userRec.loveQuartz || 0) + 15000; userRec.vitalCrystal = (userRec.vitalCrystal || 0) + 1; userRec.lastWeekly = now; const cards = readCards(); const epics = cards.filter(c => { const r = (c.rarity || '').toLowerCase(); return r.includes('ep'); }); let pick; if (epics.length > 0) pick = epics[Math.floor(Math.random() * epics.length)]; else pick = cards[Math.floor(Math.random() * cards.length)]; const uidCol = collections[uid] || {}; if (!uidCol[pick.code]) uidCol[pick.code] = 0; uidCol[pick.code] += 1; collections[uid] = uidCol; users[uid] = userRec; writeUsers(users); writeCollections(collections); addReminder(uid, 'weekly', WEEK_MS, message.guildId, message.channelId);
    const embed = new EmbedBuilder()
    .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
    .setTitle('✦ Weekly feedback')
    .setDescription(`ㆍ**The magic council admires your weekly performance**. As a token of appreciation, take these rewards: **15000**${LOVE_QUARTZ}, **1**${VITAL_CRYSTAL} and the epic card **${pick.name}**!\n\nㆍ**Card details:** ${pick.group} — ${pick.rarity} (\`${pick.code}\`)\nㆍ**Total balance:** ${userRec.loveQuartz}${LOVE_QUARTZ} and ${userRec.vitalCrystal}${VITAL_CRYSTAL}.`)
    .setFooter({ text: '✦ Keep playing for more!' })
    .setColor('#ea8bb9');
    const { embed: embedWithThumb, files: thumbFiles } = setThumbnailOrAttachment(embed, 'weekly.png');
    if (pick.image) { if (isHttpUrl(pick.image)) { const remote = await normalizeAndVerifyUrl(pick.image); if (remote) { embedWithThumb.setImage(remote); message.reply({ embeds: [embedWithThumb], files: thumbFiles }); return; } } const imgPath = resolveImagePath(pick.image); if (imgPath) { const attachment = new AttachmentBuilder(imgPath); embedWithThumb.setImage(`attachment://${path.basename(imgPath)}`); message.reply({ embeds: [embedWithThumb], files: [...thumbFiles, attachment] }); } else { message.reply({ embeds: [embedWithThumb], files: thumbFiles }); } } else { message.reply({ embeds: [embedWithThumb], files: thumbFiles }); }
    return;
  }

  // cooldown
  if (cmd === 'cooldown' || cmd === 'cd') {
    const users = readUsers(); const uid = message.author.id; const userRec = users[uid] || {}; const now = Date.now(); const remDrop = Math.max(0, (userRec.lastDrop || 0) + COOLDOWN_MS - now); const remDaily = Math.max(0, (userRec.lastDaily || 0) + DAILY_MS - now); const remWeekly = Math.max(0, (userRec.lastWeekly || 0) + WEEK_MS - now); const remHunt = Math.max(0, (userRec.lastHunt || 0) + HUNT_COOLDOWN_MS - now);
    const dropTime = remDrop > 0 ? Math.floor((now + remDrop) / 1000) : null; const dailyTime = remDaily > 0 ? Math.floor((now + remDaily) / 1000) : null; const weeklyTime = remWeekly > 0 ? Math.floor((now + remWeekly) / 1000) : null; const huntTime = remHunt > 0 ? Math.floor((now + remHunt) / 1000) : null;
    const dropVal = dropTime ? `${NOT_READY_HEART} ✦ Come back in <t:${dropTime}:R>!` : `${READY_HEART} ✦ It's ready!`; const dailyVal = dailyTime ? `${NOT_READY_HEART} ✦ Come back in <t:${dailyTime}:R>!` : `${READY_HEART} ✦ It's ready!`; const weeklyVal = weeklyTime ? `${NOT_READY_HEART} ✦ Come back in <t:${weeklyTime}:R>!` : `${READY_HEART} ✦ It's ready!`; const huntVal = huntTime ? `${NOT_READY_HEART} ✦ Come back in <t:${huntTime}:R>!` : `${READY_HEART} ✦ It's ready!`;
    const embed = new EmbedBuilder()
    .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
    .setTitle(`✦ Looking at the skull clock...`).addFields({ name: `ㆍAre you ready for **${usedPrefix}drop?**`, value: dropVal, inline: true },{ name: `ㆍAre you ready for **${usedPrefix}daily**?`, value: dailyVal, inline: true },{ name: `ㆍAre you ready for **${usedPrefix}weekly**?`, value: weeklyVal, inline: true },{ name: `ㆍAre you ready for **${usedPrefix}hunt**?`, value: huntVal, inline: true })
    .setFooter({ text: '✦ Are you ready for this? Zimzalabim!' })
    .setColor('#ea8bb9');
    const { embed: embedWithThumb, files: thumbFiles } = setThumbnailOrAttachment(embed, 'cooldown.png');
    message.reply({ embeds: [embedWithThumb], files: thumbFiles }); return;
  }

  // progress
  if (cmd === 'progress' || cmd === 'prog') {
    const cards = readCards();
    const collections = readCollections();
    let filterArgs = Array.from(args);
    let targetUid = message.author.id;
    
    if (filterArgs.length > 0) {
      const maybe = filterArgs[0];
      const mentionMatch = maybe.match(/^<@!?(\d+)>$/);
      if (mentionMatch) { targetUid = mentionMatch[1]; filterArgs.shift(); }
      else if (maybe.startsWith('<') && maybe.endsWith('>')) filterArgs.shift();
    }

    const filters = {};
    for (const a of filterArgs) {
      const eq = a.indexOf('='); if (eq === -1) continue;
      const k = a.slice(0, eq).toLowerCase(); const v = a.slice(eq + 1);
      if (['era','rarity','rar','name','na','group','gr'].includes(k)) {
        let key = k;
        if (k === 'na') key = 'name';
        if (k === 'gr') key = 'group';
        if (k === 'rar') key = 'rarity';
        filters[key] = normalizeStr(v);
      }
    }

    function cardMatchesFilters(card) { for (const k of Object.keys(filters)) { const want = filters[k]; const actual = normalizeStr(card[k] || ''); if (!actual.includes(want)) return false; } return true; }

    const userCol = collections[targetUid] || {};
    const filteredCards = cards.filter(c => cardMatchesFilters(c));
    
    if (filteredCards.length === 0) {
      message.reply(`${NOT_READY_HEART} ✦ No cards found with these filters!`); return;
    }

    let totalOwned = 0;
    let totalPossible = 0;
    const breakdown = {};

    for (const card of filteredCards) {
      totalPossible++;
      const count = userCol[card.code] || 0;
      if (count > 0) totalOwned++;
      
      const key = `${card.group} - ${card.era}`;
      if (!breakdown[key]) breakdown[key] = { owned: 0, total: 0 };
      breakdown[key].total++;
      if (count > 0) breakdown[key].owned++;
    }

    const percent = totalPossible > 0 ? Math.round((totalOwned / totalPossible) * 100) : 0;
    const progressBar = `[${'█'.repeat(Math.floor(percent / 5))}${'░'.repeat(20 - Math.floor(percent / 5))}] ${percent}%`;

    let breakdownText = '';
    for (const [key, data] of Object.entries(breakdown)) {
      const subPercent = Math.round((data.owned / data.total) * 100);
      breakdownText += `ㆍ**${key}:** ${data.owned}/${data.total} (${subPercent}%)\n`;
    }

    let displayName = message.author.username;
    if (targetUid !== message.author.id) {
      try { const user = await message.guild?.members.fetch(targetUid); if (user) displayName = user.user.username; } catch (_) {}
    }

    const embed = new EmbedBuilder()
    .setAuthor({ name: displayName, iconURL: message.author.displayAvatarURL() })
    .setTitle(`✦ ${displayName}'s Collection Progress`)
    .setDescription(`${progressBar}\n\nㆍ**Total:** ${totalOwned}/${totalPossible} **tarot cards** collected!\n\n${breakdownText}`)
    .setFooter({ text: '✦ Keep playing for more cards!' })
    .setColor('#ea8bb9');

    const { embed: embedWithThumb, files: thumbFiles } = setThumbnailOrAttachment(embed, 'cards.png');
    message.reply({ embeds: [embedWithThumb], files: thumbFiles }); return;
  }

  // search/cards
  if (cmd === 'search' || cmd === 'cards' || cmd === 's') {
    const cards = readCards(); const filters = {}; for (const a of args) { const eq = a.indexOf('='); if (eq === -1) continue; const k = a.slice(0, eq).toLowerCase(); const v = a.slice(eq + 1); if (['era','rarity','rar','name','na','group','gr'].includes(k)) { let key = k; if (k === 'na') key = 'name'; if (k === 'gr') key = 'group'; if (k === 'rar') key = 'rarity'; filters[key] = normalizeStr(v); } }
    function cardMatchesFilters(card) { for (const k of Object.keys(filters)) { const want = filters[k]; const actual = normalizeStr(card[k] || ''); if (!actual.includes(want)) return false; } return true; }
    const filteredCards = cards.filter(c => cardMatchesFilters(c));
    if (filteredCards.length === 0) { 
    const tempEmbed = new EmbedBuilder()
    .setTitle('✦ OMG! It is a really empty search!')
    .setDescription('ㆍNo tarot cards found!')
    .setColor('#ea8bb9');
    const { embed: tempEmbedWithThumb, files: tempThumbFiles } = setThumbnailOrAttachment(tempEmbed, 'cards.png');
    message.reply({ embeds: [tempEmbedWithThumb], files: tempThumbFiles }); return; }
    
    const lines = filteredCards.map(c => `ㆍ**Name:** ${c.name}\nㆍ**Group:** ${c.group}\nㆍ**Era:** ${c.era}\nㆍ**Rarity:** ${rarityEmoji(c.rarity)}\nㆍ**Code:** ${c.code}`);
    const cardsPerPage = 5; let currentPage = 1; const totalPages = Math.ceil(lines.length / cardsPerPage);
    
    async function showPage(pageNum) {
      const start = (pageNum - 1) * cardsPerPage; const end = start + cardsPerPage; const pageLines = lines.slice(start, end);
      const embed = new EmbedBuilder()
        .setTitle(`✦ Tarot Cards Search Results`)
        .setDescription(`${READY_HEART}ㆍPage ${pageNum}/${totalPages} (${lines.length} cards found)\n\n${pageLines.join('\n\n')}`)
        .setColor('#ea8bb9')
        .setFooter({ text: `✦ Cards shown: ${start + 1}-${Math.min(end, lines.length)}` });
      
      const buttons = [];
      if (pageNum > 1) buttons.push({ customId: `search_prev_${pageNum - 1}`, label: 'Previous' });
      if (pageNum < totalPages) buttons.push({ customId: `search_next_${pageNum + 1}`, label: 'Next' });
      
      if (buttons.length > 0) {
        const row = { type: 1, components: buttons.map(b => ({ type: 2, custom_id: b.customId, label: b.label, style: 1 })) };
        message.reply({ embeds: [embed], components: [row] });
      } else {
        message.reply({ embeds: [embed] });
      }
    }
    
    await showPage(currentPage);
    return;
  }

  // view
  if (cmd === 'view' || cmd === 'vw' || cmd === 'v') {
    const id = args[0]; if (!id) { message.reply('Use .view <cardId>'); return; }
    const cards = readCards(); const card = cards.find(c => c.code === id.toUpperCase()); if (!card) { message.reply(`${NOT_READY_HEART} ✦ Tarot card not found.`); return; }
    const embed = new EmbedBuilder()
    .setTitle(`✦ Hey, it's ${card.name}!`)
    .setDescription(`ㆍ**Name:** ${card.name}\nㆍ**Group:** ${card.group}\nㆍ**Era:** ${card.era}\nㆍ**Rarity:** ${card.rarity}\nㆍ**Code:** \`${card.code}\``)
    .setFooter({ text: '✦ What a Original Visual!' })
    .setColor('#ea8bb9');
    const { embed: embedWithThumb, files: thumbFiles } = setThumbnailOrAttachment(embed, 'cards.png');
    if (card.image) { if (isHttpUrl(card.image)) { const remote = await normalizeAndVerifyUrl(card.image); if (remote) { embedWithThumb.setImage(remote); message.reply({ embeds: [embedWithThumb], files: thumbFiles }); return; } } const imgPath = resolveImagePath(card.image); if (imgPath) { const attachment = new AttachmentBuilder(imgPath); embedWithThumb.setImage(`attachment://${path.basename(imgPath)}`); message.reply({ embeds: [embedWithThumb], files: [...thumbFiles, attachment] }); return; } }
    message.reply({ embeds: [embedWithThumb], files: thumbFiles }); return;
  }

  // bag
  if (cmd === 'bag') {
    const bags = readBags(); const uid = message.author.id; const bag = bags[uid] || { cards: {}, loveQuartz: 0, vitalCrystal: 0 };
    const cards = readCards(); let cardsList = [];
    for (const [code, count] of Object.entries(bag.cards || {})) { if (count > 0) { const card = cards.find(c => c.code === code); if (card) cardsList.push(`${card.name} (${code}) x${count}`); } }
    const embed = new EmbedBuilder()
    .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
    .setTitle('✦ #MagicBag! Hey, hey, hey!')
    .setDescription(cardsList.length > 0 || bag.loveQuartz > 0 || bag.vitalCrystal > 0 ? `${READY_HEART} ✦ Your #MagicBag contains:` : `${NOT_READY_HEART} ✦ Your #MagicBag is empty!`)
    .addFields({ name: `ㆍ${LOVE_QUARTZ} Love Quartz amount:`, value: `${bag.loveQuartz || 0}`, inline: true },{ name: `ㆍ${VITAL_CRYSTAL} Vital Crystals amount:`, value: `${bag.vitalCrystal || 0}`, inline: true },
    { name: 'ㆍTarot cards:', value: `${cardsList.length}`, inline: true },{ name: `${READY_HEART} ✦ Contents:`, value: cardsList.length > 0 ? cardsList.join('\n') : `${NOT_READY_HEART} ✦ Is empty!`, inline: false })
    .setFooter({ text: '✦ Use .store <code|crystals> [quantity] or .withdraw <code|crystals> [quantity]!' })
    .setColor('#ea8bb9');
    const { embed: embedWithThumb, files: thumbFiles } = setThumbnailOrAttachment(embed, 'bag.png');
    message.reply({ embeds: [embedWithThumb], files: thumbFiles }); return;
  }

  // store
  if (cmd === 'store' || cmd === 'storebag' || cmd === 'st') {
    const bags = readBags(); const collections = readCollections(); const users = readUsers(); const uid = message.author.id;
    const arg1 = args[0]; const arg2 = args[1] || '1'; if (!arg1) { message.reply(`${NOT_READY_HEART} ✦ Use: **.store <cardCode> [quantity] or .store crystals <amount>**`); return; }
    if (arg1.toLowerCase() === 'love quartz' || arg1.toLowerCase() === 'crystals' || arg1.toLowerCase() === 'cq' || arg1.toLowerCase() === 'lq') {
      const amount = parseInt(arg2); if (isNaN(amount) || amount < 1) { message.reply(`${NOT_READY_HEART} ✦ Invalid amount.`); return; }
      const userRec = users[uid] || { loveQuartz: 0, vitalCrystal: 0 }; if ((userRec.loveQuartz || 0) < amount) { message.reply(`${NOT_READY_HEART} ✦ You only have ${userRec.loveQuartz || 0} ${LOVE_QUARTZ}.`); return; }
      userRec.loveQuartz -= amount; users[uid] = userRec; writeUsers(users);
      const bag = bags[uid] || { cards: {}, loveQuartz: 0, vitalCrystal: 0 }; bag.loveQuartz = (bag.loveQuartz || 0) + amount; bags[uid] = bag; writeBags(bags);
      const embed = new EmbedBuilder()
      .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
      .setTitle('✦ Stored in your #MagicBag!')
      .setDescription(`ㆍ**${amount}**${LOVE_QUARTZ} stored in your #MagicBag!`)
      .addFields({ name: `ㆍ${LOVE_QUARTZ} #MagicBag Total:`, value: `${bag.loveQuartz}`, inline: true })
      .setFooter({ text: '✦ Put your hand in the #MagicBag!' })
      .setColor('#ea8bb9'); 
      const { embed: embedWithThumb, files: thumbFiles } = setThumbnailOrAttachment(embed, 'bag.png');
      message.reply({ embeds: [embedWithThumb], files: thumbFiles }); return; }
    if (arg1.toLowerCase() === 'vital crystal' || arg1.toLowerCase() === 'vc') {
      const amount = parseInt(arg2); if (isNaN(amount) || amount < 1) { message.reply(`${NOT_READY_HEART} ✦ Invalid amount.`); return; }
      const userRec = users[uid] || { loveQuartz: 0, vitalCrystal: 0 }; if ((userRec.vitalCrystal || 0) < amount) { message.reply(`${NOT_READY_HEART} ✦ You only have ${userRec.vitalCrystal || 0} ${VITAL_CRYSTAL}.`); return; }
      userRec.vitalCrystal -= amount; users[uid] = userRec; writeUsers(users);
      const bag = bags[uid] || { cards: {}, loveQuartz: 0, vitalCrystal: 0 }; bag.vitalCrystal = (bag.vitalCrystal || 0) + amount; bags[uid] = bag; writeBags(bags);
      const embed = new EmbedBuilder()
      .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
      .setTitle('✦ Stored in your #MagicBag!')
      .setDescription(`ㆍ**${amount}** ${VITAL_CRYSTAL} stored in your #MagicBag!`)
      .addFields({ name: `ㆍ${VITAL_CRYSTAL} #MagicBag Total:`, value: `${bag.vitalCrystal}`, inline: true })
      .setFooter({ text: '✦ Put your hand in the #MagicBag!' })
      .setColor('#ea8bb9'); 
      const { embed: embedWithThumb, files: thumbFiles } = setThumbnailOrAttachment(embed, 'bag.png');
      message.reply({ embeds: [embedWithThumb], files: thumbFiles }); return; }
    const cardCode = arg1.toUpperCase(); const qty = parseInt(arg2); if (isNaN(qty) || qty < 1) { message.reply(`${NOT_READY_HEART} ✦ Invalid quantity.`); return; }
    const cards = readCards(); const card = cards.find(c => c.code === cardCode); if (!card) { message.reply(`${NOT_READY_HEART} ✦ Card \`${cardCode}\` not found.`); return; }
    const col = collections[uid] || {}; const owned = col[cardCode] || 0; if (owned < qty) { message.reply(`${NOT_READY_HEART} ✦ You only have ${owned} of this card.`); return; }
    col[cardCode] = owned - qty; collections[uid] = col; writeCollections(collections);
    const bag = bags[uid] || { cards: {}, loveQuartz: 0, vitalCrystal: 0 }; bag.cards = bag.cards || {}; bag.cards[cardCode] = (bag.cards[cardCode] || 0) + qty; bags[uid] = bag; writeBags(bags);
    const embed = new EmbedBuilder()
    .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
    .setTitle('✦ Stored in your #MagicBag!')
    .setDescription(`**ㆍ${qty}x ${card.name}** (${cardCode}) stored in your #MagicBag!`)
    .addFields({ name: 'ㆍ#MagicBag Contents:', value: `${Object.values(bag.cards || {}).reduce((a, b) => a + b, 0)} tarot cards`, inline: true })
    .setFooter({ text: '✦ Put your hand in the #MagicBag!' })
    .setColor('#ea8bb9'); 
    const { embed: embedWithThumb, files: thumbFiles } = setThumbnailOrAttachment(embed, 'bag.png');
    message.reply({ embeds: [embedWithThumb], files: thumbFiles }); return;
  }

  // withdraw
  if (cmd === 'withdraw' || cmd === 'withdrawbag' || cmd === 'wd') {
    const bags = readBags(); const collections = readCollections(); const users = readUsers(); const uid = message.author.id;
    const arg1 = args[0]; const arg2 = args[1] || '1'; if (!arg1) { message.reply(`${NOT_READY_HEART} ✦ Use: **.withdraw <cardCode> [quantity] or .withdraw crystals <amount>**`); return; }
    if (arg1.toLowerCase() === 'crystals' || arg1.toLowerCase() === 'cq' || arg1.toLowerCase() === 'lq') {
      const amount = parseInt(arg2); if (isNaN(amount) || amount < 1) { message.reply(`${NOT_READY_HEART} ✦ Invalid amount.`); return; }
      const bag = bags[uid] || { cards: {}, loveQuartz: 0, vitalCrystal: 0 }; if ((bag.loveQuartz || 0) < amount) { message.reply(`${NOT_READY_HEART} ✦ Your bag only has ${bag.loveQuartz || 0} ${LOVE_QUARTZ}.`); return; }
      bag.loveQuartz -= amount; bags[uid] = bag; writeBags(bags); const userRec = users[uid] || { loveQuartz: 0, vitalCrystal: 0 }; userRec.loveQuartz = (userRec.loveQuartz || 0) + amount; users[uid] = userRec; writeUsers(users); const embed = new EmbedBuilder()
      .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
      .setTitle('✦ Withdrawn from your #MagicBag!')
      .setDescription(`ㆍ**${amount}**${LOVE_QUARTZ} taken from your #MagicBag!`)
      .addFields({ name: `ㆍ${LOVE_QUARTZ} #MagicBag Total`, value: `${userRec.loveQuartz}`, inline: true })
      .setFooter({ text: '✦ Back in your pocket!' })
      .setColor('#ea8bb9'); 
      const { embed: embedWithThumb, files: thumbFiles } = setThumbnailOrAttachment(embed, 'bag.png');
      message.reply({ embeds: [embedWithThumb], files: thumbFiles }); return; }
    if (arg1.toLowerCase() === 'vital crystal' || arg1.toLowerCase() === 'vc') { const amount = parseInt(arg2); if (isNaN(amount) || amount < 1) { message.reply(`${NOT_READY_HEART} ✦ Invalid amount.`); return; } const bag = bags[uid] || { cards: {}, loveQuartz: 0, vitalCrystal: 0 }; if ((bag.vitalCrystal || 0) < amount) { message.reply(`${NOT_READY_HEART} ✦ Your bag only has ${bag.vitalCrystal || 0} ${VITAL_CRYSTAL}.`); return; } bag.vitalCrystal -= amount; bags[uid] = bag; writeBags(bags); const userRec = users[uid] || { loveQuartz: 0, vitalCrystal: 0 }; userRec.vitalCrystal = (userRec.vitalCrystal || 0) + amount; users[uid] = userRec; writeUsers(users); const embed = new EmbedBuilder()
      .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
      .setTitle('✦ Withdrawn from your #MagicBag!')
      .setDescription(`ㆍ**${amount}** ${VITAL_CRYSTAL} taken from your #MagicBag!`)
      .addFields({ name: `ㆍ${VITAL_CRYSTAL} #MagicBag Total`, value: `${userRec.vitalCrystal}`, inline: true })
      .setFooter({ text: '✦ Back in your pocket!' })
      .setColor('#ea8bb9'); 
      const { embed: embedWithThumb, files: thumbFiles } = setThumbnailOrAttachment(embed, 'bag.png');
      message.reply({ embeds: [embedWithThumb], files: thumbFiles }); return; }
    const cardCode = arg1.toUpperCase(); const qty = parseInt(arg2); if (isNaN(qty) || qty < 1) { message.reply(`${NOT_READY_HEART} ✦ Invalid quantity.`); return; } const cards = readCards(); const card = cards.find(c => c.code === cardCode); if (!card) { message.reply(`${NOT_READY_HEART} ✦ Card \`${cardCode}\` not found.`); return; } const bag = bags[uid] || { cards: {}, vitalCrystal: 0 }; const inBag = bag.cards?.[cardCode] || 0; if (inBag < qty) { message.reply(`${NOT_READY_HEART} ✦ Your bag only has ${inBag} of this card.`); return; } bag.cards[cardCode] = inBag - qty; bags[uid] = bag; writeBags(bags); const col = collections[uid] || {}; col[cardCode] = (col[cardCode] || 0) + qty; collections[uid] = col; writeCollections(collections); const embed = new EmbedBuilder().setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() }).setTitle('✦ Withdrawn from your #MagicBag!').setDescription(`**${qty}x ${card.name}** (${cardCode}) back to your inventory!`).addFields({ name: '🎴 Inventory', value: `${col[cardCode]} of this card`, inline: true }).setFooter({ text: 'Back in your collection' }).setColor('#ea8bb9'); 
    const { embed: embedWithThumb, files: thumbFiles } = setThumbnailOrAttachment(embed, 'bag.png');
    message.reply({ embeds: [embedWithThumb], files: thumbFiles }); return;
  }

  // imgtest
  if (cmd === 'imgtest') {
    const testUrl = args.join(' ') || 'https://imgur.com/a/QRr03pR';
    console.log(`\n🔍 Testando URL: ${testUrl}`);
    try {
      // Use normalizeAndVerifyUrl to test if an URL resolves to an image
      const normalized = await normalizeAndVerifyUrl(testUrl).catch(() => null);
      console.log(`📌 Resolved image URL: ${normalized || 'NONE'}`);
    } catch (err) {
      console.error('❌ Erro:', err && err.message ? err.message : err);
    }
    message.reply(`✅ Test complete. Check console output.`);
    return;
  }

  // .shop - Bot's shop with rotating cards
  if (cmd === 'shop') {
    const cards = readCards();
    let shop = readShop();
    const now = Date.now();
    const WEEK_7 = 7 * 24 * 60 * 60 * 1000;
    
    // Regenerate shop if 7 days have passed
    if (now - shop.lastUpdate > WEEK_7) {
      shop = { lastUpdate: now, cards: [] };
      
      // 1 epic special (3 vital crystal)
      const epicCards2 = cards.filter(c => (c.rarity || '').toLowerCase() === 'epic');
      if (epicCards2.length > 0) {
        const epicSpecial = epicCards2[Math.floor(Math.random() * epicCards2.length)];
        shop.cards.push({ code: epicSpecial.code, rarity: 'epic', price: 3, currency: 'vital' });
      }
      
      // 2 rare (15k love quartz)
      const rareCards = cards.filter(c => (c.rarity || '').toLowerCase() === 'rare');
      for (let i = 0; i < 2 && rareCards.length > 0; i++) {
        const rare = rareCards[Math.floor(Math.random() * rareCards.length)];
        shop.cards.push({ code: rare.code, rarity: 'rare', price: 15000, currency: 'love' });
      }
      
      // 4 common (3k love quartz)
      const commonCards = cards.filter(c => (c.rarity || '').toLowerCase() === 'common');
      for (let i = 0; i < 4 && commonCards.length > 0; i++) {
        const common = commonCards[Math.floor(Math.random() * commonCards.length)];
        shop.cards.push({ code: common.code, rarity: 'common', price: 3000, currency: 'love' });
      }
      
      writeShop(shop);
    }
    
    // Display shop
    let description = `${READY_HEART}ㆍIrene's Shop - Updates in <t:${Math.floor((shop.lastUpdate + WEEK_7) / 1000)}:R>\n\n`;
    for (let i = 0; i < shop.cards.length; i++) {
      const item = shop.cards[i];
      const card = cards.find(c => c.code === item.code);
      if (card) {
        const priceStr = item.currency === 'vital' ? `${item.price}${VITAL_CRYSTAL}` : `${item.price}${LOVE_QUARTZ}`;
        description += `**[${i + 1}]** ${card.name} (${card.rarity})\nㆍPrice: ${priceStr}\nㆍCode: ${card.code}\n\n`;
      }
    }
    
    const embed = new EmbedBuilder()
      .setTitle(`✦ Irene's Moon Shop`)
      .setDescription(description)
      .setFooter({ text: '✦ Use .shop buy <number> to purchase!' })
      .setColor('#ea8bb9');
    
    const { embed: embedWithThumb, files: thumbFiles } = setThumbnailOrAttachment(embed, 'cards.png');
    message.reply({ embeds: [embedWithThumb], files: thumbFiles });
    return;
  }

  // .shop buy - Purchase from bot's shop
  if (cmd === 'shopbuy') {
    const index = parseInt(args[0]) - 1;
    if (isNaN(index) || index < 0) { message.reply(`${NOT_READY_HEART} ✦ Use: **.shopbuy <number>**`); return; }
    
    const shop = readShop();
    if (index >= shop.cards.length) { message.reply(`${NOT_READY_HEART} ✦ Invalid item number!`); return; }
    
    const item = shop.cards[index];
    const cards = readCards();
    const card = cards.find(c => c.code === item.code);
    if (!card) { message.reply(`${NOT_READY_HEART} ✦ Card not found!`); return; }
    
    const uid = message.author.id;
    const users = readUsers();
    const userRec = users[uid] || { loveQuartz: 0, vitalCrystal: 0 };
    const collections = readCollections();
    const userCol = collections[uid] || {};
    
    // Check and deduct payment
    if (item.currency === 'love') {
      if ((userRec.loveQuartz || 0) < item.price) { 
        message.reply(`${NOT_READY_HEART} ✦ You need ${item.price}${LOVE_QUARTZ}, but only have ${userRec.loveQuartz || 0}!`); 
        return; 
      }
      userRec.loveQuartz -= item.price;
    } else if (item.currency === 'vital') {
      if ((userRec.vitalCrystal || 0) < item.price) { 
        message.reply(`${NOT_READY_HEART} ✦ You need ${item.price}${VITAL_CRYSTAL}, but only have ${userRec.vitalCrystal || 0}!`); 
        return; 
      }
      userRec.vitalCrystal -= item.price;
    }
    
    // Add card to collection
    userCol[card.code] = (userCol[card.code] || 0) + 1;
    collections[uid] = userCol;
    users[uid] = userRec;
    
    writeUsers(users);
    writeCollections(collections);
    
    const priceStr = item.currency === 'vital' ? `${item.price}${VITAL_CRYSTAL}` : `${item.price}${LOVE_QUARTZ}`;
    const embed = new EmbedBuilder()
      .setTitle('✦ Purchase successful!')
      .setDescription(`ㆍYou bought **${card.name}** for ${priceStr}!\nㆍIt was added to your collection!`)
      .setColor('#ea8bb9');
    
    message.reply({ embeds: [embed] });
    return;
  }

  // .market - Player's personal shop
  if (cmd === 'market') {
    const subCmd = args[0] || 'view';
    const uid = message.author.id;
    let market = readMarket();
    
    if (subCmd === 'view' || subCmd === 'list') {
      const targetUid = args[1] ? (args[1].match(/^<@!?(\d+)>$/) || [])[1] || args[1] : uid;
      let pageNum = 1;
      if (args[1]) {
        const parsed = parseInt(args[2]);
        if (!isNaN(parsed)) pageNum = parsed;
      }
      
      const shop = market[targetUid];
      if (!shop || shop.items.length === 0) { 
        message.reply(`${NOT_READY_HEART} ✦ This market is empty or doesn't exist!`); 
        return; 
      }
      
      const itemsPerPage = 5;
      const totalPages = Math.ceil(shop.items.length / itemsPerPage);
      if (pageNum > totalPages) pageNum = totalPages;
      if (pageNum < 1) pageNum = 1;
      
      const start = (pageNum - 1) * itemsPerPage;
      const end = start + itemsPerPage;
      const pageItems = shop.items.slice(start, end);
      
      let description = `${READY_HEART}ㆍMarket by <@${targetUid}>\nㆍPage ${pageNum}/${totalPages}\n\n`;
      const cards = readCards();
      for (let i = 0; i < pageItems.length; i++) {
        const item = pageItems[i];
        const card = cards.find(c => c.code === item.code);
        if (card) {
          const priceStr = item.currency === 'vital' ? `${item.price}${VITAL_CRYSTAL}` : `${item.price}${LOVE_QUARTZ}`;
          const itemNum = start + i + 1;
          description += `**[${itemNum}]** ${card.name} (x${item.quantity})\nㆍPrice: ${priceStr}\nㆍCode: ${card.code}\n\n`;
        }
      }
      
      const embed = new EmbedBuilder()
        .setTitle(`✦ Personal Magic Market`)
        .setDescription(description)
        .setFooter({ text: '✦ Use .market buy <seller_id> <number> to purchase!' })
        .setColor('#ea8bb9');
      
      const buttons = [];
      if (pageNum > 1) buttons.push({ customId: `market_prev_${targetUid}_${pageNum - 1}`, label: 'Previous' });
      if (pageNum < totalPages) buttons.push({ customId: `market_next_${targetUid}_${pageNum + 1}`, label: 'Next' });
      
      const { embed: embedWithThumb, files: thumbFiles } = setThumbnailOrAttachment(embed, 'bag.png');
      
      if (buttons.length > 0) {
        const row = { type: 1, components: buttons.map(b => ({ type: 2, custom_id: b.customId, label: b.label, style: 1 })) };
        message.reply({ embeds: [embedWithThumb], components: [row], files: thumbFiles });
      } else {
        message.reply({ embeds: [embedWithThumb], files: thumbFiles });
      }
      return;
    }
    
    if (subCmd === 'add') {
      const cardCode = args[1]?.toUpperCase();
      const quantity = parseInt(args[2]) || 1;
      const price = parseInt(args[3]);
      const currency = args[4]?.toLowerCase() || 'love';
      
      if (!cardCode || !price) { 
        message.reply(`${NOT_READY_HEART} ✦ Use: **.market add <cardCode> <quantity> <price> [love|vital]**`); 
        return; 
      }
      
      const cards = readCards();
      const card = cards.find(c => c.code === cardCode);
      if (!card) { message.reply(`${NOT_READY_HEART} ✦ Card not found!`); return; }
      
      const collections = readCollections();
      const userCol = collections[uid] || {};
      const owned = userCol[cardCode] || 0;
      if (owned < quantity) { 
        message.reply(`${NOT_READY_HEART} ✦ You only have ${owned} of this card!`); 
        return; 
      }
      
      // Initialize shop if doesn't exist
      if (!market[uid]) market[uid] = { items: [] };
      
      // Add item to market
      const existingItem = market[uid].items.find(i => i.code === cardCode && i.price === price && i.currency === currency);
      if (existingItem) {
        existingItem.quantity += quantity;
      } else {
        market[uid].items.push({ code: cardCode, quantity, price, currency });
      }
      
      // Remove from collection
      userCol[cardCode] -= quantity;
      collections[uid] = userCol;
      
      writeMarket(market);
      writeCollections(collections);
      
      message.reply(`${READY_HEART} ✦ Added **${quantity}x ${card.name}** to your market!`);
      return;
    }
    
    if (subCmd === 'remove') {
      const itemIndex = parseInt(args[1]) - 1;
      if (isNaN(itemIndex) || itemIndex < 0 || itemIndex >= (market[uid]?.items?.length || 0)) { 
        message.reply(`${NOT_READY_HEART} ✦ Invalid item number!`); 
        return; 
      }
      
      const item = market[uid].items[itemIndex];
      const cards = readCards();
      const card = cards.find(c => c.code === item.code);
      
      // Return to collection
      const collections = readCollections();
      const userCol = collections[uid] || {};
      userCol[item.code] = (userCol[item.code] || 0) + item.quantity;
      collections[uid] = userCol;
      
      market[uid].items.splice(itemIndex, 1);
      
      writeMarket(market);
      writeCollections(collections);
      
      message.reply(`${READY_HEART} ✦ Removed **${item.quantity}x ${card.name}** from your market!`);
      return;
    }
    
    if (subCmd === 'buy') {
      const sellerStr = args[1];
      const itemIndex = parseInt(args[2]) - 1;
      
      if (!sellerStr || isNaN(itemIndex)) { 
        message.reply(`${NOT_READY_HEART} ✦ Use: **.market buy <seller_id> <number>**`); 
        return; 
      }
      
      const sellerId = sellerStr.match(/^<@!?(\d+)>$/) ? sellerStr.match(/^<@!?(\d+)>$/)[1] : sellerStr;
      const sellerShop = market[sellerId];
      
      if (!sellerShop || itemIndex >= sellerShop.items.length) { 
        message.reply(`${NOT_READY_HEART} ✦ Item not found in that market!`); 
        return; 
      }
      
      const item = sellerShop.items[itemIndex];
      const cards = readCards();
      const card = cards.find(c => c.code === item.code);
      if (!card) { message.reply(`${NOT_READY_HEART} ✦ Card not found!`); return; }
      
      const users = readUsers();
      const buyerRec = users[uid] || { loveQuartz: 0, vitalCrystal: 0 };
      const sellerRec = users[sellerId] || { loveQuartz: 0, vitalCrystal: 0 };
      const collections = readCollections();
      const buyerCol = collections[uid] || {};
      const sellerCol = collections[sellerId] || {};
      
      // Check and deduct payment from buyer
      if (item.currency === 'love') {
        if ((buyerRec.loveQuartz || 0) < item.price) { 
          message.reply(`${NOT_READY_HEART} ✦ You need ${item.price}${LOVE_QUARTZ}!`); 
          return; 
        }
        buyerRec.loveQuartz -= item.price;
        sellerRec.loveQuartz = (sellerRec.loveQuartz || 0) + item.price;
      } else if (item.currency === 'vital') {
        if ((buyerRec.vitalCrystal || 0) < item.price) { 
          message.reply(`${NOT_READY_HEART} ✦ You need ${item.price}${VITAL_CRYSTAL}!`); 
          return; 
        }
        buyerRec.vitalCrystal -= item.price;
        sellerRec.vitalCrystal = (sellerRec.vitalCrystal || 0) + item.price;
      }
      
      // Transfer card
      buyerCol[card.code] = (buyerCol[card.code] || 0) + item.quantity;
      sellerCol[card.code] = (sellerCol[card.code] || 0) - item.quantity;
      
      collections[uid] = buyerCol;
      collections[sellerId] = sellerCol;
      users[uid] = buyerRec;
      users[sellerId] = sellerRec;
      
      // Remove from market
      sellerShop.items.splice(itemIndex, 1);
      
      writeMarket(market);
      writeCollections(collections);
      writeUsers(users);
      
      const priceStr = item.currency === 'vital' ? `${item.price}${VITAL_CRYSTAL}` : `${item.price}${LOVE_QUARTZ}`;
      const embed = new EmbedBuilder()
        .setTitle('✦ Purchase successful!')
        .setDescription(`ㆍYou bought **${item.quantity}x ${card.name}** for ${priceStr}!\nㆍCards added to your collection!`)
        .setColor('#ea8bb9');
      
      message.reply({ embeds: [embed] });
      return;
    }
    
    message.reply(`${NOT_READY_HEART} ✦ Use: **.market [view|add|remove|buy]**\n**.market view [@user]**\n**.market add <code> <qty> <price> [love|vital]**\n**.market remove <number>**\n**.market buy <seller> <number>**`);
    return;
  }

  // help with pagination
  if (cmd === 'help' || cmd === '?') {
    const p = usedPrefix;
    const pageNum = Math.max(1, parseInt(args[0]) || 1);
    const uid = message.author.id;
    
    const buildHelpEmbed = (page) => {
      let embed;
      if (page === 1) {
        embed = new EmbedBuilder()
          .setTitle(`✦ Irene's Ancient Book`)
          .setDescription('・Many, many years ago, when **five young witches** discovered the **wonders of divination**, each of them joined their life force and created this book to **help with tarot readings**. Come here and read it whenever you need help.\n\n**Page 1/4** - Main Description\n\nUse the buttons to navigate or **.help <page>**')
          .setColor('#ea8bb9')
          .setFooter({ text: '✦ Pages: 1/4' });
      } else if (page === 2) {
        embed = new EmbedBuilder()
          .setTitle(`✦ Collection Commands`)
          .setDescription(`**・Managing Your Collection\n\n${READY_HEART}・Drop & Obtain:`)
          .addFields(
            { name: `${p}drop (${p}d, ${p}dr)`, value: '・Get a new card every 5 minutes. (50% common, 30% rare, 15% epic, 5% limited)', inline: false },
            { name: `${p}daily`, value: '・Get 1500 Love Quartz every 24 hours.', inline: false },
            { name: `${p}weekly`, value: '・Get 15000 LQ + 1 VC every 7 days.', inline: false },
            { name: `${p}hunt (${p}h)`, value: '・Hunt for 1000 LQ or 5 VC (25% chance) every 24 hours.', inline: false },
            { name: `\n${READY_HEART}ㆍView & Search:`, value: '・', inline: false },
            { name: `${p}inventory (${p}inv, ${p}i)`, value: '・View your collection with filters. Ex: .inv era=Debut rarity=epic', inline: false },
            { name: `${p}search (${p}cards, ${p}s)`, value: '・Search for cards in the database with filters.', inline: false },
            { name: `${p}view (${p}v)`, value: '・View detailed info about a specific card.', inline: false }
          )
          .setColor('#ea8bb9')
          .setFooter({ text: '✦ Pages: 2/4' });
      } else if (page === 3) {
        embed = new EmbedBuilder()
          .setTitle(`✦ Economy Commands`)
          .setDescription(`・Trading & Shopping\n\n${READY_HEART}・Markets:`)
          .addFields(
            { name: `✦ ${p}shop`, value: '・View Irene\'s official shop *(updates every 7 days)*.', inline: false },
            { name: `✦ ${p}shopbuy <number>`, value: `・Buy cards from Irene\'s shop with ${LOVE_QUARTZ} or ${VITAL_CRYSTAL}.`, inline: false },
            { name: `✦ ${p}market [view|add|remove|buy]`, value: '・Create your own market and sell cards with other players!', inline: false },
            { name: `✦ \n${READY_HEART}ㆍCurrencies:`, value: 'ㆍ', inline: false },
            { name: `✦ ${p}balance (${p}bal)`, value: `・Check your ${LOVE_QUARTZ} and ${VITAL_CRYSTAL} balance.`, inline: false },
            { name: `✦ ${p}pay <user> <amount>`, value: `・Send ${LOVE_QUARTZ} to another player.`, inline: false },
            { name: `✦ ${p}bag`, value: '・Store items safely in your #MagicBag!', inline: false },
            { name: `✦ ${p}store (${p}st)`, value: '・Store cards/crystals in your bag.', inline: false },
            { name: `✦ ${p}withdraw (${p}wd)`, value: '・Withdraw cards/crystals from your bag.', inline: false }
          )
          .setColor('#ea8bb9')
          .setFooter({ text: '✦ Pages: 3/4' });
      } else if (page === 4) {
        embed = new EmbedBuilder()
          .setTitle(`✦ Social & Utility Commands`)
          .setDescription(`・Profile & Settings\n\n${READY_HEART}・Profile:`)
          .addFields(
            { name: `${p}profile (${p}p)`, value: '・View your or someone else\'s profile with favorite card.', inline: false },
            { name: `${p}progress (${p}prog)`, value: '・Check your collection progress with statistics.', inline: false },
            { name: `${p}setfav <code>`, value: '・Set a favorite card for your profile.', inline: false },
            { name: `${p}removefav`, value: '・Remove your favorite card.', inline: false },
            { name: `${p}setdesc <text>`, value: '・Set a custom description for your profile (max. 200 chars.).', inline: false },
            { name: `${p}removedesc`, value: '・Remove your profile description.', inline: false },
            { name: `${p}gift <@user> <code> [amount]`, value: '・Gift cards to other players.', inline: false },
            { name: `${p}cooldown (${p}cd)`, value: '・Check remaining time for all cooldowns.', inline: false }
          )
          .setColor('#ea8bb9')
          .setFooter({ text: '✦ Pages: 4/4' });
      }
      return embed;
    };
    
    if (pageNum === 1) {
      const embed = buildHelpEmbed(1);
      const { embed: embedWithThumb, files: thumbFiles } = setThumbnailOrAttachment(embed, 'help.png');
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`help_prev_${uid}_0`)
            .setLabel('Previous')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
          new ButtonBuilder()
            .setCustomId(`help_next_${uid}_2`)
            .setLabel('Next')
            .setStyle(ButtonStyle.Secondary)
        );
      message.reply({ embeds: [embedWithThumb], files: thumbFiles, components: [row] });
    } else if (pageNum >= 2 && pageNum <= 4) {
      const embed = buildHelpEmbed(pageNum);
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`help_prev_${uid}_${pageNum - 2}`)
            .setLabel('Previous')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(pageNum === 2),
          new ButtonBuilder()
            .setCustomId(`help_next_${uid}_${pageNum}`)
            .setLabel('Next')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(pageNum === 4)
        );
      message.reply({ embeds: [embed], components: [row] });
    } else {
      message.reply(`${NOT_READY_HEART} ✦ Invalid page! Use **.help 1** to **.help 4**`);
    }
    return;
  }

  // cmdlist (owner only)
  if (cmd === 'cmdlist') {
    if (message.author.id !== BOT_OWNER_ID) { message.reply('❌ Only the bot owner can use this command.'); return; }
    const allCmds = ['.drop, .d, .dr', '.daily', '.weekly', '.hunt, .h', '.inventory, .inv, .i', '.search, .cards, .s', '.view, .v', '.profile, .p', '.balance, .bal', '.progress, .prog', '.cooldown, .cd', '.setfav, .favorite, .fav', '.removefav, .unsetfav', '.setdesc, .description, .desc', '.removedesc, .cleardesc', '.gift, .g', '.pay', '.bag', '.store, .storebag, .st', '.withdraw, .withdrawbag, .wd', '.shop', '.shopbuy', '.market', '.help, .?'];
    const embed = new EmbedBuilder()
      .setTitle('📋 All Bot Commands')
      .setDescription('Commands:\n' + allCmds.join('\n'))
      .setColor('#00bcd4')
      .setFooter({ text: `Total: ${allCmds.length} command groups` });
    message.reply({ embeds: [embed] });
    return;
  }

  // give (owner only)
  if (cmd === 'give') {
    if (message.author.id !== BOT_OWNER_ID) { message.reply('❌ Only the bot owner can use this command.'); return; }
    const targetStr = args[0]; const item = args[1]; const amountStr = args[2] || '1'; if (!targetStr || !item) { message.reply(`${NOT_READY_HEART} ✦ Use: **.give <@user|id> <cardCode|crystals|vital> <amount>**`); return; }
    let targetUid = null; const mentionMatch = targetStr.match(/^<@!?(\d+)>$/); if (mentionMatch) targetUid = mentionMatch[1]; else if (/^\d{17,19}$/.test(targetStr)) targetUid = targetStr; else { message.reply(`${NOT_READY_HEART} ✦ Invalid user. Use mention or user ID.`); return; }
    const amount = Math.max(1, parseInt(amountStr)); if (isNaN(amount)) { message.reply('Invalid amount.'); return; }
    const users = readUsers(); const collections = readCollections(); if (item.toLowerCase() === 'love quartz' || item.toLowerCase() === 'crystals' || item.toLowerCase() === 'lq') { const userRec = users[targetUid] || { loveQuartz: 0, vitalCrystal: 0 }; userRec.loveQuartz = (userRec.loveQuartz || 0) + amount; users[targetUid] = userRec; writeUsers(users); message.reply(`${READY_HEART} ✦ Gave ${amount} ${LOVE_QUARTZ} to <@${targetUid}>.`); return; }
    if (item.toLowerCase() === 'vital crystal' || item.toLowerCase() === 'vital' || item.toLowerCase() === 'vc') { const userRec = users[targetUid] || { loveQuartz: 0, vitalCrystal: 0 }; userRec.vitalCrystal = (userRec.vitalCrystal || 0) + amount; users[targetUid] = userRec; writeUsers(users); message.reply(`${READY_HEART} ✦ Gave ${amount} ${VITAL_CRYSTAL} to <@${targetUid}>.`); return; }
    const cards = readCards(); const card = cards.find(c => c.code === item.toUpperCase()); if (!card) { message.reply('Card not found.'); return; } const userCol = collections[targetUid] || {}; userCol[card.code] = (userCol[card.code] || 0) + amount; collections[targetUid] = userCol; writeCollections(collections); message.reply(`${READY_HEART} ✦ Gave ${amount}x ${card.name} (\`${card.code}\`) to <@${targetUid}>.`); return; }

  // fallback: unknown command -> ignore
}

async function handleInteraction(interaction, ctx) {
  const { readCards, readCollections, readMarket, rarityEmoji, EmbedBuilder, READY_HEART, NOT_READY_HEART } = ctx;
  if (!interaction.isButton()) return;
  const customId = interaction.customId;

  if (customId.startsWith('inv_next_') || customId.startsWith('inv_prev_')) {
    const parts = customId.split('_');
    const targetUid = parts[2];
    const pageNum = parseInt(parts[3]);

    if (interaction.user.id !== targetUid && interaction.message.author?.id !== targetUid) {
      await interaction.reply({ content: `${NOT_READY_HEART} ✦ You can only navigate your own inventory!`, ephemeral: true }); return;
    }

    const collections = readCollections(); const cards = readCards(); const userCol = collections[targetUid] || {};
    const lines = [];
    for (const card of cards) {
      const count = userCol[card.code] || 0; if (count <= 0) continue; const dupeTag = count > 1 ? ' (dupe)' : ''; const rareEmoji = rarityEmoji(card.rarity);
      lines.push(`ㆍ**Name:** ${card.name}\nㆍ**Group:** ${card.group}\nㆍ**Era:** ${card.era}\nㆍ**Rarity:** ${rareEmoji} (${card.rarity})\nㆍ**Amount:** ${count}x${dupeTag}\nㆍ**Code:** ${card.code}\n`);
    }

    const cardsPerPage = 5; const totalPages = Math.ceil(lines.length / cardsPerPage); const start = (pageNum - 1) * cardsPerPage; const end = start + cardsPerPage; const pageLines = lines.slice(start, end);

    let headerName = interaction.user.username; if (targetUid !== interaction.user.id) { try { const u = await interaction.client.users.fetch(targetUid); headerName = u.username; } catch (_) { headerName = targetUid; } }

    const embed = new EmbedBuilder().setTitle(`✦ ${headerName}'s Magic Deck of Cards`).setDescription(`${READY_HEART}ㆍPage ${pageNum}/${totalPages} (${lines.length} cards in total)\n\n${pageLines.join('\n')}`).setColor('#ea8bb9').setFooter({ text: `✦ Cards shown: ${start + 1}-${Math.min(end, lines.length)}` });

    const buttons = [];
    if (pageNum > 1) buttons.push({ customId: `inv_prev_${targetUid}_${pageNum - 1}`, label: 'Previous' });
    if (pageNum < totalPages) buttons.push({ customId: `inv_next_${targetUid}_${pageNum + 1}`, label: 'Next' });

    const row = buttons.length > 0 ? { type: 1, components: buttons.map(b => ({ type: 2, custom_id: b.customId, label: b.label, style: 1 })) } : null;

    if (interaction.update) {
      await interaction.update({ embeds: [embed], components: row ? [row] : [] });
    } else {
      await interaction.reply({ embeds: [embed], components: row ? [row] : [] });
    }
  }

  if (customId.startsWith('search_next_') || customId.startsWith('search_prev_')) {
    const pageNum = parseInt(customId.split('_').pop());
    const cards = readCards(); 
    const { readCards: rc } = ctx;
    
    // Reconstruct filtered cards from current message (simplified - would need to pass filters in customId for proper implementation)
    // For now, using a basic approach to get cards based on the search
    const allCards = readCards();
    const lines = allCards.map(c => `ㆍ**Name:** ${c.name}\nㆍ**Group:** ${c.group}\nㆍ**Era:** ${c.era}\nㆍ**Rarity:** ${rarityEmoji(c.rarity)}\nㆍ**Code:** ${c.code}`);
    
    const cardsPerPage = 5;
    const totalPages = Math.ceil(lines.length / cardsPerPage);
    const start = (pageNum - 1) * cardsPerPage;
    const end = start + cardsPerPage;
    const pageLines = lines.slice(start, end);

    const embed = new EmbedBuilder()
      .setTitle(`✦ Tarot Cards Search Results`)
      .setDescription(`${READY_HEART}ㆍPage ${pageNum}/${totalPages} (${lines.length} cards found)\n\n${pageLines.join('\n\n')}`)
      .setColor('#ea8bb9')
      .setFooter({ text: `✦ Cards shown: ${start + 1}-${Math.min(end, lines.length)}` });

    const buttons = [];
    if (pageNum > 1) buttons.push({ customId: `search_prev_${pageNum - 1}`, label: 'Previous' });
    if (pageNum < totalPages) buttons.push({ customId: `search_next_${pageNum + 1}`, label: 'Next' });

    const row = buttons.length > 0 ? { type: 1, components: buttons.map(b => ({ type: 2, custom_id: b.customId, label: b.label, style: 1 })) } : null;

    if (interaction.update) {
      await interaction.update({ embeds: [embed], components: row ? [row] : [] });
    } else {
      await interaction.reply({ embeds: [embed], components: row ? [row] : [] });
    }
  }

  if (customId.startsWith('market_next_') || customId.startsWith('market_prev_')) {
    const parts = customId.split('_');
    const targetUid = parts[2];
    const pageNum = parseInt(parts[3]);
    
    const market = readMarket();
    const shop = market[targetUid];
    
    if (!shop || shop.items.length === 0) {
      await interaction.reply({ content: `${NOT_READY_HEART} ✦ This market is empty!`, ephemeral: true });
      return;
    }
    
    const itemsPerPage = 5;
    const totalPages = Math.ceil(shop.items.length / itemsPerPage);
    const start = (pageNum - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const pageItems = shop.items.slice(start, end);
    
    let description = `${READY_HEART}ㆍMarket by <@${targetUid}>\nㆍPage ${pageNum}/${totalPages}\n\n`;
    const cards = readCards();
    for (let i = 0; i < pageItems.length; i++) {
      const item = pageItems[i];
      const card = cards.find(c => c.code === item.code);
      if (card) {
        const priceStr = item.currency === 'vital' ? `${item.price}${ctx.VITAL_CRYSTAL}` : `${item.price}${ctx.LOVE_QUARTZ}`;
        const itemNum = start + i + 1;
        description += `**[${itemNum}]** ${card.name} (x${item.quantity})\nㆍPrice: ${priceStr}\nㆍCode: ${card.code}\n\n`;
      }
    }
    
    const embed = new EmbedBuilder()
      .setTitle(`✦ Personal Magic Market`)
      .setDescription(description)
      .setFooter({ text: '✦ Use .market buy <seller_id> <number> to purchase!' })
      .setColor('#ea8bb9');
    
    const buttons = [];
    if (pageNum > 1) buttons.push({ customId: `market_prev_${targetUid}_${pageNum - 1}`, label: 'Previous' });
    if (pageNum < totalPages) buttons.push({ customId: `market_next_${targetUid}_${pageNum + 1}`, label: 'Next' });
    
    const row = buttons.length > 0 ? { type: 1, components: buttons.map(b => ({ type: 2, custom_id: b.customId, label: b.label, style: 1 })) } : null;
    
    if (interaction.update) {
      await interaction.update({ embeds: [embed], components: row ? [row] : [] });
    } else {
      await interaction.reply({ embeds: [embed], components: row ? [row] : [] });
    }
  }

  if (customId.startsWith('help_next_') || customId.startsWith('help_prev_')) {
    const parts = customId.split('_');
    const targetUid = parts[2];
    const pageNum = parseInt(parts[3]) + 1;

    if (interaction.user.id !== targetUid) {
      await interaction.reply({ content: `${NOT_READY_HEART} ✦ You can only navigate your own help!`, ephemeral: true });
      return;
    }

    const buildHelpEmbed = (page) => {
      let embed;
      const p = '.';
      if (page === 1) {
        embed = new EmbedBuilder()
          .setTitle(`✦ Irene's Ancient Book`)
          .setDescription('・Many, many years ago, when **five young witches** discovered the **wonders of divination**, each of them joined their life force and created this book to **help with tarot readings**. Come here and read it whenever you need help.\n\n**Page 1/4** - Main Description\n\nUse the buttons to navigate or **.help <page>**')
          .setColor('#ea8bb9')
          .setFooter({ text: '✦ Pages: 1/4' });
      } else if (page === 2) {
        embed = new EmbedBuilder()
          .setTitle(`✦ Collection Commands`)
          .setDescription(`**Page 2/4** - Managing Your Collection\n\n${READY_HEART}ㆍDrop & Obtain:`)
          .addFields(
            { name: `${p}drop (${p}d, ${p}dr)`, value: 'Get a new card every 5 minutes. (50% common, 30% rare, 15% epic, 5% limited)', inline: false },
            { name: `${p}daily`, value: 'Get 1500 Love Quartz every 24 hours.', inline: false },
            { name: `${p}weekly`, value: 'Get 15000 LQ + 1 VC every 7 days.', inline: false },
            { name: `${p}hunt (${p}h)`, value: 'Hunt for 1000 LQ or 5 VC (25% chance) every 24 hours.', inline: false },
            { name: `\n${READY_HEART}ㆍView & Search:`, value: 'ㆍ', inline: false },
            { name: `${p}inventory (${p}inv, ${p}i)`, value: 'View your collection with filters. Ex: .inv era=Debut rarity=epic', inline: false },
            { name: `${p}search (${p}cards, ${p}s)`, value: 'Search for cards in the database with filters.', inline: false },
            { name: `${p}view (${p}v)`, value: 'View detailed info about a specific card.', inline: false }
          )
          .setColor('#ea8bb9')
          .setFooter({ text: '✦ Pages: 2/4' });
      } else if (page === 3) {
        embed = new EmbedBuilder()
          .setTitle(`✦ Economy Commands`)
          .setDescription(`**Page 3/4** - Trading & Shopping\n\n${READY_HEART}ㆍMarkets:`)
          .addFields(
            { name: `${p}shop`, value: 'View bot\'s official shop (updates every 7 days).', inline: false },
            { name: `${p}shopbuy <number>`, value: 'Buy cards from bot\'s shop with LQ or VC.', inline: false },
            { name: `${p}market [view|add|remove|buy]`, value: 'Create your personal shop and trade with other players!', inline: false },
            { name: `\n${READY_HEART}ㆍCurrencies:`, value: 'ㆍ', inline: false },
            { name: `${p}balance (${p}bal)`, value: 'Check your LQ and VC balance.', inline: false },
            { name: `${p}pay <user> <amount>`, value: 'Send Love Quartz to another player.', inline: false },
            { name: `${p}bag`, value: 'Store items safely in your magic bag.', inline: false },
            { name: `${p}store (${p}st)`, value: 'Store cards/crystals in your bag.', inline: false },
            { name: `${p}withdraw (${p}wd)`, value: 'Withdraw cards/crystals from your bag.', inline: false }
          )
          .setColor('#ea8bb9')
          .setFooter({ text: '✦ Pages: 3/4' });
      } else if (page === 4) {
        embed = new EmbedBuilder()
          .setTitle(`✦ Social & Utility Commands`)
          .setDescription(`**Page 4/4** - Profile & Settings\n\n${READY_HEART}ㆍProfile:`)
          .addFields(
            { name: `${p}profile (${p}p)`, value: 'View your or someone else\'s profile with favorite card.', inline: false },
            { name: `${p}progress (${p}prog)`, value: 'Check your collection progress with statistics.', inline: false },
            { name: `${p}setfav <code>`, value: 'Set a favorite card for your profile.', inline: false },
            { name: `${p}removefav`, value: 'Remove your favorite card.', inline: false },
            { name: `${p}setdesc <text>`, value: 'Set a custom description for your profile (max 200 chars).', inline: false },
            { name: `${p}removedesc`, value: 'Remove your profile description.', inline: false },
            { name: `${p}gift <@user> <code> [amount]`, value: 'Gift cards to other players.', inline: false },
            { name: `${p}cooldown (${p}cd)`, value: 'Check remaining time for all cooldowns.', inline: false }
          )
          .setColor('#ea8bb9')
          .setFooter({ text: '✦ Pages: 4/4' });
      }
      return embed;
    };

    const embed = buildHelpEmbed(pageNum);
    const row = new (require('discord.js')).ActionRowBuilder()
      .addComponents(
        new (require('discord.js')).ButtonBuilder()
          .setCustomId(`help_prev_${targetUid}_${pageNum - 2}`)
          .setLabel('◀ Previous')
          .setStyle(2)
          .setDisabled(pageNum === 1),
        new (require('discord.js')).ButtonBuilder()
          .setCustomId(`help_next_${targetUid}_${pageNum}`)
          .setLabel('Next ▶')
          .setStyle(2)
          .setDisabled(pageNum === 4)
      );

    if (pageNum === 1) {
      const { embed: embedWithThumb, files: thumbFiles } = setThumbnailOrAttachment(embed, 'help.png');
      await interaction.update({ embeds: [embedWithThumb], files: thumbFiles, components: [row] });
    } else {
      await interaction.update({ embeds: [embed], components: [row] });
    }
  }
}
