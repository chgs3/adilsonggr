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

client.once("ready", () => {
  console.log(`✅ Bot está online como ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (!message.content.startsWith(prefix) || message.author.bot) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  console.log(`Comando recebido: ${command}, Argumentos: ${args.join(' ')}`);

  if (command === "play") {
    const query = args.join(" ");

    if (!query) {
      return message.reply("❌ Você precisa me dizer o que tocar! Use `!play <nome da música>` ou `!play <link do YouTube>`.");
    }

    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
      return message.reply("🎤 Você precisa estar em um canal de voz para eu tocar música!");
    }

    try {
      let videoUrl;
      let videoTitle;

      // Regex pra validar URL do YouTube
      const youtubeUrlRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/(watch\?v=|embed\/|v\/|)([\w-]{11})(.*)?$/;

      if (youtubeUrlRegex.test(query)) {
        // Se a query for uma URL, usa ela diretamente
        videoUrl = query;
        const info = await ytdl.getInfo(videoUrl);
        videoTitle = info.videoDetails.title;
        console.log(`URL do YouTube detectada: ${videoUrl}`);
      } else {
        // Se não for uma URL, tenta pesquisar pelo nome da música usando youtube-sr
        console.log(`Pesquisando por: ${query}`);
        const searchResults = await ytsr.search(query, { type: 'video', limit: 1 }); // busca só o primeiro resultado de vídeo
        
        if (searchResults.length === 0) {
          return message.reply(`😔 Não encontrei nenhuma música com o nome "${query}". Tente ser mais específico!`);
        }
        
        videoUrl = searchResults[0].url; // Pega a URL do primeiro resultado
        videoTitle = searchResults[0].title; // Pega o título do primeiro resultado
        message.channel.send(`🎵 Encontrei "${videoTitle}". Tocando agora!`);
      }

      // Garante que temos uma URL válida
      if (!videoUrl) {
          return message.reply("❌ Não foi possível encontrar um vídeo para tocar com a sua requisição.");
      }

      console.log(`Tentando tocar: ${videoTitle} (${videoUrl})`);

      // Cria o stream de áudio usando ytdl-core.
      // filter: 'audioonly' garante que estamos pegando apenas o áudio.
      // quality: 'highestaudio' pega a melhor qualidade de áudio disponível.
      const stream = ytdl(videoUrl, { filter: 'audioonly', quality: 'highestaudio' });
      
      // Cria o recurso de áudio para o @discordjs/voice
      const resource = createAudioResource(stream);
      const player = createAudioPlayer();

      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
      });

      connection.subscribe(player);
      player.play(resource);

      message.reply(`🎶 Tocando: **${videoTitle}**`);

      player.on(AudioPlayerStatus.Idle, () => {
        console.log("Música terminou, destruindo conexão.");
        connection.destroy();
      });

      player.on('error', error => {
        console.error('Erro no AudioPlayer:', error);
        message.channel.send('Ocorreu um erro durante a reprodução da música.');
        connection.destroy();
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
});

client.login(process.env.DISCORD_TOKEN);