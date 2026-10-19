
require('dotenv').config();

const {
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const { ID_APLICACAO, ID_SERVIDOR } = require('./config');

const comandos = [
  new SlashCommandBuilder()
    .setName('publicar-regras')
    .setDescription('Publica as regras oficiais do Basement')
    .setDefaultMemberPermissions(
      PermissionFlagsBits.Administrator
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('tempo')
    .setDescription('Mostra o ranking de tempo em call do Basement')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('resettempo')
    .setDescription('Zera o ranking de tempo em call')
    .setDefaultMemberPermissions(
      PermissionFlagsBits.Administrator
    )
    .toJSON(),
];

async function registrarComandos() {
  if (!process.env.DISCORD_TOKEN) {
    throw new Error(
      'DISCORD_TOKEN não foi configurado no arquivo .env.'
    );
  }

  const rest = new REST({ version: '10' })
    .setToken(process.env.DISCORD_TOKEN);

  try {
    await rest.put(
      Routes.applicationGuildCommands(
        ID_APLICACAO,
        ID_SERVIDOR
      ),  
      { body: comandos }
    );

    console.log(
      'Comandos registrados com sucesso: /publicar-regras, /tempo e /resettempo!'
    );
  } catch (error) {
    console.error('Erro ao registrar comandos:', error);
  }
}

registrarComandos();
