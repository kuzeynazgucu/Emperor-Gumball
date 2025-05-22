const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const { Client, GatewayIntentBits, Partials, EmbedBuilder, SlashCommandBuilder, Routes, REST } = require('discord.js');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.send('Bot is alive!'));
app.listen(3000, () => console.log('Web server running'));

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

const PREFIX = '!';
const warns = new Map();

const commands = [
  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a user temporarily')
    .addUserOption(opt => opt.setName('user').setDescription('User to warn').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('Reason').setRequired(false))
    .addStringOption(opt => opt.setName('duration').setDescription('Duration (e.g. 10s, 1m)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('warncheck')
    .setDescription('Check warnings of a user')
    .addUserOption(opt => opt.setName('user').setDescription('User to check').setRequired(true)),

  new SlashCommandBuilder().setName('help').setDescription('Show help'),
  new SlashCommandBuilder().setName('ping').setDescription('Ping latency info')
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('Slash commands registered.');
  } catch (err) {
    console.error(err);
  }
})();

function parseDuration(str) {
  const match = str.match(/^(\d+)(s|m|h)$/);
  if (!match) return 10000;
  const num = parseInt(match[1]);
  const unit = match[2];
  switch (unit) {
    case 's': return num * 1000;
    case 'm': return num * 60 * 1000;
    case 'h': return num * 60 * 60 * 1000;
    default: return 10000;
  }
}

function addWarn(userId, reason, durationMs, channel) {
  if (!warns.has(userId)) warns.set(userId, []);
  warns.get(userId).push(reason);

  setTimeout(() => {
    const userWarns = warns.get(userId);
    if (!userWarns) return;
    userWarns.shift();
    warns.set(userId, userWarns);
    if (channel) channel.send(`<@${userId}>'s warning has expired.`);
  }, durationMs);
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'warn') {
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const durationStr = interaction.options.getString('duration') || '10s';
    const ms = parseDuration(durationStr);

    addWarn(user.id, reason, ms, interaction.channel);

    const embed = new EmbedBuilder()
      .setTitle('User Warned')
      .addFields(
        { name: 'User', value: user.tag, inline: true },
        { name: 'Reason', value: reason, inline: true },
        { name: 'Duration', value: durationStr, inline: true }
      )
      .setColor(0xff0000);

    await interaction.reply({ embeds: [embed] });
  }

  else if (commandName === 'warncheck') {
    const user = interaction.options.getUser('user');
    const userWarns = warns.get(user.id) || [];
    const embed = new EmbedBuilder()
      .setTitle(`Warnings for ${user.tag}`)
      .setDescription(userWarns.length > 0 ? userWarns.join('\n') : 'No warnings')
      .setColor(0xffff00);

    await interaction.reply({ embeds: [embed] });
  }

  else if (commandName === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('Help')
      .setDescription('List of commands:')
      .addFields(
        { name: '/warn', value: 'Warn a user temporarily' },
        { name: '/warncheck', value: 'Check user warnings' },
        { name: '/ping', value: 'Ping bot latency' }
      )
      .setColor(0x00ffcc);
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  else if (commandName === 'ping') {
    const sent = await interaction.reply({ content: 'Pinging...', fetchReply: true });
    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    const apiPing = client.ws.ping;
    await interaction.editReply(`Pong! Latency: ${latency}ms | API: ${apiPing}ms`);
  }
});

client.on('messageCreate', async message => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;
  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();

  if (cmd === 'ping') {
    const sent = await message.reply('Pinging...');
    const latency = sent.createdTimestamp - message.createdTimestamp;
    const apiPing = client.ws.ping;
    sent.edit(`Pong! Latency: ${latency}ms | API: ${apiPing}ms`);
  }

  else if (cmd === 'warn') {
    const userMention = message.mentions.users.first();
    if (!userMention) return message.reply('Please mention a user.');

    let durationStr = '10s';
    let reasonStart = 0;
    if (args[0] && /^\d+[smh]$/.test(args[0])) {
      durationStr = args[0];
      reasonStart = 1;
    }
    const reason = args.slice(reasonStart).join(' ') || 'No reason provided';
    const ms = parseDuration(durationStr);

    addWarn(userMention.id, reason, ms, message.channel);

    const embed = new EmbedBuilder()
      .setTitle('User Warned')
      .addFields(
        { name: 'User', value: userMention.tag, inline: true },
        { name: 'Reason', value: reason, inline: true },
        { name: 'Duration', value: durationStr, inline: true }
      )
      .setColor(0xff9900);
    message.reply({ embeds: [embed] });
  }

  else if (cmd === 'warncheck') {
    const userMention = message.mentions.users.first();
    if (!userMention) return message.reply('Mention a user.');

    const userWarns = warns.get(userMention.id) || [];
    const embed = new EmbedBuilder()
      .setTitle(`Warnings for ${userMention.tag}`)
      .setDescription(userWarns.length > 0 ? userWarns.join('\n') : 'No warnings')
      .setColor(0xffff00);

    message.reply({ embeds: [embed] });
  }

  else if (cmd === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('Bot Commands')
      .addFields(
        { name: '!warn', value: 'Warn a user (e.g. !warn @user 10s reason)' },
        { name: '!warncheck', value: 'Check user warnings' },
        { name: '!ping', value: 'Show latency' }
      )
      .setColor(0x00ffcc);
    message.reply({ embeds: [embed] });
  }
});

client.once('ready', () => {
  console.log(`${client.user.tag} is online!`);
});

client.login(TOKEN);
