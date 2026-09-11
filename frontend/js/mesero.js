const API = '/api';
let mesasData = [];
let itemsData = [];
let ventasData = [];
let ventaItemsData = [];
let ventaActiva = null;
let syncTimer = null;
let sse = null;

function $(id) { return document.getElementById(id); }

function conectarSSE() {
    if (sse) {
        sse.close();
        sse = null;
    }
    try {
        sse = new EventSource(`${API}/eventos`);
        sse.addEventListener('message', (e) => {
            const data = JSON.parse(e.data);
            if (data.evento === 'ventas_actualizadas') {
                cargarDatos();
            }
        });
    } catch (err) {
        console.error('SSE error:', err);
    }
}

window.addEventListener('beforeunload', () => {
    if (sse) sse.close();
});

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

function setSyncing(syncing) {
    const el = $('syncIndicator');
    if (!el) return;
    el.className = syncing ? 'sync-indicator syncing' : 'sync-indicator';
}

/* ============== AUTH ============== */
document.addEventListener('DOMContentLoaded', () => {
    inicializarLogin();
    inicializarPOS();
    verificarAuth();
});

function verificarAuth() {
    if (localStorage.getItem('autenticado') === 'true') {
        mostrarPOS();
    } else {
        mostrarLogin();
    }
}

function inicializarLogin() {
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
                localStorage.setItem('usuario', data.usuario || usuario);
                mostrarPOS();
            } else {
                $('loginError').textContent = data.message;
            }
        } catch (err) {
            $('loginError').textContent = 'Error de conexión';
        }
    });
}

function mostrarLogin() {
    $('posView').classList.add('hidden');
    $('loginView').classList.remove('hidden');
    detenerSync();
    if (sse) {
        sse.close();
        sse = null;
    }
}

function mostrarPOS() {
    $('loginView').classList.add('hidden');
    $('posView').classList.remove('hidden');
    $('userName').textContent = localStorage.getItem('usuario') || 'Mesero';
    cargarDatos();
    iniciarSync();
    conectarSSE();
}

/* ============== DATOS ============== */
async function cargarDatos() {
    setSyncing(true);
    try {
        await Promise.all([cargarMesas(), cargarItems(), cargarVentasAbiertas()]);
        renderizarMesas();
        if (ventaActiva) {
            const v = ventasData.find(x => x.id_venta === ventaActiva.id_venta);
            if (v) {
                renderizarCuenta(v);
            } else if (ventaActiva.id_venta) {
                // La venta fue cerrada desde otro lado
                ventaActiva = null;
                limpiarCuenta();
                alert('La mesa fue cerrada desde otro dispositivo');
            }
        }
    } catch (err) {
        console.error('Error cargando datos:', err);
    }
    setSyncing(false);
}

async function cargarMesas() {
    const r = await fetch(`${API}/mesas`);
    mesasData = await r.json();
}

async function cargarItems() {
    const r = await fetch(`${API}/items`);
    itemsData = await r.json();
    const select = $('selectItem');
    if (!select) return;
    const valorActual = select.value;
    select.innerHTML = '<option value="">Selecciona un producto</option>';
    itemsData.forEach(i => {
        const opt = document.createElement('option');
        opt.value = i.id_item;
        opt.textContent = `${i.nombre_item} (${formatearPrecio(i.precio_venta)})`;
        select.appendChild(opt);
    });
    // Restaurar selección si el producto sigue existiendo
    if (valorActual && itemsData.some(i => String(i.id_item) === valorActual)) {
        select.value = valorActual;
    }
}

async function cargarVentasAbiertas() {
    const r = await fetch(`${API}/ventas_abiertas`);
    const data = await r.json();
    ventasData = data.ventas;
    ventaItemsData = data.items;
}

/* ============== MESAS ============== */
function renderizarMesas() {
    const grid = $('mesasGrid');
    grid.innerHTML = '';
    mesasData.filter(m => m.activa).forEach(m => {
        const ventaAbierta = ventasData.find(v => v.id_mesa === m.id_mesa);
        const seleccionada = ventaActiva && ventaActiva.id_mesa === m.id_mesa;
        const div = document.createElement('div');
        div.className = `card-mesa ${ventaAbierta ? 'occupied' : ''} ${seleccionada ? 'selected' : ''}`;
        const estado = ventaAbierta ? 'Ocupada' : (seleccionada ? 'Seleccionada' : 'Libre');
        div.innerHTML = `
            <strong>${escapeHtml(m.nombre_mesa)}</strong>
            <small>${estado}</small>
        `;
        div.addEventListener('click', () => seleccionarMesa(m.id_mesa, ventaAbierta));
        grid.appendChild(div);
    });
}

function seleccionarMesa(id_mesa, ventaAbierta) {
    if (ventaActiva && ventaActiva.id_mesa === id_mesa) return;

    if (ventaAbierta) {
        ventaActiva = { id_venta: ventaAbierta.id_venta, id_mesa };
        renderizarMesas();
        const v = ventasData.find(x => x.id_venta === ventaAbierta.id_venta);
        if (v) renderizarCuenta(v);
    } else {
        ventaActiva = { id_venta: null, id_mesa };
        renderizarMesas();
        limpiarCuentaSeleccion();
    }
}

/* ============== CUENTA ============== */
function renderizarCuenta(venta) {
    const mesa = mesasData.find(m => m.id_mesa === venta.id_mesa);
    $('tituloCuenta').textContent = mesa ? `Cuenta: ${mesa.nombre_mesa}` : `Cuenta #${venta.id_venta}`;

    const itemsVenta = ventaItemsData.filter(i => i.id_venta === venta.id_venta);
    const contenedor = $('itemsCuenta');
    contenedor.innerHTML = '';
    let subtotal = 0;

    if (itemsVenta.length === 0) {
        contenedor.innerHTML = '<p class="empty">Aún no hay productos</p>';
    } else {
        itemsVenta.forEach(i => {
            const item = itemsData.find(x => x.id_item === i.id_item);
            subtotal += (i.total_linea || 0);
            const div = document.createElement('div');
            div.className = 'item-row';
            div.innerHTML = `
                <div class="item-info">
                    <div class="name">${escapeHtml(item ? item.nombre_item : 'Item #' + i.id_item)}</div>
                    <div class="qty">${formatearEntero(i.cantidad)} x ${formatearPrecio(i.precio_unitario)} · <span class="origen ${escapeHtml(i.agregado_por || 'caja')}">${escapeHtml(i.agregado_por || 'caja')}</span></div>
                </div>
                <div class="item-total">${formatearPrecio(i.total_linea)}</div>
            `;
            contenedor.appendChild(div);
        });
    }

    $('subtotalCuenta').textContent = formatearPrecio(subtotal);
    $('agregarBox').classList.remove('hidden');
    $('btnCerrarMesa').classList.remove('hidden');
    $('btnCancelarSeleccion').classList.remove('hidden');
}

function limpiarCuenta() {
    $('tituloCuenta').textContent = 'Selecciona una mesa';
    $('itemsCuenta').innerHTML = '<p class="empty">Ninguna mesa seleccionada</p>';
    $('subtotalCuenta').textContent = formatearPrecio(0);
    $('agregarBox').classList.add('hidden');
    $('btnCerrarMesa').classList.add('hidden');
    $('btnCancelarSeleccion').classList.add('hidden');
    $('selectItem').value = '';
    $('cantidadItem').value = 1;
}

function limpiarCuentaSeleccion() {
    $('tituloCuenta').textContent = 'Agrega productos para abrir cuenta';
    $('itemsCuenta').innerHTML = '<p class="empty">Cuenta vacía</p>';
    $('subtotalCuenta').textContent = formatearPrecio(0);
    $('agregarBox').classList.remove('hidden');
    $('btnCerrarMesa').classList.add('hidden');
    $('btnCancelarSeleccion').classList.remove('hidden');
    $('selectItem').value = '';
    $('cantidadItem').value = 1;
}

/* ============== POS ============== */
function inicializarPOS() {
    $('btnLogout').addEventListener('click', () => {
        localStorage.removeItem('autenticado');
        localStorage.removeItem('usuario');
        mostrarLogin();
    });

    $('btnCancelarSeleccion').addEventListener('click', () => {
        ventaActiva = null;
        renderizarMesas();
        limpiarCuenta();
    });

    $('btnMenos').addEventListener('click', () => {
        let v = parseInt($('cantidadItem').value) || 1;
        if (v > 1) $('cantidadItem').value = v - 1;
    });

    $('btnMas').addEventListener('click', () => {
        let v = parseInt($('cantidadItem').value) || 1;
        $('cantidadItem').value = v + 1;
    });

    $('btnAgregarItem').addEventListener('click', async () => {
        if (!ventaActiva) {
            alert('Selecciona una mesa primero');
            return;
        }
        const id_item = parseInt($('selectItem').value);
        const cantidad = parseInt($('cantidadItem').value);
        if (!id_item || !cantidad || cantidad <= 0) {
            alert('Selecciona un producto y cantidad válida');
            return;
        }

        // Crear venta si es mesa libre
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
            body: JSON.stringify({ id_venta: ventaActiva.id_venta, id_item, cantidad, agregado_por: 'mesero' })
        });
        const data = await r.json();
        if (data.success) {
            $('cantidadItem').value = 1;
            await cargarDatos();
        } else {
            alert(data.message);
        }
    });

    $('btnCerrarMesa').addEventListener('click', async () => {
        if (!ventaActiva || !ventaActiva.id_venta) return;
        if (!confirm('¿Cerrar la mesa?')) return;
        const r = await fetch(`${API}/ventas/${ventaActiva.id_venta}/cerrar`, { method: 'POST' });
        const data = await r.json();
        if (data.success) {
            alert(`Mesa cerrada. Total: ${formatearPrecio(data.subtotal)}`);
            ventaActiva = null;
            limpiarCuenta();
            await cargarDatos();
        } else {
            alert(data.message);
        }
    });
}

/* ============== SYNC ============== */
function iniciarSync() {
    detenerSync();
    syncTimer = setInterval(cargarDatos, 5000);
}

function detenerSync() {
    if (syncTimer) {
        clearInterval(syncTimer);
        syncTimer = null;
    }
}
