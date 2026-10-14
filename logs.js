
const {
  AuditLogEvent,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const CATEGORIA_LOGS = '📋・LOGS BASEMENT';

const CANAIS_LOGS = {
  entradas: 'entradas',
  saidas: 'saidas',
  banimentos: 'banimentos',
  expulsoes: 'expulsoes',
  mensagensApagadas: 'mensagens-apagadas',
  mensagensEditadas: 'mensagens-editadas',
  voz: 'logs-voz',
  cargos: 'logs-cargos',
  canais: 'logs-canais',
  servidor: 'logs-servidor',
};

module.exports = function iniciarLogs(client, idServidor) {
  const mapaCanais = new Map();

  // Impede verificações simultâneas nesta instância.
  let inicializacaoLogs = null;

  function embedBase(titulo, cor = '#5865F2') {
    return new EmbedBuilder()
      .setColor(cor)
      .setTitle(titulo)
      .setFooter({ text: 'BASEMENT • Sistema de logs' })
      .setTimestamp();
  }

  function nomeParaChave(nome) {
    return Object.keys(CANAIS_LOGS).find(
      (chave) => CANAIS_LOGS[chave] === nome
    );
  }

  async function enviar(guild, chave, embed) {
    try {
      let canalId = mapaCanais.get(chave);
      let canal = canalId
        ? guild.channels.cache.get(canalId)
        : null;

      if (!canal) {
        canal = guild.channels.cache.find(
          (c) =>
            c.type === ChannelType.GuildText &&
            c.name === CANAIS_LOGS[chave] &&
            c.parent?.name === CATEGORIA_LOGS
        );

        if (canal) {
          mapaCanais.set(chave, canal.id);
        }
      }

      if (!canal) {
        console.warn(
          `[LOGS] Canal "${CANAIS_LOGS[chave]}" não encontrado.`
        );
        return;
      }

      await canal.send({ embeds: [embed] });
    } catch (error) {
      console.error(
        `[LOGS] Falha ao enviar para ${CANAIS_LOGS[chave]}:`,
        error.message
      );
    }
  }

  async function buscarResponsavel(
    guild,
    tipo,
    alvoId,
    maxIdadeMs = 15000
  ) {
    try {
      const logs = await guild.fetchAuditLogs({
        type: tipo,
        limit: 6,
      });

      const agora = Date.now();

      const entrada = logs.entries.find((item) => {
        const alvoConfere =
          !alvoId || item.target?.id === alvoId;

        const recente =
          agora - item.createdTimestamp <= maxIdadeMs;

        return alvoConfere && recente;
      });

      if (!entrada) return null;

      return {
        usuario: entrada.executor,
        motivo: entrada.reason || 'Motivo não informado',
        entrada,
      };
    } catch {
      return null;
    }
  }

  // Cria somente o que estiver faltando.
  async function garantirCanais(guild) {
    if (!guild || guild.id !== idServidor) return;

    if (inicializacaoLogs) {
      return inicializacaoLogs;
    }

    inicializacaoLogs = (async () => {
      try {
        const eu =
          guild.members.me || await guild.members.fetchMe();

        if (
          !eu.permissions.has(
            PermissionFlagsBits.ManageChannels
          )
        ) {
          console.error(
            '[LOGS] Preciso da permissão Gerenciar Canais.'
          );
          return;
        }

        // Atualiza os canais antes de procurar a categoria.
        await guild.channels.fetch();

        let categoria = guild.channels.cache.find(
          (c) =>
            c.type === ChannelType.GuildCategory &&
            c.name === CATEGORIA_LOGS
        );

        if (!categoria) {
          categoria = await guild.channels.create({
            name: CATEGORIA_LOGS,
            type: ChannelType.GuildCategory,
            permissionOverwrites: [
              {
                id: guild.roles.everyone.id,
                deny: [
                  PermissionFlagsBits.ViewChannel,
                ],
              },
              {
                id: eu.id,
                allow: [
                  PermissionFlagsBits.ViewChannel,
                  PermissionFlagsBits.SendMessages,
                  PermissionFlagsBits.EmbedLinks,
                  PermissionFlagsBits.ReadMessageHistory,
                  PermissionFlagsBits.ManageChannels,
                ],
              },
            ],
            reason:
              'Configuração automática dos logs do Basement',
          });
        }

        // Atualiza novamente após localizar/criar a categoria.
        const canaisExistentes =
          await guild.channels.fetch();

        for (const nome of Object.values(CANAIS_LOGS)) {
          let canal = canaisExistentes.find(
            (c) =>
              c &&
              c.type === ChannelType.GuildText &&
              c.name === nome &&
              c.parentId === categoria.id
          );

          if (!canal) {
            canal = await guild.channels.create({
              name: nome,
              type: ChannelType.GuildText,
              parent: categoria.id,
              topic: `Registro automático do Basement: ${nome}`,
              reason:
                'Configuração automática dos logs do Basement',
            });

            canaisExistentes.set(canal.id, canal);
          }

          const chave = nomeParaChave(nome);

          if (chave) {
            mapaCanais.set(chave, canal.id);
          }
        }

        console.log(
          '[LOGS] Categoria e canais de logs verificados.'
        );
      } catch (error) {
        console.error(
          '[LOGS] Não consegui verificar os canais. Confira as permissões:',
          error
        );
      }
    })();

    try {
      await inicializacaoLogs;
    } finally {
      inicializacaoLogs = null;
    }
  }

  client.on('guildCreate', async (guild) => {
    if (guild.id === idServidor) {
      await garantirCanais(guild);
    }
  });

  client.once('clientReady', async () => {
    const guild = client.guilds.cache.get(idServidor);

    if (!guild) {
      console.error(
        `[LOGS] Não encontrei o servidor configurado: ${idServidor}`
      );
      return;
    }

    await garantirCanais(guild);
  });

  // ENTRADA DE MEMBROS
  client.on('guildMemberAdd', async (member) => {
    if (member.guild.id !== idServidor) return;

    const embed = embedBase(
      '📥 Membro entrou',
      '#57F287'
    )
      .setDescription(`${member} **${member.user.tag}**`)
      .addFields(
        {
          name: 'ID do usuário',
          value: member.id,
          inline: true,
        },
        {
          name: 'Membros no servidor',
          value: String(member.guild.memberCount),
          inline: true,
        },
        {
          name: 'Conta criada',
          value: `<t:${Math.floor(
            member.user.createdTimestamp / 1000
          )}:F>`,
        }
      );

    await enviar(member.guild, 'entradas', embed);
  });

  // SAÍDAS E EXPULSÕES
  client.on('guildMemberRemove', async (member) => {
    if (member.guild.id !== idServidor) return;

    const kick = await buscarResponsavel(
      member.guild,
      AuditLogEvent.MemberKick,
      member.id,
      12000
    );

    if (kick) {
      const embed = embedBase(
        '👢 Membro expulso',
        '#ED4245'
      )
        .setDescription(
          `**${member.user?.tag || member.id}** foi expulso do servidor.`
        )
        .addFields(
          {
            name: 'Usuário',
            value: `${member.user?.tag || 'Desconhecido'}\nID: ${member.id}`,
            inline: true,
          },
          {
            name: 'Responsável',
            value: `${kick.usuario || 'Não identificado'}`,
            inline: true,
          },
          {
            name: 'Motivo',
            value: kick.motivo,
          }
        );

      await enviar(member.guild, 'expulsoes', embed);
      return;
    }

    const embed = embedBase(
      '📤 Membro saiu',
      '#FEE75C'
    )
      .setDescription(
        `**${member.user?.tag || 'Usuário desconhecido'}** saiu ou não está mais no servidor.`
      )
      .addFields({
        name: 'ID do usuário',
        value: member.id,
      });

    await enviar(member.guild, 'saidas', embed);
  });

  // BANIMENTOS
  client.on('guildBanAdd', async (ban) => {
    if (ban.guild.id !== idServidor) return;

    const responsavel = await buscarResponsavel(
      ban.guild,
      AuditLogEvent.MemberBanAdd,
      ban.user.id
    );

    const embed = embedBase(
      '🔨 Membro banido',
      '#ED4245'
    )
      .setDescription(
        `**${ban.user.tag}** foi banido do Basement.`
      )
      .addFields(
        {
          name: 'Usuário',
          value: `${ban.user.tag}\nID: ${ban.user.id}`,
          inline: true,
        },
        {
          name: 'Responsável',
          value: `${responsavel?.usuario || 'Não identificado'}`,
          inline: true,
        },
        {
          name: 'Motivo',
          value:
            responsavel?.motivo ||
            ban.reason ||
            'Motivo não informado',
        }
      );

    await enviar(ban.guild, 'banimentos', embed);
  });

  // BANIMENTOS REMOVIDOS
  client.on('guildBanRemove', async (ban) => {
    if (ban.guild.id !== idServidor) return;

    const responsavel = await buscarResponsavel(
      ban.guild,
      AuditLogEvent.MemberBanRemove,
      ban.user.id
    );

    const embed = embedBase(
      '🔓 Banimento removido',
      '#57F287'
    )
      .setDescription(
        `O banimento de **${ban.user.tag}** foi removido.`
      )
      .addFields(
        {
          name: 'ID do usuário',
          value: ban.user.id,
          inline: true,
        },
        {
          name: 'Responsável',
          value: `${responsavel?.usuario || 'Não identificado'}`,
          inline: true,
        }
      );

    await enviar(ban.guild, 'banimentos', embed);
  });

  // MENSAGENS APAGADAS
  client.on('messageDelete', async (message) => {
    if (
      !message.guild ||
      message.guild.id !== idServidor ||
      message.author?.bot
    ) return;

    const embed = embedBase(
      '🗑️ Mensagem apagada',
      '#ED4245'
    )
      .addFields(
        {
          name: 'Autor',
          value: `${message.author || 'Desconhecido'}\nID: ${message.author?.id || 'indisponível'}`,
          inline: true,
        },
        {
          name: 'Canal',
          value: `${message.channel}`,
          inline: true,
        },
        {
          name: 'Conteúdo',
          value: (
            message.content ||
            '*Conteúdo indisponível — mensagem sem texto, anexo ou fora do cache.*'
          ).slice(0, 1024),
        }
      );

    if (message.attachments?.size) {
      const anexos = [...message.attachments.values()]
        .map((a) => a.url)
        .join('\n')
        .slice(0, 1024);

      embed.addFields({
        name: 'Anexos',
        value: anexos || 'Anexo indisponível',
      });
    }

    await enviar(
      message.guild,
      'mensagensApagadas',
      embed
    );
  });

  // MENSAGENS EDITADAS
  client.on('messageUpdate', async (antes, depois) => {
    if (
      !depois.guild ||
      depois.guild.id !== idServidor ||
      depois.author?.bot
    ) return;

    if (antes.partial || depois.partial) {
      const [antesCompleto, depoisCompleto] =
        await Promise.all([
          antes.fetch().catch(() => null),
          depois.fetch().catch(() => null),
        ]);

      if (!antesCompleto || !depoisCompleto) return;

      antes = antesCompleto;
      depois = depoisCompleto;
    }

    if (antes.content === depois.content) return;

    const embed = embedBase(
      '✏️ Mensagem editada',
      '#FEE75C'
    )
      .addFields(
        {
          name: 'Autor',
          value: `${depois.author || 'Desconhecido'}\nID: ${depois.author?.id || 'indisponível'}`,
          inline: true,
        },
        {
          name: 'Canal',
          value: `${depois.channel}`,
          inline: true,
        },
        {
          name: 'Antes',
          value: (
            antes.content || '*Conteúdo anterior indisponível*'
          ).slice(0, 1024),
        },
        {
          name: 'Depois',
          value: (
            depois.content || '*Mensagem sem texto*'
          ).slice(0, 1024),
        }
      )
      .setURL(
        `https://discord.com/channels/${depois.guild.id}/${depois.channel.id}/${depois.id}`
      );

    await enviar(
      depois.guild,
      'mensagensEditadas',
      embed
    );
  });

  // ENTRADA, SAÍDA E TROCA DE CANAIS DE VOZ
  client.on('voiceStateUpdate', async (antes, depois) => {
    const guild = depois.guild || antes.guild;

    if (!guild || guild.id !== idServidor) return;

    const membro = depois.member || antes.member;

    if (!membro || membro.user?.bot) return;

    let titulo;
    let descricao;
    let responsavel = null;

    if (!antes.channelId && depois.channelId) {
      titulo = '🔊 Entrou em call';
      descricao = `${membro} entrou em **${depois.channel?.name || 'canal de voz'}**.`;
    } else if (antes.channelId && !depois.channelId) {
      titulo = '🔇 Saiu da call';
      descricao = `${membro} saiu de **${antes.channel?.name || 'canal de voz'}**.`;

      responsavel = await buscarResponsavel(
        guild,
        AuditLogEvent.MemberDisconnect,
        membro.id,
        10000
      );
    } else if (
      antes.channelId &&
      depois.channelId &&
      antes.channelId !== depois.channelId
    ) {
      titulo = '🔁 Mudou de call';
      descricao = `${membro} mudou de **${antes.channel?.name || 'canal anterior'}** para **${depois.channel?.name || 'canal novo'}**.`;

      responsavel = await buscarResponsavel(
        guild,
        AuditLogEvent.MemberMove,
        membro.id,
        10000
      );
    } else {
      return;
    }

    const embed = embedBase(
      titulo,
      '#5865F2'
    ).setDescription(descricao);

    if (responsavel?.usuario) {
      embed.addFields({
        name: 'Ação realizada por',
        value: `${responsavel.usuario}`,
        inline: true,
      });
    }

    await enviar(guild, 'voz', embed);
  });

  // CANAIS CRIADOS
  client.on('channelCreate', async (canal) => {
    if (!canal.guild || canal.guild.id !== idServidor) return;

    if (
      canal.name === CATEGORIA_LOGS ||
      Object.values(CANAIS_LOGS).includes(canal.name)
    ) return;

    const responsavel = await buscarResponsavel(
      canal.guild,
      AuditLogEvent.ChannelCreate,
      canal.id
    );

    const embed = embedBase(
      '➕ Canal criado',
      '#57F287'
    )
      .setDescription(
        `O canal **${canal.name}** foi criado.`
      )
      .addFields(
        {
          name: 'ID do canal',
          value: canal.id,
          inline: true,
        },
        {
          name: 'Responsável',
          value: `${responsavel?.usuario || 'Não identificado'}`,
          inline: true,
        }
      );

    await enviar(canal.guild, 'canais', embed);
  });

  // CANAIS EXCLUÍDOS
  client.on('channelDelete', async (canal) => {
    if (!canal.guild || canal.guild.id !== idServidor) return;

    const responsavel = await buscarResponsavel(
      canal.guild,
      AuditLogEvent.ChannelDelete,
      canal.id
    );

    const embed = embedBase(
      '➖ Canal excluído',
      '#ED4245'
    )
      .setDescription(
        `O canal **${canal.name}** foi excluído.`
      )
      .addFields(
        {
          name: 'ID do canal',
          value: canal.id,
          inline: true,
        },
        {
          name: 'Responsável',
          value: `${responsavel?.usuario || 'Não identificado'}`,
          inline: true,
        }
      );

    await enviar(canal.guild, 'canais', embed);
  });

  // CANAIS ALTERADOS
  client.on('channelUpdate', async (antes, depois) => {
    if (!depois.guild || depois.guild.id !== idServidor) return;

    const mudancas = [];

    if (antes.name !== depois.name) {
      mudancas.push(
        `**Nome:** ${antes.name} → ${depois.name}`
      );
    }

    if (antes.parentId !== depois.parentId) {
      mudancas.push('**Categoria:** categoria alterada');
    }

    if ('topic' in antes && antes.topic !== depois.topic) {
      mudancas.push('**Tópico:** alterado');
    }

    if (!mudancas.length) return;

    const responsavel = await buscarResponsavel(
      depois.guild,
      AuditLogEvent.ChannelUpdate,
      depois.id
    );

    const embed = embedBase(
      '⚙️ Canal alterado',
      '#FEE75C'
    )
      .setDescription(
        `Canal: <#${depois.id}>\n${mudancas.join('\n')}`
      )
      .addFields({
        name: 'Responsável',
        value: `${responsavel?.usuario || 'Não identificado'}`,
      });

    await enviar(depois.guild, 'canais', embed);
  });

  // CARGOS CRIADOS
  client.on('roleCreate', async (cargo) => {
    if (cargo.guild.id !== idServidor) return;

    const responsavel = await buscarResponsavel(
      cargo.guild,
      AuditLogEvent.RoleCreate,
      cargo.id
    );

    const embed = embedBase(
      '➕ Cargo criado',
      '#57F287'
    )
      .setDescription(`Cargo **${cargo.name}** criado.`)
      .addFields(
        {
          name: 'ID',
          value: cargo.id,
          inline: true,
        },
        {
          name: 'Responsável',
          value: `${responsavel?.usuario || 'Não identificado'}`,
          inline: true,
        }
      );

    await enviar(cargo.guild, 'cargos', embed);
  });

  // CARGOS EXCLUÍDOS
  client.on('roleDelete', async (cargo) => {
    if (cargo.guild.id !== idServidor) return;

    const responsavel = await buscarResponsavel(
      cargo.guild,
      AuditLogEvent.RoleDelete,
      cargo.id
    );

    const embed = embedBase(
      '➖ Cargo excluído',
      '#ED4245'
    )
      .setDescription(`Cargo **${cargo.name}** excluído.`)
      .addFields(
        {
          name: 'ID',
          value: cargo.id,
          inline: true,
        },
        {
          name: 'Responsável',
          value: `${responsavel?.usuario || 'Não identificado'}`,
          inline: true,
        }
      );

    await enviar(cargo.guild, 'cargos', embed);
  });

  // CARGOS ALTERADOS
  client.on('roleUpdate', async (antes, depois) => {
    if (depois.guild.id !== idServidor) return;

    const mudancas = [];

    if (antes.name !== depois.name) {
      mudancas.push(
        `Nome: ${antes.name} → ${depois.name}`
      );
    }

    if (antes.hexColor !== depois.hexColor) {
      mudancas.push(
        `Cor: ${antes.hexColor} → ${depois.hexColor}`
      );
    }

    if (antes.hoist !== depois.hoist) {
      mudancas.push(
        'Exibição separada na lista de membros alterada'
      );
    }

    if (antes.mentionable !== depois.mentionable) {
      mudancas.push('Permissão de menção alterada');
    }

    if (!mudancas.length) return;

    const responsavel = await buscarResponsavel(
      depois.guild,
      AuditLogEvent.RoleUpdate,
      depois.id
    );

    const embed = embedBase(
      '⚙️ Cargo alterado',
      '#FEE75C'
    )
      .setDescription(
        `Cargo: <@&${depois.id}>\n${mudancas.join('\n')}`
      )
      .addFields({
        name: 'Responsável',
        value: `${responsavel?.usuario || 'Não identificado'}`,
      });

    await enviar(depois.guild, 'cargos', embed);
  });

  // APELIDOS E CARGOS DE MEMBROS
  client.on('guildMemberUpdate', async (antes, depois) => {
    if (depois.guild.id !== idServidor) return;

    if (antes.nickname !== depois.nickname) {
      const responsavel = await buscarResponsavel(
        depois.guild,
        AuditLogEvent.MemberUpdate,
        depois.id
      );

      const embed = embedBase(
        '🪪 Apelido alterado',
        '#FEE75C'
      )
        .setDescription(
          `Membro: ${depois}\n` +
          `**Antes:** ${antes.nickname || antes.user.username}\n` +
          `**Depois:** ${depois.nickname || depois.user.username}`
        )
        .addFields({
          name: 'Responsável',
          value: `${responsavel?.usuario || 'O próprio membro ou responsável não identificado'}`,
        });

      await enviar(depois.guild, 'servidor', embed);
    }

    const antesIds = new Set(antes.roles.cache.keys());
    const depoisIds = new Set(depois.roles.cache.keys());

    const adicionados = [...depoisIds].filter(
      (id) => !antesIds.has(id) && id !== depois.guild.id
    );

    const removidos = [...antesIds].filter(
      (id) => !depoisIds.has(id) && id !== depois.guild.id
    );

    if (adicionados.length || removidos.length) {
      const responsavel = await buscarResponsavel(
        depois.guild,
        AuditLogEvent.MemberRoleUpdate,
        depois.id
      );

      const embed = embedBase(
        '🎭 Cargos de membro alterados',
        '#5865F2'
      )
        .setDescription(`${depois}`)
        .addFields(
          {
            name: 'Cargos adicionados',
            value:
              adicionados.map((id) => `<@&${id}>`).join(', ') ||
              'Nenhum',
          },
          {
            name: 'Cargos removidos',
            value:
              removidos.map((id) => `<@&${id}>`).join(', ') ||
              'Nenhum',
          },
          {
            name: 'Responsável',
            value: `${responsavel?.usuario || 'Não identificado'}`,
          }
        );

      await enviar(depois.guild, 'cargos', embed);
    }
  });
};
