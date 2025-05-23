require('dotenv').config();
const { 
  Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, PermissionsBitField, EmbedBuilder, 
  Collection
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent, 
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

// Storage (in-memory)
const warns = new Map();       // userId => [{ reason, expiresAt }]
const balances = new Map();    // userId => number
const dailyCooldown = new Map();// userId => timestamp
const prefixes = new Map();    // guildId => prefix

const DEFAULT_PREFIX = '!';

// --- Helper Functions ---

function parseDuration(str) {
  if (!str) return 10_000;
  const match = str.match(/^(\d+)(s|m|h|d|mo)$/);
  if (!match) return 10_000;
  const num = parseInt(match[1]);
  switch (match[2]) {
    case 's': return num * 1000;
    case 'm': return num * 60 * 1000;
    case 'h': return num * 60 * 60 * 1000;
    case 'd': return num * 24 * 60 * 60 * 1000;
    case 'mo': return num * 30 * 24 * 60 * 60 * 1000;
    default: return 10_000;
  }
}

function addWarn(userId, reason, durationMs) {
  if (!warns.has(userId)) warns.set(userId, []);
  const expiresAt = Date.now() + durationMs;
  warns.get(userId).push({ reason, expiresAt });
  // Automatically clear expired warns later
  setTimeout(() => {
    const userWarns = warns.get(userId) || [];
    const filtered = userWarns.filter(w => w.expiresAt > Date.now());
    warns.set(userId, filtered);
  }, durationMs);
}

function deleteWarn(userId) {
  warns.delete(userId);
}

function getPrefix(guildId) {
  return prefixes.get(guildId) || DEFAULT_PREFIX;
}

async function isMod(member) {
  if (!member) return false;
  return member.permissions.has(PermissionsBitField.Flags.ManageMessages);
}

// --- Commands Definition ---

const commands = [
  new SlashCommandBuilder().setName('warn').setDescription('Warn a user')
    .addUserOption(opt => opt.setName('user').setDescription('User to warn').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('Reason'))
    .addStringOption(opt => opt.setName('duration').setDescription('Duration (10s, 1m, 1h, 1d)')),

  new SlashCommandBuilder().setName('warncheck').setDescription('Check warnings for a user')
    .addUserOption(opt => opt.setName('user').setDescription('User to check').setRequired(true)),

  new SlashCommandBuilder().setName('warndelete').setDescription('Delete all warnings for a user')
    .addUserOption(opt => opt.setName('user').setDescription('User to clear warnings').setRequired(true)),

  new SlashCommandBuilder().setName('kick').setDescription('Kick a user')
    .addUserOption(opt => opt.setName('user').setDescription('User to kick').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('Reason')),

  new SlashCommandBuilder().setName('ban').setDescription('Ban a user')
    .addUserOption(opt => opt.setName('user').setDescription('User to ban').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('Reason')),

  new SlashCommandBuilder().setName('timeout').setDescription('Timeout a user')
    .addUserOption(opt => opt.setName('user').setDescription('User to timeout').setRequired(true))
    .addStringOption(opt => opt.setName('duration').setDescription('Duration').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('Reason')),

  new SlashCommandBuilder().setName('cf').setDescription('Coin flip')
    .addStringOption(opt => opt.setName('side').setDescription('h or t').setRequired(true))
    .addIntegerOption(opt => opt.setName('bet').setDescription('Bet amount').setRequired(true)),

  new SlashCommandBuilder().setName('daily').setDescription('Claim daily reward'),

  new SlashCommandBuilder().setName('bank').setDescription('Check your balance'),

  new SlashCommandBuilder().setName('prefix').setDescription('Set a new prefix')
    .addStringOption(opt => opt.setName('newprefix').setDescription('New prefix').setRequired(true)),

  new SlashCommandBuilder().setName('ping').setDescription('Bot latency'),

  new SlashCommandBuilder().setName('help').setDescription('List all commands'),

  new SlashCommandBuilder().setName('pin').setDescription('Pin a message')
    .addStringOption(opt => opt.setName('messageid').setDescription('ID of the message').setRequired(true))
].map(c => c.toJSON());

// --- Register slash commands ---

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log('🔁 Registering slash commands...');
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('✅ Slash commands registered.');
  } catch (e) {
    console.error('❌ Error registering commands:', e);
  }
})();

// --- Event Handlers ---

client.on('ready', () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

// Slash commands handler
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const cmd = interaction.commandName;
  const user = interaction.options.getUser('user');
  const member = user ? await interaction.guild.members.fetch(user.id).catch(() => null) : null;

  try {
    if (cmd === 'warn') {
      if (!(await isMod(interaction.member))) return interaction.reply('❌ You need Manage Messages permission.');
      const reason = interaction.options.getString('reason') || 'No reason';
      const durationStr = interaction.options.getString('duration') || '10s';
      const durationMs = parseDuration(durationStr);
      addWarn(user.id, reason, durationMs);
      interaction.reply(`⚠️ ${user.tag} has been warned. Reason: ${reason}, Duration: ${durationStr}`);
    } 
    
    else if (cmd === 'warncheck') {
      if (!(await isMod(interaction.member))) return interaction.reply('❌ You need Manage Messages permission.');
      const userWarns = warns.get(user.id) || [];
      const active = userWarns.filter(w => w.expiresAt > Date.now());
      const response = active.length === 0 ? 'No active warnings.' :
        active.map((w, i) => `${i + 1}. ${w.reason} (${Math.round((w.expiresAt - Date.now()) / 1000)}s left)`).join('\n');
      interaction.reply(`⚠️ Warnings for ${user.tag}:\n${response}`);
    } 
    
    else if (cmd === 'warndelete') {
      if (!(await isMod(interaction.member))) return interaction.reply('❌ You need Manage Messages permission.');
      deleteWarn(user.id);
      interaction.reply(`🗑️ Cleared all warnings for ${user.tag}`);
    }
    
    else if (cmd === 'kick') {
      if (!(await isMod(interaction.member))) return interaction.reply('❌ You need Manage Messages permission.');
      if (!member || !member.kickable) return interaction.reply('❌ Cannot kick this user.');
      const reason = interaction.options.getString('reason') || 'No reason';
      await member.kick(reason);
      interaction.reply(`👢 ${user.tag} was kicked. Reason: ${reason}`);
    }
    
    else if (cmd === 'ban') {
      if (!(await isMod(interaction.member))) return interaction.reply('❌ You need Manage Messages permission.');
      if (!member || !member.bannable) return interaction.reply('❌ Cannot ban this user.');
      const reason = interaction.options.getString('reason') || 'No reason';
      await member.ban({ reason });
      interaction.reply(`🔨 ${user.tag} was banned. Reason: ${reason}`);
    }
    
    else if (cmd === 'timeout') {
      if (!(await isMod(interaction.member))) return interaction.reply('❌ You need Manage Messages permission.');
      const reason = interaction.options.getString('reason') || 'No reason';
      const duration = parseDuration(interaction.options.getString('duration'));
      if (!member || !member.moderatable) return interaction.reply('❌ Cannot timeout this user.');
      await member.timeout(duration, reason);
      interaction.reply(`⏱️ ${user.tag} was timed out. Reason: ${reason}`);
    }
    
    else if (cmd === 'cf') {
      const bet = interaction.options.getInteger('bet');
      const side = interaction.options.getString('side').toLowerCase();
      const balance = balances.get(interaction.user.id) || 0;
  
      if (balance < bet) return interaction.reply('💰 Insufficient balance.');
      if (!['h','t'].includes(side)) return interaction.reply('❌ Side must be "h" or "t".');
  
      const win = Math.random() < 0.5;
      const result = win ? side : (side === 'h' ? 't' : 'h');
  
      balances.set(interaction.user.id, balance + (win ? bet : -bet));
      interaction.reply(`🎲 Coin landed on **${result.toUpperCase()}**. You ${win ? 'won' : 'lost'}! Balance: ${balances.get(interaction.user.id)}`);
    }
    
    else if (cmd === 'daily') {
      const now = Date.now();
      const last = dailyCooldown.get(interaction.user.id) || 0;
      if (now - last < 86400000) return interaction.reply('🕒 Try again later.');
      const balance = (balances.get(interaction.user.id) || 0) + 1000;
      balances.set(interaction.user.id, balance);
      dailyCooldown.set(interaction.user.id, now);
      interaction.reply(`💸 You received 1000 coins. Balance: ${balance}`);
    }
    
    else if (cmd === 'bank') {
      interaction.reply(`💳 Balance: ${balances.get(interaction.user.id) || 0}`);
    }
    
    else if (cmd === 'prefix') {
      if (!(await isMod(interaction.member))) return interaction.reply('❌ You need Manage Messages permission.');
      const newPrefix = interaction.options.getString('newprefix');
      prefixes.set(interaction.guild.id, newPrefix);
      interaction.reply(`✅ Prefix updated to: \`${newPrefix}\``);
    }
    
    else if (cmd === 'ping') {
      const sent = await interaction.reply({ content: '🏓 Pinging...', fetchReply: true });
      interaction.editReply(`🏓 Pong! Latency: ${sent.createdTimestamp - interaction.createdTimestamp}ms`);
    }
    
    else if (cmd === 'help') {
      const embed = new EmbedBuilder()
        .setTitle('📜 Command List')
        .addFields(
          { name: 'Moderation', value: '`/warn`, `/warncheck`, `/warndelete`, `/kick`, `/ban`, `/timeout`' },
          { name: 'Economy', value: '`/cf`, `/daily`, `/bank`' },
          { name: 'Utility', value: '`/prefix`, `/ping`, `/help`, `/pin`' }
        )
        .setColor('#00AAFF');
      interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    else if (cmd === 'pin') {
      const msgId = interaction.options.getString('messageid');
      const msg = await interaction.channel.messages.fetch(msgId).catch(() => null);
      if (!msg) return interaction.reply('❌ Message not found.');
      await msg.pin();
      interaction.reply('📌 Message pinned.');
    }

  } catch (err) {
    console.error('Error processing slash command:', err);
    if (!interaction.replied) interaction.reply('❌ An error occurred.');
  }
});

// Prefix commands handler
client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  const prefix = getPrefix(message.guild.id);
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();

  // Check permissions helper
  const member = message.member;
  if (!member) return;

  // Permission check for mod commands
  const modCmds = ['warn', 'warncheck', 'warndelete', 'kick', 'ban', 'timeout', 'prefix'];
  const needsMod = modCmds.includes(cmd);
  if (needsMod && !member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
    return message.reply('❌ You need Manage Messages permission.');
  }

  try {
    if (cmd === 'warn') {
      const user = message.mentions.users.first();
      if (!user) return message.reply('❌ Mention a user to warn.');
      const reason = args.slice(1).join(' ') || 'No reason';
      const durationStr = args[0] || '10s';
      const durationMs = parseDuration(durationStr);
      addWarn(user.id, reason, durationMs);
      return message.reply(`⚠️ ${user.tag} has been warned. Reason: ${reason}, Duration: ${durationStr}`);
    }

    else if (cmd === 'warncheck') {
      const user = message.mentions.users.first();
      if (!user) return message.reply('❌ Mention a user.');
      const userWarns = warns.get(user.id) || [];
      const active = userWarns.filter(w => w.expiresAt > Date.now());
      const response = active.length === 0 ? 'No active warnings.' :
        active.map((w, i) => `${i + 1}. ${w.reason} (${Math.round((w.expiresAt - Date.now()) / 1000)}s left)`).join('\n');
      return message.reply(`⚠️ Warnings for