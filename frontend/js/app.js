const API_URL = '/api';

async function iniciarSesion(usuario, password) {
    try {
        const response = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario, password })
        });

        const data = await response.json();
        if (data.success) {
            localStorage.setItem('adminLogueado', 'true');
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error al iniciar sesión:', error);
        return false;
    }
}

function verificarSesion() {
    return localStorage.getItem('adminLogueado') === 'true';
}

function cerrarSesion() {
    localStorage.removeItem('adminLogueado');
    window.location.href = 'login.html';
}

function guardarReserva(reserva) {
    const reservas = JSON.parse(localStorage.getItem('reservas') || '[]');
    reservas.push({ ...reserva, id: Date.now(), estado: 'Pendiente' });
    localStorage.setItem('reservas', JSON.stringify(reservas));
}

function obtenerReservas() {
    return JSON.parse(localStorage.getItem('reservas') || '[]');
}

function eliminarReserva(id) {
    const reservas = obtenerReservas().filter(r => r.id !== id);
    localStorage.setItem('reservas', JSON.stringify(reservas));
    cargarReservas();
}

function actualizarEstadoReserva(id, nuevoEstado) {
    const reservas = obtenerReservas().map(r => {
        if (r.id === id) {
            r.estado = nuevoEstado;
        }
        return r;
    });
    localStorage.setItem('reservas', JSON.stringify(reservas));
    cargarReservas();
}

function cargarReservas() {
    const tbody = document.getElementById('tablaReservasBody');
    if (!tbody) return;

    const reservas = obtenerReservas();
    const hoy = new Date().toISOString().split('T')[0];

    document.getElementById('totalReservas').textContent = reservas.length;
    document.getElementById('reservasHoy').textContent = reservas.filter(r => r.fecha === hoy).length;

    if (reservas.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="sin-reservas">No hay reservas registradas.</td></tr>';
        return;
    }

    tbody.innerHTML = reservas.map(r => {
        const estados = ['Pendiente', 'Confirmada', 'Cancelada'];
        const opciones = estados.map(estado =>
            `<option value="${estado}" ${estado === r.estado ? 'selected' : ''}>${estado}</option>`
        ).join('');

        return `
        <tr>
            <td>${r.nombre}</td>
            <td>${r.telefono}</td>
            <td>${r.cancha}</td>
            <td>${r.fecha}</td>
            <td>${r.hora}</td>
            <td>
                <select class="select-estado" onchange="actualizarEstadoReserva(${r.id}, this.value)">${opciones}</select>
            </td>
            <td>
                <button class="btn-eliminar" onclick="eliminarReserva(${r.id})">Eliminar</button>
            </td>
        </tr>
    `;
    }).join('');
}

async function manejarLogin(e) {
    e.preventDefault();
    const usuario = document.getElementById('usuario').value.trim();
    const password = document.getElementById('password').value;
    const error = document.getElementById('loginError');

    const exito = await iniciarSesion(usuario, password);
    if (exito) {
        error.textContent = '';
        window.location.href = 'reservas.html';
    } else {
        error.textContent = 'Usuario o contraseña incorrectos.';
    }
}

function obtenerFechaLocal() {
    const ahora = new Date();
    const anio = ahora.getFullYear();
    const mes = String(ahora.getMonth() + 1).padStart(2, '0');
    const dia = String(ahora.getDate()).padStart(2, '0');
    return `${anio}-${mes}-${dia}`;
}

function filtrarHorasDisponibles() {
    const selectFecha = document.getElementById('fecha');
    const selectCancha = document.getElementById('cancha');
    const selectHora = document.getElementById('hora');

    if (!selectFecha || !selectCancha || !selectHora) return;

    const fechaSeleccionada = selectFecha.value;
    const canchaSeleccionada = selectCancha.value;

    if (!fechaSeleccionada || !canchaSeleccionada) return;

    const horasOcupadas = obtenerReservas()
        .filter(r => r.fecha === fechaSeleccionada && r.cancha === canchaSeleccionada && r.estado !== 'Cancelada')
        .map(r => r.hora);

    const hoy = obtenerFechaLocal();
    const horaActual = new Date().getHours();

    Array.from(selectHora.options).forEach(option => {
        if (!option.value) return;

        const horaOption = parseInt(option.value.split(':')[0], 10);
        let mostrar = true;

        if (fechaSeleccionada === hoy && horaOption <= horaActual) {
            mostrar = false;
        }

        if (horasOcupadas.includes(option.value)) {
            mostrar = false;
        }

        option.disabled = !mostrar;
        option.hidden = !mostrar;
    });

    if (selectHora.selectedOptions[0].disabled) {
        selectHora.value = '';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', manejarLogin);
    }

    const formReserva = document.getElementById('formReserva');
    if (formReserva) {
        const selectFecha = document.getElementById('fecha');
        const selectCancha = document.getElementById('cancha');

        if (selectFecha) {
            selectFecha.min = obtenerFechaLocal();
            selectFecha.value = obtenerFechaLocal();
            selectFecha.addEventListener('change', filtrarHorasDisponibles);
        }

        if (selectCancha) {
            selectCancha.addEventListener('change', filtrarHorasDisponibles);
        }

        filtrarHorasDisponibles();

        formReserva.addEventListener('submit', (e) => {
            e.preventDefault();
            const formData = new FormData(formReserva);
            const reserva = {
                nombre: formData.get('nombre'),
                telefono: formData.get('telefono'),
                cancha: formData.get('cancha'),
                fecha: formData.get('fecha'),
                hora: formData.get('hora')
            };
            guardarReserva(reserva);
            alert('Reserva enviada correctamente. Nos comunicaremos contigo para confirmar.');
            formReserva.reset();
            filtrarHorasDisponibles();
        });
    }

    const cerrarSesionBtn = document.getElementById('cerrarSesion');
    if (cerrarSesionBtn) {
        cerrarSesionBtn.addEventListener('click', (e) => {
            e.preventDefault();
            cerrarSesion();
        });
    }

    if (window.location.pathname.includes('reservas.html')) {
        if (!verificarSesion()) {
            window.location.href = 'login.html';
        } else {
            cargarReservas();
            inicializarConfiguracion();
        }
    }
});

// ===== CONFIGURACIÓN DE GOOGLE SHEETS =====

function inicializarConfiguracion() {
    const configLink = document.getElementById('configLink');
    const configSection = document.getElementById('configSection');
    const formConfig = document.getElementById('formConfig');

    if (!configLink || !configSection || !formConfig) return;

    configLink.addEventListener('click', (e) => {
        e.preventDefault();
        const visible = configSection.style.display === 'block';
        configSection.style.display = visible ? 'none' : 'block';
        if (!visible) cargarConfiguracion();
    });

    formConfig.addEventListener('submit', async (e) => {
        e.preventDefault();
        const url = document.getElementById('gsheetsUrl').value.trim();

        try {
            const response = await fetch(`${API_URL}/config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ GSHEETS_URL: url })
            });

            const data = await response.json();
            if (data.success) {
                alert('Configuración guardada. La sincronización con Google Sheets comenzará.');
                configSection.style.display = 'none';
            } else {
                alert(data.message || 'Error al guardar configuración');
            }
        } catch (error) {
            console.error('Error al guardar configuración:', error);
            alert('Error de conexión');
        }
    });
}

async function cargarConfiguracion() {
    try {
        const response = await fetch(`${API_URL}/config`);
        const data = await response.json();
        document.getElementById('gsheetsUrl').value = data.GSHEETS_URL || '';
    } catch (error) {
        console.error('Error al cargar configuración:', error);
    }
}
