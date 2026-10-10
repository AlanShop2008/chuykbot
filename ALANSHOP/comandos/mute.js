'use strict';

const fs = require('fs');
const path = require('path');

const RUTA_DATOS = path.join(__dirname, '..', 'database', 'usuarios-silenciados.json');

function canonicalizarJid(valor) {
    return String(valor || '')
        .trim()
        .toLowerCase()
        .replace(/:\d+(?=@)/, '');
}

function numeroTelefono(valor) {
    const jid = canonicalizarJid(valor);
    if (jid.endsWith('@s.whatsapp.net')) return jid.split('@')[0].replace(/\D/g, '');
    if (/^\+?\d+$/.test(jid)) return jid.replace(/\D/g, '');
    return '';
}

function idsParticipante(participante) {
    return [
        participante?.id,
        participante?.jid,
        participante?.phoneNumber,
        participante?.phoneJid,
        participante?.lid,
        participante?.participantAlt
    ].filter(Boolean).map(canonicalizarJid);
}

function idsRemitente(mensaje) {
    const key = mensaje?.key || {};
    return [key.participant, key.participantAlt, key.participantPn]
        .filter(Boolean).map(canonicalizarJid);
}

function coincidenIdentidades(a, b) {
    const canonA = new Set((a || []).map(canonicalizarJid).filter(Boolean));
    const canonB = (b || []).map(canonicalizarJid).filter(Boolean);
    if (canonB.some(id => canonA.has(id))) return true;

    const numsA = new Set((a || []).map(numeroTelefono).filter(Boolean));
    return (b || []).map(numeroTelefono).filter(Boolean).some(numero => numsA.has(numero));
}

function esAdmin(participante) {
    const rol = String(participante?.admin || '').toLowerCase();
    return rol === 'admin' || rol === 'superadmin' || participante?.isAdmin === true || participante?.isSuperAdmin === true;
}

function cargarDatos() {
    try {
        if (!fs.existsSync(RUTA_DATOS)) return { groups: {} };
        const datos = JSON.parse(fs.readFileSync(RUTA_DATOS, 'utf8'));
        return datos && typeof datos === 'object' && datos.groups && typeof datos.groups === 'object'
            ? datos
            : { groups: {} };
    } catch (error) {
        console.error('🦖❌ No pude leer usuarios-silenciados.json:', error.message);
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

function extraerMencion(mensaje) {
    const contenido = mensaje?.message?.extendedTextMessage?.contextInfo ||
        mensaje?.message?.imageMessage?.contextInfo ||
        mensaje?.message?.videoMessage?.contextInfo || {};
    const mencionados = Array.isArray(contenido.mentionedJid) ? contenido.mentionedJid.filter(Boolean) : [];
    if (mencionados.length) return mencionados;
    if (contenido.quotedMessage && contenido.participant) return [contenido.participant];
    return [];
}

function crearIdentidades(participante, referencia) {
    return [...new Set([...idsParticipante(participante), ...(referencia || []).map(canonicalizarJid)].filter(Boolean))];
}

function etiquetaParticipante(participante) {
    const candidato = participante?.phoneNumber || participante?.phoneJid || participante?.id || participante?.jid || 'miembro';
    const numero = numeroTelefono(candidato);
    if (numero) return `@${numero}`;
    const base = canonicalizarJid(candidato).split('@')[0].replace(/[^a-z0-9_]/g, '').slice(0, 25);
    return `@${base || 'miembro'}`;
}

async function procesarMensaje({ sock, mensaje, enviarConEncabezado } = {}) {
    const key = mensaje?.key || {};
    const chat = String(key.remoteJid || '');
    if (!chat.endsWith('@g.us') || key.fromMe || !key.id) return false;

    const datos = cargarDatos();
    const silenciados = Array.isArray(datos.groups[chat]) ? datos.groups[chat] : [];
    if (!silenciados.length) return false;

    const ids = idsRemitente(mensaje);
    if (!ids.length) return false;
    const silenciado = silenciados.some(usuario => coincidenIdentidades(usuario.ids, ids));
    if (!silenciado) return false;

    try {
        await sock.sendMessage(chat, { delete: key });
    } catch (error) {
        console.error(`🦖❌ No pude borrar un mensaje de un usuario silenciado en ${chat}:`, error.message);
    }
    return true;
}

async function manejarComando({ sock, chat, mensaje, comando, enviarConEncabezado } = {}) {
    const enviar = payload => responder(sock, chat, payload, enviarConEncabezado);
    if (!String(chat || '').endsWith('@g.us')) {
        await enviar({ text: '🦖 .mute y .unmute solo funcionan dentro de un grupo.' });
        return;
    }
    if (comando !== 'mute' && comando !== 'unmute') return;

    let metadata;
    try {
        metadata = await sock.groupMetadata(chat);
    } catch (error) {
        console.error(`🦖❌ No pude consultar admins de ${chat}:`, error.message);
        await enviar({ text: '🦖❌ No pude revisar los permisos del grupo. Intenta de nuevo.' });
        return;
    }

    const participantes = metadata?.participants || [];
    const solicitante = participantes.find(participante => coincidenIdentidades(idsParticipante(participante), idsRemitente(mensaje)));
    if (!esAdmin(solicitante)) {
        await enviar({ text: '🦖⛔ Solo los administradores del grupo pueden usar .mute y .unmute.' });
        return;
    }

    const referencias = extraerMencion(mensaje);
    if (referencias.length !== 1) {
        await enviar({ text: `🦖 Menciona a una sola persona.\nEjemplo: .${comando} @usuario` });
        return;
    }

    const destino = participantes.find(participante => coincidenIdentidades(idsParticipante(participante), referencias));
    if (!destino) {
        await enviar({ text: '🦖 No encontré a esa persona entre los miembros de este grupo.' });
        return;
    }

    if (comando === 'mute') {
        const idsBot = [sock.user?.id, sock.user?.lid, sock.user?.phoneNumber, sock.user?.jid].filter(Boolean).map(canonicalizarJid);
        if (coincidenIdentidades(idsParticipante(destino), idsBot)) {
            await enviar({ text: '🦖 No puedo silenciar al propio bot.' });
            return;
        }
        const participanteBot = participantes.find(participante => coincidenIdentidades(idsParticipante(participante), idsBot));
        if (!esAdmin(participanteBot)) {
            await enviar({ text: '🦖 Para borrar mensajes, primero haz administrador al bot en este grupo.' });
            return;
        }
    }

    const datos = cargarDatos();
    if (!Array.isArray(datos.groups[chat])) datos.groups[chat] = [];
    const identidadesDestino = crearIdentidades(destino, referencias);
    const indiceExistente = datos.groups[chat].findIndex(usuario => coincidenIdentidades(usuario.ids, identidadesDestino));
    const etiqueta = etiquetaParticipante(destino);

    if (comando === 'mute') {
        if (indiceExistente !== -1) {
            await enviar({ text: `🦖 ${etiqueta} ya está silenciado en este grupo.`, mentions: [destino.id || referencias[0]] });
            return;
        }
        datos.groups[chat].push({ ids: identidadesDestino });
        try {
            guardarDatos(datos);
        } catch (error) {
            console.error('🦖❌ No pude guardar el mute:', error.message);
            await enviar({ text: '🦖❌ No pude guardar el silenciamiento. Intenta de nuevo.' });
            return;
        }
        await enviar({ text: `🔇 ${etiqueta} quedó silenciado. El bot borrará sus mensajes en este grupo hasta que uses .unmute.`, mentions: [destino.id || referencias[0]] });
        return;
    }

    if (indiceExistente === -1) {
        await enviar({ text: `🦖 ${etiqueta} no estaba silenciado en este grupo.`, mentions: [destino.id || referencias[0]] });
        return;
    }
    datos.groups[chat].splice(indiceExistente, 1);
    try {
        guardarDatos(datos);
    } catch (error) {
        console.error('🦖❌ No pude guardar el unmute:', error.message);
        await enviar({ text: '🦖❌ No pude quitar el silenciamiento. Intenta de nuevo.' });
        return;
    }
    await enviar({ text: `🔊 ${etiqueta} ya no está silenciado en este grupo.`, mentions: [destino.id || referencias[0]] });
}

module.exports = { procesarMensaje, manejarComando };
