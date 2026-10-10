const {
    default: makeWASocket, useMultiFileAuthState, DisconnectReason
} = require('@whiskeysockets/baileys');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const yts = require('yt-search');
const ytdlp = require('youtube-dl-exec');
// 👇 AQUÍ CARGAMOS FFMPEG AUTOMÁTICAMENTE
const ffmpegPath = require('ffmpeg-static');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile); 
const manejarAntilink = require('./comandos/antilink');
const manejarIA = require('./comandos/ia');
const manejarComandosPersonalizados = require('./comandos/personalizados');
const manejarLink = require('./comandos/link');
const manejarAutoadmin = require('./comandos/autoadmin');
const manejarGrupos = require('./comandos/grupos');
const manejarBotReglas = require('./comandos/botreglas');
const manejarAntiprivado = require('./comandos/antprivado');
const manejarMute = require('./comandos/mute');
const manejarKick = require('./comandos/kick');
const manejarHorarioGrupo = require('./comandos/horario-grupo');
const manejarJoin = require('./comandos/join');

// ========================================
// 🦖 DINO BOT - DINO BOT
// ========================================

const PREFIJO = '.';
const BOT_START_TIME = Date.now();

// 👑 DATOS DEL CREADOR
const OWNER_NOMBRE = 'ALAN';
const OWNER_NUMERO = '5217715555998';
const CONFIG_PATH = path.join( __dirname, 'database', 'config.json' );
const MUSIC_PATH = path.join( __dirname, 'music' );
const MEDIA_PATH = path.join( __dirname, 'media' );

// 🖼️ FOTO DEL MENÚ DESDE INTERNET
const MENU_URL = 'https://i.postimg.cc/8P1vFmGr/7ba5b53616a37d3e98b609f3abadd7d5.jpg';

// ========================================
// 📁 CREAR CARPETAS
// ========================================

if (!fs.existsSync(path.join(__dirname, 'database'))) {
    fs.mkdirSync( path.join(__dirname, 'database'), {
        recursive: true
    } );
} if (!fs.existsSync(MUSIC_PATH)) {
    fs.mkdirSync( MUSIC_PATH, {
        recursive: true
    } );
} if (!fs.existsSync(MEDIA_PATH)) {
    fs.mkdirSync( MEDIA_PATH, {
        recursive: true
    } );
}

// ========================================
// 🖼️ DESCARGAR FOTO DEL MENÚ
// ========================================

async function descargarFotoMenu() {
    const respuesta = await fetch(MENU_URL);
    if (!respuesta.ok) {
        throw new Error(`No se pudo descargar la foto (${respuesta.status})`);
    }
    const contenido = await respuesta.arrayBuffer();
    return Buffer.from(contenido);
}

// ========================================
// ⚙️ CONFIGURACIÓN
// ========================================

function cargarConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) {
            const configuracionInicial = {
                nombreBot: 'DINO BOT', owner: OWNER_NUMERO
            };
            fs.writeFileSync( CONFIG_PATH, JSON.stringify(configuracionInicial, null, 4) );
            return configuracionInicial;
        } const config = JSON.parse( fs.readFileSync(CONFIG_PATH, 'utf8') );
        if (!config.owner) {
            config.owner = OWNER_NUMERO;
            guardarConfig(config);
        } if (!config.nombreBot) {
            config.nombreBot = 'DINO BOT';
            guardarConfig(config);
        } return config;
    } catch (error) {
        console.error( '🦖❌ Error leyendo config.json:', error );
        return {
            nombreBot: 'DINO BOT', owner: OWNER_NUMERO
        };
    }
}

// ========================================
// 💾 GUARDAR CONFIGURACIÓN
// ========================================

function guardarConfig(config) {
    fs.writeFileSync( CONFIG_PATH, JSON.stringify(config, null, 4) );
}

// ========================================
// 🗑️ ELIMINAR ARCHIVO
// ========================================

function eliminarArchivo(archivo) {
    try {
        if (fs.existsSync(archivo)) {
            fs.unlinkSync(archivo);
            console.log(`🗑️ Archivo eliminado: ${archivo}`);
        }
    } catch (error) {
        console.error( '🦖❌ No se pudo eliminar archivo:', error.message );
    }
}

// ========================================
// 💻 TERMINAL
// ========================================

const rl = readline.createInterface( {
    input: process.stdin, output: process.stdout
});

function preguntar(texto) {
    return new Promise((resolve) => {
        rl.question(texto, resolve);
    });
}

// ========================================
// 👤 ENCABEZADO DINO BOT PARA TODOS LOS MENSAJES
// ========================================

function crearEncabezadoDino(sock) {
    try {
        const numeroBot = (sock.user?.id || '')
            .split(':')[0]
            .split('@')[0]
            .replace(/\D/g, '');

        if (!numeroBot) return null;

        const vcard =
            `BEGIN:VCARD\n` +
            `VERSION:3.0\n` +
            `FN:DINO BOT\n` +
            `N:DINO BOT;;;;\n` +
            `ORG:DINO BOT;\n` +
            `TEL;type=CELL;type=VOICE;waid=${numeroBot}:+${numeroBot}\n` +
            `END:VCARD`;

        return {
            key: {
                fromMe: false,
                participant: '0@s.whatsapp.net',
                remoteJid: 'status@broadcast',
                id: `DinoBotHeader-${numeroBot}`
            },
            message: {
                contactMessage: {
                    displayName: 'DINO BOT',
                    vcard
                }
            }
        };
    } catch (error) {
        console.error('🦖⚠️ No pude crear el encabezado DINO BOT:', error.message);
        return null;
    }
}

async function enviarConEncabezado(sock, chat, contenido, opciones = {}) {
    const encabezado = crearEncabezadoDino(sock);
    const opcionesFinales = {
        ...opciones
    };

    if (encabezado) {
        opcionesFinales.quoted = encabezado;
    }

    return sock.sendMessage(chat, contenido, opcionesFinales);
}

// ========================================
// 🦖 INICIAR BOT
// ========================================

async function iniciarBot() {
    const config = cargarConfig();
    const {
        state, saveCreds
    } = await useMultiFileAuthState('./session');
    const sock = makeWASocket( {
        auth: state, printQRInTerminal: false
    });
    sock.ev.on('creds.update', saveCreds);

    // ========================================
    // 📱 VINCULACIÓN
    // ========================================
    if (!state.creds.registered) {
        const numero = await preguntar( '🦖📱 Escribe tu número de WhatsApp con código de país: ' );
        const numeroLimpio = numero.replace(/\D/g, '');
        try {
            const codigo = await sock.requestPairingCode(numeroLimpio);
            console.log('\n');
            console.log('🦖🦖🦖🦖🦖🦖🦖🦖');
            console.log('       🦖 DINO BOT');
            console.log('🦖🦖🦖🦖🦖🦖🦖🦖');
            console.log('');
            console.log('🔐 ALANSHOP:');
            console.log('');
            console.log(`       ${codigo}`);
            console.log('');
            console.log( '🦖 Vincula el dispositivo desde WhatsApp.' );
            console.log('');
        } catch (error) {
            console.error( '🦖❌ Error generando código:', error );
        }
    }

    // ========================================
    // 🔌 CONEXIÓN
    // ========================================
    sock.ev.on( 'connection.update', (update) => {
        const {
            connection, lastDisconnect
        } = update;
        if (connection === 'open') {
            manejarHorarioGrupo.reanudarTimers(sock).catch(error => {
                console.error('🦖❌ No pude reanudar los horarios de grupos:', error.message);
            });
            manejarJoin.reanudarSalidas(sock).catch(error => {
                console.error('🦖❌ No pude reanudar las salidas programadas de grupos:', error.message);
            });
            const nombreActual = cargarConfig().nombreBot;
            console.log('\n');
            console.log('🦖🦖🦖🦖🦖🦖🦖🦖🦖');
            console.log(`       🟢 ${nombreActual}`);
            console.log('       🦖 DINO BOT');
            console.log('       🦕 ¡CONECTADO!');
            console.log('🦖🦖🦖🦖🦖🦖🦖🦖🦖');
            console.log('');
        } if (connection === 'close') {
            const debeReconectar = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('🦖🔴 Bot desconectado.');
            if (debeReconectar) {
                console.log('🦖🔄 Reconectando...');
                iniciarBot();
            } else {
                console.log('🦖❌ Sesión cerrada.');
            }
        }
    } );

    // ========================================
    // 💬 MENSAJES
    // ========================================
    sock.ev.on( 'messages.upsert', async ( {
        messages
    }) => {
        try {
            const mensaje = messages[0];
            if (!mensaje.message) return;
            if (mensaje.key.fromMe) return;
            const configAntiprivado = cargarConfig();
            const privadoInterceptado = await manejarAntiprivado.procesarMensaje({
                sock,
                mensaje,
                ownerNumero: configAntiprivado.owner || OWNER_NUMERO,
                enviarConEncabezado
            });
            if (privadoInterceptado) return;
            const mensajeSilenciado = await manejarMute.procesarMensaje({ sock, mensaje });
            if (mensajeSilenciado) return;
            const texto = mensaje.message.conversation ||
                mensaje.message.extendedTextMessage?.text ||
                mensaje.message.buttonsResponseMessage?.selectedButtonId ||
                mensaje.message.templateButtonReplyMessage?.selectedId ||
                mensaje.message.listResponseMessage?.singleSelectReply?.selectedRowId || '';
            if (texto) {
                const comandoJoinLog = texto.trim().match(/^\.join\s+\S+(?:\s+(\d+))?/i);
                const textoLog = comandoJoinLog
                    ? `.join [enlace de invitación oculto]${comandoJoinLog[1] ? ` ${comandoJoinLog[1]} ${comandoJoinLog[1] === '1' ? 'día' : 'días'}` : ''}`
                    : texto;
                console.log(`🦖📩 ${textoLog}`);
            }
            const antilinkManejado = await manejarAntilink({
                sock,
                mensaje,
                texto,
                prefijo: PREFIJO,
                enviarConEncabezado
            });
            if (antilinkManejado) return;
            if (!texto) return;
            if (!texto.startsWith(PREFIJO)) {
                return;
            } const contenido = texto .slice(PREFIJO.length) .trim();
            if (!contenido) return;
            const partes = contenido.split(/\s+/);
            const comando = partes[0].toLowerCase();
            const argumentos = partes.slice(1);
            const chat = mensaje.key.remoteJid;
            const configActual = cargarConfig();
            const nombreActual = configActual.nombreBot;

            if (comando === 'antprivado') {
                await manejarAntiprivado.manejarComando({
                    sock,
                    chat,
                    mensaje,
                    argumentos,
                    ownerNumero: configActual.owner || OWNER_NUMERO,
                    enviarConEncabezado
                });
                return;
            }

            if (comando === 'botreglas') {
                await manejarBotReglas({ sock, chat, enviarConEncabezado });
                return;
            }

            if (comando === 'grupos') {
                await manejarGrupos({
                    sock,
                    mensaje,
                    chat,
                    comando,
                    argumentos,
                    contenido,
                    ownerNumero: configActual.owner || OWNER_NUMERO,
                    enviarConEncabezado
                });
                return;
            }

            if (comando === 'join') {
                await manejarJoin({
                    sock,
                    mensaje,
                    chat,
                    argumentos,
                    ownerNumero: configActual.owner || OWNER_NUMERO,
                    nombreBot: nombreActual,
                    enviarConEncabezado
                });
                return;
            }

            if (comando === 'autoadmin') {
                await manejarAutoadmin({
                    sock,
                    chat,
                    mensaje,
                    ownerNumero: configActual.owner || OWNER_NUMERO,
                    enviarConEncabezado
                });
                return;
            }

            if (comando === 'link') {
                await manejarLink({ sock, chat, enviarConEncabezado });
                return;
            }

            if (comando === 'mute' || comando === 'unmute') {
                await manejarMute.manejarComando({
                    sock,
                    chat,
                    mensaje,
                    comando,
                    enviarConEncabezado
                });
                return;
            }

            if (comando === 'kick') {
                await manejarKick({ sock, chat, mensaje, enviarConEncabezado });
                return;
            }

            if (comando === 'abrir' || comando === 'cerrar') {
                await manejarHorarioGrupo({
                    sock,
                    chat,
                    mensaje,
                    comando,
                    argumentos,
                    enviarConEncabezado
                });
                return;
            }

            const comandoPersonalizadoManejado = await manejarComandosPersonalizados({
                    sock,
                    mensaje,
                    chat,
                    comando,
                    argumentos,
                    contenido,
                    enviarConEncabezado
                });
            if (comandoPersonalizadoManejado) return;

            if (comando === 'ia') {
                await manejarIA({
                    sock,
                    chat,
                    mensaje,
                    pregunta: argumentos.join(' '),
                    enviarConEncabezado
                });
                return;
            }

            // ========================================
            // 👤 IDENTIFICAR REMITENTE
            // ========================================
            const normalizarNumero = (jid) => String(jid || '')
                .split('@')[0]
                .split(':')[0]
                .replace(/\D/g, '');
            const remitentes = [
                mensaje.key.participant,
                mensaje.key.participantAlt,
                mensaje.key.participantPn,
                mensaje.key.remoteJid,
                mensaje.key.remoteJidAlt,
                mensaje.key.remoteJidPn
            ].map(normalizarNumero).filter(Boolean);

            // ========================================
            // 🦖 .HOLA
            // ========================================
            if (comando === 'hola') {
                await enviarConEncabezado( sock, chat, {
                    text: `🦖 ¡ROOOAAR! 🦖\n\n` + `👋 ¡Hola!\n\n` + `Soy \\\\\\\\\\\\\\*${nombreActual}\\\\\\\\\\\\\\* 🦕\n` + `🏪 Tu asistente dinosaurio\n\n` + `🦴 Escribe \\\\\\\\\\\\\\*.menu\\\\\\\\\\\\\\* para ver mis comandos.`
                } );
            }

            // ========================================
            // 🏓 .PING
            // ========================================
            else if (comando === 'ping') {
                await enviarConEncabezado( sock, chat, {
                    text: `🦖🏓 \\\\\\\\\\\\\\*PONG JURÁSICO\\\\\\\\\\\\\\* 🏓🦖\n\n` + `🦕 Bot: \\\\\\\\\\\\\\*${nombreActual}\\\\\\\\\\\\\\*\n` + `🦖 DINO BOT\n` + `🦴 Estado: 🟢 ¡VIVO!`
                } );
            }

            // ========================================
            // 📜 .MENU
            // ========================================
            else if (comando === 'menu') {
                let menu = '';
                menu += `🌸✨ *${nombreActual}* ✨🌸\n`;
                menu += `╭━━〔 🌷 INFO 〕━━╮\n`;
                menu += `┃ 🌸 .hola\n┃ 🌸 .ping\n┃ 🌸 .menu\n┃ 🌸 .owner\n┃ 🌸 .runtime\n┃ 🌸 .totalfunciones\n┃ 🌸 .botreglas\n`;
                menu += `╰━━━━━━━━━━━━╯\n\n`;
                menu += `╭━━〔 🎵 DESCARGAS 〕━━╮\n`;
                menu += `┃ 🌸 .play <canción>\n┃ 🌸 .play2 <video o enlace>\n`;
                menu += `╰━━━━━━━━━━━━━━╯\n\n`;
                menu += `╭━━〔 🤖 INTELIGENCIA ARTIFICIAL 〕━━╮\n`;
                menu += `┃ 🌸 .ia <tu pregunta>\n`;
                menu += `╰━━━━━━━━━━━━━━━━╯\n\n`;
                if (chat.endsWith('@g.us')) {
                    menu += `╭━━〔 👥 GRUPOS 〕━━╮\n`;
                    menu += `┃ 🌸 .n <mensaje>\n┃ 🌸 .link\n┃ 🌸 .comandos\n┃ 🌸 .mute @usuario\n┃ 🌸 .unmute @usuario\n┃ 🌸 .kick @usuario\n┃ 🌸 .abrir <tiempo>\n┃ 🌸 .cerrar <tiempo>\n┃ 🌸 .setstock <respuesta>\n┃ 🌸 .settramites <respuesta>\n`;
                    menu += `╰━━━━━━━━━━━━━━╯\n\n`;
                }
                menu += `╭━━〔 👑 OWNER 〕━━╮\n`;
                menu += `┃ 🌸 .nombre <nuevo nombre>\n┃ 🌸 .autoadmin\n┃ 🌸 .grupos\n┃ 🌸 .join <enlace> <días>\n┃ 🌸 .antprivado <on/off>\n`;
                menu += `╰━━━━━━━━━━━━━━╯\n\n`;
                menu += `🌸 *Menú actualizado*\n`;
                menu += `🦖💙 *DINO BOT* 💙🦖`;

                const botones = [
                    { buttonId: '.menu', buttonText: { displayText: '🌸 MENÚ' }, type: 1 },
                    { buttonId: '.owner', buttonText: { displayText: '👑 OWNER' }, type: 1 },
                    { buttonId: '.ping', buttonText: { displayText: '⚡ PING' }, type: 1 }
                ];
                try {
                    const fotoMenu = await descargarFotoMenu();
                    await enviarConEncabezado(sock, chat, { image: fotoMenu, caption: menu, buttons: botones, headerType: 4 });
                } catch (error) {
                    console.error('🌸 Error descargando foto del menú:', error.message);
                    await enviarConEncabezado(sock, chat, { text: `${menu}\n\n⚠️ No pude cargar la foto del menú.` });
                }
            }

            else if (comando === 'runtime') {
                const segundos = Math.floor((Date.now() - BOT_START_TIME) / 1000);
                const dias = Math.floor(segundos / 86400);
                const horas = Math.floor((segundos % 86400) / 3600);
                const minutos = Math.floor((segundos % 3600) / 60);
                const seg = segundos % 60;
                await enviarConEncabezado(sock, chat, { text: `🌸 *TIEMPO ACTIVO*\n\n🦖 ${dias} días, ${horas} horas, ${minutos} minutos y ${seg} segundos.` });
            }

            else if (comando === 'totalfunciones') {
                const disponibles = ['hola','ping','menu','owner','runtime','totalfunciones','botreglas','play','play2','ia','n','link','comandos','mute','unmute','kick','abrir','cerrar','setstock','settramites','nombre','autoadmin','grupos','join','antprivado'];
                await enviarConEncabezado(sock, chat, { text: `🌸 *COMANDOS CONECTADOS*\n\nActualmente hay ${disponibles.length} comandos y accesos principales registrados en el menú.\n\nUsa *.menu* para verlos.\n\nNota: este número cuenta los comandos principales conocidos, no todas las variantes ni subcomandos.` });
            }

            // ========================================
            // 👑 .OWNER
            // ========================================
            else if (comando === 'owner') {
                await enviarConEncabezado( sock, chat, {
                    contacts: {
                        displayName: OWNER_NOMBRE, contacts: [ {
                            vcard: `BEGIN:VCARD\n` + `VERSION:3.0\n` + `FN:${OWNER_NOMBRE}\n` + `N:${OWNER_NOMBRE};;;;\n` + `TEL;type=CELL;type=VOICE;waid=${OWNER_NUMERO}:+${OWNER_NUMERO}\n` + `END:VCARD`
                        } ]
                    }
                } );
            }

            // ========================================
            // 👑 .NOMBRE
            // ========================================
            else if (comando === 'nombre') {
                const ownerConfigurado = normalizarNumero(configActual.owner || OWNER_NUMERO);
                if (!ownerConfigurado || !remitentes.includes(ownerConfigurado)) {
                    console.warn('🦖⚠️ Acceso a .nombre rechazado: el número del mensaje no coincide con database/config.json -> owner.');
                    await enviarConEncabezado( sock, chat, {
                        text: `🦖🚫 *¡GRRR! ACCESO DENEGADO* 🚫🦖\n\n` +
                              `🦴 Este comando es exclusivo del *OWNER* 👑\n\n` +
                              `🦕 Revisa que database/config.json → owner tenga tu número completo con código de país, solo dígitos.`
                    } );
                    return;
                } if (argumentos.length === 0) {
                    await enviarConEncabezado( sock, chat, {
                        text: `🦖❗ \\\\\\\\\\\\\\*Falta el nombre\\\\\\\\\\\\\\*\n\n` + `🦕 Usa:\n\n` + `\\\\\\\\\\\\\\*.nombre NUEVO NOMBRE\\\\\\\\\\\\\\*\n\n` + `🦴 Ejemplo:\n` + `\\\\\\\\\\\\\\*.nombre ALAN BOT\\\\\\\\\\\\\\*`
                    } );
                    return;
                } const nuevoNombre = argumentos.join(' ');
                if (nuevoNombre.length > 30) {
                    await enviarConEncabezado( sock, chat, {
                        text: `🦖❌ \\\\\\\\\\\\\\*Nombre demasiado largo\\\\\\\\\\\\\\*\n\n` + `🦴 Máximo 30 caracteres.`
                    } );
                    return;
                } configActual.nombreBot = nuevoNombre;
                guardarConfig(configActual);
                await enviarConEncabezado( sock, chat, {
                    text: `🦖🦖🦖 \\\\\\\\\\\\\\*¡ROOOAAR!\\\\\\\\\\\\\\* 🦖🦖🦖\n\n` + `👑 \\\\\\\\\\\\\\*OWNER AUTORIZADO\\\\\\\\\\\\\\*\n\n` + `✅ Nombre cambiado correctamente.\n\n` + `🦴 Antes:\n` + `\\\\\\\\\\\\\\*${nombreActual}\\\\\\\\\\\\\\*\n\n` + `🦕 Ahora:\n` + `\\\\\\\\\\\\\\*${nuevoNombre}\\\\\\\\\\\\\\*\n\n` + `🦖 DINO BOT\n` + `🦖 ¡Nombre guardado!`
                } );
                console.log( `👑🦖 Nombre cambiado: ${nombreActual} → ${nuevoNombre}` );
            }

            // ========================================
            // 🎵 .PLAY (AHORA CON FFMPEG)
            // ========================================
            else if (comando === 'play') {
                if (argumentos.length === 0) {
                    await enviarConEncabezado(sock, chat, {
                        text: `🦖❗ *FALTA LA CANCIÓN* ❗🦖\n\n` +
                              `🦴 Usa:\n*.play nombre de la canción*\n\n` +
                              `🎵 Ejemplo:\n*.play Bad Bunny Monaco*`
                    });
                    return;
                }

                const busqueda = argumentos.join(' ');
                const timestamp = Date.now();
                const rutaAudio = path.join(MUSIC_PATH, `audio_${timestamp}.mp3`);

                try { await sock.sendMessage(chat, { react: { text: '⏳', key: mensaje.key } }); } catch (e) {}

                try {
                    console.log(`🦖🎵 Buscando canción: ${busqueda}`);
                    const resultado = await yts(busqueda);
                    const video = resultado?.videos?.[0];
                    if (!video?.url) throw new Error('No se encontró la canción.');

                    const titulo = video.title || busqueda;
                    const url = String(video.url).replace(/\\/g, '');

                    await ytdlp(url, {
                        extractAudio: true,
                        audioFormat: 'mp3',
                        audioQuality: '5',
                        output: rutaAudio,
                        noPlaylist: true,
                        ffmpegLocation: ffmpegPath, // 👈 FFmpeg integrado
                        retries: 5,
                        fragmentRetries: 5,
                        extractorRetries: 3,
                        noWarnings: true
                    });

                    if (!fs.existsSync(rutaAudio)) throw new Error('No se encontró el audio descargado.');
                    await enviarConEncabezado(sock, chat, {
                        audio: fs.readFileSync(rutaAudio),
                        mimetype: 'audio/mpeg',
                        fileName: `${titulo}.mp3`,
                        ptt: false
                    });

                    try { await sock.sendMessage(chat, { react: { text: '✅', key: mensaje.key } }); } catch (e) {}
                    eliminarArchivo(rutaAudio);
                    console.log(`🦖📤 Audio enviado correctamente: ${titulo}`);
                } catch (error) {
                    console.error('🦖❌ Error en .play:', error);
                    eliminarArchivo(rutaAudio);
                    try { await sock.sendMessage(chat, { react: { text: '❌', key: mensaje.key } }); } catch (e) {}
                    await enviarConEncabezado(sock, chat, { text: `🦖❌ *NO PUDE DESCARGAR LA CANCIÓN*\n\n🦴 ${error.message}` });
                }
            }

            // ========================================
            // 🎬 .PLAY2 (DESCARGA Y CONVERSIÓN MP4)
            // ========================================
            else if (comando === 'play2') {
                if (argumentos.length === 0) {
                    await enviarConEncabezado(sock, chat, {
                        text: `🦖❗ *FALTA EL VIDEO* ❗🦖\n\n` +
                              `🦴 Usa:\n*.play2 nombre del video*\n` +
                              `También puedes pegar un enlace de YouTube.\n\n` +
                              `🎬 Ejemplo:\n*.play2 el circo el fantasma*`
                    });
                    return;
                }

                const busqueda = argumentos.join(' ').trim();
                const timestamp = Date.now();
                const prefijoArchivo = `video_${timestamp}`;
                const rutaBase = path.join(MEDIA_PATH, prefijoArchivo);
                const rutaDescarga = `${rutaBase}.%(ext)s`;
                const rutaVideo = `${rutaBase}_whatsapp.mp4`;
                let archivoEntrada = null;

                try { await sock.sendMessage(chat, { react: { text: '⏳', key: mensaje.key } }); } catch (e) {}

                try {
                    let url;
                    let titulo = busqueda;

                    if (/^https?:\/\//i.test(busqueda)) {
                        url = busqueda;
                    } else {
                        console.log(`🦖🎬 Buscando video: ${busqueda}`);
                        const resultado = await yts(busqueda);
                        const videoEncontrado = resultado?.videos?.[0];
                        if (!videoEncontrado?.url) throw new Error('No se encontró el video. Prueba con otras palabras o pega el enlace directo.');
                        url = String(videoEncontrado.url).replace(/\\/g, '');
                        titulo = videoEncontrado.title || busqueda;
                    }

                    // Limitar la descarga a 480p reduce el tiempo de red y de conversión.
                    // Si no hay formatos de esa resolución, se usa el mejor formato disponible.
                    await ytdlp(url, {
                        format: 'bv[height<=480]+ba/b[height<=480]/b',
                        mergeOutputFormat: 'mp4',
                        output: rutaDescarga,
                        noPlaylist: true,
                        ffmpegLocation: ffmpegPath,
                        retries: 5,
                        fragmentRetries: 5,
                        concurrentFragments: 8,
                        extractorRetries: 3,
                        noWarnings: true
                    });

                    const archivos = fs.readdirSync(MEDIA_PATH)
                        .filter(nombre => nombre.startsWith(`${prefijoArchivo}.`))
                        .filter(nombre => !/\.(part|ytdl)$/i.test(nombre))
                        .filter(nombre => !nombre.endsWith('_whatsapp.mp4'))
                        .map(nombre => path.join(MEDIA_PATH, nombre))
                        .filter(archivo => {
                            try { return fs.statSync(archivo).isFile(); } catch (e) { return false; }
                        });

                    if (!archivos.length) throw new Error('yt-dlp terminó pero no apareció el archivo descargado. Revisa que yt-dlp y FFmpeg estén actualizados.');
                    archivoEntrada = archivos[0];

                    // Convertir a MP4 compatible con WhatsApp, manteniendo la proporción
                    // (incluidos videos verticales) y permitiendo que el origen no tenga audio.
                    await execFileAsync(ffmpegPath, [
                        '-y',
                        '-i', archivoEntrada,
                        '-map', '0:v:0',
                        '-map', '0:a:0?',
                        '-c:v', 'libx264',
                        '-preset', 'ultrafast',
                        '-crf', '28',
                        '-pix_fmt', 'yuv420p',
                        '-c:a', 'aac',
                        '-b:a', '128k',
                        '-vf', 'scale=854:480:force_original_aspect_ratio=decrease:force_divisible_by=2',
                        '-movflags', '+faststart',
                        rutaVideo
                    ], { maxBuffer: 20 * 1024 * 1024, windowsHide: true });

                    if (!fs.existsSync(rutaVideo) || fs.statSync(rutaVideo).size < 10000) {
                        throw new Error('FFmpeg no generó un video MP4 válido.');
                    }

                    const tamañoMB = (fs.statSync(rutaVideo).size / 1024 / 1024).toFixed(2);
                    const nombreSeguro = String(titulo).replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);

                    await enviarConEncabezado(sock, chat, {
                        video: fs.readFileSync(rutaVideo),
                        mimetype: 'video/mp4',
                        fileName: `${nombreSeguro}.mp4`,
                        caption: `🦖🎬 *${titulo}*\n\n📦 ${tamañoMB} MB\n🦖 DINO BOT`
                    });

                    try { await sock.sendMessage(chat, { react: { text: '✅', key: mensaje.key } }); } catch (e) {}
                    console.log(`🦖📤 Video convertido y enviado correctamente: ${titulo}`);
                } catch (error) {
                    console.error('🦖❌ Error en .play2:', error);
                    try { await sock.sendMessage(chat, { react: { text: '❌', key: mensaje.key } }); } catch (e) {}
                    const detalle = String(error.stderr || error.message || error).trim().slice(0, 1200);
                    await enviarConEncabezado(sock, chat, {
                        text: `🦖❌ *NO PUDE DESCARGAR EL VIDEO*\n\n🦴 ${detalle}`
                    });
                } finally {
                    // Borrar el original, el MP4 procesado y cualquier fragmento parcial.
                    try {
                        fs.readdirSync(MEDIA_PATH)
                            .filter(nombre => nombre.startsWith(prefijoArchivo))
                            .forEach(nombre => eliminarArchivo(path.join(MEDIA_PATH, nombre)));
                    } catch (e) {}
                }
            }

            // ========================================
            // 📢 .N (MENCIONAR A TODOS)
            // ========================================
            else if (comando === 'n') {
                if (!chat.endsWith('@g.us')) {
                    await enviarConEncabezado(sock, chat, {
                        text: '🦖❌ Este comando solo funciona en grupos.'
                    });
                    return;
                }

                try {
                    const metadata = await sock.groupMetadata(chat);
                    const participantes = metadata.participants
                        .map(participante => participante.id)
                        .filter(Boolean);

                    const mensajeGrupo = argumentos.length
                        ? argumentos.join(' ')
                        : '🦖 Atención a todos';

                    await enviarConEncabezado(sock, chat, {
                        text: mensajeGrupo,
                        mentions: participantes
                    });
                } catch (error) {
                    console.error('🦖❌ Error en .n:', error);
                    await enviarConEncabezado(sock, chat, {
                        text: `🦖❌ No pude mencionar a todos.\n\n🦴 ${error.message}`
                    });
                }
            }

            // ========================================
            // ❓ COMANDO DESCONOCIDO
            // ========================================
            else {
                await enviarConEncabezado( sock, chat, {
                    text: `🦖❓ \\\\\\\\\\\\\\*¡GRRR! Comando desconocido\\\\\\\\\\\\\\* ❓🦖\n\n` + `🦴 No conozco:\n` + `\\\\\\\\\\\\\\*${PREFIJO}${comando}\\\\\\\\\\\\\\*\n\n` + `🦕 Usa \\\\\\\\\\\\\\*.menu\\\\\\\\\\\\\\* para ver los comandos.`
                } );
            }
        } catch (error) {
            console.error( '🦖❌ Error procesando mensaje:', error );
        }
    } );
}

// ========================================
// 🚀 ARRANCAR DINO BOT
// ========================================

const configInicial = cargarConfig();
console.log('');
console.log( '🦖🦖🦖🦖🦖🦖🦖🦖🦖🦖' );
console.log( '       🦖 DINO BOT' );
console.log( `       🦖 ${configInicial.nombreBot}` );
console.log( '       🦴 INICIANDO...' );
console.log( '🦖🦖🦖🦖🦖🦖🦖🦖🦖🦖' );
console.log('');

iniciarBot();
