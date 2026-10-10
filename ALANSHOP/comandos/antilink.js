'use strict';

const fs = require('fs');
const path = require('path');

const PREFIJO_POR_DEFECTO = '.';
const RUTA_DATOS = path.join(__dirname, '..', 'database', 'antilink.json');
const gruposAvisadosSinPermiso = new Set();

const REGEX_ENLACE = /(?:https?:\/\/|www\.)[^\s]+|(?:chat\.whatsapp\.com|wa\.me|t\.me|discord\.gg)\/[^\s]*|\b(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,}(?:\/[^\s]*)?/i;

function normalizarNumero(valor) {
    return String(valor || '')
        .split('@')[0]
        .split(':')[0]
        .replace(/\D/g, '');
}

function extraerTexto(mensaje) {
    let contenido = mensaje?.message;
    if (!contenido) return '';

    // Desenvolver mensajes efímeros y de visualización única de WhatsApp.
    for (let i = 0; i < 5; i += 1) {
        const anidado = contenido.ephemeralMessage?.message ||
            contenido.viewOnceMessage?.message ||
            contenido.viewOnceMessageV2?.message ||
            contenido.viewOnceMessageV2Extension?.message ||
            contenido.documentWithCaptionMessage?.message;
        if (!anidado) break;
        contenido = anidado;
    }

    return contenido.conversation ||
        contenido.extendedTextMessage?.text ||
        contenido.imageMessage?.caption ||
        contenido.videoMessage?.caption ||
        contenido.documentMessage?.caption ||
        contenido.buttonsResponseMessage?.selectedButtonId ||
        contenido.templateButtonReplyMessage?.selectedId ||
        contenido.listResponseMessage?.singleSelectReply?.selectedRowId ||
        '';
}

function cargarEstado() {
    try {
        if (!fs.existsSync(RUTA_DATOS)) return {};
        const datos = JSON.parse(fs.readFileSync(RUTA_DATOS, 'utf8'));
        return datos && typeof datos === 'object' && !Array.isArray(datos) ? datos : {};
    } catch (error) {
        console.error('🦖❌ No pude leer database/antilink.json:', error.message);
        return {};
    }
}

function guardarEstado(estado) {
    fs.mkdirSync(path.dirname(RUTA_DATOS), { recursive: true });
    fs.writeFileSync(RUTA_DATOS, JSON.stringify(estado, null, 2) + '\n', 'utf8');
}

function obtenerJidsRemitente(mensaje, chat) {
    const key = mensaje?.key || {};
    const posibles = [key.participant, key.participantAlt, key.participantPn];
    // En chat privado el remitente es remoteJid; en grupos no usar el JID del grupo.
    if (!String(chat || '').endsWith('@g.us')) {
        posibles.push(key.remoteJid, key.remoteJidAlt, key.remoteJidPn);
    }
    return [...new Set(posibles.filter(Boolean).map(String))];
}

function esAdminDelGrupo(metadata, jidsRemitente) {
    const exactos = new Set(jidsRemitente.map(jid => jid.toLowerCase()));
    const numeros = new Set(jidsRemitente.map(normalizarNumero).filter(Boolean));

    return (metadata?.participants || []).some(participante => {
        const privilegio = String(participante.admin || '').toLowerCase();
        if (privilegio !== 'admin' && privilegio !== 'superadmin' && !participante.isAdmin && !participante.isSuperAdmin) {
            return false;
        }

        const ids = [
            participante.id,
            participante.jid,
            participante.lid,
            participante.phoneNumber,
            participante.phoneJid,
            participante.participantAlt
        ].filter(Boolean).map(String);

        return ids.some(id => exactos.has(id.toLowerCase()) || (normalizarNumero(id) && numeros.has(normalizarNumero(id))));
    });
}

function obtenerOwnerConfigurado() {
    try {
        const rutaConfig = path.join(__dirname, '..', 'database', 'config.json');
        const config = JSON.parse(fs.readFileSync(rutaConfig, 'utf8'));
        return normalizarNumero(config.owner);
    } catch (_) {
        return '';
    }
}

function esOwner(jidsRemitente) {
    const owner = obtenerOwnerConfigurado();
    return Boolean(owner && jidsRemitente.some(jid => normalizarNumero(jid) === owner));
}

function contieneEnlace(texto) {
    // Evitar que un correo normal se tome por URL; los enlaces de la misma frase sí se detectan.
    const sinCorreos = String(texto || '').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, ' ');
    return REGEX_ENLACE.test(sinCorreos);
}

async function responder(sock, chat, contenido, enviarConEncabezado) {
    if (typeof enviarConEncabezado === 'function') {
        return enviarConEncabezado(sock, chat, contenido);
    }
    return sock.sendMessage(chat, contenido);
}

async function manejarAntilink({ sock, mensaje, texto = '', prefijo = PREFIJO_POR_DEFECTO, enviarConEncabezado } = {}) {
    try {
        const chat = mensaje?.key?.remoteJid;
        if (!chat) return false;

        const contenido = String(texto || extraerTexto(mensaje) || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
        const prefijoSeguro = String(prefijo || PREFIJO_POR_DEFECTO).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const patronComando = new RegExp(`^${prefijoSeguro}antilink(?:\\s+(.*))?$`, 'i');
        const patronInicio = new RegExp(`^${prefijoSeguro}antilink(?:\\s|$)`, 'i');
        const coincidencia = contenido.match(patronComando);

        if (coincidencia || patronInicio.test(contenido)) {
            if (!String(chat).endsWith('@g.us')) {
                await responder(sock, chat, { text: '🦖 El comando .antilink solo funciona dentro de un grupo.' }, enviarConEncabezado);
                return true;
            }

            const opcion = String(coincidencia?.[1] || '').trim().toLowerCase();
            if (opcion !== 'on' && opcion !== 'off') {
                await responder(sock, chat, {
                    text: '🦖 Usa el comando así:\n.antilink on — activar anti-enlaces\n.antilink off — desactivar anti-enlaces'
                }, enviarConEncabezado);
                return true;
            }

            const metadata = await sock.groupMetadata(chat);
            const jidsRemitente = obtenerJidsRemitente(mensaje, chat);
            if (!esAdminDelGrupo(metadata, jidsRemitente) && !esOwner(jidsRemitente)) {
                await responder(sock, chat, { text: '🦖 Solo los administradores del grupo o el owner del bot pueden cambiar el anti-enlaces.' }, enviarConEncabezado);
                return true;
            }

            const estado = cargarEstado();
            estado[chat] = opcion === 'on';
            guardarEstado(estado);
            await responder(sock, chat, {
                text: opcion === 'on'
                    ? '🦖✅ Anti-enlaces ACTIVADO. Borraré enlaces enviados por miembros que no sean administradores.'
                    : '🦖✅ Anti-enlaces DESACTIVADO.'
            }, enviarConEncabezado);
            console.log(`🦖 Anti-enlaces ${opcion === 'on' ? 'activado' : 'desactivado'} en ${chat}`);
            return true;
        }

        // No intervenir en otros comandos (por ejemplo, .play con un enlace de video).
        if (!String(chat).endsWith('@g.us') || !contenido || contenido.startsWith(prefijo)) return false;

        const estado = cargarEstado();
        if (estado[chat] !== true || !contieneEnlace(contenido)) return false;

        const metadata = await sock.groupMetadata(chat);
        const jidsRemitente = obtenerJidsRemitente(mensaje, chat);
        if (esAdminDelGrupo(metadata, jidsRemitente)) return false;

        try {
            await sock.sendMessage(chat, { delete: mensaje.key });
            console.log(`🦖🔗 Enlace eliminado en ${chat}`);
        } catch (error) {
            console.error(`🦖❌ No pude borrar el enlace en ${chat}:`, error.message);
            if (!gruposAvisadosSinPermiso.has(chat)) {
                gruposAvisadosSinPermiso.add(chat);
                try {
                    await responder(sock, chat, {
                        text: '🦖 Para borrar enlaces, necesito que me hagan administrador del grupo.'
                    }, enviarConEncabezado);
                } catch (_) {}
            }
        }
        return true;
    } catch (error) {
        console.error('🦖❌ Error en el módulo anti-enlaces:', error);
        return false;
    }
}

module.exports = manejarAntilink;
