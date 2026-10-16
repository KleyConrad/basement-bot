const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

const COR = '#008CFF'; // mesma borda azul do !tempo

function embedSemCall() {
  return new EmbedBuilder()
    .setColor(COR)
    .setTitle('📡 Transmissão da tela')
    .setDescription(
      [
        'Você precisa estar em um **canal de voz** para transmitir.',
        '',
        'Entre em uma call e envie `!transmitir` novamente.',
      ].join('\n')
    )
    .setFooter({ text: 'Basement' })
    .setTimestamp();
}

function embedTransmissao(canal, link) {
  return new EmbedBuilder()
    .setColor(COR)
    .setTitle('📡 Transmissão da tela')
    .setDescription(
      [
        `Sua sala está pronta em **${canal.name}**.`,
        '',
        '**Como entrar**',
        '1. Clique no botão **Abrir transmissão**.',
        '2. Entre com sua conta do Discord.',
        '3. Permaneça na call para continuar conectado.',
      ].join('\n')
    )
    .addFields({ name: '🔊 Canal de voz', value: canal.name, inline: true })
    .setFooter({ text: 'Basement' })
    .setTimestamp();
}

function botaoLink(link) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Abrir transmissão')
      .setStyle(ButtonStyle.Link)
      .setURL(link)
  );
}

function iniciarTransmissao(client) {
  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.guild) return; // funciona em qualquer servidor onde o bot esteja
    if (message.content.trim().toLowerCase() !== '!transmitir') return;

    try {
      const canal = message.member?.voice?.channel;
      const semPingNaResposta = { repliedUser: false };

      if (!canal) {
        return await message.reply({
          embeds: [embedSemCall()],
          allowedMentions: semPingNaResposta,
        });
      }

      const porta = process.env.PORT || 3000;
      const link = (
        process.env.BASE_URL || `http://localhost:${porta}`
      ).replace(/\/$/, '');

      const embed = embedTransmissao(canal, link);

      try {
        await message.reply({
          embeds: [embed],
          components: [botaoLink(link)],
          allowedMentions: semPingNaResposta,
        });
      } catch (erroBotao) {
        // Se o Discord recusar o botão (ex.: link inválido), envia o link no texto.
        console.warn('Botão de link recusado, enviando link no texto:', erroBotao.message);
        embed.setDescription(`${embed.data.description}\n\n🔗 <${link}>`);
        await message.reply({
          embeds: [embed],
          allowedMentions: semPingNaResposta,
        });
      }
    } catch (erro) {
      console.error('Erro no !transmitir:', erro);
    }
  });
}

module.exports = iniciarTransmissao;