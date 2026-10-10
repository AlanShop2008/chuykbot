'use strict';

const pendientes = new Map();
const VIGENCIA_PENDIENTE_MS = 5 * 60 * 1000;
const MAX_TEXTO_AVISO = 3000;

function normalizarNumero(valor) {
    return String(valor || '')
        .split('@')[0]
        .split(':')[0]
        .replace(/\D/g, '');
}

function nombreSeguro(grupo) {
    return String(grupo?.subject || '(grupo sin nombre)')
        .replace(/[\r\n\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 90) || '(grupo sin nombre)';
}

function ordenarGrupos(resultado) {
    return Object.entries(resultado || {})
        .map(([jid, metadata]) => ({
            jid: metadata?.id || jid,
            nombre: nombreSeguro(metadata)
        }))
        .filter(grupo => String(grupo.jid).endsWith('@g.us'))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es') || a.jid.localeCompare(b.jid));
}

function escaparRegex(texto) {
    return String(texto).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extraerMensaje(contenido, selector) {
    const raw = String(contenido || '');
    const selectorSeguro = escaparRegex(selector);
    const patron = new RegExp(`^grupos[\\t ]+${selectorSeguro}(?:[\\t ]+|\\r?\\n)`, 'i');
    return raw.replace(patron, '').replace(/\r\n?/g, '\n').trimEnd();
}

async function responder(sock, chat, texto, enviarConEncabezado) {
    const contenido = { text: texto };
    if (typeof enviarConEncabezado === 'function') {
        return enviarConEncabezado(sock, chat, contenido);
    }
    return sock.sendMessage(chat, contenido);
}

async function enviarListaEnPartes(sock, chat, grupos, enviarConEncabezado) {
    const limite = 2800;
    let parte = '📋 Grupos conectados al bot:\n';
    for (let i = 0; i < grupos.length; i++) {
        const linea = `${i + 1}. ${grupos[i].nombre}\n`;
        if (parte.length + linea.length > limite && parte !== '📋 Grupos conectados al bot:\n') {
            await responder(sock, chat, parte.trimEnd(), enviarConEncabezado);
            parte = '';
        }
        parte += linea;
    }
    parte += '\nAviso a un grupo: .grupos NUMERO mensaje\nAviso a todos: .grupos todos mensaje';
    await responder(sock, chat, parte.trimEnd(), enviarConEncabezado);
}

async function enviarVistaPrevia(sock, chat, gruposDestino, mensaje, esTodos, enviarConEncabezado) {
    const encabezado = esTodos
        ? `📣 AVISO PENDIENTE\nDestino: TODOS los grupos (${gruposDestino.length}).`
        : `📣 AVISO PENDIENTE\nDestino: grupo ${gruposDestino[0].indice} — ${gruposDestino[0].nombre}.`;
    await responder(sock, chat, encabezado, enviarConEncabezado);

    if (esTodos) {
        let parte = '';
        for (const grupo of gruposDestino) {
            const linea = `${grupo.indice}. ${grupo.nombre}\n`;
            if (parte && parte.length + linea.length > 2800) {
                await responder(sock, chat, parte.trimEnd(), enviarConEncabezado);
                parte = '';
            }
            parte += linea;
        }
        if (parte) await responder(sock, chat, parte.trimEnd(), enviarConEncabezado);
    }

    await responder(
        sock,
        chat,
        `Mensaje exacto:\n\n${mensaje}\n\nPara enviarlo, responde .grupos confirmar (vence en 5 minutos). Para descartarlo, .grupos cancelar.`,
        enviarConEncabezado
    );
}

async function manejarGrupos({ sock, mensaje, chat, comando, argumentos = [], contenido = '', ownerNumero, enviarConEncabezado } = {}) {
    if (comando !== 'grupos' || !chat) return false;
    const enviar = texto => responder(sock, chat, texto, enviarConEncabezado);
    const numeroOwner = normalizarNumero(ownerNumero);
    const key = mensaje?.key || {};
    const remitentes = [
        key.participant,
        key.participantAlt,
        key.participantPn,
        key.remoteJid,
        key.remoteJidAlt,
        key.remoteJidPn
    ].map(normalizarNumero).filter(Boolean);

    if (!numeroOwner || !remitentes.includes(numeroOwner)) {
        await enviar('🦖⛔ .grupos solo lo puede usar el owner configurado del bot.');
        return true;
    }

    if (String(chat).endsWith('@g.us')) {
        await enviar('🦖 Por privacidad, usa .grupos en el chat privado del bot; desde ahí verás y administrarás sus grupos.');
        return true;
    }

    const accion = String(argumentos[0] || '').toLowerCase();
    const pendiente = pendientes.get(numeroOwner);

    if (accion === 'cancelar') {
        if (!pendiente) {
            await enviar('🦖 No tienes un aviso pendiente.');
            return true;
        }
        pendientes.delete(numeroOwner);
        await enviar('🦖✅ Aviso cancelado; no se envió a ningún grupo.');
        return true;
    }

    if (accion === 'confirmar') {
        if (!pendiente || Date.now() > pendiente.vence) {
            pendientes.delete(numeroOwner);
            await enviar('🦖 No hay un aviso pendiente vigente. Prepara uno con .grupos todos mensaje o .grupos NUMERO mensaje.');
            return true;
        }

        pendientes.delete(numeroOwner);
        let enviados = 0;
        const fallidos = [];
        for (const grupo of pendiente.grupos) {
            try {
                const payload = { text: pendiente.mensaje };
                if (typeof enviarConEncabezado === 'function') {
                    await enviarConEncabezado(sock, grupo.jid, payload);
                } else {
                    await sock.sendMessage(grupo.jid, payload);
                }
                enviados++;
            } catch (error) {
                console.error(`🦖❌ Falló el aviso para ${grupo.nombre} (${grupo.jid}):`, error.message);
                fallidos.push(grupo.nombre);
            }
            if (pendiente.grupos.length > 1) await new Promise(resolve => setTimeout(resolve, 250));
        }

        let resumen = `📣 Aviso enviado a ${enviados} de ${pendiente.grupos.length} grupos.`;
        if (fallidos.length) resumen += `\nNo se pudo enviar a: ${fallidos.join(', ').slice(0, 1200)}`;
        await enviar(resumen);
        return true;
    }

    if (pendiente && Date.now() <= pendiente.vence) {
        await enviar('🦖 Ya tienes un aviso pendiente. Confírmalo con .grupos confirmar o descártalo con .grupos cancelar.');
        return true;
    }
    pendientes.delete(numeroOwner);

    if (typeof sock.groupFetchAllParticipating !== 'function') {
        await enviar('🦖❌ Esta versión de Baileys no ofrece la función para consultar los grupos del bot.');
        return true;
    }

    let grupos;
    try {
        grupos = ordenarGrupos(await sock.groupFetchAllParticipating());
    } catch (error) {
        console.error('🦖❌ No pude listar los grupos del bot:', error.message);
        await enviar('🦖❌ No pude consultar los grupos. Intenta de nuevo cuando el bot esté conectado.');
        return true;
    }

    if (accion === '') {
        if (!grupos.length) {
            await enviar('🦖 El bot todavía no está en ningún grupo.');
            return true;
        }
        await enviarListaEnPartes(sock, chat, grupos, enviarConEncabezado);
        return true;
    }

    let gruposDestino;
    let esTodos = accion === 'todos' || accion === 'all';
    if (esTodos) {
        gruposDestino = grupos.map((grupo, indice) => ({ ...grupo, indice: indice + 1 }));
    } else {
        let indice = 0;
        if (/^\d+$/.test(accion)) {
            indice = Number(accion) - 1;
        } else {
            indice = grupos.findIndex(grupo => grupo.jid.toLowerCase() === accion);
        }
        if (!Number.isInteger(indice) || indice < 0 || indice >= grupos.length) {
            await enviar('🦖 No reconozco ese grupo. Primero consulta la lista con .grupos y usa su número.');
            return true;
        }
        gruposDestino = [{ ...grupos[indice], indice: indice + 1 }];
    }

    if (!gruposDestino.length) {
        await enviar('🦖 No hay grupos para enviar el aviso.');
        return true;
    }

    const mensajeAviso = extraerMensaje(contenido, accion);
    if (!mensajeAviso) {
        await enviar('🦖 Escribe el aviso después del destino. Ejemplos:\n.grupos 2 Reunión hoy a las 6\n.grupos todos Aviso importante');
        return true;
    }
    if (mensajeAviso.length > MAX_TEXTO_AVISO) {
        await enviar(`🦖 El aviso puede tener hasta ${MAX_TEXTO_AVISO} caracteres.`);
        return true;
    }

    pendientes.set(numeroOwner, {
        mensaje: mensajeAviso,
        grupos: gruposDestino.map(({ jid, nombre }) => ({ jid, nombre })),
        vence: Date.now() + VIGENCIA_PENDIENTE_MS
    });
    await enviarVistaPrevia(sock, chat, gruposDestino, mensajeAviso, esTodos, enviarConEncabezado);
    return true;
}

module.exports = manejarGrupos;
