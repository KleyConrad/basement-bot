
const fs = require('node:fs');
const path = require('node:path');

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');

const { ID_SERVIDOR, CALLS_TEMPO } = require('./config');

const ARQUIVO_DADOS = path.join(__dirname, 'tempos.json');
const CALLS_PERMITIDAS = new Set(CALLS_TEMPO);
const POR_PAGINA = 7;

let tempos = {};
let membrosCarregados = false;

// id do membro -> momento em que a contagem atual começou.
// Só existe sessão enquanto o membro está contando tempo.
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

// Regra de contagem: o membro precisa estar em uma das calls
// liberadas e sem estar mutado nem ensurdecido (por ele ou por um moderador).
function deveContar(estado) {
  if (!estado || !estado.channelId) return false;
  if (!CALLS_PERMITIDAS.has(estado.channelId)) return false;
  if (estado.mute || estado.deaf) return false;

  return true;
}

// Compara o estado atual com a sessão e inicia/encerra a contagem.
function atualizarSessao(estado) {
  const id = estado.id;
  const contando = sessoes.has(id);
  const deve = deveContar(estado);

  if (deve && !contando) {
    garantirMembro(id);
    sessoes.set(id, Date.now());
    salvarTempos();
    return;
  }

  if (!deve && contando) {
    registrarTempo(id, sessoes.get(id));
    sessoes.delete(id);
    salvarTempos();
  }
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

function obterRanking(guild) {
  // Esconde quem já saiu do servidor (o tempo continua salvo no arquivo).
  const filtrarSaidos = membrosCarregados && guild;

  return Object.entries(tempos)
    .filter(
      ([id]) => !filtrarSaidos || guild.members.cache.has(id)
    )
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

function totalPaginasDe(ranking) {
  return Math.max(1, Math.ceil(ranking.length / POR_PAGINA));
}

function criarEmbed(ranking, pagina) {
  const totalPaginas = totalPaginasDe(ranking);

  const inicio = pagina * POR_PAGINA;
  const membros = ranking.slice(inicio, inicio + POR_PAGINA);

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

function montarPrimeiraPagina(guild) {
  const ranking = obterRanking(guild);

  return {
    embeds: [criarEmbed(ranking, 0)],
    components: [criarBotoes(0, totalPaginasDe(ranking))],
  };
}

function resetarRanking() {
  for (const id of Object.keys(tempos)) {
    tempos[id].totalMs = 0;
  }

  const agora = Date.now();

  for (const id of sessoes.keys()) {
    sessoes.set(id, agora);
  }

  salvarTempos();
}

module.exports = function iniciarTempoCall(client) {
  carregarTempos();

  // Identifica quem já está em call (liberada e sem mute) quando o bot inicia.
  client.once('clientReady', async () => {
    const guild = client.guilds.cache.get(ID_SERVIDOR);

    if (!guild) {
      console.error('Servidor Basement não encontrado.');
      return;
    }

    // Carrega todos os membros para o ranking poder esconder quem saiu.
    try {
      await guild.members.fetch();
      membrosCarregados = true;
    } catch (error) {
      console.error(
        'Não consegui carregar a lista de membros:',
        error.message
      );
    }

    const agora = Date.now();
    let quantidade = 0;

    for (const estado of guild.voiceStates.cache.values()) {
      const usuario =
        estado.member?.user || client.users.cache.get(estado.id);

      if (usuario?.bot) continue;
      if (!deveContar(estado)) continue;
      if (sessoes.has(estado.id)) continue;

      garantirMembro(estado.id);
      sessoes.set(estado.id, agora);
      quantidade++;
    }

    salvarTempos();

    console.log(
      `BASEMENT: ${quantidade} pessoa(s) contando tempo em call.`
    );
  });

  // Entrada, saída, troca de canal, mute/desmute e ensurdecer.
  client.on('voiceStateUpdate', (anterior, atual) => {
    if (atual.guild.id !== ID_SERVIDOR) return;

    const usuario =
      atual.member?.user ||
      client.users.cache.get(atual.id);

    if (usuario?.bot) return;

    atualizarSessao(atual);
  });

  // A cada minuto: salva o tempo acumulado e confere se ainda deve contar.
  const intervaloSalvamento = setInterval(() => {
    const guild = client.guilds.cache.get(ID_SERVIDOR);
    const agora = Date.now();

    for (const [id, inicio] of sessoes.entries()) {
      registrarTempo(id, inicio);

      const estado = guild?.voiceStates.cache.get(id);

      if (guild && !deveContar(estado)) {
        sessoes.delete(id);
      } else {
        sessoes.set(id, agora);
      }
    }

    salvarTempos();
  }, 60_000);

  // Comandos de texto !tempo e !resettempo (mantidos).
  client.on('messageCreate', async (message) => {
    if (message.author.bot || message.guildId !== ID_SERVIDOR) {
      return;
    }

    const comando = message.content.trim();

    if (comando === '!tempo') {
      await message.reply(montarPrimeiraPagina(message.guild));
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

      resetarRanking();

      await message.reply(
        'O ranking de tempo em call foi resetado!'
      );
    }
  });

  // Slash commands /tempo e /resettempo + botões de paginação.
  client.on('interactionCreate', async (interaction) => {
    if (interaction.guildId !== ID_SERVIDOR) return;

    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'tempo') {
        await interaction.reply(
          montarPrimeiraPagina(interaction.guild)
        );
        return;
      }

      if (interaction.commandName === 'resettempo') {
        if (
          !interaction.memberPermissions?.has(
            PermissionFlagsBits.Administrator
          )
        ) {
          await interaction.reply({
            content:
              'Você precisa ser administrador para resetar o ranking.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        resetarRanking();

        await interaction.reply(
          'O ranking de tempo em call foi resetado!'
        );
      }

      return;
    }

    if (!interaction.isButton()) return;

    const match = interaction.customId.match(
      /^tempo_(anterior|proximo)_(\d+)$/
    );

    if (!match) return;

    const paginaAtual = Number(match[2]);

    const paginaSolicitada =
      match[1] === 'proximo'
        ? paginaAtual + 1
        : paginaAtual - 1;

    const ranking = obterRanking(interaction.guild);
    const totalPaginas = totalPaginasDe(ranking);

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
    for (const [id, inicio] of sessoes.entries()) {
      registrarTempo(id, inicio);
    }

    sessoes.clear();
    salvarTempos();
    clearInterval(intervaloSalvamento);
    client.destroy();
    process.exit(0);
  }

  process.once('SIGINT', encerrar);
  process.once('SIGTERM', encerrar);
};
