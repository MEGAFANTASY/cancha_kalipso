const API = '/api';
let itemsData = [];
let syncTimer = null;
let idMesa = null;
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
                cargarCuenta();
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
    $('estadoTexto').textContent = syncing ? 'Actualizando...' : 'Actualizado';
}

async function cargarItems() {
    const r = await fetch(`${API}/items`);
    itemsData = await r.json();
}

async function cargarCuenta() {
    if (!idMesa) return;
    setSyncing(true);
    try {
        const r = await fetch(`${API}/venta_mesa?id_mesa=${idMesa}`);
        const data = await r.json();
        renderizarCuenta(data);
    } catch (err) {
        console.error('Error cargando cuenta:', err);
        $('estadoTexto').textContent = 'Error de conexión';
    }
    setSyncing(false);
}

function renderizarCuenta(data) {
    const contenedor = $('itemsCuenta');
    contenedor.innerHTML = '';
    let subtotal = 0;

    if (!data.success || !data.venta) {
        $('tituloMesa').textContent = idMesa ? `Mesa #${idMesa}` : 'Mesa';
        contenedor.innerHTML = '<p class="empty">No hay cuenta activa en esta mesa.</p>';
        $('subtotalCuenta').textContent = formatearPrecio(0);
        return;
    }

    const venta = data.venta;
    $('tituloMesa').textContent = `Cuenta de la mesa`;

    const items = data.items || [];
    if (items.length === 0) {
        contenedor.innerHTML = '<p class="empty">Cuenta abierta, aún sin productos.</p>';
    } else {
        items.forEach(i => {
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

    $('subtotalCuenta').textContent = formatearPrecio(subtotal || venta.subtotal);
}

async function iniciar() {
    const params = new URLSearchParams(window.location.search);
    idMesa = params.get('id_mesa') || params.get('mesa') || '1';

    // Validar que sea número
    if (!/^\d+$/.test(String(idMesa))) {
        idMesa = 1;
    } else {
        idMesa = parseInt(idMesa);
    }

    await cargarItems();
    await cargarCuenta();
    conectarSSE();

    // Sincronización automática cada 5 segundos como respaldo
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = setInterval(cargarCuenta, 5000);
}

iniciar();
