require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Message, Partials.Channel]
});

const deletedMessages = new Collection();
const editedMessages  = new Collection();

const excludedCategoryId = '1';
const requiredRoleId     = '1172237685763608579';
const specialUserId      = '1222548578539536405';

client.once('ready', () => {
  console.log('Bot en ligne et prêt !');
});

function escapeMentions(str) {
  return str.replace(/@([^<>@ ]*)/g, '@.$1');
}

client.on('messageDelete', async message => {
  if (message.partial) {
    try { message = await message.fetch(); }
    catch { return; }
  }

  if (!message.content && message.attachments.size === 0) return;

  const chanId = message.channel.id;
  const arr    = deletedMessages.get(chanId) || [];

  arr.push(message);
  if (arr.length > 5) {
    arr.shift();
  }
  deletedMessages.set(chanId, arr);
});

client.on('messageUpdate', async (oldMsg, newMsg) => {
  if (oldMsg.partial) {
    try {
      oldMsg = await oldMsg.fetch();
      newMsg = await newMsg.fetch();
    } catch {
      return;
    }
  }
  if (oldMsg.content === newMsg.content) return;

  editedMessages.set(oldMsg.channel.id, {
    authorTag: oldMsg.author.tag,
    before:    oldMsg.content || '[aucun contenu]',
    after:     newMsg.content
  });
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  const parts = message.content.trim().split(/\s+/);
  const cmd   = parts[0].toLowerCase();
  const arg   = parts[1];

  if (cmd !== '!snipe' && cmd !== '!esnipe') return;

  const hasRole  = message.member.roles.cache.has(requiredRoleId);
  const isSpecial = message.author.id === specialUserId;
  if (!hasRole && !isSpecial) {
    return;
  }

  if (message.channel.parentId === excludedCategoryId) {
    return message.reply("Cette commande n'est pas autorisée dans ce salon.");
  }

  if (cmd === '!snipe') {
    const requested = parseInt(arg);
    const count = isNaN(requested)
      ? 1
      : Math.min(Math.max(requested, 1), 5);

    const history = deletedMessages.get(message.channel.id) || [];
    if (history.length === 0) {
      return message.reply("Aucun message supprimé récemment dans ce salon.");
    }

    const toShow = history.slice(-count);

    if (toShow.length === 1) {
      const msg = toShow[0];
      let reply = `Dernier message supprimé :\n` +
                  `**${msg.author.tag}** : ${escapeMentions(msg.content || '[Pièce jointe]')}`;
      msg.attachments.forEach(att => {
        reply += `\n→ Pièce jointe : ${att.url}`;
      });
      return message.reply(reply);
    }

    let reply = `Les ${toShow.length} derniers messages supprimés dans ce salon :\n`;
    toShow.forEach((msg, i) => {
      reply += `${i + 1}. **${msg.author.tag}** : ${escapeMentions(msg.content || '[Pièce jointe]')}\n`;
      msg.attachments.forEach(att => {
        reply += `   → Pièce jointe : ${att.url}\n`;
      });
    });
    return message.reply(reply);
  }

  // !esnipe — affiche avant / après du dernier message édité
  if (cmd === '!esnipe') {
    const data = editedMessages.get(message.channel.id);
    if (!data) {
      return message.reply("Aucune modification récente dans ce salon.");
    }
    return message.reply(
      `Dernière édition par **${data.authorTag}** :\n` +
      `Avant : ${escapeMentions(data.before)}\n` +
      `Après : ${escapeMentions(data.after)}`
    );
  }
});

client.login(process.env.BOT_TOKEN);