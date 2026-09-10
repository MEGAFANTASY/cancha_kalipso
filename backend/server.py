import os
import sqlite3
import bcrypt
import requests
import threading
import time
from datetime import datetime, timezone, timedelta
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

PORT = int(os.environ.get('PORT', 7000))
DB_PATH = os.environ.get('DB_PATH', os.path.join(os.path.dirname(__file__), '..', 'db', 'usuarios.db'))
FRONTEND_PATH = os.environ.get('FRONTEND_PATH', '/app/frontend')
SYNC_INTERVAL = int(os.environ.get('SYNC_INTERVAL', 30))

# Cada entidad sincronizable con Google Sheets
ENTIDADES = {
    'usuarios': {
        'pk': 'id_usuario',
        'columnas': ['id_usuario', 'nombre_usuario', 'contrasena_usuario', 'fecha_modificacion']
    },
    'reservas': {
        'pk': 'id_reserva',
        'columnas': ['id_reserva', 'nombre_cliente', 'telefono', 'fecha', 'hora', 'estado', 'notas', 'precio', 'fecha_modificacion']
    },
    'mesas': {
        'pk': 'id_mesa',
        'columnas': ['id_mesa', 'nombre_mesa', 'ubicacion', 'activa', 'fecha_modificacion']
    },
    'items': {
        'pk': 'id_item',
        'columnas': ['id_item', 'nombre_item', 'categoria', 'precio_venta', 'unidad', 'stock', 'fecha_modificacion']
    },
    'cargues': {
        'pk': 'id_cargue',
        'columnas': ['id_cargue', 'id_item', 'cantidad', 'costo_unitario', 'proveedor', 'fecha_cargue', 'fecha_modificacion']
    },
    'ventas': {
        'pk': 'id_venta',
        'columnas': ['id_venta', 'id_mesa', 'subtotal', 'fecha_inicio_mesa', 'fecha_cierre', 'fecha_modificacion']
    },
    'venta_items': {
        'pk': 'id_venta_item',
        'columnas': ['id_venta_item', 'id_venta', 'id_item', 'cantidad', 'precio_unitario', 'total_linea', 'fecha_modificacion']
    }
}


def ahora_iso():
    return datetime.now(timezone.utc).isoformat()


def obtener_conexion():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def inicializar_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = obtener_conexion()

    conn.execute('''
        CREATE TABLE IF NOT EXISTS usuarios (
            id_usuario INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre_usuario TEXT NOT NULL UNIQUE,
            contrasena_usuario TEXT NOT NULL,
            fecha_modificacion TEXT
        );
    ''')

    try:
        conn.execute('SELECT fecha_modificacion FROM usuarios LIMIT 1')
    except sqlite3.OperationalError:
        conn.execute('ALTER TABLE usuarios ADD COLUMN fecha_modificacion TEXT')

    conn.execute('''
        CREATE TABLE IF NOT EXISTS configuracion (
            clave TEXT PRIMARY KEY,
            valor TEXT NOT NULL
        );
    ''')

    conn.execute('''
        CREATE TABLE IF NOT EXISTS reservas (
            id_reserva INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre_cliente TEXT NOT NULL,
            telefono TEXT,
            fecha TEXT NOT NULL,
            hora TEXT NOT NULL,
            estado TEXT DEFAULT 'Pendiente',
            notas TEXT,
            precio REAL DEFAULT 0,
            fecha_modificacion TEXT
        );
    ''')

    conn.execute('''
        CREATE TABLE IF NOT EXISTS mesas (
            id_mesa INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre_mesa TEXT NOT NULL UNIQUE,
            ubicacion TEXT,
            activa INTEGER DEFAULT 1,
            fecha_modificacion TEXT
        );
    ''')

    conn.execute('''
        CREATE TABLE IF NOT EXISTS items (
            id_item INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre_item TEXT NOT NULL,
            categoria TEXT,
            precio_venta REAL DEFAULT 0,
            unidad TEXT DEFAULT 'unidad',
            stock REAL DEFAULT 0,
            fecha_modificacion TEXT
        );
    ''')

    conn.execute('''
        CREATE TABLE IF NOT EXISTS cargues (
            id_cargue INTEGER PRIMARY KEY AUTOINCREMENT,
            id_item INTEGER NOT NULL,
            cantidad REAL NOT NULL,
            costo_unitario REAL DEFAULT 0,
            proveedor TEXT,
            fecha_cargue TEXT,
            fecha_modificacion TEXT,
            FOREIGN KEY (id_item) REFERENCES items(id_item)
        );
    ''')

    conn.execute('''
        CREATE TABLE IF NOT EXISTS ventas (
            id_venta INTEGER PRIMARY KEY AUTOINCREMENT,
            id_mesa INTEGER NOT NULL,
            subtotal REAL DEFAULT 0,
            fecha_inicio_mesa TEXT,
            fecha_cierre TEXT,
            fecha_modificacion TEXT,
            FOREIGN KEY (id_mesa) REFERENCES mesas(id_mesa)
        );
    ''')

    conn.execute('''
        CREATE TABLE IF NOT EXISTS venta_items (
            id_venta_item INTEGER PRIMARY KEY AUTOINCREMENT,
            id_venta INTEGER NOT NULL,
            id_item INTEGER NOT NULL,
            cantidad REAL NOT NULL,
            precio_unitario REAL DEFAULT 0,
            total_linea REAL DEFAULT 0,
            fecha_modificacion TEXT,
            FOREIGN KEY (id_venta) REFERENCES ventas(id_venta),
            FOREIGN KEY (id_item) REFERENCES items(id_item)
        );
    ''')

    cursor = conn.execute('SELECT * FROM usuarios WHERE nombre_usuario = ?', ('admin',))
    if cursor.fetchone() is None:
        hashed = bcrypt.hashpw('123'.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        conn.execute(
            'INSERT INTO usuarios (nombre_usuario, contrasena_usuario, fecha_modificacion) VALUES (?, ?, ?)',
            ('admin', hashed, ahora_iso())
        )
        print('Usuario admin creado con contraseña hasheada')

    conn.commit()
    conn.close()


def obtener_config(clave, default=''):
    conn = obtener_conexion()
    row = conn.execute('SELECT valor FROM configuracion WHERE clave = ?', (clave,)).fetchone()
    conn.close()
    return row['valor'] if row else default


def guardar_config(clave, valor):
    conn = obtener_conexion()
    conn.execute(
        'INSERT INTO configuracion (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = ?',
        (clave, valor, valor)
    )
    conn.commit()
    conn.close()


def gsheet_url():
    url_env = os.environ.get('GSHEETS_URL', '')
    if url_env:
        return url_env
    return obtener_config('GSHEETS_URL', '')


def listar_entidad_interno(nombre):
    meta = ENTIDADES[nombre]
    conn = obtener_conexion()
    rows = conn.execute(
        f"SELECT {', '.join(meta['columnas'])} FROM {nombre}"
    ).fetchall()
    conn.close()
    return [dict(row) for row in rows]


def aplicar_cambios_entidad(nombre, datos_sheets):
    if not datos_sheets:
        return

    meta = ENTIDADES[nombre]
    pk = meta['pk']
    columnas = meta['columnas']
    locales = {u[pk]: u for u in listar_entidad_interno(nombre)}
    ids_sheets = set()

    conn = obtener_conexion()

    for fila in datos_sheets:
        try:
            id_fila = int(fila.get(pk) or 0)
        except (ValueError, TypeError):
            id_fila = 0

        if id_fila == 0:
            valores = {c: fila.get(c) for c in columnas if c != pk}
            if pk == 'id_usuario':
                pwd = str(valores.get('contrasena_usuario') or '')
                if not pwd:
                    continue
                valores['contrasena_usuario'] = bcrypt.hashpw(pwd.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

            campos = [c for c in columnas if c != pk]
            placeholders = ','.join(['?' for _ in campos])
            conn.execute(
                f"INSERT INTO {nombre} ({', '.join(campos)}) VALUES ({placeholders})",
                [valores.get(c) for c in campos]
            )
            continue

        ids_sheets.add(id_fila)
        local = locales.get(id_fila)

        if not local:
            valores = {c: fila.get(c) for c in columnas}
            if pk == 'id_usuario':
                pwd = str(valores.get('contrasena_usuario') or '')
                if not pwd:
                    continue
                valores['contrasena_usuario'] = bcrypt.hashpw(pwd.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
            placeholders = ','.join(['?' for _ in columnas])
            conn.execute(
                f"INSERT INTO {nombre} ({', '.join(columnas)}) VALUES ({placeholders})",
                [valores.get(c) for c in columnas]
            )
            continue

        fecha_sheet = str(fila.get('fecha_modificacion') or '')
        if fecha_sheet and local.get('fecha_modificacion') and fecha_sheet <= local['fecha_modificacion']:
            continue

        valores = {c: fila.get(c) if c in fila else local.get(c) for c in columnas if c != pk}
        sets = ', '.join([f"{c} = ?" for c in valores])
        conn.execute(
            f"UPDATE {nombre} SET {sets} WHERE {pk} = ?",
            list(valores.values()) + [id_fila]
        )

    for id_local in locales:
        if id_local not in ids_sheets:
            conn.execute(f'DELETE FROM {nombre} WHERE {pk} = ?', (id_local,))

    conn.commit()
    conn.close()


def sincronizar_entidad_con_sheets(nombre):
    url = gsheet_url()
    if not url:
        print('GSHEETS_URL no configurada. Sincronización omitida.')
        return

    try:
        response = requests.post(url, json={
            'modo': 'sincronizar',
            'hoja': nombre,
            'datos': listar_entidad_interno(nombre)
        }, timeout=30)
        print(f'Google Sheets POST {nombre}:', response.status_code, response.text[:200])

        if response.status_code == 200:
            respuesta = response.json()
            if respuesta.get('ok') and 'datos' in respuesta:
                aplicar_cambios_entidad(nombre, respuesta['datos'])
    except Exception as e:
        print(f'Error al sincronizar {nombre} con Google Sheets:', e)


def sincronizar_todo():
    for nombre in ENTIDADES:
        sincronizar_entidad_con_sheets(nombre)


def sincronizacion_periodica():
    while True:
        time.sleep(SYNC_INTERVAL)
        try:
            sincronizar_todo()
        except Exception as e:
            print('Error en sincronización periódica:', e)


# ===== USUARIOS =====

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    usuario = data.get('usuario', '').strip()
    password = data.get('password', '')

    if not usuario or not password:
        return jsonify({'success': False, 'message': 'Usuario y contraseña son obligatorios'}), 400

    conn = obtener_conexion()
    row = conn.execute('SELECT * FROM usuarios WHERE nombre_usuario = ?', (usuario,)).fetchone()
    conn.close()

    if row is None:
        return jsonify({'success': False, 'message': 'Usuario o contraseña incorrectos'}), 401

    stored_hash = row['contrasena_usuario'].encode('utf-8')
    if not bcrypt.checkpw(password.encode('utf-8'), stored_hash):
        return jsonify({'success': False, 'message': 'Usuario o contraseña incorrectos'}), 401

    return jsonify({'success': True, 'usuario': row['nombre_usuario']})


@app.route('/api/usuarios', methods=['GET'])
def listar_usuarios():
    return jsonify(listar_entidad_interno('usuarios'))


@app.route('/api/usuarios', methods=['POST'])
def guardar_usuario():
    data = request.get_json()
    id_u = data.get('id_usuario')
    nombre = str(data.get('nombre_usuario') or '').strip()
    password = data.get('contrasena_usuario', '')
    fecha = data.get('fecha_modificacion') or ahora_iso()

    if not nombre:
        return jsonify({'success': False, 'message': 'El nombre es obligatorio'}), 400

    conn = obtener_conexion()

    if id_u:
        row = conn.execute('SELECT * FROM usuarios WHERE id_usuario = ?', (id_u,)).fetchone()
        if row is None:
            return jsonify({'success': False, 'message': 'Usuario no encontrado'}), 404

        if password:
            hashed = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
            conn.execute(
                'UPDATE usuarios SET nombre_usuario = ?, contrasena_usuario = ?, fecha_modificacion = ? WHERE id_usuario = ?',
                (nombre, hashed, fecha, id_u)
            )
        else:
            conn.execute(
                'UPDATE usuarios SET nombre_usuario = ?, fecha_modificacion = ? WHERE id_usuario = ?',
                (nombre, fecha, id_u)
            )
    else:
        if not password:
            return jsonify({'success': False, 'message': 'La contraseña es obligatoria para nuevos usuarios'}), 400
        hashed = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        cursor = conn.execute(
            'INSERT INTO usuarios (nombre_usuario, contrasena_usuario, fecha_modificacion) VALUES (?, ?, ?)',
            (nombre, hashed, fecha)
        )
        id_u = cursor.lastrowid

    conn.commit()
    conn.close()

    sincronizar_entidad_con_sheets('usuarios')
    return jsonify({'success': True, 'id_usuario': id_u})


@app.route('/api/usuarios/<int:id_u>', methods=['DELETE'])
def eliminar_usuario(id_u):
    conn = obtener_conexion()
    conn.execute('DELETE FROM usuarios WHERE id_usuario = ?', (id_u,))
    conn.commit()
    conn.close()

    sincronizar_entidad_con_sheets('usuarios')
    return jsonify({'success': True, 'message': 'Usuario eliminado'})


# ===== RESERVAS =====

@app.route('/api/reservas', methods=['GET'])
def listar_reservas():
    return jsonify(listar_entidad_interno('reservas'))


@app.route('/api/reservas', methods=['POST'])
def guardar_reserva():
    data = request.get_json()
    id_r = data.get('id_reserva')
    campos = ['nombre_cliente', 'telefono', 'fecha', 'hora', 'estado', 'notas', 'precio']
    valores = {c: data.get(c) for c in campos}
    valores['fecha_modificacion'] = data.get('fecha_modificacion') or ahora_iso()

    if not valores.get('nombre_cliente'):
        return jsonify({'success': False, 'message': 'El nombre del cliente es obligatorio'}), 400
    if not valores.get('fecha') or not valores.get('hora'):
        return jsonify({'success': False, 'message': 'La fecha y hora son obligatorias'}), 400

    conn = obtener_conexion()

    # Validar que no choque con otra reserva activa (no cancelada)
    if valores.get('estado') != 'Cancelada':
        existente = conn.execute(
            'SELECT id_reserva FROM reservas WHERE fecha = ? AND hora = ? AND estado != ? AND id_reserva != ?',
            (valores['fecha'], valores['hora'], 'Cancelada', id_r or 0)
        ).fetchone()
        if existente:
            conn.close()
            return jsonify({'success': False, 'message': 'Ya existe una reserva activa en esa fecha y hora'}), 409

    if id_r:
        row = conn.execute('SELECT * FROM reservas WHERE id_reserva = ?', (id_r,)).fetchone()
        if not row:
            conn.close()
            return jsonify({'success': False, 'message': 'Reserva no encontrada'}), 404
        sets = ', '.join([f'{c} = ?' for c in valores])
        conn.execute(f'UPDATE reservas SET {sets} WHERE id_reserva = ?', list(valores.values()) + [id_r])
    else:
        cols = list(valores.keys())
        placeholders = ','.join(['?' for _ in cols])
        cursor = conn.execute(
            f"INSERT INTO reservas ({', '.join(cols)}) VALUES ({placeholders})",
            list(valores.values())
        )
        id_r = cursor.lastrowid

    conn.commit()
    conn.close()

    return jsonify({'success': True, 'id_reserva': id_r})


@app.route('/api/horarios_ocupados', methods=['GET'])
def horarios_ocupados():
    fecha = request.args.get('fecha', '')
    if not fecha:
        return jsonify({'horas': []})
    conn = obtener_conexion()
    rows = conn.execute(
        'SELECT hora FROM reservas WHERE fecha = ? AND estado != ?',
        (fecha, 'Cancelada')
    ).fetchall()
    conn.close()
    return jsonify({'horas': [r['hora'] for r in rows]})


@app.route('/api/reservas/<int:id_r>', methods=['DELETE'])
def eliminar_reserva(id_r):
    conn = obtener_conexion()
    conn.execute('DELETE FROM reservas WHERE id_reserva = ?', (id_r,))
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'message': 'Reserva eliminada'})


# ===== MESAS =====

@app.route('/api/mesas', methods=['GET'])
def listar_mesas():
    return jsonify(listar_entidad_interno('mesas'))


@app.route('/api/mesas', methods=['POST'])
def guardar_mesa():
    data = request.get_json()
    id_m = data.get('id_mesa')
    campos = ['nombre_mesa', 'ubicacion', 'activa']
    valores = {c: data.get(c) for c in campos}
    valores['fecha_modificacion'] = data.get('fecha_modificacion') or ahora_iso()

    if not valores.get('nombre_mesa'):
        return jsonify({'success': False, 'message': 'El nombre de la mesa es obligatorio'}), 400

    valores['activa'] = 1 if valores.get('activa') else 0

    conn = obtener_conexion()

    if id_m:
        row = conn.execute('SELECT * FROM mesas WHERE id_mesa = ?', (id_m,)).fetchone()
        if not row:
            return jsonify({'success': False, 'message': 'Mesa no encontrada'}), 404
        sets = ', '.join([f'{c} = ?' for c in valores])
        conn.execute(f'UPDATE mesas SET {sets} WHERE id_mesa = ?', list(valores.values()) + [id_m])
    else:
        cols = list(valores.keys())
        placeholders = ','.join(['?' for _ in cols])
        cursor = conn.execute(
            f"INSERT INTO mesas ({', '.join(cols)}) VALUES ({placeholders})",
            list(valores.values())
        )
        id_m = cursor.lastrowid

    conn.commit()
    conn.close()

    return jsonify({'success': True, 'id_mesa': id_m})


@app.route('/api/mesas/<int:id_m>', methods=['DELETE'])
def eliminar_mesa(id_m):
    conn = obtener_conexion()
    conn.execute('DELETE FROM mesas WHERE id_mesa = ?', (id_m,))
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'message': 'Mesa eliminada'})


# ===== ITEMS =====

@app.route('/api/items', methods=['GET'])
def listar_items():
    return jsonify(listar_entidad_interno('items'))


@app.route('/api/items', methods=['POST'])
def guardar_item():
    data = request.get_json()
    id_i = data.get('id_item')
    campos = ['nombre_item', 'categoria', 'precio_venta', 'unidad', 'stock']
    valores = {c: data.get(c) for c in campos}
    valores['fecha_modificacion'] = data.get('fecha_modificacion') or ahora_iso()

    if not valores.get('nombre_item'):
        return jsonify({'success': False, 'message': 'El nombre del item es obligatorio'}), 400

    try:
        valores['precio_venta'] = float(valores.get('precio_venta') or 0)
        valores['stock'] = float(valores.get('stock') or 0)
    except (ValueError, TypeError):
        return jsonify({'success': False, 'message': 'Precio y stock deben ser números'}), 400

    conn = obtener_conexion()

    if id_i:
        row = conn.execute('SELECT * FROM items WHERE id_item = ?', (id_i,)).fetchone()
        if not row:
            return jsonify({'success': False, 'message': 'Item no encontrado'}), 404
        sets = ', '.join([f'{c} = ?' for c in valores])
        conn.execute(f'UPDATE items SET {sets} WHERE id_item = ?', list(valores.values()) + [id_i])
    else:
        cols = list(valores.keys())
        placeholders = ','.join(['?' for _ in cols])
        cursor = conn.execute(
            f"INSERT INTO items ({', '.join(cols)}) VALUES ({placeholders})",
            list(valores.values())
        )
        id_i = cursor.lastrowid

    conn.commit()
    conn.close()

    return jsonify({'success': True, 'id_item': id_i})


@app.route('/api/items/<int:id_i>', methods=['DELETE'])
def eliminar_item(id_i):
    conn = obtener_conexion()
    conn.execute('DELETE FROM items WHERE id_item = ?', (id_i,))
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'message': 'Item eliminado'})


# ===== CARGUES =====

@app.route('/api/cargues', methods=['GET'])
def listar_cargues():
    return jsonify(listar_entidad_interno('cargues'))


@app.route('/api/cargues', methods=['POST'])
def guardar_cargue():
    data = request.get_json()
    id_c = data.get('id_cargue')
    campos = ['id_item', 'cantidad', 'costo_unitario', 'proveedor', 'fecha_cargue']
    valores = {c: data.get(c) for c in campos}
    valores['fecha_modificacion'] = data.get('fecha_modificacion') or ahora_iso()

    if not valores.get('id_item') or not valores.get('cantidad'):
        return jsonify({'success': False, 'message': 'Item y cantidad son obligatorios'}), 400

    try:
        valores['cantidad'] = float(valores.get('cantidad'))
        valores['costo_unitario'] = float(valores.get('costo_unitario') or 0)
        valores['id_item'] = int(valores.get('id_item'))
    except (ValueError, TypeError):
        return jsonify({'success': False, 'message': 'Cantidad, costo e item deben ser números'}), 400

    if not valores.get('fecha_cargue'):
        valores['fecha_cargue'] = datetime.now(timezone.utc).strftime('%Y-%m-%d')

    conn = obtener_conexion()

    if id_c:
        row = conn.execute('SELECT * FROM cargues WHERE id_cargue = ?', (id_c,)).fetchone()
        if not row:
            return jsonify({'success': False, 'message': 'Cargue no encontrado'}), 404
        sets = ', '.join([f'{c} = ?' for c in valores])
        conn.execute(f'UPDATE cargues SET {sets} WHERE id_cargue = ?', list(valores.values()) + [id_c])
    else:
        cols = list(valores.keys())
        placeholders = ','.join(['?' for _ in cols])
        cursor = conn.execute(
            f"INSERT INTO cargues ({', '.join(cols)}) VALUES ({placeholders})",
            list(valores.values())
        )
        id_c = cursor.lastrowid

    conn.commit()
    conn.close()

    return jsonify({'success': True, 'id_cargue': id_c})


@app.route('/api/cargues/<int:id_c>', methods=['DELETE'])
def eliminar_cargue(id_c):
    conn = obtener_conexion()
    conn.execute('DELETE FROM cargues WHERE id_cargue = ?', (id_c,))
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'message': 'Cargue eliminado'})


# ===== VENTAS / CONSUMO POR MESA =====

@app.route('/api/ventas', methods=['GET'])
def listar_ventas():
    return jsonify(listar_entidad_interno('ventas'))


@app.route('/api/venta_items', methods=['GET'])
def listar_venta_items():
    return jsonify(listar_entidad_interno('venta_items'))


@app.route('/api/ventas_abiertas', methods=['GET'])
def ventas_abiertas():
    conn = obtener_conexion()
    ventas = conn.execute(
        "SELECT * FROM ventas WHERE fecha_cierre IS NULL OR fecha_cierre = '' ORDER BY id_venta"
    ).fetchall()
    items = conn.execute(
        "SELECT * FROM venta_items WHERE id_venta IN (SELECT id_venta FROM ventas WHERE fecha_cierre IS NULL OR fecha_cierre = '')"
    ).fetchall()
    conn.close()
    return jsonify({
        'ventas': [dict(v) for v in ventas],
        'items': [dict(i) for i in items]
    })


@app.route('/api/ventas', methods=['POST'])
def crear_venta():
    data = request.get_json()
    id_mesa = data.get('id_mesa')
    if not id_mesa:
        return jsonify({'success': False, 'message': 'Mesa obligatoria'}), 400

    conn = obtener_conexion()
    cursor = conn.execute(
        'INSERT INTO ventas (id_mesa, subtotal, fecha_inicio_mesa, fecha_modificacion) VALUES (?, ?, ?, ?)',
        (id_mesa, 0, ahora_iso(), ahora_iso())
    )
    id_venta = cursor.lastrowid
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'id_venta': id_venta})


@app.route('/api/venta_items', methods=['POST'])
def agregar_item_venta():
    data = request.get_json()
    id_venta = data.get('id_venta')
    id_item = data.get('id_item')
    cantidad = data.get('cantidad')

    if not id_venta or not id_item or not cantidad:
        return jsonify({'success': False, 'message': 'Venta, item y cantidad son obligatorios'}), 400

    try:
        cantidad = float(cantidad)
        id_venta = int(id_venta)
        id_item = int(id_item)
    except (ValueError, TypeError):
        return jsonify({'success': False, 'message': 'Datos inválidos'}), 400

    conn = obtener_conexion()

    # Verificar stock
    item = conn.execute('SELECT * FROM items WHERE id_item = ?', (id_item,)).fetchone()
    if not item:
        return jsonify({'success': False, 'message': 'Item no encontrado'}), 404

    if item['stock'] < cantidad:
        return jsonify({'success': False, 'message': 'Stock insuficiente'}), 400

    precio_unitario = float(item['precio_venta'])
    total_linea = precio_unitario * cantidad

    conn.execute(
        'INSERT INTO venta_items (id_venta, id_item, cantidad, precio_unitario, total_linea, fecha_modificacion) VALUES (?, ?, ?, ?, ?, ?)',
        (id_venta, id_item, cantidad, precio_unitario, total_linea, ahora_iso())
    )

    # Descontar stock
    nuevo_stock = item['stock'] - cantidad
    conn.execute(
        'UPDATE items SET stock = ?, fecha_modificacion = ? WHERE id_item = ?',
        (nuevo_stock, ahora_iso(), id_item)
    )

    # Recalcular subtotal de la venta
    total = conn.execute('SELECT SUM(total_linea) FROM venta_items WHERE id_venta = ?', (id_venta,)).fetchone()[0] or 0
    conn.execute(
        'UPDATE ventas SET subtotal = ?, fecha_modificacion = ? WHERE id_venta = ?',
        (total, ahora_iso(), id_venta)
    )

    conn.commit()
    conn.close()

    return jsonify({'success': True})


@app.route('/api/ventas/<int:id_venta>/cerrar', methods=['POST'])
def cerrar_venta(id_venta):
    conn = obtener_conexion()

    venta = conn.execute('SELECT * FROM ventas WHERE id_venta = ?', (id_venta,)).fetchone()
    if not venta:
        return jsonify({'success': False, 'message': 'Venta no encontrada'}), 404

    total = conn.execute('SELECT SUM(total_linea) FROM venta_items WHERE id_venta = ?', (id_venta,)).fetchone()[0] or 0

    conn.execute(
        'UPDATE ventas SET subtotal = ?, fecha_cierre = ?, fecha_modificacion = ? WHERE id_venta = ?',
        (total, ahora_iso(), ahora_iso(), id_venta)
    )
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'subtotal': total})


# ===== CONFIG =====

@app.route('/api/config', methods=['GET'])
def obtener_configuracion():
    return jsonify({'GSHEETS_URL': gsheet_url()})


@app.route('/api/config', methods=['POST'])
def actualizar_configuracion():
    data = request.get_json()
    url = data.get('GSHEETS_URL', '').strip()
    guardar_config('GSHEETS_URL', url)
    return jsonify({'success': True, 'message': 'Configuración guardada'})


@app.route('/api/sincronizar', methods=['POST'])
def sincronizar_manual():
    sincronizar_todo()
    return jsonify({'success': True, 'message': 'Sincronización completada'})


# Servir archivos estáticos del frontend
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def servir_frontend(path):
    if path and os.path.exists(os.path.join(FRONTEND_PATH, path)):
        return send_from_directory(FRONTEND_PATH, path)
    return send_from_directory(FRONTEND_PATH, 'index.html')


if __name__ == '__main__':
    inicializar_db()
    sincronizar_todo()

    hilo = threading.Thread(target=sincronizacion_periodica, daemon=True)
    hilo.start()
    print(f'Sincronización automática cada {SYNC_INTERVAL} segundos activada')

    app.run(host='0.0.0.0', port=PORT, threaded=True)
