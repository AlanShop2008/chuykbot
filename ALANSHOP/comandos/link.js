'use strict';

async function responder(sock, chat, contenido, enviarConEncabezado) {
    if (typeof enviarConEncabezado === 'function') {
        return enviarConEncabezado(sock, chat, contenido);
    }
    return sock.sendMessage(chat, contenido);
}

async function manejarLink({ sock, chat, enviarConEncabezado } = {}) {
    if (!chat) return;
    const enviar = contenido => responder(sock, chat, contenido, enviarConEncabezado);

    if (!String(chat).endsWith('@g.us')) {
        await enviar({ text: '🦖 .link solo funciona dentro del grupo.' });
        return;
    }

    try {
        const codigoInvitacion = await sock.groupInviteCode(chat);
        if (!codigoInvitacion) throw new Error('WhatsApp no devolvió un código de invitación.');
        await enviar({ text: `🔗 Enlace actual del grupo:\nhttps://chat.whatsapp.com/${codigoInvitacion}` });
    } catch (error) {
        console.error(`🦖❌ No pude obtener el enlace de invitación de ${chat}:`, error.message);
        await enviar({ text: '🦖❌ No pude obtener el enlace. Comprueba que el bot siga siendo administrador del grupo.' });
    }
}

module.exports = manejarLink;
