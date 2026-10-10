'use strict';

function normalizarNumero(valor) {
    return String(valor || '')
        .split('@')[0]
        .split(':')[0]
        .replace(/\D/g, '');
}

function idsDeParticipante(participante) {
    return [
        participante?.id,
        participante?.jid,
        participante?.phoneNumber,
        participante?.phoneJid,
        participante?.lid,
        participante?.participantAlt
    ].filter(Boolean).map(String);
}

async function responder(sock, chat, contenido, enviarConEncabezado) {
    if (typeof enviarConEncabezado === 'function') {
        return enviarConEncabezado(sock, chat, contenido);
    }
    return sock.sendMessage(chat, contenido);
}

async function manejarAutoadmin({ sock, chat, mensaje, ownerNumero, enviarConEncabezado } = {}) {
    if (!chat) return;
    const enviar = contenido => responder(sock, chat, contenido, enviarConEncabezado);

    if (!String(chat).endsWith('@g.us')) {
        await enviar({ text: '🦖 .autoadmin solo funciona dentro de un grupo.' });
        return;
    }

    const numeroOwner = normalizarNumero(ownerNumero);
    const key = mensaje?.key || {};
    const numerosRemitente = [
        key.participant,
        key.participantAlt,
        key.participantPn,
        key.remoteJid,
        key.remoteJidAlt,
        key.remoteJidPn
    ].map(normalizarNumero).filter(Boolean);

    if (!numeroOwner || !numerosRemitente.includes(numeroOwner)) {
        await enviar({ text: '🦖⛔ Este comando solo lo puede usar el owner configurado del bot.' });
        return;
    }

    try {
        const metadata = await sock.groupMetadata(chat);
        const participanteOwner = (metadata?.participants || []).find(participante =>
            idsDeParticipante(participante).some(id => normalizarNumero(id) === numeroOwner)
        );

        if (!participanteOwner) {
            await enviar({ text: '🦖 No encuentro al owner del bot en este grupo. Únete primero y vuelve a ejecutar .autoadmin.' });
            return;
        }

        const rol = String(participanteOwner.admin || '').toLowerCase();
        if (rol === 'admin' || rol === 'superadmin' || participanteOwner.isAdmin === true || participanteOwner.isSuperAdmin === true) {
            await enviar({ text: '🦖👑 Ya eres administrador de este grupo.' });
            return;
        }

        const jidOwner = participanteOwner.id || participanteOwner.jid || participanteOwner.phoneNumber || participanteOwner.phoneJid;
        if (!jidOwner) throw new Error('No encontré el JID de WhatsApp del owner en el grupo.');

        const resultados = await sock.groupParticipantsUpdate(chat, [jidOwner], 'promote');
        const resultadoFallido = Array.isArray(resultados)
            ? resultados.find(resultado => resultado?.status && String(resultado.status) !== '200')
            : null;
        if (resultadoFallido) {
            throw new Error(`WhatsApp rechazó la promoción (${resultadoFallido.status}).`);
        }

        const metadataActualizada = await sock.groupMetadata(chat);
        const ownerActualizado = (metadataActualizada?.participants || []).find(participante =>
            idsDeParticipante(participante).some(id => normalizarNumero(id) === numeroOwner)
        );
        const nuevoRol = String(ownerActualizado?.admin || '').toLowerCase();
        if (!(nuevoRol === 'admin' || nuevoRol === 'superadmin' || ownerActualizado?.isAdmin === true || ownerActualizado?.isSuperAdmin === true)) {
            throw new Error('WhatsApp no confirmó que el owner ahora sea administrador.');
        }
        await enviar({ text: '🦖👑 Listo, ya tienes permisos de administrador en este grupo.' });
    } catch (error) {
        console.error(`🦖❌ Error en .autoadmin para ${chat}:`, error.message);
        await enviar({ text: '🦖❌ No pude darte admin. Comprueba que el bot siga siendo administrador del grupo y vuelve a intentarlo.' });
    }
}

module.exports = manejarAutoadmin;
