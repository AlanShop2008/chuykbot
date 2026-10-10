'use strict';

const fs = require('fs');
const path = require('path');

const RUTA_ESTADO = path.join(__dirname, '..', 'database', 'antprivado.json');
const procesando = new Set();
const avisados = new Set();

function normalizarNumero(valor) {
    return String(valor || '')
        .split('@')[0]
        .split(':')[0]
        .replace(/\D/g, '');
}

function cargarActivo() {
    try {
        if (!fs.existsSync(RUTA_ESTADO)) return false;
        return JSON.parse(fs.readFileSync(RUTA_ESTADO, 'utf8')).activo === true;
    } catch (error) {
        console.error('🦖❌ No pude leer database/antprivado.json:', error.message);
        return false;
    }
}

function guardarActivo(activo) {
    fs.mkdirSync(path.dirname(RUTA_ESTADO), { recursive: true });
    const temporal = `${RUTA_ESTADO}.tmp`;
    fs.writeFileSync(temporal, JSON.stringify({ activo }, null, 2) + '\n', 'utf8');
    fs.renameSync(temporal, RUTA_ESTADO);
}

function idsRemitente(mensaje) {
    const key = mensaje?.key || {};
    return [
        key.participant,
        key.participantAlt,
        key.participantPn,
        key.remoteJid,
        key.remoteJidAlt,
        key.remoteJidPn
    ].filter(Boolean).map(String);
}

function esOwner(mensaje, ownerNumero) {
    const owner = normalizarNumero(ownerNumero);
    return Boolean(owner && idsRemitente(mensaje).some(id => normalizarNumero(id) === owner));
}

function esChatPrivado(jid) {
    const chat = String(jid || '');
    return chat.endsWith('@s.whatsapp.net') || chat.endsWith('@lid');
}

async function responder(sock, chat, payload, enviarConEncabezado) {
    if (typeof enviarConEncabezado === 'function') {
        return enviarConEncabezado(sock, chat, payload);
    }
    return sock.sendMessage(chat, payload);
}

async function procesarMensaje({ sock, mensaje, ownerNumero, enviarConEncabezado } = {}) {
    const key = mensaje?.key || {};
    const jidChat = String(key.remoteJid || '');
    if (!mensaje || key.fromMe || !esChatPrivado(jidChat) || !cargarActivo()) return false;
    if (esOwner(mensaje, ownerNumero)) return false;

    const owner = normalizarNumero(ownerNumero);
    if (!owner) {
        console.error('🦖❌ Antiprivado está activo, pero no hay owner configurado para el aviso.');
        return true;
    }

    if (procesando.has(jidChat)) return true;
    procesando.add(jidChat);
    try {
        if (!avisados.has(jidChat)) {
            const texto = `🚫 Este bot no atiende mensajes privados.\n\nPara contactar al creador, escribe al owner: +${owner}\nhttps://wa.me/${owner}`;
            try {
                await responder(sock, jidChat, { text: texto }, enviarConEncabezado);
                avisados.add(jidChat);
            } catch (error) {
                console.error('🦖❌ No pude enviar el aviso de antiprivado:', error.message);
            }
        }

        const jidAlternativo = [key.remoteJidAlt, key.remoteJidPn]
            .find(jid => String(jid || '').endsWith('@s.whatsapp.net'));
        const jidBloqueo = jidAlternativo || jidChat;
        try {
            if (typeof sock.updateBlockStatus !== 'function') {
                throw new Error('Esta versión de Baileys no ofrece updateBlockStatus.');
            }
            await sock.updateBlockStatus(jidBloqueo, 'block');
        } catch (error) {
            console.error('🦖❌ No pude bloquear al remitente privado:', error.message);
        }
    } finally {
        procesando.delete(jidChat);
    }
    return true;
}

async function manejarComando({ sock, chat, mensaje, argumentos = [], ownerNumero, enviarConEncabezado } = {}) {
    const enviar = payload => responder(sock, chat, payload, enviarConEncabezado);
    if (!esOwner(mensaje, ownerNumero)) {
        await enviar({ text: '🦖⛔ Solo el owner configurado del bot puede cambiar .antprivado.' });
        return;
    }

    const accion = String(argumentos[0] || '').toLowerCase();
    if (accion === 'on' || accion === 'activar') {
        try {
            guardarActivo(true);
            avisados.clear();
            await enviar({ text: '🦖🔒 Antiprivado activado. Los mensajes privados de otras personas recibirán una advertencia y luego se bloquearán. El owner no se bloquea.' });
        } catch (error) {
            console.error('🦖❌ No pude activar antiprivado:', error.message);
            await enviar({ text: '🦖❌ No pude guardar la configuración de antiprivado.' });
        }
        return;
    }

    if (accion === 'off' || accion === 'desactivar') {
        try {
            guardarActivo(false);
            avisados.clear();
            await enviar({ text: '🦖🔓 Antiprivado desactivado. Esto no desbloquea automáticamente a los contactos bloqueados antes.' });
        } catch (error) {
            console.error('🦖❌ No pude desactivar antiprivado:', error.message);
            await enviar({ text: '🦖❌ No pude guardar la configuración de antiprivado.' });
        }
        return;
    }

    await enviar({
        text: `🦖 Estado de antiprivado: ${cargarActivo() ? 'ACTIVADO' : 'DESACTIVADO'}.\nUsa .antprivado on u .antprivado off. Solo el owner puede cambiarlo.`
    });
}

module.exports = { procesarMensaje, manejarComando };
