require('dotenv').config();

const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const { Server } = require('socket.io');
const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');

const { ID_APLICACAO } = require('./config');

function iniciarWeb(client) {
  const PORTA = process.env.PORT || 3000;
  const BASE_URL = (
    process.env.BASE_URL || `http://localhost:${PORTA}`
  ).replace(/\/$/, '');
  const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
  const SESSION_SECRET = process.env.SESSION_SECRET;

  const LIVEKIT_URL = process.env.LIVEKIT_URL;
  const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
  const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;

  if (!CLIENT_SECRET || !SESSION_SECRET) {
    console.warn(
      '[web] Site desativado: faltam DISCORD_CLIENT_SECRET e/ou SESSION_SECRET no .env. O bot continua normalmente.'
    );
    return;
  }

  // ---------- LiveKit (servidor de vídeo) ----------
  let salasLivekit = null;

  if (LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET) {
    const urlHttp = LIVEKIT_URL.replace(/^wss:/, 'https:').replace(
      /^ws:/,
      'http:'
    );
    salasLivekit = new RoomServiceClient(
      urlHttp,
      LIVEKIT_API_KEY,
      LIVEKIT_API_SECRET
    );
  } else {
    console.warn(
      '[web] LiveKit desativado: faltam LIVEKIT_URL, LIVEKIT_API_KEY e/ou LIVEKIT_API_SECRET no .env. O login funciona, mas sem transmissão.'
    );
  }

  const nomeDaSala = (canalId) => `call-${canalId}`;

  // Tira a pessoa da sala de vídeo (usado quando ela perde o acesso).
  async function expulsarDoLivekit(userId, canalId) {
    if (!salasLivekit) return;

    try {
      await salasLivekit.removeParticipant(nomeDaSala(canalId), userId);
    } catch (erro) {
      // Se a pessoa já tinha saído ou a sala não existe, tudo bem.
      if (!/not found|does not exist/i.test(erro.message)) {
        console.warn(
          `[livekit] Não consegui expulsar ${userId}: ${erro.message}`
        );
      }
    }
  }

  const REDIRECT_URI = `${BASE_URL}/callback`;
  const PRODUCAO = BASE_URL.startsWith('https://');

  const app = express();
  const servidor = http.createServer(app);
  const io = new Server(servidor);

  if (PRODUCAO) app.set('trust proxy', 1);

  const sessao = session({
    secret: SESSION_SECRET,
    name: 'basement.sid',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: PRODUCAO,
      maxAge: 1000 * 60 * 60 * 8, // 8 horas
    },
  });

  app.disable('x-powered-by');

  // Compressão: deixa o site (principalmente o arquivo do LiveKit) bem mais leve.
  // Só liga se o pacote "compression" estiver instalado (npm install compression).
  try {
    app.use(require('compression')());
  } catch {
    console.warn(
      '[web] Dica: rode "npm install compression" para o site carregar mais rápido.'
    );
  }

  // Arquivos do site vêm ANTES da sessão: não precisam de login e,
  // assim, não gastam processamento com cookie/sessão a cada arquivo.
  // Entrega só o arquivo do cliente do LiveKit que o site precisa.
  app.get('/vendor/livekit-client.js', (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        'node_modules',
        'livekit-client',
        'dist',
        'livekit-client.umd.js'
      ),
      { maxAge: '1d' }
    );
  });

  app.use(
    express.static(path.join(__dirname, 'public'), {
      setHeaders(res, arquivo) {
        if (/\.(png|jpe?g|webp|svg|ico|woff2?)$/i.test(arquivo)) {
          // Imagens e fontes: ficam guardadas por 7 dias no aparelho.
          res.setHeader('Cache-Control', 'public, max-age=604800');
        } else {
          // html/js/css: o navegador confere se mudou e só baixa de novo se mudou.
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );

  app.use(sessao);

  // ---------- Descobrir em qual call a pessoa está ----------
  // Procura a pessoa em todos os servidores onde o bot está.
  // Se o bot não estiver pronto ou não achar a pessoa, devolve null
  // (e o acesso fica bloqueado).
  function canalDeVoz(userId) {
    if (!client.isReady()) return null;

    for (const servidorDiscord of client.guilds.cache.values()) {
      const canal = servidorDiscord.voiceStates.cache.get(userId)?.channel;

      if (canal) return { id: canal.id, nome: canal.name };
    }

    return null;
  }

  // ---------- Login com Discord ----------
  app.get('/login', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = state;

    const parametros = new URLSearchParams({
      client_id: ID_APLICACAO,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'identify',
      state,
    });

    req.session.save(() => {
      res.redirect(`https://discord.com/oauth2/authorize?${parametros}`);
    });
  });

  app.get('/callback', async (req, res) => {
    const { code, state, error } = req.query;
    const esperado = req.session.oauthState;
    delete req.session.oauthState;

    if (error || typeof code !== 'string' || !esperado || state !== esperado) {
      return res.redirect('/?erro=login');
    }

    try {
      const respostaToken = await fetch(
        'https://discord.com/api/oauth2/token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: ID_APLICACAO,
            client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI,
          }),
        }
      );

      if (!respostaToken.ok) {
        throw new Error(`Discord recusou o code (${respostaToken.status}).`);
      }

      const { access_token: token } = await respostaToken.json();

      const respostaUsuario = await fetch(
        'https://discord.com/api/users/@me',
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!respostaUsuario.ok) {
        throw new Error(
          `Não consegui ler o usuário (${respostaUsuario.status}).`
        );
      }

      const usuario = await respostaUsuario.json();

      req.session.regenerate((erroSessao) => {
        if (erroSessao) {
          console.error('Erro ao criar sessão:', erroSessao);
          return res.redirect('/?erro=login');
        }

        req.session.usuario = {
          id: usuario.id,
          nome: usuario.global_name || usuario.username,
        };

        req.session.save(() => res.redirect('/'));
      });
    } catch (erro) {
      console.error('Erro no login:', erro.message);
      res.redirect('/?erro=login');
    }
  });

  app.get('/logout', (req, res) => {
    const id = req.session.usuario?.id;

    // Derruba as conexões dessa pessoa (site e sala de vídeo).
    if (id) {
      for (const socket of io.sockets.sockets.values()) {
        if (socket.data.usuario?.id === id) {
          expulsarDoLivekit(id, socket.data.canalId);
          socket.disconnect(true);
        }
      }
    }

    req.session.destroy(() => {
      res.clearCookie('basement.sid');
      res.redirect('/');
    });
  });

  // O site pergunta aqui quem é o usuário e em qual call ele está.
  app.get('/api/eu', (req, res) => {
    const usuario = req.session.usuario;

    if (!usuario) {
      return res.status(401).json({ erro: 'nao-autenticado' });
    }

    res.json({
      ...usuario,
      canal: canalDeVoz(usuario.id),
      botOnline: client.isReady(),
    });
  });

  // Entrega o "crachá" da sala de vídeo.
  // A sala é escolhida AQUI, pela call em que a pessoa está no Discord.
  app.post('/api/livekit-token', async (req, res) => {
    const usuario = req.session.usuario;

    if (!usuario) {
      return res.status(401).json({ erro: 'nao-autenticado' });
    }

    if (!salasLivekit) {
      return res.status(503).json({ erro: 'livekit-indisponivel' });
    }

    const canal = canalDeVoz(usuario.id);

    if (!canal) {
      return res.status(403).json({ erro: 'sem-call' });
    }

    try {
      const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
        identity: usuario.id,
        name: usuario.nome,
        ttl: '2m', // vale só para entrar; o crachá "vence" rápido
      });

      token.addGrant({
        roomJoin: true,
        room: nomeDaSala(canal.id),
        canPublish: true,
        canSubscribe: true,
        canPublishData: false,
      });

      res.json({ url: LIVEKIT_URL, token: await token.toJwt() });
    } catch (erro) {
      console.error('Erro ao criar token do LiveKit:', erro.message);
      res.status(500).json({ erro: 'falha-token' });
    }
  });

  app.get('/saude', (req, res) => {
    res.json({ ok: true });
  });

  // ---------- Tempo real: só entra quem está logado E numa call ----------
  io.engine.use(sessao);

  io.use((socket, next) => {
    const usuario = socket.request.session?.usuario;

    if (!usuario) {
      return next(new Error('nao-autenticado'));
    }

    const canal = canalDeVoz(usuario.id);

    if (!canal) {
      return next(new Error('sem-call'));
    }

    socket.data.usuario = usuario;
    socket.data.canalId = canal.id;
    next();
  });

  io.on('connection', (socket) => {
    const { nome, id } = socket.data.usuario;

    socket.join(`call:${socket.data.canalId}`);
    console.log(`Site conectado: ${nome} (${id}) na call ${socket.data.canalId}`);

    socket.on('disconnect', () => {
      console.log(`Site desconectado: ${nome} (${id})`);
    });
  });

  // ---------- Revalidação contínua ----------
  function conferir(socket) {
    const { id, nome } = socket.data.usuario;
    const canal = canalDeVoz(id);

    if (!canal || canal.id !== socket.data.canalId) {
      const motivo = client.isReady() ? 'saiu-da-call' : 'bot-offline';
      console.log(`Acesso revogado: ${nome} (${motivo})`);

      expulsarDoLivekit(id, socket.data.canalId);
      socket.emit('acesso-revogado', motivo);
      socket.disconnect(true);
    }
  }

  // Na hora: quando alguém entra, sai ou troca de call.
  client.on('voiceStateUpdate', (antigo, novo) => {
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.usuario?.id === novo.id) conferir(socket);
    }
  });

  // Segurança extra: confere todo mundo a cada 15 segundos
  // (cobre eventos perdidos e o bot desconectado).
  setInterval(() => {
    for (const socket of io.sockets.sockets.values()) {
      conferir(socket);
    }
  }, 15000);

  servidor.listen(PORTA, () => {
    console.log(`Basement Screen Share rodando em ${BASE_URL}`);
  });
}

module.exports = iniciarWeb;