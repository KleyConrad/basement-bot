
const fs = require('node:fs');
const path = require('node:path');

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} = require('discord.js');

const ARQUIVO_DADOS = path.join(__dirname, 'tempos.json');
const ID_SERVIDOR = '1546332841766420490';

let tempos = {};
const sessoes = new Map();

function carregarTempos() {
  try {
    const dados = JSON.parse(
      fs.readFileSync(ARQUIVO_DADOS, 'utf8')
    );

    tempos =
      dados && typeof dados === 'object' && !Array.isArray(dados)
        ? dados
        : {};
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Erro ao ler tempos.json:', error);
    }

    tempos = {};
    salvarTempos();
  }
}

function salvarTempos() {
  try {
    fs.writeFileSync(
      ARQUIVO_DADOS,
      JSON.stringify(tempos, null, 2),
      'utf8'
    );
  } catch (error) {
    console.error('Erro ao salvar tempos.json:', error);
  }
}

function garantirMembro(id) {
  if (!tempos[id] || typeof tempos[id] !== 'object') {
    tempos[id] = { totalMs: 0 };
  }

  if (!Number.isFinite(tempos[id].totalMs)) {
    tempos[id].totalMs = 0;
  }
}

function registrarTempo(id, inicio) {
  garantirMembro(id);

  tempos[id].totalMs += Math.max(0, Date.now() - inicio);
}

function formatarTempo(ms) {
  const minutosTotais = Math.floor(ms / 60000);
  const dias = Math.floor(minutosTotais / 1440);
  const horas = Math.floor((minutosTotais % 1440) / 60);
  const minutos = minutosTotais % 60;

  if (dias > 0) return `${dias}d ${horas}h ${minutos}min`;
  if (horas > 0) return `${horas}h ${minutos}min`;

  return `${minutos}min`;
}

function obterRanking() {
  return Object.entries(tempos)
    .map(([id, dados]) => {
      const inicio = sessoes.get(id);

      const tempoAtual =
        inicio !== undefined
          ? Math.max(0, Date.now() - inicio)
          : 0;

      return {
        id,
        totalMs:
          Math.max(0, Number(dados.totalMs) || 0) + tempoAtual,
      };
    })
    .sort((a, b) => b.totalMs - a.totalMs);
}

function criarEmbed(ranking, pagina) {
  const porPagina = 7;
  const totalPaginas = Math.max(
    1,
    Math.ceil(ranking.length / porPagina)
  );

  const inicio = pagina * porPagina;
  const membros = ranking.slice(inicio, inicio + porPagina);

  const descricao = membros.length
    ? membros
        .map((membro, indice) => {
          const numero = inicio + indice + 1;
          const usuario = `<@${membro.id}>`;
          const tempo = formatarTempo(membro.totalMs);

          return `**${numero}.** ${usuario} — **${tempo}**`;
        })
        .join('\n')
    : 'Ainda não há tempos registrados.';

  return new EmbedBuilder()
    .setColor('#008CFF')
    .setTitle('⏱️ Ranking de tempo em call')
    .setDescription(descricao)
    .setFooter({
      text: `Página ${pagina + 1} de ${totalPaginas} • Basement`,
    })
    .setTimestamp();
}

function criarBotoes(pagina, totalPaginas) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`tempo_anterior_${pagina}`)
      .setLabel('Anterior')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pagina <= 0),

    new ButtonBuilder()
      .setCustomId(`tempo_proximo_${pagina}`)
      .setLabel('Próxima')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(pagina >= totalPaginas - 1)
  );
}

module.exports = function iniciarTempoCall(client) {
  carregarTempos();

  // Identifica quem já está em call quando o bot inicia.
  client.once('clientReady', () => {
    const guild = client.guilds.cache.get(ID_SERVIDOR);

    if (!guild) {
      console.error('Servidor Basement não encontrado.');
      return;
    }

    const agora = Date.now();
    let quantidade = 0;

    for (const estado of guild.voiceStates.cache.values()) {
      if (!estado.channelId) continue;

      const membro =
        estado.member || guild.members.cache.get(estado.id);

      const usuario =
        membro?.user || client.users.cache.get(estado.id);

      if (usuario?.bot) continue;

      garantirMembro(estado.id);
      sessoes.set(estado.id, agora);
      quantidade++;
    }

    salvarTempos();

    console.log(
      `BASEMENT: ${quantidade} pessoa(s) em call identificada(s).`
    );
  });

  // Registra entradas, saídas e mudanças de canal.
  client.on('voiceStateUpdate', (anterior, atual) => {
    if (atual.guild.id !== ID_SERVIDOR) return;

    const membro =
      atual.member || atual.guild.members.cache.get(atual.id);

    const usuario =
      membro?.user || client.users.cache.get(atual.id);

    if (usuario?.bot) return;

    const id = atual.id;

    // Entrou em uma call.
    if (!anterior.channelId && atual.channelId) {
      garantirMembro(id);

      if (!sessoes.has(id)) {
        sessoes.set(id, Date.now());
      }

      salvarTempos();
      return;
    }

    // Saiu de uma call.
    if (anterior.channelId && !atual.channelId) {
      const inicio = sessoes.get(id);

      if (inicio !== undefined) {
        registrarTempo(id, inicio);
        sessoes.delete(id);
        salvarTempos();
      }

      return;
    }

    // Trocar de canal não interrompe a sessão.
  });

  // Salva o tempo acumulado a cada minuto.
  const intervaloSalvamento = setInterval(() => {
    const agora = Date.now();

    for (const [id, inicio] of sessoes.entries()) {
      registrarTempo(id, inicio);
      sessoes.set(id, agora);
    }

    salvarTempos();
  }, 60_000);

  // Comandos !tempo e !resettempo.
  client.on('messageCreate', async (message) => {
    if (message.author.bot || message.guildId !== ID_SERVIDOR) {
      return;
    }

    const comando = message.content.trim();

    if (comando === '!tempo') {
      const ranking = obterRanking();

      await message.reply({
        embeds: [criarEmbed(ranking, 0)],
        components: [
          criarBotoes(
            0,
            Math.max(1, Math.ceil(ranking.length / 7))
          ),
        ],
      });

      return;
    }

    if (comando === '!resettempo') {
      if (
        !message.member?.permissions.has(
          PermissionFlagsBits.Administrator
        )
      ) {
        await message.reply(
          'Você precisa ser administrador para resetar o ranking.'
        );
        return;
      }

      for (const id of Object.keys(tempos)) {
        tempos[id].totalMs = 0;
      }

      const agora = Date.now();

      for (const id of sessoes.keys()) {
        sessoes.set(id, agora);
      }

      salvarTempos();

      await message.reply(
        'O ranking de tempo em call foi resetado!'
      );
    }
  });

  // Botões de paginação.
  client.on('interactionCreate', async (interaction) => {
    if (
      !interaction.isButton() ||
      interaction.guildId !== ID_SERVIDOR
    ) {
      return;
    }

    const match = interaction.customId.match(
      /^tempo_(anterior|proximo)_(\d+)$/
    );

    if (!match) return;

    const paginaAtual = Number(match[2]);

    const paginaSolicitada =
      match[1] === 'proximo'
        ? paginaAtual + 1
        : paginaAtual - 1;

    const ranking = obterRanking();
    const totalPaginas = Math.max(
      1,
      Math.ceil(ranking.length / 7)
    );

    const pagina = Math.max(
      0,
      Math.min(paginaSolicitada, totalPaginas - 1)
    );

    await interaction.update({
      embeds: [criarEmbed(ranking, pagina)],
      components: [criarBotoes(pagina, totalPaginas)],
    });
  });

  // Salva os tempos ao encerrar o bot.
  function encerrar() {
    const agora = Date.now();

    for (const [id, inicio] of sessoes.entries()) {
      registrarTempo(id, inicio);
      sessoes.set(id, agora);
    }

    salvarTempos();
    clearInterval(intervaloSalvamento);
    client.destroy();
    process.exit(0);
  }

  process.once('SIGINT', encerrar);
  process.once('SIGTERM', encerrar);
};
