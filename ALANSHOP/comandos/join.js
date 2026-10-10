'use strict';

const fs = require('fs');
const path = require('path');

const RUTA_DATOS = path.join(__dirname, '..', 'database', 'join-expirations.json');
const timers = new Map();
const MAX_DIAS = 365;
const REINTENTO_MS = 60 * 60 * 1000;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

function normalizarNumero(valor) {
    return String(valor || '')
        .split('@')[0]
        .split(':')[0]
        .replace(/\D/g, '');
}

function extraerRemitentes(mensaje) {
    const key = mensaje?.key || {};
    return [...new Set([
        key.participant,
        key.participantAlt,
        key.participantPn,
        key.remoteJid,
        key.remoteJidAlt,
        key.remoteJidPn
    ].filter(Boolean).map(normalizarNumero).filter(Boolean))];
}

function cargarDatos() {
    try {
        if (!fs.existsSync(RUTA_DATOS)) return { groups: {} };
        const datos = JSON.parse(fs.readFileSync(RUTA_DATOS, 'utf8'));
        return datos && typeof datos === 'object' && !Array.isArray(datos) &&
            datos.groups && typeof datos.groups === 'object' && !Array.isArray(datos.groups)
            ? datos
            : { groups: {} };
    } catch (error) {
        console.error('🦖❌ No pude leer join-expirations.json:', error.message);
        return { groups: {} };
    }
}

function guardarDatos(datos) {
    fs.mkdirSync(path.dirname(RUTA_DATOS), { recursive: true });
    const temporal = `${RUTA_DATOS}.tmp`;
    fs.writeFileSync(temporal, JSON.stringify(datos, null, 2) + '\n', 'utf8');
    fs.renameSync(temporal, RUTA_DATOS);
}

async function responder(sock, chat, payload, enviarConEncabezado) {
    if (typeof enviarConEncabezado === 'function') {
        return enviarConEncabezado(sock, chat, payload);
    }
    return sock.sendMessage(chat, payload);
}

function obtenerEnlace(texto) {
    const valor = String(texto || '').trim();
    const normalizado = /^https?:\/\//i.test(valor) ? valor : `https://${valor}`;
    let url;
    try {
        url = new URL(normalizado);
    } catch (error) {
        return null;
    }
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'chat.whatsapp.com') return null;
    const partes = url.pathname.split('/').filter(Boolean);
    if (partes.length !== 1 || !/^[A-Za-z0-9_-]{8,}$/.test(partes[0])) return null;
    return partes[0];
}

function obtenerDetalleRechazo(error, codigoInvitacion) {
    const posiblesMensajes = [
        error?.output?.payload?.message,
        error?.data?.attrs?.text,
        error?.message
    ].filter(valor => typeof valor === 'string' && valor.trim());
    let detalle = posiblesMensajes.join(' | ') || 'sin detalle proporcionado por WhatsApp';
    detalle = detalle
        .replace(/https?:\/\/chat\.whatsapp\.com\/[^\s"'<>)]*/gi, '[invitación oculta]')
        .replace(/chat\.whatsapp\.com\/[^\s"'<>)]*/gi, '[invitación oculta]');
    if (codigoInvitacion) detalle = detalle.split(codigoInvitacion).join('[código oculto]');
    detalle = detalle.replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();

    const candidatosEstado = [error?.output?.statusCode, error?.statusCode, error?.data?.attrs?.code];
    const estadoNumero = candidatosEstado.map(Number).find(valor => Number.isInteger(valor) && valor >= 100 && valor <= 599);
    return { detalle: detalle.slice(0, 300), estado: estadoNumero || null };
}

function explicarRechazo(error) {
    const texto = [
        error?.output?.payload?.message,
        error?.data?.attrs?.text,
        error?.message
    ].filter(valor => typeof valor === 'string').join(' ').toLowerCase();

    if (/approval|membership|request.{0,20}join|solicitud.{0,20}uni/.test(texto)) {
        return 'El grupo parece requerir aprobación de un administrador para nuevos miembros.';
    }
    if (/expired|invalid|not found|revok|bad.{0,10}invite|invite.{0,10}(?:invalid|expired)/.test(texto)) {
        return 'El enlace podría estar vencido, revocado o no ser una invitación activa.';
    }
    if (/rate|limit|too many|temporar|spam/.test(texto)) {
        return 'WhatsApp podría estar limitando temporalmente nuevos ingresos; espera un poco y vuelve a probar.';
    }
    if (/not-authorized|not authorized|forbidden|unauthorized/.test(texto)) {
        return 'WhatsApp no autorizó la entrada. Comprueba que el enlace sea válido y que la cuenta pueda unirse.';
    }
    return 'Verifica que el enlace esté vigente, no revocado y que el grupo permita entrar mediante invitación.';
}

function programarSalida(sock, jid, registro, delayForzado) {
    const anterior = timers.get(jid);
    if (anterior) clearTimeout(anterior);

    const restante = Math.max(0, registro.saleEn - Date.now());
    const espera = Math.min(delayForzado ?? restante, MAX_TIMEOUT_MS);
    const timer = setTimeout(() => terminarEstancia(sock, jid, registro), espera);
    if (typeof timer.unref === 'function') timer.unref();
    timers.set(jid, timer);
}

function eliminarRegistroSiCoincide(jid, registro) {
    const datos = cargarDatos();
    const actual = datos.groups[jid];
    if (!actual || actual.saleEn !== registro.saleEn || actual.unidoEn !== registro.unidoEn) return;
    delete datos.groups[jid];
    guardarDatos(datos);
    timers.delete(jid);
}

async function terminarEstancia(sock, jid, registro) {
    const datos = cargarDatos();
    const actual = datos.groups[jid];
    if (!actual || actual.saleEn !== registro.saleEn || actual.unidoEn !== registro.unidoEn) return;

    if (actual.saleEn > Date.now()) {
        programarSalida(sock, jid, actual);
        return;
    }

    try {
        if (typeof sock.groupFetchAllParticipating === 'function') {
            const grupos = await sock.groupFetchAllParticipating();
            if (!grupos?.[jid]) {
                eliminarRegistroSiCoincide(jid, actual);
                return;
            }
        }

        await sock.groupLeave(jid);
        eliminarRegistroSiCoincide(jid, actual);
        console.log(`🦖⏱️ Terminó la estancia programada en ${actual.nombre || jid}; el bot salió del grupo.`);
    } catch (error) {
        console.error(`🦖❌ No pude salir del grupo al vencer la estancia (${jid}):`, error.message);
        programarSalida(sock, jid, actual, REINTENTO_MS);
    }
}

async function reanudarSalidas(sock) {
    const datos = cargarDatos();
    const invalidos = [];
    for (const [jid, registro] of Object.entries(datos.groups)) {
        if (!jid.endsWith('@g.us') || !registro ||
            !Number.isFinite(registro.saleEn) || !Number.isFinite(registro.unidoEn)) {
            invalidos.push(jid);
            continue;
        }
        if (registro.saleEn <= Date.now()) {
            await terminarEstancia(sock, jid, registro);
        } else {
            programarSalida(sock, jid, registro);
        }
    }
    if (invalidos.length) {
        const actualizados = cargarDatos();
        for (const jid of invalidos) delete actualizados.groups[jid];
        guardarDatos(actualizados);
    }
}

async function manejarJoin({ sock, mensaje, chat, argumentos = [], ownerNumero, nombreBot = 'DINO BOT', enviarConEncabezado } = {}) {
    if (!chat) return false;
    const enviar = payload => responder(sock, chat, payload, enviarConEncabezado);

    if (String(chat).endsWith('@g.us')) {
        await enviar({ text: '🦖 Por seguridad, usa .join en el chat privado del bot.' });
        return true;
    }

    const owner = normalizarNumero(ownerNumero);
    if (!owner || !extraerRemitentes(mensaje).includes(owner)) {
        await enviar({ text: '🦖⛔ .join solo lo puede usar el owner configurado del bot.' });
        return true;
    }

    if (argumentos.length !== 2) {
        await enviar({ text: '🦖 Usa: .join ENLACE_Del_GRUPO DÍAS\nEjemplo: .join https://chat.whatsapp.com/ABC123xyz 30\nAcepto entre 1 y 365 días.' });
        return true;
    }

    const codigoInvitacion = obtenerEnlace(argumentos[0]);
    if (!codigoInvitacion) {
        await enviar({ text: '🦖❌ El enlace no parece una invitación válida de chat.whatsapp.com. Revisa el enlace y vuelve a intentarlo.' });
        return true;
    }

    const dias = Number(argumentos[1]);
    if (!/^\d+$/.test(String(argumentos[1])) || !Number.isSafeInteger(dias) || dias < 1 || dias > MAX_DIAS) {
        await enviar({ text: `🦖❌ Indica un número entero de días entre 1 y ${MAX_DIAS}. Ejemplo: .join ENLACE 30` });
        return true;
    }

    if (typeof sock.groupAcceptInvite !== 'function' || typeof sock.groupLeave !== 'function') {
        await enviar({ text: '🦖❌ Esta versión de Baileys no ofrece las funciones necesarias para unirse y salir del grupo.' });
        return true;
    }

    let jid;
    try {
        jid = await sock.groupAcceptInvite(codigoInvitacion);
    } catch (error) {
        const diagnostico = obtenerDetalleRechazo(error, codigoInvitacion);
        console.error(`🦖❌ WhatsApp rechazó la invitación. estado=${diagnostico.estado || 'desconocido'} detalle=${diagnostico.detalle}`);
        await enviar({ text: `🦖❌ WhatsApp rechazó la invitación. ${explicarRechazo(error)}\n\nEl log ahora muestra un detalle técnico sin incluir el enlace ni su código.` });
        return true;
    }

    if (typeof jid !== 'string' || !jid.endsWith('@g.us')) {
        await enviar({ text: '🦖❌ WhatsApp no devolvió un grupo válido; no pude programar la salida.' });
        return true;
    }

    const unidoEn = Date.now();
    const saleEn = unidoEn + dias * 24 * 60 * 60 * 1000;
    const nombre = String(nombreBot || 'DINO BOT').replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 50) || 'DINO BOT';
    const registro = { unidoEn, saleEn, dias, nombre };
    const datos = cargarDatos();
    datos.groups[jid] = registro;

    try {
        guardarDatos(datos);
    } catch (error) {
        console.error('🦖❌ No pude guardar la fecha de salida; intentaré salir del grupo para no dejar una estancia sin límite.');
        try {
            await sock.groupLeave(jid);
        } catch (errorSalida) {
            console.error(`🦖❌ También falló la salida de emergencia de ${jid}:`, errorSalida.message);
        }
        await enviar({ text: '🦖❌ No pude guardar el plazo de estancia. Para evitar quedarme en el grupo sin fecha de salida, cancelé la entrada o intenté salir.' });
        return true;
    }

    programarSalida(sock, jid, registro);

    let bienvenidaEnviada = true;
    try {
        await responder(sock, jid, {
            text: `👋 ¡Hola! Soy ${nombre}, el bot del grupo.\n\nMe quedaré aquí durante ${dias} ${dias === 1 ? 'día' : 'días'} y saldré automáticamente al terminar ese plazo. ¡Gracias por recibirme!`
        }, enviarConEncabezado);
    } catch (error) {
        bienvenidaEnviada = false;
        console.error(`🦖❌ Me uní al grupo ${jid}, pero no pude enviar la bienvenida:`, error.message);
    }

    const fechaSalida = new Date(saleEn).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
    await enviar({
        text: `🦖✅ Me uní al grupo y guardé una estancia de ${dias} ${dias === 1 ? 'día' : 'días'}.\n${bienvenidaEnviada ? 'Envié la bienvenida.' : 'No pude enviar la bienvenida, pero la salida sigue programada.'}\nSalida automática prevista: ${fechaSalida} (hora de Ciudad de México).`
    });
    return true;
}

manejarJoin.reanudarSalidas = reanudarSalidas;
module.exports = manejarJoin;

