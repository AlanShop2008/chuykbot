'use strict';

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

function extraerObjetivo(mensaje) {
    const contexto = mensaje?.message?.extendedTextMessage?.contextInfo ||
        mensaje?.message?.imageMessage?.contextInfo ||
        mensaje?.message?.videoMessage?.contextInfo || {};
    const menciones = Array.isArray(contexto.mentionedJid) ? contexto.mentionedJid.filter(Boolean) : [];
    if (menciones.length) return { referencias: menciones, variasMenciones: menciones.length !== 1 };
    if (contexto.quotedMessage && contexto.participant) {
        return { referencias: [contexto.participant], variasMenciones: false };
    }
    return { referencias: [], variasMenciones: false };
}

function etiquetaParticipante(participante) {
    const candidato = participante?.phoneNumber || participante?.phoneJid || participante?.id || participante?.jid || 'miembro';
    const numero = numeroTelefono(candidato);
    if (numero) return `@${numero}`;
    const base = canonicalizarJid(candidato).split('@')[0].replace(/[^a-z0-9_]/g, '').slice(0, 25);
    return `@${base || 'miembro'}`;
}

async function responder(sock, chat, payload, enviarConEncabezado) {
    if (typeof enviarConEncabezado === 'function') {
        return enviarConEncabezado(sock, chat, payload);
    }
    return sock.sendMessage(chat, payload);
}

async function manejarKick({ sock, chat, mensaje, enviarConEncabezado } = {}) {
    const enviar = payload => responder(sock, chat, payload, enviarConEncabezado);
    if (!String(chat || '').endsWith('@g.us')) {
        await enviar({ text: '🦖 .kick solo funciona dentro de un grupo.' });
        return;
    }

    let metadata;
    try {
        metadata = await sock.groupMetadata(chat);
    } catch (error) {
        console.error(`🦖❌ No pude consultar miembros de ${chat}:`, error.message);
        await enviar({ text: '🦖❌ No pude consultar los miembros del grupo. Intenta de nuevo.' });
        return;
    }

    const participantes = metadata?.participants || [];
    const idsSolicitante = idsRemitente(mensaje);
    const solicitante = participantes.find(participante => coincidenIdentidades(idsParticipante(participante), idsSolicitante));
    if (!esAdmin(solicitante)) {
        await enviar({ text: '🦖⛔ Solo los administradores del grupo pueden usar .kick.' });
        return;
    }

    const idsBot = [sock.user?.id, sock.user?.lid, sock.user?.phoneNumber, sock.user?.jid].filter(Boolean).map(canonicalizarJid);
    const botEnGrupo = participantes.find(participante => coincidenIdentidades(idsParticipante(participante), idsBot));
    if (!esAdmin(botEnGrupo)) {
        await enviar({ text: '🦖 Para expulsar miembros, primero haz administrador al bot en este grupo.' });
        return;
    }

    const { referencias, variasMenciones } = extraerObjetivo(mensaje);
    if (variasMenciones) {
        await enviar({ text: '🦖 Menciona a una sola persona o responde al mensaje de una sola persona.' });
        return;
    }
    if (!referencias.length) {
        await enviar({ text: '🦖 Menciona a quien quieras expulsar o responde a su mensaje con .kick.' });
        return;
    }

    const destino = participantes.find(participante => coincidenIdentidades(idsParticipante(participante), referencias));
    if (!destino) {
        await enviar({ text: '🦖 Esa persona ya no está en este grupo.' });
        return;
    }

    const idsDestino = idsParticipante(destino);
    if (coincidenIdentidades(idsDestino, idsBot)) {
        await enviar({ text: '🦖 No puedo expulsar al propio bot.' });
        return;
    }
    if (coincidenIdentidades(idsDestino, idsSolicitante)) {
        await enviar({ text: '🦖 No puedes expulsarte a ti mismo con .kick.' });
        return;
    }
    if (esAdmin(destino)) {
        await enviar({ text: '🦖 .kick solo puede expulsar miembros que no sean administradores.' });
        return;
    }

    const jidDestino = destino.id || destino.jid || destino.phoneNumber || destino.phoneJid;
    if (!jidDestino) {
        await enviar({ text: '🦖 No pude identificar el JID de esa persona.' });
        return;
    }

    try {
        const resultados = await sock.groupParticipantsUpdate(chat, [jidDestino], 'remove');
        if (!Array.isArray(resultados) || resultados.length === 0) {
            throw new Error('WhatsApp no confirmó la expulsión.');
        }
        const resultadoFallido = resultados.find(resultado => resultado?.status && String(resultado.status) !== '200');
        if (resultadoFallido) {
            throw new Error(`WhatsApp rechazó la expulsión (${resultadoFallido.status}).`);
        }

        await enviar({ text: `🦖✅ Se expulsó a ${etiquetaParticipante(destino)} del grupo.` });
    } catch (error) {
        console.error(`🦖❌ No pude expulsar a un miembro de ${chat}:`, error.message);
        await enviar({ text: '🦖❌ No pude expulsar a esa persona. Comprueba que el bot siga siendo administrador y vuelve a intentarlo.' });
    }
}

module.exports = manejarKick;
