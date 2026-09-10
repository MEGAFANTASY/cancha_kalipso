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
        cargarCargues()
    ]);
}

/* ============== CONFIGURACIÓN ============== */
function inicializarConfiguracion() {
    if (!existe('btnConfig')) return;
    $('btnConfig').addEventListener('click', async () => {
        try {
            const r = await fetch(`${API}/config`);
            const data = await r.json();
            $('gsheetsUrl').value = data.GSHEETS_URL || '';
            await cargarMesas();
            await cargarItems();
            await cargarCargues();
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

    $('btnSincronizar').addEventListener('click', async () => {
        try {
            const r = await fetch(`${API}/sincronizar`, { method: 'POST' });
            const data = await r.json();
            alert(data.message);
            await cargarDatosIniciales();
            if ($('tabConsumo').classList.contains('active')) {
                cargarConsumo();
            }
        } catch (err) {
            alert('Error de sincronización');
        }
    });
}

/* ============== RESERVAS PUBLICAS ================= */
const HORAS_DISPONIBLES = [];
for (let h = 8; h <= 22; h++) {
    for (let m of ['00', '30']) {
        const horaStr = `${String(h).padStart(2, '0')}:${m}`;
        if (h === 22 && m === '30') continue;
        HORAS_DISPONIBLES.push(horaStr);
    }
}

function inicializarReservaPublica() {
    if (!existe('formReserva')) return;

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

    async function actualizarHoras() {
        const fecha = $('fecha').value;
        if (!fecha) {
            poblarHoras([]);
            return;
        }
        try {
            const r = await fetch(`${API}/horarios_ocupados?fecha=${encodeURIComponent(fecha)}`);
            const data = await r.json();
            poblarHoras(data.horas || []);
        } catch (err) {
            console.error('Error cargando horarios ocupados', err);
        }
    }

    poblarHoras([]);
    if (existe('fecha')) $('fecha').addEventListener('change', actualizarHoras);

    $('formReserva').addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
            nombre_cliente: $('nombre').value.trim(),
            telefono: $('telefono').value.trim(),
            fecha: $('fecha').value,
            hora: $('hora').value,
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

    let filtradas = reservasData;
    if (filtroFecha) {
        filtradas = reservasData.filter(r => r.fecha === filtroFecha);
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
            unidad: $('unidadItem').value.trim() || 'unidad',
            stock: parseFloat($('stockItem').value || 0)
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
            <td>$${(i.precio_venta || 0).toFixed(2)}</td>
            <td>${escapeHtml(i.unidad || 'unidad')}</td>
            <td>${(i.stock || 0).toFixed(2)}</td>
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
    if (optCargue) optCargue.innerHTML = '<option value="">Seleccione item</option>';
    if (optConsumo) optConsumo.innerHTML = '<option value="">Seleccione item</option>';
    itemsData.forEach(i => {
        if (optCargue) {
            const opt1 = document.createElement('option');
            opt1.value = i.id_item;
            opt1.textContent = `${i.nombre_item} ($${(i.precio_venta || 0).toFixed(2)}) - Stock: ${(i.stock || 0).toFixed(2)}`;
            optCargue.appendChild(opt1);
        }

        if (optConsumo) {
            const opt2 = document.createElement('option');
            opt2.value = i.id_item;
            opt2.textContent = `${i.nombre_item} ($${(i.precio_venta || 0).toFixed(2)})`;
            optConsumo.appendChild(opt2);
        }
    });
}

window.editarItem = (id) => {
    const i = itemsData.find(x => x.id_item === id);
    if (!i) return;
    $('idItem').value = i.id_item;
    $('nombreItem').value = i.nombre_item;
    $('categoriaItem').value = i.categoria || '';
    $('precioItem').value = i.precio_venta || '';
    $('unidadItem').value = i.unidad || 'unidad';
    $('stockItem').value = i.stock || 0;
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
            cantidad: parseFloat($('cantidadCargue').value),
            costo_unitario: parseFloat($('costoCargue').value || 0),
            proveedor: $('proveedorCargue').value.trim(),
            fecha_cargue: $('fechaCargue').value
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
            await cargarCargues();
            await cargarItems();
        } else {
            alert(data.message);
        }
    });

    $('btnCancelarCargue').addEventListener('click', () => {
        $('formCargue').reset();
        $('idCargue').value = '';
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
            <td>${(c.cantidad || 0).toFixed(2)}</td>
            <td>$${(c.costo_unitario || 0).toFixed(2)}</td>
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
        const cantidad = parseFloat($('cantidadItemConsumo').value);
        if (!id_item || !cantidad || cantidad <= 0) {
            alert('Selecciona un item y cantidad válida');
            return;
        }
        const r = await fetch(`${API}/venta_items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id_venta: ventaActiva.id_venta, id_item, cantidad })
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
            alert(`Mesa cerrada. Subtotal: $${(data.subtotal || 0).toFixed(2)}`);
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

async function cargarConsumo() {
    await Promise.all([cargarMesas(), cargarItems()]);

    const r = await fetch(`${API}/ventas_abiertas`);
    const data = await r.json();
    ventasData = data.ventas;
    ventaItemsData = data.items;

    renderizarMesas();
    if (ventaActiva) {
        const v = ventasData.find(x => x.id_venta === ventaActiva.id_venta);
        if (v) {
            renderizarCuenta(v);
        } else {
            ventaActiva = null;
            limpiarCuenta();
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

function renderizarMesas() {
    const grid = $('consumoGridMesas');
    grid.innerHTML = '';
    mesasData.filter(m => m.activa).forEach(m => {
        const ventaAbierta = ventasData.find(v => v.id_mesa === m.id_mesa);
        const div = document.createElement('div');
        div.className = `card-mesa ${ventaAbierta ? 'ocupada' : ''} ${ventaActiva && ventaActiva.id_mesa === m.id_mesa ? 'active' : ''}`;
        div.innerHTML = `
            
            <strong>${escapeHtml(m.nombre_mesa)}</strong>
            <div>${ventaAbierta ? 'Ocupada' : 'Libre'}</div>
        `;
        div.addEventListener('click', async () => {
            await seleccionarMesa(m.id_mesa, ventaAbierta);
        });
        grid.appendChild(div);
    });
}

async function seleccionarMesa(id_mesa, ventaAbierta) {
    if (ventaActiva && ventaActiva.id_mesa === id_mesa) return;

    if (ventaAbierta) {
        ventaActiva = { id_venta: ventaAbierta.id_venta, id_mesa };
    } else {
        // Crear nueva venta abierta
        const r = await fetch(`${API}/ventas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id_mesa })
        });
        const data = await r.json();
        if (!data.success) {
            alert(data.message);
            return;
        }
        ventaActiva = { id_venta: data.id_venta, id_mesa };
    }

    await cargarConsumo();
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
            <td>${(i.cantidad || 0).toFixed(2)}</td>
            <td>$${(i.precio_unitario || 0).toFixed(2)}</td>
            <td>$${(i.total_linea || 0).toFixed(2)}</td>
        `;
        tbody.appendChild(tr);
    });
    $('subtotalCuenta').textContent = `$${subtotal.toFixed(2)}`;
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
                <span>Venta #${v.id_venta} — ${mesa ? escapeHtml(mesa.nombre_mesa) : 'Mesa #' + v.id_mesa} — $${(v.subtotal || 0).toFixed(2)}</span>
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
                <td>${(i.cantidad || 0).toFixed(2)}</td>
                <td>$${(i.precio_unitario || 0).toFixed(2)}</td>
                <td>$${(i.total_linea || 0).toFixed(2)}</td>
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

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
