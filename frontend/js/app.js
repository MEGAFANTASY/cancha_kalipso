const API = '/api';
let mesasData = [];
let itemsData = [];
let carguesData = [];
let reservasData = [];
let ventasData = [];
let ventaItemsData = [];
let ventaActiva = null; // { id_venta, id_mesa }

function $(id) { return document.getElementById(id); }

document.addEventListener('DOMContentLoaded', () => {
    if (document.querySelector('.tab-btn')) inicializarTabs();
    if (existe('loginForm')) inicializarLogin();
    if (existe('btnLogout')) {
        $('btnLogout').addEventListener('click', () => {
            localStorage.removeItem('autenticado');
            window.location.href = 'login.html';
        });
    }
    if (existe('btnConfig')) inicializarConfiguracion();
    if (existe('tablaReservas')) inicializarReservas();
    if (existe('formMesa')) inicializarMesas();
    if (existe('formItem')) inicializarItems();
    if (existe('formCargue')) inicializarCargues();
    if (existe('btnAgregarItemConsumo')) inicializarConsumo();
    if (existe('formReserva')) inicializarReservaPublica();

    // Página pública: cargar config (precio, horarios, contacto) si existen los elementos
    if (existe('precioCancha') || existe('horarioLv') || existe('datoDireccion')) {
        cargarConfigWebPublica();
    }

    conectarSSE();

    const esPanelAdmin = document.querySelector('.admin-container');
    if (esPanelAdmin) {
        if (localStorage.getItem('autenticado') !== 'true') {
            window.location.replace('login.html');
            return;
        }
        // Cargar datos del panel cuando ya está autenticado
        cargarDatosIniciales();
    }
});

function existe(id) { return document.getElementById(id) !== null; }

function inicializarTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            $(`tab${capitalize(btn.dataset.tab)}`).classList.add('active');
            if (btn.dataset.tab === 'consumo') {
                cargarConsumo();
            } else if (btn.dataset.tab === 'historial') {
                cargarHistorialVentas();
            } else if (btn.dataset.tab === 'inventario') {
                inicializarFiltrosInventario();
                cargarInventario();
            }
        });
    });

    document.querySelectorAll('.subtab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.subtab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            $(`subtab${capitalize(btn.dataset.subtab)}`).classList.add('active');
        });
    });
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/* ============== LOGIN ============== */
function inicializarLogin() {
    if (!existe('loginForm')) return;
    $('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const usuario = $('usuario').value.trim();
        const password = $('password').value;
        try {
            const r = await fetch(`${API}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ usuario, password })
            });
            const data = await r.json();
            if (data.success) {
                localStorage.setItem('autenticado', 'true');
                window.location.href = 'reservas.html';
            } else {
                if (existe('loginError')) $('loginError').textContent = data.message;
            }
        } catch (err) {
            if (existe('loginError')) $('loginError').textContent = 'Error de conexión';
        }
    });
}

async function cargarDatosIniciales() {
    await Promise.all([
        cargarReservasAdmin(),
        cargarMesas(),
        cargarItems(),
        cargarCargues(),
        cargarVentasAbiertas(),
        cargarVentaItems()
    ]);
    // Si estamos en la pestaña de consumo, renderizar mesas
    if (document.querySelector('.tab-btn[data-tab="consumo"]')?.classList.contains('active')) {
        renderizarMesas();
    }
}

/* ============== CONFIGURACIÓN ============== */
function inicializarConfiguracion() {
    if (!existe('btnConfig')) return;
    $('btnConfig').addEventListener('click', async () => {
        try {
            const r = await fetch(`${API}/config`);
            const data = await r.json();
            $('gsheetsUrl').value = data.GSHEETS_URL || '';
            await cargarWebConfig();
            await cargarMesas();
            await cargarItems();
            await cargarCargues();
            // Fecha default hoy para cargues
            if (existe('fechaCargue') && !$('fechaCargue').value) {
                $('fechaCargue').value = new Date().toISOString().slice(0, 10);
            }
        } catch (err) {
            console.error(err);
        }
        $('configModal').style.display = 'flex';
    });

    $('btnCerrarConfig').addEventListener('click', () => {
        $('configModal').style.display = 'none';
    });

    $('formConfigUrl').addEventListener('submit', async (e) => {
        e.preventDefault();
        const url = $('gsheetsUrl').value.trim();
        try {
            const r = await fetch(`${API}/config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ GSHEETS_URL: url })
            });
            const data = await r.json();
            alert(data.message);
        } catch (err) {
            alert('Error guardando URL');
        }
    });

    if (existe('formConfigWeb')) {
        $('formConfigWeb').addEventListener('submit', async (e) => {
            e.preventDefault();
            const payload = {
                precio_cancha: $('webPrecioCancha').value,
                horario_lv: $('webHorarioLv').value,
                horario_sab: $('webHorarioSab').value,
                horario_dom: $('webHorarioDom').value,
                hora_inicio: $('webHoraInicio').value,
                hora_fin: $('webHoraFin').value,
                intervalo_minutos: $('webIntervalo').value,
                direccion: $('webDireccion').value,
                telefono: $('webTelefono').value,
                correo: $('webCorreo').value,
                whatsapp: $('webWhatsapp').value,
            };
            try {
                const r = await fetch(`${API}/config_web`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await r.json();
                alert(data.message);
            } catch (err) {
                alert('Error guardando configuración web');
            }
        });
    }

    if (existe('formCambiarPassword')) {
        $('formCambiarPassword').addEventListener('submit', async (e) => {
            e.preventDefault();
            const actual = $('passwordActual').value;
            const nueva = $('passwordNueva').value;
            const confirmar = $('passwordConfirmar').value;

            if (nueva !== confirmar) {
                alert('La nueva contraseña y la confirmación no coinciden');
                return;
            }

            try {
                const r = await fetch(`${API}/cambiar_password_admin`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password_actual: actual, password_nueva: nueva })
                });
                const data = await r.json();
                alert(data.message);
                if (data.success) {
                    $('formCambiarPassword').reset();
                }
            } catch (err) {
                alert('Error cambiando la contraseña');
            }
        });
    }
}

async function cargarWebConfig() {
    try {
        const r = await fetch(`${API}/config_web`);
        const data = await r.json();
        if (existe('webPrecioCancha')) $('webPrecioCancha').value = data.precio_cancha || '';
        if (existe('webHorarioLv')) $('webHorarioLv').value = data.horario_lv || '';
        if (existe('webHorarioSab')) $('webHorarioSab').value = data.horario_sab || '';
        if (existe('webHorarioDom')) $('webHorarioDom').value = data.horario_dom || '';
        if (existe('webHoraInicio')) $('webHoraInicio').value = data.hora_inicio || '';
        if (existe('webHoraFin')) $('webHoraFin').value = data.hora_fin || '';
        if (existe('webIntervalo')) $('webIntervalo').value = data.intervalo_minutos || '';
        if (existe('webDireccion')) $('webDireccion').value = data.direccion || '';
        if (existe('webTelefono')) $('webTelefono').value = data.telefono || '';
        if (existe('webCorreo')) $('webCorreo').value = data.correo || '';
        if (existe('webWhatsapp')) $('webWhatsapp').value = data.whatsapp || '';
    } catch (err) {
        console.error('Error cargando config web:', err);
    }
}

/* ============== RESERVAS PUBLICAS ================= */
let configWebData = {};

async function cargarConfigWebPublica() {
    try {
        const r = await fetch(`${API}/config_web`);
        const data = await r.json();
        configWebData = data;
        // Precio
        if (existe('precioCancha')) {
            $('precioCancha').textContent = data.precio_cancha || '$80.000 / hora';
        }
        // Horarios
        if (existe('horarioLv')) $('horarioLv').textContent = data.horario_lv || '8:00 a.m. - 10:00 p.m.';
        if (existe('horarioSab')) $('horarioSab').textContent = data.horario_sab || '8:00 a.m. - 11:00 p.m.';
        if (existe('horarioDom')) $('horarioDom').textContent = data.horario_dom || '9:00 a.m. - 9:00 p.m.';
        // Contacto
        if (existe('datoDireccion')) $('datoDireccion').textContent = data.direccion || 'Calle 123 #45-67';
        if (existe('datoTelefono')) $('datoTelefono').textContent = data.telefono || '300 123 4567';
        if (existe('datoCorreo')) $('datoCorreo').textContent = data.correo || 'reservas@canchadekalipso.com';
        // WhatsApp
        if (existe('linkWhatsapp')) {
            const wa = (data.whatsapp || '573001234567').replace(/\D/g, '');
            $('linkWhatsapp').href = `https://wa.me/${wa}?text=Hola,%20quiero%20reservar%20una%20cancha`;
        }
    } catch (err) {
        console.error('Error cargando config web pública:', err);
    }
}

function reconstruirHorasDisponibles() {
    HORAS_DISPONIBLES.length = 0;
    const inicio = parseInt(configWebData.hora_inicio || 8);
    const fin = parseInt(configWebData.hora_fin || 22);
    const intervalo = parseInt(configWebData.intervalo_minutos || 60);
    for (let h = inicio; h <= fin; h++) {
        for (let m = 0; m < 60; m += intervalo) {
            if (h === fin && m > 0) continue;
            HORAS_DISPONIBLES.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
        }
    }
}

const HORAS_DISPONIBLES = [];

async function inicializarReservaPublica() {
    if (!existe('formReserva')) return;

    await cargarConfigWebPublica();
    reconstruirHorasDisponibles();

    const selectHora = $('hora');
    selectHora.innerHTML = '<option value="">Selecciona hora</option>';

    function poblarHoras(ocupadas = []) {
        selectHora.innerHTML = '<option value="">Selecciona hora</option>';
        HORAS_DISPONIBLES.forEach(hora => {
            if (ocupadas.includes(hora)) return;
            const opt = document.createElement('option');
            opt.value = hora;
            opt.textContent = hora;
            selectHora.appendChild(opt);
        });
    }

    function fechaEsHoy(fechaStr) {
        const hoy = new Date();
        const hoyStr = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-${String(hoy.getDate()).padStart(2,'0')}`;
        return fechaStr === hoyStr;
    }

    function ahoraEnMinutos() {
        const ahora = new Date();
        return ahora.getHours() * 60 + ahora.getMinutes();
    }

    async function actualizarHoras() {
        const fecha = $('fecha').value;
        if (!fecha) {
            poblarHoras([]);
            return;
        }

        // No permitir fechas pasadas
        const inputFecha = new Date(fecha + 'T00:00:00');
        const hoy = new Date();
        hoy.setHours(0,0,0,0);
        if (inputFecha < hoy) {
            alert('No puedes reservar en una fecha pasada.');
            $('fecha').value = '';
            poblarHoras([]);
            return;
        }

        const esHoy = fechaEsHoy(fecha);
        const ahoraMin = ahoraEnMinutos();

        try {
            const r = await fetch(`${API}/horarios_ocupados?fecha=${encodeURIComponent(fecha)}`);
            const data = await r.json();
            const ocupadas = data.horas || [];
            selectHora.innerHTML = '<option value="">Selecciona hora</option>';
            HORAS_DISPONIBLES.forEach(hora => {
                if (ocupadas.includes(hora)) return;
                // Si es hoy, ocultar horas que ya pasaron o estan en curso
                if (esHoy) {
                    const [h, m] = hora.split(':').map(Number);
                    const horaMin = h * 60 + m;
                    if (horaMin < ahoraMin) return;
                }
                const opt = document.createElement('option');
                opt.value = hora;
                opt.textContent = hora;
                selectHora.appendChild(opt);
            });
        } catch (err) {
            console.error('Error cargando horarios ocupados', err);
        }
    }

    // Establecer minimo de fecha a hoy
    if (existe('fecha')) {
        const hoy = new Date();
        const hoyStr = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-${String(hoy.getDate()).padStart(2,'0')}`;
        $('fecha').min = hoyStr;
    }

    poblarHoras([]);
    if (existe('fecha')) $('fecha').addEventListener('change', actualizarHoras);

    $('formReserva').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fecha = $('fecha').value;
        const hora = $('hora').value;

        // Validar fecha no pasada
        const inputFecha = new Date(fecha + 'T00:00:00');
        const hoy = new Date();
        hoy.setHours(0,0,0,0);
        if (inputFecha < hoy) {
            alert('No puedes reservar en una fecha pasada.');
            return;
        }

        // Validar hora no pasada si es hoy
        if (fechaEsHoy(fecha)) {
            const [h, m] = hora.split(':').map(Number);
            const horaMin = h * 60 + m;
            const ahoraMin = ahoraEnMinutos();
            if (horaMin < ahoraMin) {
                alert('No puedes reservar en una hora que ya pasó.');
                return;
            }
        }

        const payload = {
            nombre_cliente: $('nombre').value.trim(),
            telefono: $('telefono').value.trim(),
            fecha,
            hora,
            estado: 'Pendiente',
            notas: 'Reserva web',
            precio: 0
        };
        try {
            const r = await fetch(`${API}/reservas`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await r.json();
            if (data.success) {
                alert('¡Reserva registrada! Nos contactaremos contigo.');
                $('formReserva').reset();
                actualizarHoras();
            } else {
                alert(data.message || 'No se pudo registrar la reserva');
            }
        } catch (err) {
            alert('Error de conexión');
        }
    });
}

/* ============== RESERVAS ADMIN ============== */
function inicializarReservas() {
    if (!existe('tablaReservas')) return;

    $('btnFiltrarReservas').addEventListener('click', cargarReservasAdmin);
    $('btnLimpiarFiltroReservas').addEventListener('click', () => {
        $('filtroFechaReservas').value = '';
        cargarReservasAdmin();
    });
}

async function cambiarEstadoReserva(id_reserva, nuevoEstado) {
    const r = reservasData.find(x => x.id_reserva === id_reserva);
    if (!r) return;
    const payload = {
        id_reserva: r.id_reserva,
        nombre_cliente: r.nombre_cliente,
        telefono: r.telefono || '',
        fecha: r.fecha,
        hora: r.hora,
        estado: nuevoEstado,
        notas: r.notas || '',
        precio: r.precio || 0
    };
    try {
        const resp = await fetch(`${API}/reservas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await resp.json();
        if (data.success) {
            await cargarReservasAdmin();
        } else {
            alert(data.message);
        }
    } catch (err) {
        alert('Error de conexión');
    }
}

window.cambiarEstadoReserva = cambiarEstadoReserva;

async function cargarReservasAdmin() {
    if (!existe('tablaReservas')) return;
    const r = await fetch(`${API}/reservas`);
    reservasData = await r.json();
    const filtroFecha = existe('filtroFechaReservas') ? $('filtroFechaReservas').value : '';

    const tbody = $('tablaReservas').querySelector('tbody');
    tbody.innerHTML = '';

    const ahora = new Date();

    let filtradas = reservasData.filter(r => {
        const finReserva = new Date(`${r.fecha}T${r.hora}:00`);
        return finReserva >= ahora;
    });

    if (filtroFecha) {
        filtradas = filtradas.filter(r => r.fecha === filtroFecha);
    }

    filtradas.sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));

    if (filtradas.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="7" class="text-center text-muted">No hay reservas para esta fecha.</td>`;
        tbody.appendChild(tr);
        return;
    }

    filtradas.forEach(r => {
        const claseEstado = r.estado === 'Confirmada' ? 'estado-confirmada' : r.estado === 'Cancelada' ? 'estado-cancelada' : 'estado-pendiente';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHtml(r.nombre_cliente)}</td>
            <td>${escapeHtml(r.telefono || '')}</td>
            <td>${r.fecha}</td>
            <td>${r.hora}</td>
            <td class="${claseEstado}">${r.estado}</td>
            <td>${escapeHtml(r.notas || '')}</td>
            <td class="acciones-estado">
                <button type="button" class="btn btn-primary" onclick="cambiarEstadoReserva(${r.id_reserva}, 'Confirmada')" ${r.estado === 'Confirmada' ? 'disabled' : ''}>Confirmar</button>
                <button type="button" class="btn btn-secondary" onclick="cambiarEstadoReserva(${r.id_reserva}, 'Pendiente')" ${r.estado === 'Pendiente' ? 'disabled' : ''}>Espera</button>
                <button type="button" class="btn btn-danger" onclick="cambiarEstadoReserva(${r.id_reserva}, 'Cancelada')" ${r.estado === 'Cancelada' ? 'disabled' : ''}>Cancelar</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

/* ============== MESAS ============== */
function inicializarMesas() {
    if (!existe('formMesa')) return;
    $('formMesa').addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
            id_mesa: $('idMesa').value ? parseInt($('idMesa').value) : null,
            nombre_mesa: $('nombreMesa').value.trim(),
            ubicacion: $('ubicacionMesa').value.trim(),
            activa: $('activaMesa').checked ? 1 : 0
        };
        const r = await fetch(`${API}/mesas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await r.json();
        if (data.success) {
            $('formMesa').reset();
            $('idMesa').value = '';
            await cargarMesas();
        } else {
            alert(data.message);
        }
    });

    $('btnCancelarMesa').addEventListener('click', () => {
        $('formMesa').reset();
        $('idMesa').value = '';
    });
}

async function cargarMesas() {
    if (!existe('tablaMesas')) return;
    const r = await fetch(`${API}/mesas`);
    mesasData = await r.json();

    const tbody = $('tablaMesas').querySelector('tbody');
    tbody.innerHTML = '';
    mesasData.forEach(m => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${m.id_mesa}</td>
            <td>${escapeHtml(m.nombre_mesa)}</td>
            <td>${escapeHtml(m.ubicacion || '')}</td>
            <td>${m.activa ? 'Sí' : 'No'}</td>
            <td>
                <button class="btn-secondary" onclick="editarMesa(${m.id_mesa})">Editar</button>
                <button class="btn-danger" onclick="eliminarMesa(${m.id_mesa})">Eliminar</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.editarMesa = (id) => {
    const m = mesasData.find(x => x.id_mesa === id);
    if (!m) return;
    $('idMesa').value = m.id_mesa;
    $('nombreMesa').value = m.nombre_mesa;
    $('ubicacionMesa').value = m.ubicacion || '';
    $('activaMesa').checked = !!m.activa;
};

window.eliminarMesa = async (id) => {
    if (!confirm('¿Eliminar esta mesa?')) return;
    await fetch(`${API}/mesas/${id}`, { method: 'DELETE' });
    await cargarMesas();
};

/* ============== ITEMS ============== */
function inicializarItems() {
    if (!existe('formItem')) return;
    $('formItem').addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
            id_item: $('idItem').value ? parseInt($('idItem').value) : null,
            nombre_item: $('nombreItem').value.trim(),
            categoria: $('categoriaItem').value.trim(),
            precio_venta: parseFloat($('precioItem').value || 0),
            unidad: $('unidadItem').value.trim() || 'unidad'
        };
        const r = await fetch(`${API}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await r.json();
        if (data.success) {
            $('formItem').reset();
            $('idItem').value = '';
            await cargarItems();
        } else {
            alert(data.message);
        }
    });

    $('btnCancelarItem').addEventListener('click', () => {
        $('formItem').reset();
        $('idItem').value = '';
    });
}

async function cargarItems() {
    if (!existe('tablaItems')) return;
    const r = await fetch(`${API}/items`);
    itemsData = await r.json();

    const tbody = $('tablaItems').querySelector('tbody');
    tbody.innerHTML = '';
    itemsData.forEach(i => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${i.id_item}</td>
            <td>${escapeHtml(i.nombre_item)}</td>
            <td>${escapeHtml(i.categoria || '')}</td>
            <td>${formatearPrecio(i.precio_venta)}</td>
            <td>${escapeHtml(i.unidad || 'unidad')}</td>
            <td>${formatearEntero(i.stock)}</td>
            <td>
                <button class="btn-secondary" onclick="editarItem(${i.id_item})">Editar</button>
                <button class="btn-danger" onclick="eliminarItem(${i.id_item})">Eliminar</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Poblar selects de cargues y consumo
    const optCargue = existe('itemCargue') ? $('itemCargue') : null;
    const optConsumo = existe('selectItemConsumo') ? $('selectItemConsumo') : null;
    const valorCargue = optCargue ? optCargue.value : '';
    const valorConsumo = optConsumo ? optConsumo.value : '';
    if (optCargue) optCargue.innerHTML = '<option value="">Seleccione item</option>';
    if (optConsumo) optConsumo.innerHTML = '<option value="">Seleccione item</option>';
    itemsData.forEach(i => {
        if (optCargue) {
            const opt1 = document.createElement('option');
            opt1.value = i.id_item;
            opt1.textContent = `${i.nombre_item} (${formatearPrecio(i.precio_venta)}) - Stock: ${formatearEntero(i.stock)}`;
            optCargue.appendChild(opt1);
        }

        if (optConsumo) {
            const opt2 = document.createElement('option');
            opt2.value = i.id_item;
            opt2.textContent = `${i.nombre_item} (${formatearPrecio(i.precio_venta)})`;
            optConsumo.appendChild(opt2);
        }
    });
    // Restaurar valores si siguen existiendo
    if (optCargue && valorCargue && itemsData.some(i => String(i.id_item) === valorCargue)) {
        optCargue.value = valorCargue;
    }
    if (optConsumo && valorConsumo && itemsData.some(i => String(i.id_item) === valorConsumo)) {
        optConsumo.value = valorConsumo;
    }
}

window.editarItem = (id) => {
    const i = itemsData.find(x => x.id_item === id);
    if (!i) return;
    $('idItem').value = i.id_item;
    $('nombreItem').value = i.nombre_item;
    $('categoriaItem').value = i.categoria || '';
    $('precioItem').value = i.precio_venta || '';
    $('unidadItem').value = i.unidad || 'unidad';
};

window.eliminarItem = async (id) => {
    if (!confirm('¿Eliminar este item?')) return;
    await fetch(`${API}/items/${id}`, { method: 'DELETE' });
    await cargarItems();
};

/* ============== CARGUES ============== */
function inicializarCargues() {
    if (!existe('formCargue')) return;
    $('formCargue').addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
            id_cargue: $('idCargue').value ? parseInt($('idCargue').value) : null,
            id_item: parseInt($('itemCargue').value),
            cantidad: parseInt($('cantidadCargue').value),
            costo_unitario: parseFloat($('costoCargue').value || 0),
            proveedor: $('proveedorCargue').value.trim(),
            fecha_cargue: $('fechaCargue').value || new Date().toISOString().slice(0, 10)
        };
        const r = await fetch(`${API}/cargues`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await r.json();
        if (data.success) {
            $('formCargue').reset();
            $('idCargue').value = '';
            $('fechaCargue').value = new Date().toISOString().slice(0, 10);
            await cargarCargues();
            await cargarItems();
        } else {
            alert(data.message);
        }
    });

    $('btnCancelarCargue').addEventListener('click', () => {
        $('formCargue').reset();
        $('idCargue').value = '';
        $('fechaCargue').value = new Date().toISOString().slice(0, 10);
    });
}

async function cargarCargues() {
    if (!existe('tablaCargues')) return;
    const r = await fetch(`${API}/cargues`);
    carguesData = await r.json();

    const tbody = $('tablaCargues').querySelector('tbody');
    tbody.innerHTML = '';
    carguesData.forEach(c => {
        const item = itemsData.find(i => i.id_item === c.id_item);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${c.id_cargue}</td>
            <td>${escapeHtml(item ? item.nombre_item : c.id_item)}</td>
            <td>${formatearEntero(c.cantidad)}</td>
            <td>${formatearPrecio(c.costo_unitario)}</td>
            <td>${escapeHtml(c.proveedor || '')}</td>
            <td>${c.fecha_cargue || ''}</td>
            <td>
                <button class="btn-secondary" onclick="editarCargue(${c.id_cargue})">Editar</button>
                <button class="btn-danger" onclick="eliminarCargue(${c.id_cargue})">Eliminar</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.editarCargue = (id) => {
    const c = carguesData.find(x => x.id_cargue === id);
    if (!c) return;
    $('idCargue').value = c.id_cargue;
    $('itemCargue').value = c.id_item;
    $('cantidadCargue').value = c.cantidad;
    $('costoCargue').value = c.costo_unitario || '';
    $('proveedorCargue').value = c.proveedor || '';
    $('fechaCargue').value = c.fecha_cargue || '';
};

window.eliminarCargue = async (id) => {
    if (!confirm('¿Eliminar este cargue?')) return;
    await fetch(`${API}/cargues/${id}`, { method: 'DELETE' });
    await cargarCargues();
};

/* ============== CONSUMO (POS) ============== */
function inicializarConsumo() {
    if (!existe('btnAgregarItemConsumo')) return;
    $('btnAgregarItemConsumo').addEventListener('click', async () => {
        if (!ventaActiva) {
            alert('Selecciona una mesa primero');
            return;
        }
        const id_item = parseInt($('selectItemConsumo').value);
        const cantidad = parseInt($('cantidadItemConsumo').value);
        if (!id_item || !cantidad || cantidad <= 0) {
            alert('Selecciona un item y cantidad válida');
            return;
        }

        // Si es mesa libre, crear la venta primero
        if (!ventaActiva.id_venta) {
            const r = await fetch(`${API}/ventas`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id_mesa: ventaActiva.id_mesa })
            });
            const data = await r.json();
            if (!data.success) {
                alert(data.message);
                return;
            }
            ventaActiva.id_venta = data.id_venta;
        }

        const r = await fetch(`${API}/venta_items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id_venta: ventaActiva.id_venta, id_item, cantidad, agregado_por: 'caja' })
        });
        const data = await r.json();
        if (data.success) {
            $('cantidadItemConsumo').value = 1;
            await cargarConsumo();
        } else {
            alert(data.message);
        }
    });

    $('btnCerrarMesa').addEventListener('click', async () => {
        if (!ventaActiva) return;
        if (!confirm('¿Cerrar la mesa? Esto guardará la venta.')) return;
        const r = await fetch(`${API}/ventas/${ventaActiva.id_venta}/cerrar`, { method: 'POST' });
        const data = await r.json();
        if (data.success) {
            alert(`Mesa cerrada. Subtotal: ${formatearPrecio(data.subtotal)}`);
            ventaActiva = null;
            limpiarCuenta();
            await cargarConsumo();
        } else {
            alert(data.message);
        }
    });

    $('btnCancelarSeleccion').addEventListener('click', () => {
        ventaActiva = null;
        renderizarMesas();
        limpiarCuenta();
    });
}

async function cargarVentasAbiertas() {
    const r = await fetch(`${API}/ventas_abiertas`);
    const data = await r.json();
    ventasData = data.ventas;
    return ventasData;
}

async function cargarVentaItems() {
    // Solo cargar items de ventas abiertas
    const r = await fetch(`${API}/ventas_abiertas`);
    const data = await r.json();
    ventaItemsData = data.items || [];
    return ventaItemsData;
}

async function cargarConsumo() {
    await Promise.all([cargarMesas(), cargarItems(), cargarVentasAbiertas(), cargarVentaItems()]);

    renderizarMesas();
    if (ventaActiva) {
        if (ventaActiva.id_venta) {
            const v = ventasData.find(x => x.id_venta === ventaActiva.id_venta);
            if (v) {
                renderizarCuenta(v);
            } else {
                ventaActiva = null;
                limpiarCuenta();
            }
        } else {
            // Mesa libre seleccionada pero sin venta - mantener esa vista
            const mesa = mesasData.find(m => m.id_mesa === ventaActiva.id_mesa);
            if (mesa) {
                limpiarCuenta();
                $('tituloCuenta').textContent = `Mesa: ${escapeHtml(mesa.nombre_mesa)}`;
                $('agregarItemBox').style.display = 'block';
                $('btnCerrarMesa').disabled = true;
            } else {
                ventaActiva = null;
                limpiarCuenta();
            }
        }
    }
}

async function cargarHistorialVentas() {
    await Promise.all([cargarMesas(), cargarItems()]);

    const r = await fetch(`${API}/ventas`);
    const ventas = await r.json();
    const rItems = await fetch(`${API}/venta_items`);
    const items = await rItems.json();

    renderizarHistorialVentas(ventas, items);
}

/* ============== INVENTARIO ============== */
function inicializarFiltrosInventario() {
    // Poblar select de categorías únicas
    const selectCat = $('filtroCategoriaInventario');
    if (selectCat) {
        const categorias = [...new Set(itemsData.map(i => i.categoria).filter(Boolean))].sort();
        selectCat.innerHTML = '<option value="">Todas las categorías</option>';
        categorias.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            selectCat.appendChild(opt);
        });
    }

    // Eventos de filtro
    if (existe('filtroNombreInventario')) {
        $('filtroNombreInventario').addEventListener('input', cargarInventario);
    }
    if (existe('filtroCategoriaInventario')) {
        $('filtroCategoriaInventario').addEventListener('change', cargarInventario);
    }
    if (existe('btnLimpiarFiltrosInventario')) {
        $('btnLimpiarFiltrosInventario').addEventListener('click', () => {
            $('filtroNombreInventario').value = '';
            $('filtroCategoriaInventario').value = '';
            cargarInventario();
        });
    }
}

async function cargarInventario() {
    if (!existe('tablaInventario')) return;

    await Promise.all([cargarItems(), cargarCargues()]);

    const r = await fetch(`${API}/venta_items`);
    const ventaItems = await r.json();

    // Sumar cantidades vendidas por item
    const vendidoPorItem = {};
    ventaItems.forEach(vi => {
        const id = Number(vi.id_item);
        vendidoPorItem[id] = (vendidoPorItem[id] || 0) + (parseInt(vi.cantidad) || 0);
    });

    // Calcular costo promedio ponderado y total cargado por item
    const cargadoPorItem = {};
    const costoTotalPorItem = {};
    carguesData.forEach(c => {
        const id = Number(c.id_item);
        const cantidad = parseInt(c.cantidad) || 0;
        const costo = Number(c.costo_unitario) || 0;
        cargadoPorItem[id] = (cargadoPorItem[id] || 0) + cantidad;
        costoTotalPorItem[id] = (costoTotalPorItem[id] || 0) + (cantidad * costo);
    });

    const tbody = $('tablaInventario').querySelector('tbody');
    tbody.innerHTML = '';

    // Aplicar filtros
    const filtroNombre = ($('filtroNombreInventario')?.value || '').toLowerCase();
    const filtroCategoria = $('filtroCategoriaInventario')?.value || '';

    const itemsFiltrados = itemsData.filter(i => {
        const nombre = (i.nombre_item || '').toLowerCase();
        const categoria = i.categoria || '';
        return nombre.includes(filtroNombre) && (!filtroCategoria || categoria === filtroCategoria);
    });

    if (itemsFiltrados.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="6" class="text-center text-muted">No hay items que coincidan con los filtros.</td>';
        tbody.appendChild(tr);
        return;
    }

    itemsFiltrados.forEach(i => {
        const id = i.id_item;
        const cargado = cargadoPorItem[id] || 0;
        const vendido = vendidoPorItem[id] || 0;
        const stockActual = i.stock !== undefined ? i.stock : (cargado - vendido);
        const costoPromedio = cargado > 0 ? (costoTotalPorItem[id] || 0) / cargado : 0;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHtml(i.nombre_item)}</td>
            <td>${escapeHtml(i.categoria || '')}</td>
            <td>${formatearEntero(cargado)}</td>
            <td>${formatearEntero(vendido)}</td>
            <td><strong>${formatearEntero(stockActual)}</strong> ${escapeHtml(i.unidad || '')}</td>
            <td>${formatearPrecio(costoPromedio)}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderizarMesas() {
    const grid = $('consumoGridMesas');
    grid.innerHTML = '';
    mesasData.filter(m => m.activa).forEach(m => {
        const ventaAbierta = ventasData.find(v => v.id_mesa === m.id_mesa);
        const div = document.createElement('div');
        const esSeleccionada = ventaActiva && ventaActiva.id_mesa === m.id_mesa;
        div.className = `card-mesa ${ventaAbierta ? 'ocupada' : ''} ${esSeleccionada ? 'active' : ''}`;
        div.innerHTML = `
            
            <strong>${escapeHtml(m.nombre_mesa)}</strong>
            <div>${ventaAbierta ? 'Ocupada' : (esSeleccionada ? 'Seleccionada' : 'Libre')}</div>
        `;
        div.addEventListener('click', () => {
            seleccionarMesa(m.id_mesa, ventaAbierta);
        });
        grid.appendChild(div);
    });
}

function seleccionarMesa(id_mesa, ventaAbierta) {
    if (ventaActiva && ventaActiva.id_mesa === id_mesa) return;

    if (ventaAbierta) {
        // Seleccionar venta ya existente
        ventaActiva = { id_venta: ventaAbierta.id_venta, id_mesa };
        renderizarMesas();
        const v = ventasData.find(x => x.id_venta === ventaAbierta.id_venta);
        if (v) renderizarCuenta(v);
    } else {
        // Seleccionar mesa libre sin crear venta aún
        ventaActiva = { id_venta: null, id_mesa };
        renderizarMesas();
        limpiarCuenta();
        $('tituloCuenta').textContent = 'Agrega productos para abrir cuenta';
        $('agregarItemBox').style.display = 'block';
        $('btnCerrarMesa').disabled = true;
    }
}

function renderizarCuenta(venta) {
    const mesa = mesasData.find(m => m.id_mesa === venta.id_mesa);
    $('tituloCuenta').textContent = `Cuenta: ${mesa ? mesa.nombre_mesa : 'Mesa #' + venta.id_mesa}`;
    $('mesaInfo').textContent = `Inicio: ${formatearFecha(venta.fecha_inicio_mesa)}`;
    $('agregarItemBox').style.display = 'block';
    $('btnCerrarMesa').disabled = false;

    const itemsVenta = ventaItemsData.filter(i => i.id_venta === venta.id_venta);
    const tbody = $('tablaCuenta').querySelector('tbody');
    tbody.innerHTML = '';
    let subtotal = 0;
    itemsVenta.forEach(i => {
        const item = itemsData.find(x => x.id_item === i.id_item);
        subtotal += (i.total_linea || 0);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHtml(item ? item.nombre_item : 'Item #' + i.id_item)}</td>
            <td>${formatearEntero(i.cantidad)}</td>
            <td>${formatearPrecio(i.precio_unitario)}</td>
            <td>${formatearPrecio(i.total_linea)}</td>
            <td class="text-center"><span class="badge-${(i.agregado_por || 'caja').toLowerCase()}" title="Agregado por ${escapeHtml(i.agregado_por || 'caja')}">${escapeHtml(i.agregado_por || 'caja')}</span></td>
        `;
        tbody.appendChild(tr);
    });
    $('subtotalCuenta').textContent = formatearPrecio(subtotal);
}

function limpiarCuenta() {
    $('tituloCuenta').textContent = 'Ninguna mesa seleccionada';
    $('mesaInfo').textContent = '';
    $('agregarItemBox').style.display = 'none';
    $('btnCerrarMesa').disabled = true;
    $('tablaCuenta').querySelector('tbody').innerHTML = '';
    $('subtotalCuenta').textContent = '$0.00';
}

function renderizarHistorialVentas(ventas, items) {
    if (!existe('historialVentas')) return;
    const contenedor = $('historialVentas');
    contenedor.innerHTML = '';

    const cerradas = ventas
        .filter(v => v.fecha_cierre)
        .sort((a, b) => (b.fecha_cierre || '').localeCompare(a.fecha_cierre || ''));

    if (cerradas.length === 0) {
        contenedor.innerHTML = '<p class="text-muted">Aún no hay ventas cerradas.</p>';
        return;
    }

    cerradas.forEach(v => {
        const mesa = mesasData.find(m => m.id_mesa === v.id_mesa);
        const itemsVenta = items.filter(i => i.id_venta === v.id_venta);

        const div = document.createElement('div');
        div.className = 'historial-venta';
        div.innerHTML = `
            <button type="button" class="historial-venta-header" onclick="toggleHistorialVenta(this)">
                <span>Venta #${v.id_venta} — ${mesa ? escapeHtml(mesa.nombre_mesa) : 'Mesa #' + v.id_mesa} — ${formatearPrecio(v.subtotal)}</span>
                <span class="text-muted">${formatearFecha(v.fecha_cierre)} ▸</span>
            </button>
            <div class="historial-venta-detalles">
                <p class="text-muted">Inicio mesa: ${formatearFecha(v.fecha_inicio_mesa)} · Cierre: ${formatearFecha(v.fecha_cierre)}</p>
                <table class="historial-venta-items">
                    <thead>
                        <tr><th>Item</th><th>Cantidad</th><th>Precio</th><th>Total</th></tr>
                    </thead>
                    <tbody></tbody>
                </table>
            </div>
        `;

        const tbody = div.querySelector('tbody');
        itemsVenta.forEach(i => {
            const item = itemsData.find(x => x.id_item === i.id_item);
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHtml(item ? item.nombre_item : 'Item #' + i.id_item)}</td>
                <td>${formatearEntero(i.cantidad)}</td>
                <td>${formatearPrecio(i.precio_unitario)}</td>
                <td>${formatearPrecio(i.total_linea)}</td>
            `;
            tbody.appendChild(tr);
        });

        contenedor.appendChild(div);
    });
}

window.toggleHistorialVenta = function(btn) {
    const detalles = btn.nextElementSibling;
    detalles.classList.toggle('open');
    const span = btn.querySelector('span:last-child');
    span.textContent = detalles.classList.contains('open') ? formatearFecha(btn.dataset.fecha || '') + ' ▼' : formatearFecha(btn.dataset.fecha || '') + ' ▸';
};

function formatearFecha(fecha) {
    if (!fecha) return '';
    const d = new Date(fecha);
    return d.toLocaleString('es-CO');
}

function conectarSSE() {
    if (typeof EventSource === 'undefined') return;
    let sse = null;
    const connect = () => {
        if (sse) sse.close();
        sse = new EventSource(`${API}/eventos`);
        sse.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);
                if (data.evento === 'ventas_actualizadas') {
                    refrescarDatosVenta();
                }
            } catch (err) {
                console.error('SSE parse error:', err);
            }
        };
        sse.onerror = () => {
            if (sse) sse.close();
            setTimeout(connect, 5000);
        };
    };
    connect();
}

async function refrescarDatosVenta() {
    await cargarVentasAbiertas();
    await cargarVentaItems();
    renderizarMesas();
    if (ventaActiva) {
        if (ventaActiva.id_venta) {
            const v = ventasData.find(x => x.id_venta === ventaActiva.id_venta);
            if (v) {
                renderizarCuenta(v);
            } else {
                limpiarCuenta();
                ventaActiva = null;
                renderizarMesas();
            }
        } else {
            // Mesa seleccionada pero sin venta aún - no hacer nada, mantener estado
            const mesa = mesasData.find(m => m.id_mesa === ventaActiva.id_mesa);
            if (!mesa) {
                ventaActiva = null;
                limpiarCuenta();
            }
        }
    }
}

function formatearEntero(n) {
    return Math.round(Number(n) || 0).toLocaleString('es-CO');
}

function formatearPrecio(n) {
    return '$' + (Number(n) || 0).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
