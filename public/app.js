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
  saidaAudio: $('saidaAudio'),
  btnAtualizarSaidas: $('btnAtualizarSaidas'),
  btnMudo: $('btnMudo'),
  volumeGeral: $('volumeGeral'),
  volumeGeralTexto: $('volumeGeralTexto'),
  transmissorWrap: $('transmissorWrap'),
  btnAudioMenu: $('btnAudioMenu'),
  btnQualidadeMenu: $('btnQualidadeMenu'),
  btnPessoas: $('btnPessoas'),
  painelAudio: $('painelAudio'),
  painelQualidade: $('painelQualidade'),
  painelPessoas: $('painelPessoas'),
};

const estado = {
  usuario: null,
  servidorOnline: false, // conexão com o servidor do site
  midia: 'offline',      // sala de vídeo: offline | conectando | online | erro
  ocupado: false,        // true enquanto o navegador pede permissão
  espectador: false,     // mantém a lista, mas não recebe nem publica vídeo
  volumeGeral: 1,        // 0 a 1, vale para todas as transmissões
  mudo: false,           // silencia todas as transmissões
  saidaAudio: lerSaidaSalva(), // id do dispositivo de saída ('' = padrão)
};

const tilesOcultos = new Set();

// Cliente do LiveKit (carregado pelo index.html).
const LK = typeof LivekitClient !== 'undefined' ? LivekitClient : null;

let sala = null;          // a sala de vídeo atual
const tiles = new Map();  // quadros de vídeo na tela

// ---------- Ícones e botões ----------
const ICONES = {
  video: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>',
  videoOff: '<path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"/><line x1="1" y1="1" x2="23" y2="23"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  volume: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>',
  volumeX: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>',
  logIn: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>',
  logOut: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
};

function icone(nome) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONES[nome] || ''}</svg>`;
}

// Troca o ícone e o texto de um botão da barra (o texto só aparece em telas largas).
function definirBotao(botao, nomeIcone, texto, dica) {
  botao.innerHTML = `${icone(nomeIcone)}<span class="btn-txt">${texto}</span>`;
  botao.title = dica || texto;
  botao.setAttribute('aria-label', dica || texto);
}

// Pinta a parte "cheia" da barrinha de volume.
function preencherSlider(input) {
  input.style.setProperty('--p', input.value + '%');
}

// ---------- Áudio das transmissões ----------
// O som da tela compartilhada chega como uma faixa de áudio separada.
// Cada faixa tem um <audio> escondido; é ele que toca no seu dispositivo.
const audios = new Map(); // 'idDaPessoa:fonte' -> { track, elemento }
const volumesIndividuais = new Map(); // idDaPessoa -> 0 a 1 (só para você)
const contAudios = document.createElement('div');
contAudios.style.display = 'none';
document.body.appendChild(contAudios);

const saidaSuportada =
  typeof HTMLMediaElement !== 'undefined' &&
  'setSinkId' in HTMLMediaElement.prototype;

// ---------- Diagnóstico: mostra na tela o que está acontecendo com o som ----------
const statusAudio = document.createElement('p');
statusAudio.id = 'statusAudio';
statusAudio.className = 'status-som';
el.painelAudio.appendChild(statusAudio);

function dizerAudio(texto) {
  console.log('[áudio]', texto);
  statusAudio.textContent = texto ? 'Som: ' + texto : '';
}

let ctxNivel = null;
const medidores = new Map(); // chave -> { id, fonte }

function iniciarMedidor(chave, nome, track) {
  try {
    ctxNivel = ctxNivel || new (window.AudioContext || window.webkitAudioContext)();
    ctxNivel.resume().catch(() => {});

    const fonte = ctxNivel.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]));
    const analisador = ctxNivel.createAnalyser();
    analisador.fftSize = 512;
    fonte.connect(analisador); // só mede; não manda para a caixa de som

    const dados = new Uint8Array(analisador.fftSize);
    const id = setInterval(() => {
      analisador.getByteTimeDomainData(dados);
      let pico = 0;
      for (const v of dados) pico = Math.max(pico, Math.abs(v - 128));
      const nivel = Math.round((pico / 128) * 100);
      statusAudio.textContent =
        `Som: recebendo de ${nome} · nível ${nivel}%` +
        (nivel === 0 ? ' (chegando em silêncio: nada está tocando no que foi compartilhado)' : '');
    }, 700);

    medidores.set(chave, { id, fonte });
  } catch (erro) {
    console.warn('[áudio] medidor falhou:', erro);
  }
}

function pararMedidor(chave) {
  const m = medidores.get(chave);
  if (!m) return;
  clearInterval(m.id);
  try { m.fonte.disconnect(); } catch { /* já desconectado */ }
  medidores.delete(chave);
}

function lerSaidaSalva() {
  try {
    return localStorage.getItem('basement.saidaAudio') || '';
  } catch {
    return '';
  }
}

function salvarSaida(id) {
  try {
    localStorage.setItem('basement.saidaAudio', id);
  } catch {
    /* sem armazenamento: tudo bem */
  }
}

function volumeEfetivo(identity) {
  if (estado.mudo) return 0;
  const individual = volumesIndividuais.has(identity)
    ? volumesIndividuais.get(identity)
    : 1;
  return Math.max(0, Math.min(1, estado.volumeGeral * individual));
}

function aplicarVolumes() {
  for (const [chave, item] of audios) {
    item.track.setVolume(volumeEfetivo(chave.split(':')[0]));
  }
}

function aplicarSaida(elemento) {
  if (!saidaSuportada) return;
  elemento.setSinkId(estado.saidaAudio || '').catch((erro) => {
    console.warn('Não consegui usar essa saída de áudio:', erro);
  });
}

function adicionarAudio(participante, fonte, track) {
  if (!LK || track.kind !== LK.Track.Kind.Audio) return;
  // Só toca o som da tela compartilhada. A voz continua no Discord.
  if (fonte !== LK.Track.Source.ScreenShareAudio) return;

  removerAudio(participante, fonte);
  if (estado.espectador) return;

  const elemento = track.attach();
  elemento.autoplay = true;
  contAudios.appendChild(elemento);
  audios.set(chaveTile(participante, fonte), { track, elemento });

  aplicarSaida(elemento);
  track.setVolume(volumeEfetivo(participante.identity));
  if (sala) sala.startAudio().catch(() => {});

  dizerAudio(`áudio de ${nomeDe(participante)} recebido, iniciando...`);
  elemento.play().catch((erro) => {
    dizerAudio(`o navegador bloqueou o play (${erro.name}). Clique na página.`);
    mostrarErro('O navegador bloqueou o som. Clique em qualquer lugar da página para ativar.');
  });
  iniciarMedidor(chaveTile(participante, fonte), nomeDe(participante), track);
}

function removerAudio(participante, fonte) {
  const chave = chaveTile(participante, fonte);
  const item = audios.get(chave);
  if (!item) return;

  pararMedidor(chave);
  item.track.detach(item.elemento);
  item.elemento.remove();
  audios.delete(chave);
}

function removerAudiosDe(participante) {
  for (const chave of [...audios.keys()]) {
    if (chave.startsWith(participante.identity + ':')) {
      const item = audios.get(chave);
      pararMedidor(chave);
      item.track.detach(item.elemento);
      item.elemento.remove();
      audios.delete(chave);
    }
  }
}

function limparAudios() {
  for (const chave of [...medidores.keys()]) pararMedidor(chave);
  for (const item of audios.values()) {
    item.track.detach(item.elemento);
    item.elemento.remove();
  }
  audios.clear();
}

function atualizarControlesAudio() {
  el.volumeGeralTexto.textContent = estado.mudo
    ? 'Mudo'
    : Math.round(estado.volumeGeral * 100) + '%';
  const semSom = estado.mudo || estado.volumeGeral === 0;
  definirBotao(
    el.btnMudo,
    semSom ? 'volumeX' : 'volume',
    semSom ? 'Ativar som' : 'Silenciar',
    semSom ? 'Ativar o som' : 'Silenciar a transmissão'
  );
  el.btnMudo.classList.toggle('ativo', semSom);
  el.volumeGeral.style.setProperty('--p', (estado.mudo ? 0 : estado.volumeGeral * 100) + '%');
}

// Lista as saídas de áudio (caixas, fones...) para o seletor.
async function listarSaidas(pedirPermissao = false) {
  if (!saidaSuportada || !navigator.mediaDevices?.enumerateDevices) {
    el.saidaAudio.innerHTML =
      '<option value="">Troca de saída indisponível neste navegador</option>';
    el.saidaAudio.disabled = true;
    el.btnAtualizarSaidas.disabled = true;
    return;
  }

  try {
    const pegar = async () =>
      (await navigator.mediaDevices.enumerateDevices()).filter(
        (d) => d.kind === 'audiooutput'
      );

    let lista = await pegar();

    // Sem permissão o navegador esconde os nomes. Pedimos só para ler os
    // nomes e já paramos o microfone (nada é gravado ou enviado).
    if (pedirPermissao && (lista.length === 0 || lista.every((d) => !d.label))) {
      try {
        const fluxo = await navigator.mediaDevices.getUserMedia({ audio: true });
        fluxo.getTracks().forEach((t) => t.stop());
      } catch {
        /* sem permissão: segue com nomes genéricos */
      }
      lista = await pegar();
    }

    el.saidaAudio.innerHTML = '';

    const padrao = document.createElement('option');
    padrao.value = '';
    padrao.textContent = 'Padrão do sistema';
    el.saidaAudio.appendChild(padrao);

    lista.forEach((d, i) => {
      if (d.deviceId === 'default') return; // já temos "Padrão do sistema"
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Saída de áudio ${i + 1}`;
      el.saidaAudio.appendChild(opt);
    });

    const existe = [...el.saidaAudio.options].some(
      (o) => o.value === estado.saidaAudio
    );
    el.saidaAudio.value = existe ? estado.saidaAudio : '';
    el.saidaAudio.disabled = false;
  } catch (erro) {
    console.warn('Não consegui listar as saídas de áudio:', erro);
  }
}

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

  // Volume só do compartilhamento de tela de outra pessoa (só para você).
  // Câmera e a sua própria tela não têm som para controlar.
  if (!local && !ehCamera) {
    const volume = document.createElement('div');
    volume.className = 'tile-volume';
    volume.title = 'Volume do som desta transmissão (só para você)';

    const btnMudoTile = document.createElement('button');
    btnMudoTile.type = 'button';
    btnMudoTile.className = 'tile-icon-btn';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.value = String(
      Math.round((volumesIndividuais.get(participante.identity) ?? 1) * 100)
    );
    slider.setAttribute('aria-label', 'Volume desta transmissão');
    preencherSlider(slider);

    let anterior = Number(slider.value) || 100;

    const atualizarIconeTile = () => {
      const mudo = Number(slider.value) === 0;
      btnMudoTile.innerHTML = criarIcone(mudo ? 'mute' : 'volume');
      btnMudoTile.title = mudo ? 'Ativar o som' : 'Silenciar esta transmissão';
      btnMudoTile.setAttribute('aria-label', btnMudoTile.title);
    };

    const definirVolume = (valor) => {
      slider.value = String(valor);
      preencherSlider(slider);
      volumesIndividuais.set(participante.identity, valor / 100);
      aplicarVolumes();
      atualizarIconeTile();
    };

    slider.addEventListener('input', () => {
      const v = Number(slider.value);
      if (v > 0) anterior = v;
      definirVolume(v);
    });

    btnMudoTile.addEventListener('click', () => {
      definirVolume(Number(slider.value) === 0 ? anterior || 100 : 0);
    });

    atualizarIconeTile();
    volume.append(btnMudoTile, slider);
    ferramentas.appendChild(volume);
  }
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
  removerAudiosDe(participante);
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
  limparAudios();
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
    if (track.kind === Track.Kind.Audio) {
      adicionarAudio(participante, publicacao.source, track);
      desenhar();
      return;
    }

    if (!estado.espectador && !publicacao.isMuted) {
      adicionarTile(participante, publicacao.source, track);
    }
    desenhar();
  });

  r.on(RoomEvent.TrackUnsubscribed, (track, publicacao, participante) => {
    if (track.kind === Track.Kind.Audio) {
      removerAudio(participante, publicacao.source);
      desenhar();
      return;
    }

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

  // Diagnóstico: o outro lado publicou áudio da tela?
  r.on(RoomEvent.TrackPublished, (publicacao, participante) => {
    if (publicacao.source === Track.Source.ScreenShareAudio) {
      dizerAudio(`${nomeDe(participante)} publicou o áudio da tela`);
    }
  });

  r.on(RoomEvent.TrackSubscriptionFailed, (sid, participante) => {
    dizerAudio(`falha ao receber uma faixa de ${nomeDe(participante)}`);
  });

  r.on(RoomEvent.TrackSubscribed, (track, publicacao, participante) => {
    if (publicacao.source !== Track.Source.ScreenShare) return;
    setTimeout(() => {
      if (!participante.getTrackPublication(Track.Source.ScreenShareAudio)) {
        dizerAudio(`${nomeDe(participante)} está compartilhando a tela SEM áudio (não marcou "Compartilhar áudio")`);
      }
    }, 3000);
  });

  // O navegador pode bloquear o som até você clicar na página.
  r.on(RoomEvent.AudioPlaybackStatusChanged, () => {
    if (!r.canPlaybackAudio && audios.size > 0) {
      mostrarErro('O navegador bloqueou o som. Clique em qualquer lugar da página para ativar.');
    } else if (el.erro.textContent.startsWith('O navegador bloqueou')) {
      mostrarErro('');
    }
  });

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

    sala = new LK.Room({
      adaptiveStream: true,
      dynacast: true,
      publishDefaults: {
        // H.264 usa a placa de vídeo para codificar (bem mais leve para o PC
        // de quem transmite do que o VP8, que usa o processador).
        videoCodec: 'h264',
        // Sem codec reserva: evita codificar o vídeo duas vezes.
        backupCodec: false,
        // Só uma versão da tela (sem camadas extras) = menos trabalho no PC.
        screenShareSimulcastLayers: [],
      },
    });
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
    // A tela vai com o som (se você marcar "Compartilhar áudio" na janela
    // do navegador). A voz da call continua pelo Discord.
    const perfilEscolhido = el.perfilTela?.value || 'equilibrado';
    const perfil = PERFIS_TELA[perfilEscolhido] || PERFIS_TELA.equilibrado;

    await sala.localParticipant.setScreenShareEnabled(
      true,
      {
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        systemAudio: 'include',
        resolution: perfil.resolution,
        contentHint: perfil.contentHint,
      },
      {
        screenShareEncoding: perfil.encoding,
      }
    );

    // Avisa se a tela subiu sem som (o navegador só manda se você marcar).
    const temAudio =
      !!sala &&
      !!sala.localParticipant.getTrackPublication(LK.Track.Source.ScreenShareAudio);
    dizerAudio(temAudio ? 'a SUA tela está enviando áudio' : 'a SUA tela NÃO está enviando áudio');
    if (sala && !temAudio) {
      mostrarErro('Tela compartilhada SEM som. Para enviar o som, compartilhe a "Tela inteira" ou uma aba e marque "Compartilhar áudio" na janela do navegador.');
    }
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
    dizerAudio('');
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
          publicacao.setSubscribed(false); // vídeo e som
        }
      }
    } else {
      estado.espectador = false;
      for (const participante of sala.remoteParticipants.values()) {
        for (const publicacao of participante.trackPublications.values()) {
          if (publicacao.isSubscribed === false) publicacao.setSubscribed(true); // vídeo e som
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

// ---------- Controles de áudio ----------
el.volumeGeral.addEventListener('input', () => {
  estado.volumeGeral = Number(el.volumeGeral.value) / 100;
  if (estado.volumeGeral > 0) estado.mudo = false;
  atualizarControlesAudio();
  aplicarVolumes();
});

el.btnMudo.addEventListener('click', () => {
  estado.mudo = !estado.mudo;
  atualizarControlesAudio();
  aplicarVolumes();
});

el.saidaAudio.addEventListener('change', () => {
  estado.saidaAudio = el.saidaAudio.value;
  salvarSaida(estado.saidaAudio);
  for (const item of audios.values()) aplicarSaida(item.elemento);
});

el.btnAtualizarSaidas.addEventListener('click', () => listarSaidas(true));

if (navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener('devicechange', () => listarSaidas(false));
}

// Um clique na página libera o som caso o navegador tenha bloqueado.
document.addEventListener('click', () => {
  if (sala && !sala.canPlaybackAudio) {
    sala.startAudio().then(() => {
      if (el.erro.textContent.startsWith('O navegador bloqueou')) mostrarErro('');
    }).catch(() => {});
  }
});

// Clicar no aviso fecha ele.
el.erro.addEventListener('click', () => mostrarErro(''));

// ---------- Menus da barra (áudio, qualidade, pessoas) ----------
const menus = [
  [el.btnAudioMenu, el.painelAudio],
  [el.btnQualidadeMenu, el.painelQualidade],
  [el.btnPessoas, el.painelPessoas],
];

function fecharMenus(exceto) {
  for (const [botao, painel] of menus) {
    if (painel === exceto) continue;
    painel.hidden = true;
    botao.classList.remove('aberto');
    botao.setAttribute('aria-expanded', 'false');
  }
}

for (const [botao, painel] of menus) {
  botao.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const abrir = painel.hidden;
    fecharMenus(painel);
    painel.hidden = !abrir;
    botao.classList.toggle('aberto', abrir);
    botao.setAttribute('aria-expanded', String(abrir));
    if (abrir && painel === el.painelAudio) listarSaidas(false);
  });
  painel.addEventListener('click', (ev) => ev.stopPropagation());
}

document.addEventListener('click', () => fecharMenus(null));
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') fecharMenus(null);
});

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
  definirBotao(el.btnCamera, camera ? 'video' : 'videoOff', camera ? 'Desligar câmera' : 'Ligar câmera');
  el.btnCamera.classList.toggle('ativo', camera);
  el.btnCamera.disabled = !online || ocupado || estado.espectador;

  el.btnTela.classList.toggle('ativo', tela);
  el.btnTela.disabled = !online || ocupado || tela || !telaSuportada || estado.espectador;
  definirBotao(
    el.btnTela,
    'monitor',
    'Compartilhar tela',
    telaSuportada ? 'Compartilhar tela' : 'Este navegador não permite compartilhar a tela.'
  );
  el.btnTela.hidden = tela; // enquanto compartilha, aparece o botão de parar

  el.btnParar.disabled = !online || ocupado || !tela || estado.espectador;
  el.btnParar.hidden = !tela;
  definirBotao(el.btnParar, 'stop', 'Parar', 'Encerrar compartilhamento');
  if (el.perfilTela) el.perfilTela.disabled = ocupado || tela;

  const textoSala =
    midia === 'online' && estado.espectador ? 'Voltar à transmissão'
    : midia === 'online' ? 'Sair da transmissão'
    : midia === 'conectando' ? 'Conectando...'
    : midia === 'erro' ? 'Tentar novamente'
    : 'Entrar na sala';
  definirBotao(
    el.btnSala,
    midia === 'online' && !estado.espectador ? 'logOut' : midia === 'erro' ? 'refresh' : 'logIn',
    textoSala
  );
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
    el.listaContagem.textContent = String(todos.length);
    el.btnPessoas.title = `${todos.length} ${todos.length === 1 ? 'pessoa' : 'pessoas'} na sala`;
  }

  if (todos.length === 0) {
    const vazio = document.createElement('li');
    vazio.className = 'vazio';
    vazio.textContent = 'Ninguém conectado';
    el.lista.appendChild(vazio);
    el.transmissor.textContent = 'ninguém';
    el.transmissorWrap.hidden = true;
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
  el.transmissorWrap.hidden = quem.length === 0;
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

  atualizarControlesAudio();
  listarSaidas(false);
  desenhar();
  conectarSocket();
  conectarLivekit();
}

iniciar();