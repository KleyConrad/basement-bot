require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');

const { ID_SERVIDOR, NOME_CANAL_REGRAS } = require('./config');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  // Permite receber eventos de mensagens/membros que não estavam no cache.
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.GuildMember,
  ],
});

// Sistema de tempo em call.
const iniciarTempoCall = require('./tempo-call');
iniciarTempoCall(client);

// Sistema automático de logs.
const iniciarLogs = require('./logs');
iniciarLogs(client, ID_SERVIDOR);

// Comando !transmitir.
const iniciarTransmissao = require('./transmissao');
iniciarTransmissao(client);

// Site Basement Screen Share.
const iniciarWeb = require('./web');
iniciarWeb(client);

client.once('clientReady', () => {
  console.log(`BASEMENT online como ${client.user.tag}!`);
});

// Comando /publicar-regras
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'publicar-regras') return;

  if (interaction.guildId !== ID_SERVIDOR) {
    return interaction.reply({
      content: 'Este comando só pode ser usado no Basement.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!interaction.memberPermissions?.has(
    PermissionFlagsBits.Administrator
  )) {
    return interaction.reply({
      content: 'Você precisa ser administrador para usar este comando.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const canais = await interaction.guild.channels.fetch();

    const canal = canais.find(
      (c) => c && c.name === NOME_CANAL_REGRAS && c.isTextBased()
    );

    if (!canal) {
      return interaction.editReply(
        `Não encontrei o canal "${NOME_CANAL_REGRAS}". Confira o nome dele.`
      );
    }

    const regras = new EmbedBuilder()
      .setColor('#008CFF')
      .setTitle('Regras do Basement')
      .setDescription([
        'Seja bem-vindo ao **Basement**!',
        'Leia as regras antes de participar da comunidade.',
        '',
        '**01 · Respeito**',
        'Trate todos com respeito. Assédio, perseguição e discriminação não serão tolerados.',
        '',
        '**02 · Sem spam**',
        'Evite flood, mensagens repetidas e marcações desnecessárias.',
        '',
        '**03 · Conteúdo permitido**',
        'Não publique conteúdo ilegal ou material que viole as regras do Discord.',
      ].join('\n'))
      .setFooter({ text: 'BASEMENT' })
      .setTimestamp();

    await canal.send({ embeds: [regras] });

    await interaction.editReply(
      `Regras publicadas com sucesso em <#${canal.id}>!`
    );
  } catch (error) {
    console.error('Erro ao publicar regras:', error);

    await interaction.editReply(
      'Não consegui publicar as regras. Confira as permissões do bot e o terminal.'
    );
  }
});

// Verifica se o token foi configurado.
if (!process.env.DISCORD_TOKEN) {
  throw new Error(
    'DISCORD_TOKEN não foi configurado no arquivo .env.'
  );
}

// Inicia o bot.
client.login(process.env.DISCORD_TOKEN);