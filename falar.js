// Sistema de fala por texto (portado do TTS Bot em Rust).
//
// !voice            -> o bot entra na sua call. Depois disso, tudo que você
//                      escrever NESTE canal de texto ele fala na call.
// !voice <mensagem> -> o mesmo, e já fala a mensagem.
// !voicequit        -> o bot sai da call.
//
// O bot também sai sozinho quando não sobra nenhuma pessoa na call.

const { PassThrough } = require('stream');
const { PermissionFlagsBits } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  generateDependencyReport,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  StreamType,
  NoSubscriberBehavior,
} = require('@discordjs/voice');
const googleTTS = require('google-tts-api');

// ---------- Configurações (pode mudar aqui) ----------
const IDIOMA = 'pt';               // idioma da voz (português)
const ANUNCIAR_NOME = true;        // fala "Fulano disse ..." quando muda quem está falando
const LIMITE_MENSAGEM = 1500;      // ignora mensagens maiores que isso (igual ao bot Rust)
const LIMITE_TEXTO = 400;          // máximo de caracteres falados por mensagem
const MAX_FILA = 10;               // máximo de mensagens esperando para falar

const REGEX_COMANDO = /^!voice(?:\s+([\s\S]*))?$/i;
const REGEX_SAIR = /^!voicequit$/i;

// Uma sessão por servidor.
// sessao.usuarios: quem deu !voice -> id do canal de texto onde deu o comando.
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
  nn: 'não',
  s: 'sim',
  ss: 'sim',
  td: 'tudo',
  msm: 'mesmo',
  hj: 'hoje',
  sdds: 'saudades',
  sdd: 'saudade',
  flw: 'falou',
  vlw: 'valeu',
  pfv: 'por favor',
  pf: 'por favor',
  tmj: 'tamo junto',
  slc: 'se loco',
  slk: 'se loco',
  olc: 'oloco',
  olk: 'oloco',
  cmg: 'comigo',
  ctz: 'certeza',
  kd: 'cadê',
  qnd: 'quando',
  ngm: 'ninguém',
  sv: 'salve',
  fml: 'familia',
  cz: 'cuzão',
  pnc: 'pau no cu',
  tmnc: 'toma no cu',
  fdp: 'filho da puta',
  pt: 'vai toma no cu petista',
  cpk: 'cabeça de pika',
  interpol: 'interpol, a isa mandou um beijo na nadega esquerda',
  yuta: 'yuta o bumbum guloso',
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
    usuarios: new Map(),
    pronta: null,
  };

  // Logs para diagnóstico (aparecem no terminal).
  connection.on('stateChange', (antes, depois) => {
    console.log(`[voice] Conexão: ${antes.status} -> ${depois.status}`);
  });
  connection.on('error', (erro) => {
    console.error('[voice] Erro na conexão:', erro);
  });
  player.on('stateChange', (antes, depois) => {
    console.log(`[voice] Player: ${antes.status} -> ${depois.status}`);
  });
  player.on('error', (erro) => {
    console.error('[voice] Erro no player:', erro);
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
      const item = sessao.fila.shift();

      try {
        const partes = await googleTTS.getAllAudioBase64(item.texto, {
          lang: IDIOMA,
          slow: false,
          timeout: 15_000,
        });

        console.log(`[voice] Áudio gerado: ${partes.length} parte(s) para "${item.texto}"`);

        for (const parte of partes) {
          if (sessoes.get(sessao.guildId) !== sessao) break;
          await tocarBase64(sessao.player, parte.base64);
        }
      } catch (erro) {
        console.error('[voice] Falha ao gerar/tocar o áudio:', erro);
        item.message.react('⚠️').catch(() => {});
      }
    }
  } finally {
    sessao.tocando = false;
  }
}

function enfileirar(sessao, message, textoCru) {
  const nome =
    message.member?.displayName ||
    message.author.globalName ||
    message.author.username;

  const anunciar = ANUNCIAR_NOME && sessao.ultimoAutor !== message.author.id;

  const frase = limparTexto(textoCru, {
    nome: anunciar ? nome : null,
    anexos: message.attachments,
  });

  // Se só sobrou símbolo/pontuação, não fala nada.
  if (!/[\p{L}\p{N}]/u.test(frase)) return;

  if (sessao.fila.length >= MAX_FILA) {
    message.react('⏳').catch(() => {});
    return;
  }

  sessao.ultimoAutor = message.author.id;
  sessao.fila.push({ texto: frase.slice(0, LIMITE_TEXTO), message });
  processarFila(sessao);
}

// ---------- Comandos ----------

async function tratarVoice(message, argumentos) {
  const responder = (texto) =>
    message.reply({ content: texto, allowedMentions: { repliedUser: false } });

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

  const sessao = sessaoAtual || criarSessao(guild, canalAutor);

  try {
    await sessao.pronta;
  } catch (erro) {
    console.error('[voice] Não consegui entrar na call:', erro);
    return responder('Não consegui entrar na call. Tente de novo em instantes.');
  }

  const jaAtivo = sessao.usuarios.get(message.author.id) === message.channelId;
  sessao.usuarios.set(message.author.id, message.channelId);

  if (!jaAtivo) {
    await responder(
      '🔊 Entrei na call! A partir de agora eu falo o que você escrever **neste canal**.\nPara eu sair: `!voicequit`'
    );
  }

  // Se mandou texto junto com o comando, já fala.
  if (textoPedido || message.attachments.size > 0) {
    if (message.content.length >= LIMITE_MENSAGEM) return;
    const textoCru = message.cleanContent.replace(/^\s*!voice\s*/i, '');
    enfileirar(sessao, message, textoCru);
  }
}

async function tratarSair(message) {
  const responder = (texto) =>
    message.reply({ content: texto, allowedMentions: { repliedUser: false } });

  const sessao = sessoes.get(message.guild.id);

  if (!sessao) return responder('Eu não estou em nenhuma call.');

  const canalAutor = message.member?.voice?.channelId;
  const canalDoBot = message.guild.members.me?.voice?.channelId ?? sessao.canalId;

  if (canalAutor !== canalDoBot) {
    return responder('Você precisa estar na mesma call que eu para me mandar sair.');
  }

  encerrarSessao(sessao);
  return message.react('👋').catch(() => {});
}

// Mensagem normal (sem comando) de quem ativou o !voice.
function lerMensagemAutomatica(message) {
  const sessao = sessoes.get(message.guild.id);
  if (!sessao) return;

  // Só lê quem deu !voice, e só no canal de texto onde deu o comando.
  if (sessao.usuarios.get(message.author.id) !== message.channelId) return;

  // Só lê se a pessoa ainda está na mesma call que o bot.
  const canalDoBot = message.guild.members.me?.voice?.channelId ?? sessao.canalId;
  if (message.member?.voice?.channelId !== canalDoBot) return;

  // Ignora outros comandos (ex.: !transmitir) e mensagens enormes.
  if (message.content.startsWith('!')) return;
  if (message.content.length >= LIMITE_MENSAGEM) return;

  enfileirar(sessao, message, message.cleanContent);
}

function iniciarFala(client) {
  console.log('[voice] Relatório de dependências de voz:\n' + generateDependencyReport());

  client.on('voiceStateUpdate', (antes, depois) => {
    const guild = antes.guild;
    const sessao = sessoes.get(guild.id);
    if (!sessao) return;

    const canalDoBot = guild.members.me?.voice?.channel;
    if (!canalDoBot) return;

    // Quem saiu da call deixa de ser lido (precisa dar !voice de novo).
    if (antes.channelId === canalDoBot.id && depois.channelId !== canalDoBot.id) {
      sessao.usuarios.delete(antes.id);
    }

    // Sai sozinho quando não sobra nenhuma pessoa (só bots) na call.
    const pessoas = canalDoBot.members.filter((m) => !m.user.bot).size;
    if (pessoas === 0) {
      encerrarSessao(sessao);
    }
  });

  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    const conteudo = message.content.trim();

    try {
      if (REGEX_SAIR.test(conteudo)) {
        await tratarSair(message);
        return;
      }

      const encontrado = conteudo.match(REGEX_COMANDO);
      if (encontrado) {
        await tratarVoice(message, encontrado[1]);
        return;
      }

      lerMensagemAutomatica(message);
    } catch (erro) {
      console.error('[voice] Erro ao tratar mensagem:', erro);
    }
  });
}

module.exports = iniciarFala;