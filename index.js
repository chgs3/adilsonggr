require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require("@discordjs/voice");
const ytdl = require("@distube/ytdl-core");
const ytsr = require("youtube-sr").YouTube;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

const prefix = "!";

// gerencia as filas por servidor
const guildQueues = new Map(); // Map para armazenar as filas de cada servidor
// Cada entrada no Map será: guildId -> { voiceChannel, connection, player, songs: [], currentIndex: -1, loop: false }

function getGuildQueue(guildId) {
  if (!guildQueues.has(guildId)) {
    guildQueues.set(guildId, {
      voiceChannel: null, // Canal de voz onde o bot está
      connection: null,   // Conexão de voz ativa
      player: null,       // AudioPlayer ativo
      songs: [],          // Array de músicas na fila
      currentIndex: -1,   // Índice da música atual na fila
      loop: false,        // Opção de loop
    });
  }
  return guildQueues.get(guildId);
}

// Função para tocar a próxima música na fila
async function playNextSong(guildId) {
  const queue = getGuildQueue(guildId);

  // Se a fila estiver vazia ou o índice fora dos limites, desconecta e limpa
  if (queue.songs.length === 0 || queue.currentIndex >= queue.songs.length || queue.currentIndex < 0) {
    if (queue.connection) {
      queue.connection.destroy();
      queue.connection = null;
      queue.voiceChannel = null;
    }
    if (queue.player) {
      queue.player.stop();
      queue.player = null;
    }
    queue.songs = [];
    queue.currentIndex = -1;
    console.log(`Fila do servidor ${guildId} esgotada. Conexão encerrada.`);
    // Se o canal de voz ainda existir, avise
    if (queue.voiceChannel && queue.voiceChannel.isTextBased()) { // Verifica se é um canal de texto
      queue.voiceChannel.send("Fila de músicas esgotada. Desconectando do canal de voz.");
    }
    guildQueues.delete(guildId); // Remove a entrada do mapa para limpar tudo
    return;
  }

  const song = queue.songs[queue.currentIndex];
  console.log(`Tentando tocar a próxima música: ${song.title} (${song.url})`);

  try {
    const stream = ytdl(song.url, { filter: 'audioonly', quality: 'highestaudio' });
    const resource = createAudioResource(stream);

    // Cria o player se ele não existir
    if (!queue.player) {
      queue.player = createAudioPlayer();
      queue.connection.subscribe(queue.player); // Assina a conexão ao player

      // Configura os listeners do player APENAS UMA VEZ
      queue.player.on(AudioPlayerStatus.Idle, () => {
        console.log(`Música "${song.title}" terminou.`);
        if (queue.loop) {
          playNextSong(guildId); // Se estiver em loop, toca a mesma música novamente
        } else {
          queue.currentIndex++; // Avança para a próxima música
          playNextSong(guildId);
        }
      });

      queue.player.on('error', error => {
        console.error(`Erro no AudioPlayer para ${song.title}:`, error);
        if (queue.voiceChannel && queue.voiceChannel.isTextBased()) {
          queue.voiceChannel.send(`❌ Ocorreu um erro ao tocar **${song.title}**. Pulando para a próxima...`);
        }
        if (queue.loop) {
          playNextSong(guildId); // Se estiver em loop, tenta tocar a mesma música novamente
        } else {
          queue.currentIndex++; // Pula para a próxima em caso de erro
          playNextSong(guildId);
        }
      });
    }

    queue.player.play(resource); // Toca a nova música
    if (queue.voiceChannel && queue.voiceChannel.isTextBased()) {
         queue.voiceChannel.send(`🎶 Tocando agora: **${song.title}**`);
    }

  } catch (error) {
    console.error(`Erro ao criar stream para ${song.title}:`, error);
    if (queue.voiceChannel && queue.voiceChannel.isTextBased()) {
         queue.voiceChannel.send(`❌ Não foi possível tocar **${song.title}**. Pulando para a próxima...`);
    }
    if (queue.loop) {
      playNextSong(guildId);
    } else {
      queue.currentIndex++;
      playNextSong(guildId);
    }
  }
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
  const queue = getGuildQueue(guildId); // Obtém a fila para o servidor

  if (command === "play") {
    const query = args.join(" ");

    if (!query) {
      return message.reply("❌ Você precisa me dizer o que tocar! Use `!play <nome da música>` ou `!play <link do YouTube>`.");
    }

    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
      return message.reply("🎤 Você precisa estar em um canal de voz para eu tocar música!");
    }

    // Se o bot já estiver em outro canal de voz
    if (queue.connection && queue.voiceChannel && queue.voiceChannel.id !== voiceChannel.id) {
        return message.reply(`Já estou em um canal de voz diferente (<#${queue.voiceChannel.id}>). Use o comando ` + "`!stop`" + ` lá primeiro se quiser me mover.`);
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
        // Não envia "Tocando agora!" aqui, pois pode ser adicionado à fila
        message.channel.send(`🎵 Encontrei **${videoTitle}**.`);
      }

      if (!videoUrl) {
          return message.reply("❌ Não foi possível encontrar um vídeo para tocar com a sua requisição.");
      }

      const song = { title: videoTitle, url: videoUrl };
      queue.songs.push(song); // Adiciona a música à fila

      // Se não houver conexão, ou se a conexão estiver desconectada, estabelece uma nova e começa a tocar
      if (!queue.connection || queue.connection.state.status === 'disconnected') {
        queue.voiceChannel = voiceChannel;
        queue.connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: message.guild.id,
          adapterCreator: message.guild.voiceAdapterCreator,
        });
        queue.currentIndex = 0; // Começa da primeira música (a que acabou de ser adicionada)
        playNextSong(guildId); // Inicia a reprodução
      } else if (queue.player && queue.player.state.status !== AudioPlayerStatus.Idle) {
        // Se já estiver tocando algo, apenas adiciona à fila
        message.channel.send(`✅ **${song.title}** adicionada à fila! Posição: ${queue.songs.length}`);
      } else {
        // Se a conexão existe mas o player está idle (ex: música anterior terminou), toca a próxima da fila
        queue.currentIndex = queue.songs.length - 1; // Toca a música que acabou de ser adicionada
        playNextSong(guildId);
      }

    } catch (error) {
      console.error("Erro ao adicionar música à fila:", error);
      if (error.message.includes("No video id found")) {
          message.reply("❌ Link do YouTube inválido ou vídeo não encontrado.");
      } else {
          message.reply("❌ Ocorreu um erro ao tentar adicionar a música. Verifique o nome/link e tente novamente.");
      }
    }
  }

  else if (command === "stop") {
    // Verifica se há algo para parar
    if (!queue.connection || queue.connection.state.status === 'disconnected') {
      return message.reply("❌ Não estou tocando nada no momento!");
    }

    // Verifica se o usuário está no mesmo canal de voz que o bot
    if (message.member.voice.channel && queue.voiceChannel && message.member.voice.channel.id !== queue.voiceChannel.id) {
        return message.reply("❌ Você precisa estar no mesmo canal de voz que eu para parar a música!");
    }
    
    // Limpa a fila e zera o índice
    queue.songs = [];
    queue.currentIndex = -1;
    
    // Para o player e destrói a conexão
    if (queue.player) queue.player.stop();
    queue.connection.destroy();

    // Remove a entrada do mapa para limpar tudo
    guildQueues.delete(guildId);

    message.reply("⏹️ Parando já, mermão!");
    console.log(`Bot parado e desconectado do servidor ${guildId}.`);
  }

  else if (command === "pause") {
    if (!queue.player || queue.player.state.status === AudioPlayerStatus.Idle) {
        return message.reply("❌ Não estou tocando nada para pausar!");
    }
    if (message.member.voice.channel && queue.voiceChannel && message.member.voice.channel.id !== queue.voiceChannel.id) {
        return message.reply("❌ Você precisa estar no mesmo canal de voz para pausar!");
    }
    if (queue.player.state.status === AudioPlayerStatus.Paused) {
        return message.reply("ℹ️ A música já está pausada.");
    }
    if (queue.player.state.status === AudioPlayerStatus.Playing) {
        queue.player.pause();
        message.reply("⏸️ Música pausada!");
        console.log(`Música pausada no servidor ${guildId}.`);
    } else {
        message.reply("❓ Não consigo pausar a música no estado atual. Tente novamente.");
    }
  }

  else if (command === "resume") {
    if (!queue.player || queue.player.state.status === AudioPlayerStatus.Idle) {
        return message.reply("❌ Não há nenhuma música pausada para retomar!");
    }
    if (message.member.voice.channel && queue.voiceChannel && message.member.voice.channel.id !== queue.voiceChannel.id) {
        return message.reply("❌ Você precisa estar no mesmo canal de voz para retomar!");
    }
    if (queue.player.state.status === AudioPlayerStatus.Playing) {
        return message.reply("ℹ️ A música já está tocando.");
    }
    if (queue.player.state.status === AudioPlayerStatus.Paused) {
        queue.player.unpause();
        message.reply("▶️ Música retomada!");
        console.log(`Música retomada no servidor ${guildId}.`);
    } else {
        message.reply("❓ Não consigo retomar a música no estado atual. Tente novamente.");
    }
  }

  else if (command === "skip") {
    if (!queue.connection || queue.songs.length === 0) {
      return message.reply("❌ Não há músicas na fila para pular!");
    }
    if (message.member.voice.channel && queue.voiceChannel && message.member.voice.channel.id !== queue.voiceChannel.id) {
        return message.reply("❌ Você precisa estar no mesmo canal de voz que eu para pular a música!");
    }

    if (queue.currentIndex + 1 < queue.songs.length) {
      queue.currentIndex++; // Avança para a próxima música
      playNextSong(guildId); // Toca a próxima música na fila
      message.reply("⏭️ Pulando para a próxima música!");
    } else {
      message.reply("End of queue. Não há mais músicas para pular. Desconectando.");
      queue.currentIndex++; // Força o índice a ir além do limite para desconectar
      playNextSong(guildId); // Isso fará com que o bot se desconecte
    }
  }

  else if (command === "previous") {
    if (!queue.connection || queue.songs.length === 0) {
      return message.reply("❌ Não há músicas anteriores para voltar!");
    }
    if (message.member.voice.channel && queue.voiceChannel && message.member.voice.channel.id !== queue.voiceChannel.id) {
        return message.reply("❌ Você precisa estar no mesmo canal de voz que eu para voltar a música!");
    }

    // Verifica se pode voltar (não está na primeira música)
    if (queue.currentIndex > 0) {
      queue.currentIndex--; // Volta para a música anterior
      playNextSong(guildId); // Toca a música anterior na fila
      message.reply("⏮️ Voltando para a música anterior!");
    } else {
      message.reply("Você já está na primeira música da fila. Não há música anterior.");
    }
  }

  else if (command === "queue") {
    const queue = getGuildQueue(message.guild.id); // Garante que a fila está atualizada

    if (queue.songs.length === 0) {
        return message.reply("🎶 A fila de músicas está vazia!");
    }

    let response = "🎶 **Fila de Músicas:**\n";
    queue.songs.forEach((song, index) => {
        // Adiciona um indicador '▶️' para a música atual
        response += `${index === queue.currentIndex ? "▶️" : ""}${index + 1}. ${song.title}\n`;
    });

    // Limita o tamanho da mensagem para evitar exceder o limite de caracteres do Discord (2000)
    if (response.length > 1900) {
        response = response.substring(0, 1900) + "\n... (fila muito longa, mostrando apenas o início)";
    }

    message.channel.send(response);
  }
});

client.login(process.env.DISCORD_TOKEN);