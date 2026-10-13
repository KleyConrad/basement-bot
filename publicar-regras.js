
require('dotenv').config();

const {
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const ID_APLICACAO = '1559366996112441354';
const ID_SERVIDOR = '1546332841766420490';

const comandos = [
  new SlashCommandBuilder()
    .setName('publicar-regras')
    .setDescription('Publica as regras oficiais do Basement')
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
      'Comando /publicar-regras registrado com sucesso!'
    );
  } catch (error) {
    console.error('Erro ao registrar comandos:', error);
  }
}

registrarComandos();
