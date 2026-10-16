const $ = (id) => document.getElementById(id);

const el = {
  telaLogin: $('telaLogin'),
  telaSemCall: $('telaSemCall'),
  telaApp: $('telaApp'),
  loginAviso: $('loginAviso'),
  semCallMsg: $('semCallMsg'),
  btnRecarregar: $('btnRecarregar'),
  usuarioNome: $('usuarioNome'),
  canalNome: $('canalNome'),
  ponto: $('ponto'),
  status: $('status'),
  palco: $('palco'),
  palcoTexto: $('palcoTexto'),
  palcoTitulo: $('palcoTitulo'),
  palcoSub: $('palcoSub'),
  transmissor: $('transmissor'),
  lista: $('lista'),
  listaContagem: $('listaContagem'),
  erro: $('erro'),
  btnCamera: $('btnCamera'),
  btnTela: $('btnTela'),
  btnParar: $('btnParar'),
  btnSala: $('btnSala'),
  perfilTela: $('perfilTela'),
};

const estado = {
  usuario: null,
  servidorOnline: false, // conexão com o servidor do site
  midia: 'offline',      // sala de vídeo: offline | conectando | online | erro
  ocupado: false,        // true enquanto o navegador pede permissão
  espectador: false,     // mantém a lista, mas não recebe nem publica vídeo
};

const tilesOcultos = new Set();

// Cliente do LiveKit (carregado pelo index.html).
const LK = typeof LivekitClient !== 'undefined' ? LivekitClient : null;

let sala = null;          // a sala de vídeo atual
const tiles = new Map();  // quadros de vídeo na tela

// Celulares normalmente não permitem compartilhar tela.
const telaSuportada = !!navigator.mediaDevices?.getDisplayMedia;

// Perfis de compartilhamento. A qualidade real também depende do PC e da conexão.
const PERFIS_TELA = {
  fluido: {
    resolution: { width: 1280, height: 720, frameRate: 30 },
    contentHint: 'motion',
    encoding: { maxBitrate: 2_500_000, maxFramerate: 30 },
  },
  equilibrado: {
    resolution: { width: 1920, height: 1080, frameRate: 30 },
    contentHint: 'detail',
    encoding: { maxBitrate: 5_000_000, maxFramerate: 30 },
  },
  qualidade: {
    resolution: { width: 1920, height: 1080, frameRate: 60 },
    contentHint: 'motion',
    encoding: { maxBitrate: 8_000_000, maxFramerate: 60 },
  },
};

// ---------- Trocar de tela ----------
function mostrarTela(nome) {
  el.telaLogin.hidden = nome !== 'login';
  el.telaSemCall.hidden = nome !== 'semcall';
  el.telaApp.hidden = nome !== 'app';
}

function mostrarLogin(mensagem) {
  desconectarSala();
  mostrarTela('login');

  if (mensagem) {
    el.loginAviso.textContent = mensagem;
    el.loginAviso.hidden = false;
  }
}

function mostrarSemCall(mensagem) {
  desconectarSala();
  mostrarErro('');
  el.semCallMsg.textContent = mensagem;
  mostrarTela('semcall');
}

const MSG_SEM_CALL =
  'Você não está em um canal de voz. Entre em uma call no Discord e use !transmitir.';

// ---------- Erros ----------
function mostrarErro(mensagem) {
  el.erro.textContent = mensagem || '';
  el.erro.hidden = !mensagem;
}

function mensagemDeErro(erro, recurso) {
  const detalhe = ` (${erro.name})`;

  if (erro.name === 'NotAllowedError') {
    return recurso === 'tela'
      ? 'Compartilhamento cancelado ou sem permissão.'
      : 'Permissão da câmera negada. Libere o acesso no cadeado ao lado do endereço do site.';
  }

  if (recurso === 'camera' && erro.name === 'NotFoundError') {
    return 'Nenhuma câmera encontrada neste dispositivo.';
  }

  if (recurso === 'camera' && erro.name === 'NotReadableError') {
    return 'A câmera está sendo usada por outro programa.';
  }

  return recurso === 'tela'
    ? 'Não consegui compartilhar a tela.' + detalhe
    : 'Não consegui ligar a câmera.' + detalhe;
}

// ---------- Quadros de vídeo ----------
function nomeDe(participante) {
  return participante.name || participante.identity;
}

function chaveTile(participante, fonte) {
  return participante.identity + ':' + fonte;
}

function atualizarPalco() {
  el.palcoTexto.hidden = tiles.size > 0;
  el.palco.classList.toggle('ativo', tiles.size > 0);
}

function adicionarTile(participante, fonte, track) {
  if (!LK || track.kind !== LK.Track.Kind.Video) return;

  removerTile(participante, fonte);

  if (estado.espectador) return;
  const local = !!sala && participante === sala.localParticipant;
  const ehCamera = fonte === LK.Track.Source.Camera;
  const chave = chaveTile(participante, fonte);
  if (tilesOcultos.has(chave)) return;

  const quadro = document.createElement('div');
  quadro.className =
    'tile ' + (ehCamera ? 'camera' : 'tela') + (local ? ' local' : '');

  const video = track.attach();
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true; // só vídeo; o áudio continua no Discord
  quadro.appendChild(video);

  const rotulo = document.createElement('span');
  rotulo.className = 'rotulo';
  rotulo.textContent =
    (local ? 'Você' : nomeDe(participante)) +
    ' · ' +
    (ehCamera ? 'câmera' : 'tela');
  quadro.appendChild(rotulo);

  const ferramentas = document.createElement('div');
  ferramentas.className = 'tile-ferramentas';

  const criarIcone = (nome) => {
    const caminhos = {
      eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
      eyeOff: '<path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a15 15 0 0 1-3.1 3.8M6.2 6.2C3.5 8 2 12 2 12s3.5 7 10 7a10 10 0 0 0 4-.8"/>',
      fullscreen: '<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"/>',
      volume: '<path d="M11 5 6 9H3v6h3l5 4V5ZM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
      mute: '<path d="M11 5 6 9H3v6h3l5 4V5ZM16 9l5 6m0-6-5 6"/>'
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${caminhos[nome] || ''}</svg>`;
  };
  const criarBotaoIcone = (icone, titulo, acao) => {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'tile-icon-btn';
    botao.innerHTML = criarIcone(icone);
    botao.setAttribute('aria-label', titulo);
    botao.title = titulo;
    botao.addEventListener('click', acao);
    ferramentas.appendChild(botao);
    return botao;
  };

  const btnOcultar = criarBotaoIcone('eye', 'Ocultar este vídeo só para você', () => {
    video.hidden = !video.hidden;
    btnOcultar.innerHTML = criarIcone(video.hidden ? 'eyeOff' : 'eye');
    btnOcultar.title = video.hidden ? 'Mostrar este vídeo novamente' : 'Ocultar este vídeo só para você';
    btnOcultar.setAttribute('aria-label', btnOcultar.title);
  });

  const qualidadeWrap = document.createElement('label');
  qualidadeWrap.className = 'tile-qualidade-wrap';
  qualidadeWrap.title = 'Ajustar qualidade recebida apenas por você';
  qualidadeWrap.innerHTML = '<span class="qualidade-icone" aria-hidden="true">HD</span>';
  const qualidade = document.createElement('select');
  qualidade.className = 'tile-qualidade';
  qualidade.setAttribute('aria-label', 'Qualidade deste vídeo');
  for (const [valor, texto] of [['high', 'Alta'], ['medium', 'Média'], ['low', 'Baixa']]) {
    const opt = document.createElement('option');
    opt.value = valor;
    opt.textContent = texto;
    qualidade.appendChild(opt);
  }
  qualidade.value = 'high';
  qualidade.addEventListener('change', () => {
    const publicacao = participante.getTrackPublication?.(fonte);
    const mapa = { high: LK.VideoQuality?.HIGH, medium: LK.VideoQuality?.MEDIUM, low: LK.VideoQuality?.LOW };
    try {
      if (publicacao?.setVideoQuality && mapa[qualidade.value] !== undefined) publicacao.setVideoQuality(mapa[qualidade.value]);
    } catch (e) { console.warn('Não foi possível ajustar a qualidade recebida:', e); }
  });
  qualidadeWrap.appendChild(qualidade);
  ferramentas.appendChild(qualidadeWrap);

  criarBotaoIcone('fullscreen', 'Abrir em tela cheia', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await quadro.requestFullscreen();
    } catch (e) { mostrarErro('Não foi possível abrir em tela cheia neste navegador.'); }
  });

  // O áudio da call permanece no Discord; não há uma faixa de áudio do LiveKit
  // por participante para controlar individualmente neste momento.
  const volume = document.createElement('div');
  volume.className = 'tile-volume';
  volume.title = 'O áudio é reproduzido pelo Discord. O volume individual estará disponível quando o áudio passar pelo Basement.';
  const volumeIcon = document.createElement('span');
  volumeIcon.className = 'tile-volume-icon';
  volumeIcon.innerHTML = criarIcone('volume');
  volumeIcon.setAttribute('aria-hidden', 'true');
  const volumeSlider = document.createElement('input');
  volumeSlider.type = 'range';
  volumeSlider.min = '0';
  volumeSlider.max = '100';
  volumeSlider.value = '100';
  volumeSlider.disabled = true;
  volumeSlider.setAttribute('aria-label', 'Volume individual indisponível: áudio pelo Discord');
  volume.append(volumeIcon, volumeSlider);
  ferramentas.appendChild(volume);
  quadro.appendChild(ferramentas);

  el.palco.appendChild(quadro);
  tiles.set(chave, { quadro, track, video });
  atualizarPalco();
}

function removerTile(participante, fonte) {
  const chave = chaveTile(participante, fonte);
  const item = tiles.get(chave);
  if (!item) return;

  item.track.detach(item.video);
  item.quadro.remove();
  tiles.delete(chave);
  atualizarPalco();
}

function removerTilesDe(participante) {
  for (const chave of [...tiles.keys()]) {
    if (chave.startsWith(participante.identity + ':')) {
      const item = tiles.get(chave);
      item.track.detach(item.video);
      item.quadro.remove();
      tiles.delete(chave);
    }
  }
  atualizarPalco();
}

function limparTiles() {
  for (const item of tiles.values()) {
    item.track.detach(item.video);
    item.quadro.remove();
  }
  tiles.clear();
  atualizarPalco();
}

// ---------- Sala de vídeo (LiveKit) ----------
function registrarEventos(r) {
  const { RoomEvent, Track } = LK;

  // Transmissões dos outros.
  r.on(RoomEvent.TrackSubscribed, (track, publicacao, participante) => {
    if (!estado.espectador && !publicacao.isMuted) {
      adicionarTile(participante, publicacao.source, track);
    }
    desenhar();
  });

  r.on(RoomEvent.TrackUnsubscribed, (track, publicacao, participante) => {
    removerTile(participante, publicacao.source);
    desenhar();
  });

  // Suas próprias transmissões (prévia).
  r.on(RoomEvent.LocalTrackPublished, (publicacao, participante) => {
    if (!estado.espectador && publicacao.track) {
      adicionarTile(participante, publicacao.source, publicacao.track);
    }
    desenhar();
  });

  r.on(RoomEvent.LocalTrackUnpublished, (publicacao, participante) => {
    removerTile(participante, publicacao.source);
    desenhar();
  });

  // Câmera desligada/ligada de novo.
  r.on(RoomEvent.TrackMuted, (publicacao, participante) => {
    if (publicacao.kind === Track.Kind.Video) {
      removerTile(participante, publicacao.source);
    }
    desenhar();
  });

  r.on(RoomEvent.TrackUnmuted, (publicacao, participante) => {
    if (publicacao.kind === Track.Kind.Video && publicacao.track) {
      adicionarTile(participante, publicacao.source, publicacao.track);
    }
    desenhar();
  });

  r.on(RoomEvent.ParticipantDisconnected, (participante) => {
    removerTilesDe(participante);
    desenhar();
  });

  for (const evento of [
    RoomEvent.ParticipantConnected,
    RoomEvent.TrackPublished,
    RoomEvent.TrackUnpublished,
  ]) {
    r.on(evento, () => desenhar());
  }

  r.on(RoomEvent.Disconnected, () => {
    if (sala !== r) return; // foi a gente que desconectou
    limparTiles();
    sala = null;
    estado.midia = 'offline';
    estado.espectador = false;
    desenhar();
  });
}

async function conectarLivekit() {
  if (sala || estado.midia === 'conectando') return;

  if (!LK) {
    estado.midia = 'erro';
    mostrarErro('Não consegui carregar o cliente de vídeo.');
    desenhar();
    return;
  }

  mostrarErro('');
  estado.midia = 'conectando';
  desenhar();

  try {
    const resposta = await fetch('/api/livekit-token', { method: 'POST' });

    if (!resposta.ok) {
      throw new Error('token-' + resposta.status);
    }

    const { url, token } = await resposta.json();

    sala = new LK.Room({ adaptiveStream: true, dynacast: true });
    registrarEventos(sala);
    await sala.connect(url, token);

    // Perdeu o acesso enquanto conectava? Sai de novo.
    if (el.telaApp.hidden) {
      desconectarSala();
      return;
    }

    estado.midia = 'online';
  } catch (erro) {
    console.error('Erro ao conectar na sala de vídeo:', erro);
    if (el.telaApp.hidden) return;

    desconectarSala();
    estado.midia = 'erro';
    mostrarErro('Não consegui entrar na sala de transmissão.');
  }

  desenhar();
}

function desconectarSala() {
  const atual = sala;
  estado.espectador = false;
  sala = null;
  limparTiles();
  estado.midia = 'offline';
  if (atual) atual.disconnect(); // também desliga câmera e tela
}

// ---------- Ações dos botões ----------
async function alternarCamera() {
  if (!sala || estado.ocupado) return;

  mostrarErro('');
  estado.ocupado = true;
  desenhar();

  try {
    const local = sala.localParticipant;
    await local.setCameraEnabled(!local.isCameraEnabled);
  } catch (erro) {
    mostrarErro(mensagemDeErro(erro, 'camera'));
  }

  estado.ocupado = false;
  desenhar();
}

async function ligarTela() {
  if (!sala || estado.ocupado) return;

  if (!telaSuportada) {
    mostrarErro('Este navegador não permite compartilhar a tela.');
    return;
  }

  mostrarErro('');
  estado.ocupado = true;
  desenhar();

  try {
    // O áudio continua sendo só o do Discord. A captura e a codificação
    // recebem limites conforme o perfil escolhido no site.
    const perfilEscolhido = el.perfilTela?.value || 'equilibrado';
    const perfil = PERFIS_TELA[perfilEscolhido] || PERFIS_TELA.equilibrado;

    await sala.localParticipant.setScreenShareEnabled(
      true,
      {
        audio: false,
        resolution: perfil.resolution,
        contentHint: perfil.contentHint,
      },
      {
        screenShareEncoding: perfil.encoding,
      }
    );
  } catch (erro) {
    mostrarErro(mensagemDeErro(erro, 'tela'));
  }

  estado.ocupado = false;
  desenhar();
}

async function pararTela() {
  if (!sala || estado.ocupado) return;

  estado.ocupado = true;
  desenhar();

  try {
    await sala.localParticipant.setScreenShareEnabled(false);
  } catch (erro) {
    mostrarErro(mensagemDeErro(erro, 'tela'));
  }

  estado.ocupado = false;
  desenhar();
}

async function alternarModoSala() {
  if (!sala || estado.midia !== 'online' || estado.ocupado) {
    if (!sala && estado.midia !== 'conectando') conectarLivekit();
    return;
  }

  estado.ocupado = true;
  mostrarErro('');
  desenhar();
  try {
    const local = sala.localParticipant;
    if (!estado.espectador) {
      // Desliga o que o próprio usuário publica, mas mantém a conexão para
      // atualizar a lista de participantes em tempo real.
      await local.setCameraEnabled(false).catch(() => {});
      await local.setScreenShareEnabled(false).catch(() => {});
      estado.espectador = true;
      limparTiles();
      for (const participante of sala.remoteParticipants.values()) {
        for (const publicacao of participante.trackPublications.values()) {
          if (publicacao.kind === LK.Track.Kind.Video) publicacao.setSubscribed(false);
        }
      }
    } else {
      estado.espectador = false;
      for (const participante of sala.remoteParticipants.values()) {
        for (const publicacao of participante.trackPublications.values()) {
          if (publicacao.kind === LK.Track.Kind.Video && publicacao.isSubscribed === false) publicacao.setSubscribed(true);
        }
      }
    }
  } catch (erro) {
    mostrarErro('Não consegui alterar o modo de visualização. Tente novamente.');
  }
  estado.ocupado = false;
  desenhar();
}

el.btnCamera.addEventListener('click', alternarCamera);
el.btnTela.addEventListener('click', ligarTela);
el.btnParar.addEventListener('click', pararTela);

el.btnSala.addEventListener('click', alternarModoSala);

el.btnRecarregar.addEventListener('click', () => {
  location.reload();
});

// ---------- Desenhar a tela principal ----------
function transmite(participante) {
  return participante.isCameraEnabled || participante.isScreenShareEnabled;
}

function desenhar() {
  const { servidorOnline, midia, ocupado } = estado;
  const online = servidorOnline && midia === 'online';
  const local = sala ? sala.localParticipant : null;
  const tela = !!local && local.isScreenShareEnabled;
  const camera = !!local && local.isCameraEnabled;

  // Indicador de conexão
  let texto;
  if (!servidorOnline) texto = 'Sem conexão com o servidor';
  else if (midia === 'online') texto = 'Conectado à sala';
  else if (midia === 'conectando') texto = 'Conectando à sala...';
  else if (midia === 'erro') texto = 'Falha na transmissão';
  else texto = 'Fora da sala';

  el.status.textContent = texto;
  el.ponto.className =
    'ponto ' +
    (online ? 'online' : midia === 'conectando' ? '' : 'offline');

  // Botões
  el.btnCamera.textContent = camera ? 'Desligar câmera' : 'Ligar câmera';
  el.btnCamera.classList.toggle('ativo', camera);
  el.btnCamera.disabled = !online || ocupado || estado.espectador;

  el.btnTela.classList.toggle('ativo', tela);
  el.btnTela.disabled = !online || ocupado || tela || !telaSuportada || estado.espectador;
  el.btnTela.title = telaSuportada
    ? ''
    : 'Este navegador não permite compartilhar a tela.';

  el.btnParar.disabled = !online || ocupado || !tela || estado.espectador;
  if (el.perfilTela) el.perfilTela.disabled = ocupado || tela;

  el.btnSala.textContent =
    midia === 'online' && estado.espectador ? 'Voltar à transmissão'
    : midia === 'online' ? 'Sair da transmissão'
    : midia === 'conectando' ? 'Conectando...'
    : midia === 'erro' ? 'Tentar novamente'
    : 'Entrar na sala';
  el.btnSala.classList.toggle('entrar', midia === 'offline' || midia === 'erro' || (midia === 'online' && estado.espectador));
  el.btnSala.classList.toggle('sair-sala', midia === 'online' && !estado.espectador);
  el.btnSala.classList.toggle('ativo', false);
  el.btnSala.disabled = !servidorOnline || midia === 'conectando' || ocupado;

  // Texto do palco quando não há nenhuma transmissão
  if (midia === 'online') {
    el.palcoTitulo.textContent = 'Ninguém está transmitindo';
    el.palcoSub.textContent = 'Ligue a câmera ou compartilhe sua tela.';
  } else if (midia === 'conectando') {
    el.palcoTitulo.textContent = 'Conectando à sala...';
    el.palcoSub.textContent = '';
  } else if (midia === 'online' && estado.espectador) {
    el.palcoTitulo.textContent = 'Você está fora da transmissão';
    el.palcoSub.textContent = 'A lista de participantes continua atualizada. Volte à transmissão para ver câmera e tela.';
  } else if (midia === 'erro') {
    el.palcoTitulo.textContent = 'Não consegui conectar à transmissão';
    el.palcoSub.textContent = 'Clique em "Tentar de novo".';
  } else {
    el.palcoTitulo.textContent = 'Você saiu da sala';
    el.palcoSub.textContent = 'Clique em “Entrar na sala” para voltar.';
  }

  // A lista permanece visível no modo espectador; nesse modo, ocultamos você.
  el.lista.innerHTML = '';

  const todos = sala && midia === 'online'
    ? [...(estado.espectador ? [] : [sala.localParticipant]), ...sala.remoteParticipants.values()]
    : [];

  if (el.listaContagem) {
    el.listaContagem.textContent = `${todos.length} ${todos.length === 1 ? 'pessoa' : 'pessoas'}`;
  }

  if (todos.length === 0) {
    const vazio = document.createElement('li');
    vazio.className = 'vazio';
    vazio.textContent = 'Ninguém conectado';
    el.lista.appendChild(vazio);
    el.transmissor.textContent = 'ninguém';
    if (el.avisoEspectador) el.avisoEspectador.hidden = !estado.espectador;
    return;
  }

  for (const p of todos) {
    const item = document.createElement('li');
    const info = document.createElement('span');
    info.className = 'membro-info';

    const pontoMembro = document.createElement('span');
    pontoMembro.className = 'membro-ponto';
    pontoMembro.setAttribute('aria-hidden', 'true');
    info.appendChild(pontoMembro);

    const nome = document.createElement('span');
    nome.className = 'membro-nome';
    nome.textContent = nomeDe(p) + (p === sala.localParticipant ? ' (você)' : '');
    info.appendChild(nome);
    item.appendChild(info);

    if (transmite(p)) {
      const etiqueta = document.createElement('span');
      etiqueta.className = 'etiqueta';
      etiqueta.textContent = 'ao vivo';
      item.appendChild(etiqueta);
    }

    el.lista.appendChild(item);
  }

  const quem = todos
    .filter(transmite)
    .map((p) => (p === sala.localParticipant ? 'Você' : nomeDe(p)));

  el.transmissor.textContent = quem.length ? quem.join(', ') : 'ninguém';
  if (el.avisoEspectador) el.avisoEspectador.hidden = !estado.espectador;
}

// ---------- Conexão com o servidor do site ----------
function conectarSocket() {
  const socket = io();

  socket.on('connect', () => {
    estado.servidorOnline = true;
    desenhar();
  });

  socket.on('disconnect', () => {
    estado.servidorOnline = false;
    desenhar();
  });

  // O servidor tirou o acesso (saiu da call, trocou de call, bot offline).
  // A sala de vídeo é desconectada na hora.
  socket.on('acesso-revogado', (motivo) => {
    socket.close();
    mostrarSemCall(
      motivo === 'bot-offline'
        ? 'Perdi a conexão com o Discord. O acesso foi pausado por segurança.'
        : 'Você saiu da call. Entre em uma call e use !transmitir de novo.'
    );
  });

  socket.on('connect_error', (erro) => {
    estado.servidorOnline = false;

    if (erro.message === 'nao-autenticado') {
      socket.close();
      mostrarLogin('Sua sessão expirou. Entre novamente.');
      return;
    }

    if (erro.message === 'sem-call') {
      socket.close();
      mostrarSemCall(MSG_SEM_CALL);
      return;
    }

    desenhar();
  });
}

// ---------- Início ----------
async function iniciar() {
  if (new URLSearchParams(location.search).get('erro') === 'login') {
    history.replaceState(null, '', '/');
    mostrarLogin('Não consegui entrar com o Discord. Tente de novo.');
    return;
  }

  let resposta;

  try {
    resposta = await fetch('/api/eu');
  } catch {
    mostrarLogin('Não consegui falar com o servidor.');
    return;
  }

  if (!resposta.ok) {
    mostrarLogin();
    return;
  }

  const dados = await resposta.json();
  estado.usuario = dados;

  if (!dados.canal) {
    mostrarSemCall(
      dados.botOnline
        ? MSG_SEM_CALL
        : 'Não consegui confirmar sua call agora. Tente de novo em instantes.'
    );
    return;
  }

  el.usuarioNome.textContent = dados.nome;
  el.canalNome.textContent = dados.canal.nome;
  mostrarTela('app');

  desenhar();
  conectarSocket();
  conectarLivekit();
}

iniciar();