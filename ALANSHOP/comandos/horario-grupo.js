'use strict';

const fs = require('fs');
const path = require('path');

const RUTA_DATOS = path.join(__dirname, '..', 'database', 'horarios-grupo.json');
const timers = new Map();
const MAX_DURACION_MS = 24 * 60 * 60 * 1000;
const ESPERA_REINTENTO_MS = 60 * 1000;

function canonicalizarJid(valor) {
    return String(valor || '').trim().toLowerCase().replace(/:\d+(?=@)/, '');
}

function numeroTelefono(valor) {
    const jid = canonicalizarJid(valor);
    if (jid.endsWith('@s.whatsapp.net')) return jid.split('@')[0].replace(/\D/g, '');
    if (/^\+?\d+$/.test(jid)) return jid.replace(/\D/g, '');
    return '';
}

function idsParticipante(participante) {
    return [participante?.id, participante?.jid, participante?.phoneNumber, participante?.phoneJid, participante?.lid]
        .filter(Boolean).map(canonicalizarJid);
}

function idsRemitente(mensaje) {
    const key = mensaje?.key || {};
    return [key.participant, key.participantAlt, key.participantPn].filter(Boolean).map(canonicalizarJid);
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
        console.error('🦖❌ No pude leer horarios-grupo.json:', error.message);
        return { groups: {} };
    }
}

function guardarDatos(datos) {
    fs.mkdirSync(path.dirname(RUTA_DATOS), { recursive: true });
    const temporal = `${RUTA_DATOS}.tmp`;
    fs.writeFileSync(temporal, JSON.stringify(datos, null, 2) + '\n', 'utf8');
    fs.renameSync(temporal, RUTA_DATOS);
}

function accionDeEstado(estado) {
    return estado === 'cerrado' ? 'announcement' : 'not_announcement';
}

function programar(sock, chat, registro, delayForzado) {
    const anterior = timers.get(chat);
    if (anterior) clearTimeout(anterior);
    const restante = Math.max(0, registro.vence - Date.now());
    const espera = delayForzado ?? restante;
    const timer = setTimeout(() => terminar(sock, chat, registro), espera);
    timers.set(chat, timer);
}

async function terminar(sock, chat, registro) {
    const datos = cargarDatos();
    const actual = datos.groups[chat];
    if (!actual || actual.vence !== registro.vence || actual.estado !== registro.estado) return;

    if (actual.vence > Date.now()) {
        programar(sock, chat, actual);
        return;
    }

    try {
        await sock.groupSettingUpdate(chat, accionDeEstado(actual.despues));
        const actualizados = cargarDatos();
        const registroActual = actualizados.groups[chat];
        if (registroActual && registroActual.vence === actual.vence && registroActual.estado === actual.estado) {
            delete actualizados.groups[chat];
            guardarDatos(actualizados);
        }
        timers.delete(chat);
    } catch (error) {
        console.error(`🦖❌ No pude cambiar el estado programado del grupo ${chat}:`, error.message);
        programar(sock, chat, actual, ESPERA_REINTENTO_MS);
    }
}

function analizarDuracion(texto) {
    const coincidencia = String(texto || '').trim().toLowerCase().match(/^(\d+)(s|m|h|d)$/);
    if (!coincidencia) return null;
    const cantidad = Number(coincidencia[1]);
    const unidad = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 }[coincidencia[2]];
    const milisegundos = cantidad * unidad;
    if (!Number.isSafeInteger(milisegundos) || milisegundos < 1000 || milisegundos > MAX_DURACION_MS) return null;
    return { milisegundos, texto: `${cantidad}${coincidencia[2]}` };
}

async function responder(sock, chat, payload, enviarConEncabezado) {
    if (typeof enviarConEncabezado === 'function') return enviarConEncabezado(sock, chat, payload);
    return sock.sendMessage(chat, payload);
}

async function reanudarTimers(sock) {
    const datos = cargarDatos();
    let limpiarDatos = false;
    for (const [chat, registro] of Object.entries(datos.groups)) {
        if (!registro || !['abierto', 'cerrado'].includes(registro.estado) || !['abierto', 'cerrado'].includes(registro.despues)) {
            delete datos.groups[chat];
            limpiarDatos = true;
            continue;
        }
        if (registro.vence <= Date.now()) {
            await terminar(sock, chat, registro);
            const datosActualizados = cargarDatos();
            if (datosActualizados.groups[chat]) {
                datos.groups[chat] = datosActualizados.groups[chat];
            } else {
                delete datos.groups[chat];
                limpiarDatos = true;
            }
        } else {
            try {
                await sock.groupSettingUpdate(chat, accionDeEstado(registro.estado));
            } catch (error) {
                console.error(`🦖❌ No pude reanudar el estado temporal del grupo ${chat}:`, error.message);
            }
            programar(sock, chat, registro);
        }
    }
    if (limpiarDatos) {
        try {
            guardarDatos(datos);
        } catch (error) {
            console.error('🦖❌ No pude limpiar horarios inválidos:', error.message);
        }
    }
}

async function manejarHorario({ sock, chat, mensaje, comando, argumentos = [], enviarConEncabezado } = {}) {
    const enviar = payload => responder(sock, chat, payload, enviarConEncabezado);
    if (!String(chat || '').endsWith('@g.us')) {
        await enviar({ text: '🦖 .abrir y .cerrar solo funcionan dentro de un grupo.' });
        return;
    }

    const duracion = analizarDuracion(argumentos[0]);
    if (!duracion || argumentos.length !== 1) {
        await enviar({ text: '🦖 Indica una duración de 1 segundo hasta 1 día. Ejemplos: .abrir 1s, .abrir 1m, .cerrar 1h, .cerrar 1d.' });
        return;
    }

    if (comando !== 'abrir' && comando !== 'cerrar') return;
    let metadata;
    try {
        metadata = await sock.groupMetadata(chat);
    } catch (error) {
        console.error(`🦖❌ No pude consultar permisos de ${chat}:`, error.message);
        await enviar({ text: '🦖❌ No pude consultar los permisos del grupo. Intenta de nuevo.' });
        return;
    }

    const participantes = metadata?.participants || [];
    const solicitante = participantes.find(participante => coincidenIdentidades(idsParticipante(participante), idsRemitente(mensaje)));
    if (!esAdmin(solicitante)) {
        await enviar({ text: '🦖⛔ Solo los administradores del grupo pueden usar .abrir y .cerrar.' });
        return;
    }

    const idsBot = [sock.user?.id, sock.user?.lid, sock.user?.phoneNumber, sock.user?.jid].filter(Boolean).map(canonicalizarJid);
    const participanteBot = participantes.find(participante => coincidenIdentidades(idsParticipante(participante), idsBot));
    if (!esAdmin(participanteBot)) {
        await enviar({ text: '🦖 Para cambiar quién puede escribir, primero haz administrador al bot en este grupo.' });
        return;
    }

    const estado = comando === 'cerrar' ? 'cerrado' : 'abierto';
    const despues = estado === 'cerrado' ? 'abierto' : 'cerrado';
    const ahora = Date.now();
    const registro = { estado, despues, vence: ahora + duracion.milisegundos };
    const datos = cargarDatos();
    const anterior = datos.groups[chat];
    datos.groups[chat] = registro;
    try {
        guardarDatos(datos);
    } catch (error) {
        console.error('🦖❌ No pude guardar el horario temporal:', error.message);
        await enviar({ text: '🦖❌ No pude guardar el cambio programado.' });
        return;
    }

    const timerAnterior = timers.get(chat);
    if (timerAnterior) clearTimeout(timerAnterior);
    timers.delete(chat);

    try {
        await sock.groupSettingUpdate(chat, accionDeEstado(estado));
    } catch (error) {
        const restaurar = cargarDatos();
        if (anterior) restaurar.groups[chat] = anterior;
        else delete restaurar.groups[chat];
        try {
            guardarDatos(restaurar);
            if (anterior) programar(sock, chat, anterior);
        } catch (errorRestaurar) {
            console.error('🦖❌ No pude restaurar el horario anterior:', errorRestaurar.message);
        }
        console.error(`🦖❌ No pude aplicar el cambio temporal a ${chat}:`, error.message);
        await enviar({ text: '🦖❌ No pude cambiar quién puede escribir. Comprueba que el bot sea administrador.' });
        return;
    }

    programar(sock, chat, registro);
    if (estado === 'cerrado') {
        await enviar({ text: `🔒 Grupo cerrado por ${duracion.text}: solo los administradores pueden escribir. Se abrirá automáticamente al terminar.` });
    } else {
        await enviar({ text: `🔓 Grupo abierto por ${duracion.text}: todos pueden escribir. Se cerrará automáticamente al terminar.` });
    }
}

manejarHorario.reanudarTimers = reanudarTimers;
module.exports = manejarHorario;
