// Sistema de fala por texto (portado do TTS Bot em Rust).
// Uso: !voice <mensagem>   -> o bot entra na sua call e fala a mensagem.
//      !voicequit          -> o bot sai da call.
// O bot também sai sozinho quando não sobra nenhuma pessoa na call.

const { PassThrough } = require('stream');
const { PermissionFlagsBits } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  StreamType,
  NoSubscriberBehavior,
} = require('@discordjs/voice');
const googleTTS = require('google-tts-api');

// ---------- Configurações (pode mudar aqui) ----------
const IDIOMA = 'pt-BR';            // idioma da voz
const ANUNCIAR_NOME = true;        // fala "Fulano disse ..." quando muda quem está falando
const LIMITE_MENSAGEM = 1500;      // ignora mensagens maiores que isso (igual ao bot Rust)
const LIMITE_TEXTO = 400;          // máximo de caracteres falados por mensagem
const MAX_FILA = 10;               // máximo de mensagens esperando para falar

const REGEX_COMANDO = /^!voice(?:\s+([\s\S]*))?$/i;
const REGEX_SAIR = /^!voicequit$/i;

// Uma sessão por servidor: { connection, player, fila, tocando, ... }
const sessoes = new Map();

// ---------- Limpeza do texto (port do process_msg.rs) ----------

const SIGLAS = {
  vc: 'você',
  vcs: 'vocês',
  tb: 'também',
  tbm: 'também',
  pq: 'porque',
  blz: 'beleza',
  obg: 'obrigado',
  mt: 'muito',
  mto: 'muito',
  q: 'que',
  n: 'não',
  td: 'tudo',
  msm: 'mesmo',
  hj: 'hoje',
  sdds: 'saudades',
  flw: 'falou',
  vlw: 'valeu',
  pfv: 'por favor',
  pf: 'por favor',
  tmj: 'tamo junto',
  slc: 'sério',
  cmg: 'comigo',
  ctz: 'certeza',
  kd: 'cadê',
  qnd: 'quando',
  ngm: 'ninguém',
};

const REGEX_SIGLAS = new RegExp(
  `(?<![\\p{L}\\p{N}])(${Object.keys(SIGLAS).join('|')})(?![\\p{L}\\p{N}])`,
  'giu'
);

const REGEX_LINK = /https?:\/\/\S+|www\.\S+/gi;

function descreverAnexos(anexos) {
  if (anexos.size === 0) return null;
  if (anexos.size >= 2) return 'vários arquivos';

  const nome = anexos.first().name || '';
  const extensao = nome.split('.').pop().toLowerCase();

  if (['bmp', 'gif', 'ico', 'png', 'psd', 'svg', 'jpg', 'jpeg', 'webp'].includes(extensao)) return 'uma imagem';
  if (['mid', 'midi', 'mp3', 'ogg', 'wav', 'wma'].includes(extensao)) return 'um áudio';
  if (['avi', 'mp4', 'wmv', 'm4v', 'mpg', 'mpeg', 'mov', 'webm'].includes(extensao)) return 'um vídeo';
  if (['zip', '7z', 'rar', 'gz', 'xz'].includes(extensao)) return 'um arquivo compactado';
  if (['doc', 'docx', 'txt', 'odt', 'rtf', 'pdf'].includes(extensao)) return 'um documento';
  if (['bat', 'sh', 'jar', 'py', 'php', 'js'].includes(extensao)) return 'um arquivo de código';
  if (['apk', 'exe', 'msi', 'deb'].includes(extensao)) return 'um programa';
  if (['dmg', 'iso', 'img', 'ima'].includes(extensao)) return 'uma imagem de disco';
  return 'um arquivo';
}

function montarFrase(nome, texto, temLink, anexo) {
  const t = texto.trim();
  const extras = [];
  if (temLink) extras.push('um link');
  if (anexo) extras.push(anexo);
  const listaExtras = extras.join(' e ');

  if (nome) {
    if (!t && !listaExtras) return `${nome} enviou uma mensagem`;
    if (!t) return `${nome} enviou ${listaExtras}`;
    if (!listaExtras) return `${nome} disse: ${t}`;
    return `${nome} enviou ${listaExtras} e disse: ${t}`;
  }

  if (!t) return listaExtras;
  if (!listaExtras) return t;
  return `${t}, com ${listaExtras}`;
}

function limparTexto(textoOriginal, { nome, anexos }) {
  let t = textoOriginal.replace(/\u200b/g, '').toLowerCase();
  let temLink = false;

  if (t.trim() === '?') {
    t = 'o quê';
  } else {
    t = t.replace(/\|\|[\s\S]*?\|\|/g, '. spoiler evitado.');
    t = t.replace(/```[\s\S]*?```/g, '. bloco de código.');
    t = t.replace(/`[\s\S]*?`/g, '. trecho de código.');

    // Emoji personalizado do Discord: <:nome:id> vira "emoji nome".
    t = t.replace(/<(a?):([^<>]+):\d+>/g, (_, animado, nomeEmoji) =>
      `${animado ? 'emoji animado' : 'emoji'} ${nomeEmoji}`
    );

    // Emojis normais são removidos.
    t = t.replace(/\p{Emoji_Presentation}/gu, '');

    // Links são removidos (o bot só avisa que tinha um link).
    if (REGEX_LINK.test(t)) {
      temLink = true;
      t = t.replace(REGEX_LINK, ' ');
    }
    REGEX_LINK.lastIndex = 0;

    t = t.replace(REGEX_SIGLAS, (sigla) => SIGLAS[sigla.toLowerCase()]);
    t = t.replace(/:\)/g, ' carinha feliz ').replace(/:\(/g, ' carinha triste ');

    // "kkkk" vira "haha".
    t = t.replace(/(?<![\p{L}])k{3,}(?![\p{L}])/giu, 'haha');

    // Letras repetidas demais (aaaaaaa) ficam com no máximo 3.
    t = t.replace(/(.)\1{3,}/gu, '$1$1$1');
  }

  t = t.replace(/\s+/g, ' ').trim();

  return montarFrase(nome, t, temLink, descreverAnexos(anexos));
}

// ---------- Sessão de voz ----------

function encerrarSessao(sessao) {
  sessao.fila.length = 0;

  if (sessoes.get(sessao.guildId) === sessao) {
    sessoes.delete(sessao.guildId);
  }

  try {
    sessao.player.stop(true);
  } catch {
    // ignora
  }

  if (sessao.connection.state.status !== VoiceConnectionStatus.Destroyed) {
    sessao.connection.destroy();
  }
}

function criarSessao(guild, canal) {
  const connection = joinVoiceChannel({
    channelId: canal.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true,
  });

  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Play },
  });
  connection.subscribe(player);

  const sessao = {
    guildId: guild.id,
    canalId: canal.id,
    connection,
    player,
    fila: [],
    tocando: false,
    ultimoAutor: null,
    pronta: null,
  };

  player.on('error', (erro) => {
    console.error('[voice] Erro no player:', erro.message);
  });

  // Se o bot for desconectado/movido, tenta reconectar; se não der, encerra.
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      encerrarSessao(sessao);
    }
  });

  connection.on(VoiceConnectionStatus.Destroyed, () => {
    if (sessoes.get(sessao.guildId) === sessao) {
      sessoes.delete(sessao.guildId);
    }
  });

  sessao.pronta = entersState(connection, VoiceConnectionStatus.Ready, 20_000).then(
    () => undefined,
    (erro) => {
      encerrarSessao(sessao);
      throw erro;
    }
  );

  sessoes.set(guild.id, sessao);
  return sessao;
}

// ---------- Fila e reprodução ----------

function tocarBase64(player, base64) {
  return new Promise((resolve) => {
    const stream = new PassThrough();
    stream.end(Buffer.from(base64, 'base64'));

    const recurso = createAudioResource(stream, {
      inputType: StreamType.Arbitrary, // o ffmpeg converte o mp3
    });

    const limite = setTimeout(finalizar, 60_000);

    function aoMudar(_antigo, novo) {
      if (novo.status === AudioPlayerStatus.Idle) finalizar();
    }

    function finalizar() {
      clearTimeout(limite);
      player.off('stateChange', aoMudar);
      resolve();
    }

    player.on('stateChange', aoMudar);
    player.play(recurso);
  });
}

async function processarFila(sessao) {
  if (sessao.tocando) return;

  sessao.tocando = true;

  try {
    while (sessao.fila.length > 0 && sessoes.get(sessao.guildId) === sessao) {
      const texto = sessao.fila.shift();

      try {
        const partes = await googleTTS.getAllAudioBase64(texto, {
          lang: IDIOMA,
          slow: false,
          timeout: 15_000,
        });

        for (const parte of partes) {
          if (sessoes.get(sessao.guildId) !== sessao) break;
          await tocarBase64(sessao.player, parte.base64);
        }
      } catch (erro) {
        console.error('[voice] Falha ao gerar/tocar o áudio:', erro.message);
      }
    }
  } finally {
    sessao.tocando = false;
  }
}

// ---------- Comando !voice ----------

async function tratarComando(message, argumentos) {
  const semPing = { repliedUser: false };
  const responder = (texto) =>
    message.reply({ content: texto, allowedMentions: semPing });

  const guild = message.guild;
  const canalAutor = message.member?.voice?.channel;
  const textoPedido = (argumentos || '').trim();

  if (!canalAutor) {
    return responder(
      '🔇 Você precisa estar em um **canal de voz** para usar o `!voice`.'
    );
  }

  const sessaoAtual = sessoes.get(guild.id);
  const canalDoBot = guild.members.me?.voice?.channelId ?? sessaoAtual?.canalId;

  if (!textoPedido && message.attachments.size === 0) {
    return responder(
      'Use assim: `!voice sua mensagem aqui`\nPara eu sair da call: `!voicequit`'
    );
  }

  if (message.content.length >= LIMITE_MENSAGEM) {
    return responder('Mensagem muito grande para eu falar.');
  }

  if (sessaoAtual && canalDoBot && canalDoBot !== canalAutor.id) {
    return responder('Já estou em outra call. Entre nela ou espere eu sair.');
  }

  const permissoes = canalAutor.permissionsFor(guild.members.me);
  if (
    !permissoes?.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.Connect,
      PermissionFlagsBits.Speak,
    ])
  ) {
    return responder(
      'Eu não tenho permissão para **entrar e falar** nessa call. Confira as permissões do bot.'
    );
  }

  // Prepara o texto (tira o "!voice" do começo e limpa).
  const nome =
    message.member?.displayName ||
    message.author.globalName ||
    message.author.username;

  const sessao = sessaoAtual || criarSessao(guild, canalAutor);

  try {
    await sessao.pronta;
  } catch (erro) {
    console.error('[voice] Não consegui entrar na call:', erro.message);
    return responder('Não consegui entrar na call. Tente de novo em instantes.');
  }

  const anunciar = ANUNCIAR_NOME && sessao.ultimoAutor !== message.author.id;

  const textoCru = message.cleanContent.replace(/^\s*!voice\s*/i, '');
  const frase = limparTexto(textoCru, {
    nome: anunciar ? nome : null,
    anexos: message.attachments,
  });

  // Se só sobrou símbolo/pontuação, não fala nada.
  if (!/[\p{L}\p{N}]/u.test(frase)) return;

  if (sessao.fila.length >= MAX_FILA) {
    return responder('A fila de fala está cheia, espere um pouco.');
  }

  sessao.ultimoAutor = message.author.id;
  sessao.fila.push(frase.slice(0, LIMITE_TEXTO));

  message.react('🔊').catch(() => {});
  processarFila(sessao);
}

async function tratarSair(message) {
  const sessao = sessoes.get(message.guild.id);

  if (!sessao) {
    return message.reply({
      content: 'Eu não estou em nenhuma call.',
      allowedMentions: { repliedUser: false },
    });
  }

  const canalAutor = message.member?.voice?.channelId;
  const canalDoBot = message.guild.members.me?.voice?.channelId ?? sessao.canalId;

  if (canalAutor !== canalDoBot) {
    return message.reply({
      content: 'Você precisa estar na mesma call que eu para me mandar sair.',
      allowedMentions: { repliedUser: false },
    });
  }

  encerrarSessao(sessao);
  return message.react('👋').catch(() => {});
}

function iniciarFala(client) {
  // Sai sozinho quando não sobra nenhuma pessoa (só bots) na call.
  client.on('voiceStateUpdate', (antes) => {
    const guild = antes.guild;
    const sessao = sessoes.get(guild.id);
    if (!sessao) return;

    const canalDoBot = guild.members.me?.voice?.channel;
    if (!canalDoBot) return;

    const pessoas = canalDoBot.members.filter((m) => !m.user.bot).size;
    if (pessoas === 0) {
      encerrarSessao(sessao);
    }
  });

  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    if (REGEX_SAIR.test(message.content.trim())) {
      try {
        await tratarSair(message);
      } catch (erro) {
        console.error('Erro no !voicequit:', erro);
      }
      return;
    }

    const encontrado = message.content.trim().match(REGEX_COMANDO);
    if (!encontrado) return;

    try {
      await tratarComando(message, encontrado[1]);
    } catch (erro) {
      console.error('Erro no !voice:', erro);
    }
  });
}

module.exports = iniciarFala;