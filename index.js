require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require("@discordjs/voice");
const ytdl = require("@distube/ytdl-core");
const ytsr = require("youtube-sr").YouTube; // faz a busca por nome ao invés de somente links

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

const prefix = "!";

// gerenciamento de players e conexões por servidor
const guildPlayers = new Map(); // Map para armazenar player e conexão de cada servidor
// Cada entrada no Map será: guildId -> { connection, player, voiceChannelId }

function getGuildPlayer(guildId) {
  if (!guildPlayers.has(guildId)) {
    guildPlayers.set(guildId, {
      connection: null,
      player: null,
      voiceChannelId: null // Para verificar se o usuário está no mesmo canal
    });
  }
  return guildPlayers.get(guildId);
}

client.once("ready", () => {
  console.log(`✅ Bot está online como ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (!message.content.startsWith(prefix) || message.author.bot) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  console.log(`Comando recebido: ${command}, Argumentos: ${args.join(' ')}`);

  const guildId = message.guild.id;
  const playerState = getGuildPlayer(guildId); // Obtém o estado do player para o servidor

  if (command === "play") {
    const query = args.join(" ");

    if (!query) {
      return message.reply("❌ Você precisa me dizer o que tocar! Use `!play <nome da música>` ou `!play <link do YouTube>`.");
    }

    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
      return message.reply("🎤 Você precisa estar em um canal de voz para eu tocar música!");
    }

    // Se o bot já tiver tocando ou em um canal de voz, não deve iniciar outro player
    // Por enquanto, sem fila, apenas um player por vez
    if (playerState.player && playerState.player.state.status !== AudioPlayerStatus.Idle) {
        // Se estiver tocando e no mesmo canal, pode querer pausar/retomar, mas play deve ser para iniciar algo novo ou adicionar à fila
        if (playerState.voiceChannelId === voiceChannel.id) {
            return message.reply("Já estou tocando uma música neste canal. Use `!pause` para pausar ou `!stop` para parar.");
        }
        // Se estiver em outro canal, avisa
        return message.reply(`Já estou em um canal de voz (<#${playerState.voiceChannelId}>). Por favor, use lá ou me pare primeiro.`);
    }
    // Se a conexão existe mas está desconectada (ex: bot foi kickado), limpa o estado
    if (playerState.connection && playerState.connection.state.status === 'disconnected') {
        playerState.connection = null;
        playerState.player = null;
        playerState.voiceChannelId = null;
    }


    try {
      let videoUrl;
      let videoTitle;

      const youtubeUrlRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/(watch\?v=|embed\/|v\/|)([\w-]{11})(.*)?$/;

      if (youtubeUrlRegex.test(query)) {
        videoUrl = query;
        const info = await ytdl.getInfo(videoUrl);
        videoTitle = info.videoDetails.title;
        console.log(`URL do YouTube detectada: ${videoUrl}`);
      } else {
        console.log(`Pesquisando por: ${query}`);
        const searchResults = await ytsr.search(query, { type: 'video', limit: 1 });
        
        if (searchResults.length === 0) {
          return message.reply(`😔 Não encontrei nenhuma música com o nome "${query}". Tente ser mais específico!`);
        }
        
        videoUrl = searchResults[0].url;
        videoTitle = searchResults[0].title;
        message.channel.send(`🎵 Encontrei "${videoTitle}".`);
      }

      if (!videoUrl) {
          return message.reply("❌ Não foi possível encontrar um vídeo para tocar com a sua requisição.");
      }

      console.log(`Tentando tocar: ${videoTitle} (${videoUrl})`);

      const stream = ytdl(videoUrl, { filter: 'audioonly', quality: 'highestaudio' });
      const resource = createAudioResource(stream);
      
      const player = createAudioPlayer(); // Sempre cria um novo player para evitar estados antigos
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
      });

      // Armazena o player e a conexão no estado do servidor
      playerState.player = player;
      playerState.connection = connection;
      playerState.voiceChannelId = voiceChannel.id;

      connection.subscribe(player);
      player.play(resource);

      message.reply(`🎶 Tocando: **${videoTitle}**`);

      // Eventos do player
      player.on(AudioPlayerStatus.Idle, () => {
        console.log("Música terminou, destruindo conexão.");
        connection.destroy();
        // Limpa o estado do player para o servidor
        playerState.player = null;
        playerState.connection = null;
        playerState.voiceChannelId = null;
      });

      player.on('error', error => {
        console.error('Erro no AudioPlayer:', error);
        message.channel.send('Ocorreu um erro durante a reprodução da música.');
        connection.destroy();
        // Limpa o estado do player para o servidor em caso de erro
        playerState.player = null;
        playerState.connection = null;
        playerState.voiceChannelId = null;
      });

    } catch (error) {
      console.error("Erro ao tocar música:", error);
      if (error.message.includes("No video id found")) {
          message.reply("❌ Link do YouTube inválido ou vídeo não encontrado.");
      } else {
          message.reply("❌ Ocorreu um erro ao tentar tocar a música. Verifique o nome/link e tente novamente.");
      }
    }
  }

  else if (command === "stop") {
    // Verifica se o bot está tocando algo ou conectado
    if (!playerState.connection || playerState.connection.state.status === 'disconnected') {
      return message.reply("❌ Não estou tocando nada agora!");
    }

    // Verifica se o usuário está no mesmo canal de voz que o bot
    if (message.member.voice.channel && playerState.voiceChannelId && message.member.voice.channel.id !== playerState.voiceChannelId) {
        return message.reply("❌ Você precisa estar no mesmo canal de voz que eu pra parar a música!");
    }
    
    playerState.player.stop(); // Para a reprodução
    playerState.connection.destroy(); // Destrói a conexão de voz

    // Limpa o estado do player para o servidor
    playerState.player = null;
    playerState.connection = null;
    playerState.voiceChannelId = null;

    message.reply("⏹️ Parando já, mermão!");
    console.log(`Bot parado e desconectado do servidor ${guildId}.`);
  }

else if (command === "pause") {
    const playerState = getGuildPlayer(message.guild.id); // Garante que playerState está atualizado

    // Verifica se o bot está tocando algo
    if (!playerState.player || playerState.player.state.status === AudioPlayerStatus.Idle) {
        return message.reply("❌ Não estou tocando nada para pausar!");
    }

    // Verifica se o usuário está no mesmo canal de voz que o bot
    if (message.member.voice.channel && playerState.voiceChannelId && message.member.voice.channel.id !== playerState.voiceChannelId) {
        return message.reply("❌ Você precisa estar no mesmo canal de voz para pausar!");
    }

    // Verifica se a música já está pausada
    if (playerState.player.state.status === AudioPlayerStatus.Paused) {
        return message.reply("ℹ️ A música já está pausada.");
    }

    // Se estiver tocando, pausa
    if (playerState.player.state.status === AudioPlayerStatus.Playing) {
        playerState.player.pause(); // Pausa a reprodução
        message.reply("⏸️ Música pausada!");
        console.log(`Música pausada no servidor ${message.guild.id}.`);
    } else {
        message.reply("❓ Não consigo pausar a música no estado atual. Tente novamente.");
    }
}

else if (command === "resume") { // usa o comando resume para retomar a música pausada
    const playerState = getGuildPlayer(message.guild.id); // Garante que playerState está atualizado

    // Verifica se o bot tem um player, mas não está ocioso
    if (!playerState.player || playerState.player.state.status === AudioPlayerStatus.Idle) {
        return message.reply("❌ Não tem nenhuma música pausada para retomar!");
    }

    // Verifica se o usuário está no mesmo canal de voz que o bot
    if (message.member.voice.channel && playerState.voiceChannelId && message.member.voice.channel.id !== playerState.voiceChannelId) {
        return message.reply("❌ Você precisa estar no mesmo canal de voz para retomar!");
    }

    // Verifica se a música já está tocando
    if (playerState.player.state.status === AudioPlayerStatus.Playing) {
        return message.reply("ℹ️ A música já está tocando.");
    }

    // Se estiver pausada, retoma
    if (playerState.player.state.status === AudioPlayerStatus.Paused) {
        playerState.player.unpause(); // Retoma a reprodução
        message.reply("▶️ Música retomada!");
        console.log(`Música retomada no servidor ${message.guild.id}.`);
    } else {
        message.reply("❓ Não consigo retomar a música no estado atual. Tente novamente.");
    }
}
});

client.login(process.env.DISCORD_TOKEN);