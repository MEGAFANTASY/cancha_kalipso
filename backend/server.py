import os
import sqlite3
import bcrypt
import requests
import threading
import time
from datetime import datetime, timezone
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

PORT = int(os.environ.get('PORT', 7000))
DB_PATH = os.environ.get('DB_PATH', os.path.join(os.path.dirname(__file__), '..', 'db', 'usuarios.db'))
FRONTEND_PATH = os.environ.get('FRONTEND_PATH', '/app/frontend')
GSHEETS_URL = os.environ.get('GSHEETS_URL', '')
SYNC_INTERVAL = int(os.environ.get('SYNC_INTERVAL', 30))


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

    # Migrar tabla si no tiene fecha_modificacion
    try:
        conn.execute('SELECT fecha_modificacion FROM usuarios LIMIT 1')
    except sqlite3.OperationalError:
        conn.execute('ALTER TABLE usuarios ADD COLUMN fecha_modificacion TEXT')

    # Tabla para configuración del sistema
    conn.execute('''
        CREATE TABLE IF NOT EXISTS configuracion (
            clave TEXT PRIMARY KEY,
            valor TEXT NOT NULL
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


def sincronizar_con_sheets():
    url = gsheet_url()
    if not url:
        print('GSHEETS_URL no configurada. Sincronización omitida.')
        return

    try:
        response = requests.post(url, json={
            'modo': 'sincronizar',
            'hoja': 'usuarios',
            'datos': listar_usuarios_interno()
        }, timeout=30)
        print('Google Sheets POST:', response.status_code, response.text[:200])

        if response.status_code == 200:
            respuesta = response.json()
            if respuesta.get('ok') and 'datos' in respuesta:
                aplicar_cambios_desde_sheets(respuesta['datos'])
    except Exception as e:
        print('Error al sincronizar con Google Sheets:', e)


def aplicar_cambios_desde_sheets(usuarios_sheets):
    if not usuarios_sheets:
        return

    locales = {u['id_usuario']: u for u in listar_usuarios_interno()}
    ids_sheets = set()

    conn = obtener_conexion()

    for u in usuarios_sheets:
        try:
            id_u = int(u.get('id_usuario') or 0)
        except (ValueError, TypeError):
            id_u = 0

        nombre = str(u.get('nombre_usuario') or '').strip()
        password_plano = str(u.get('contrasena_usuario') or '')
        fecha_sheet = str(u.get('fecha_modificacion') or '')

        if not nombre:
            continue

        ids_sheets.add(id_u)

        if id_u == 0:
            # Nuevo usuario desde Sheets
            hashed = bcrypt.hashpw(password_plano.encode('utf-8'), bcrypt.gensalt()).decode('utf-8') if password_plano else ''
            if not hashed:
                continue
            conn.execute(
                'INSERT INTO usuarios (nombre_usuario, contrasena_usuario, fecha_modificacion) VALUES (?, ?, ?)',
                (nombre, hashed, fecha_sheet or ahora_iso())
            )
            continue

        local = locales.get(id_u)
        if not local:
            # No existe localmente, lo creamos si tiene contraseña
            hashed = bcrypt.hashpw(password_plano.encode('utf-8'), bcrypt.gensalt()).decode('utf-8') if password_plano else ''
            if not hashed:
                continue
            conn.execute(
                'INSERT INTO usuarios (id_usuario, nombre_usuario, contrasena_usuario, fecha_modificacion) VALUES (?, ?, ?, ?)',
                (id_u, nombre, hashed, fecha_sheet or ahora_iso())
            )
            continue

        # Resolver conflicto por fecha
        if fecha_sheet and local.get('fecha_modificacion') and fecha_sheet <= local['fecha_modificacion']:
            continue

        # Actualizar desde Sheets
        if password_plano:
            hashed = bcrypt.hashpw(password_plano.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        else:
            hashed = local['contrasena_usuario']

        conn.execute(
            'UPDATE usuarios SET nombre_usuario = ?, contrasena_usuario = ?, fecha_modificacion = ? WHERE id_usuario = ?',
            (nombre, hashed, fecha_sheet or ahora_iso(), id_u)
        )

    # Borrar locales que no estén en Sheets
    for id_local in locales:
        if id_local not in ids_sheets:
            conn.execute('DELETE FROM usuarios WHERE id_usuario = ?', (id_local,))

    conn.commit()
    conn.close()


def listar_usuarios_interno():
    conn = obtener_conexion()
    rows = conn.execute(
        'SELECT id_usuario, nombre_usuario, contrasena_usuario, fecha_modificacion FROM usuarios'
    ).fetchall()
    conn.close()
    return [dict(row) for row in rows]


@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    usuario = data.get('usuario', '').strip()
    password = data.get('password', '')

    if not usuario or not password:
        return jsonify({'success': False, 'message': 'Usuario y contraseña son obligatorios'}), 400

    conn = obtener_conexion()
    row = conn.execute(
        'SELECT * FROM usuarios WHERE nombre_usuario = ?', (usuario,)
    ).fetchone()
    conn.close()

    if row is None:
        return jsonify({'success': False, 'message': 'Usuario o contraseña incorrectos'}), 401

    stored_hash = row['contrasena_usuario'].encode('utf-8')
    if not bcrypt.checkpw(password.encode('utf-8'), stored_hash):
        return jsonify({'success': False, 'message': 'Usuario o contraseña incorrectos'}), 401

    return jsonify({'success': True, 'usuario': row['nombre_usuario']})


@app.route('/api/usuarios', methods=['GET'])
def listar_usuarios():
    return jsonify(listar_usuarios_interno())


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

    sincronizar_con_sheets()
    return jsonify({'success': True, 'id_usuario': id_u})


@app.route('/api/usuarios/<int:id_u>', methods=['DELETE'])
def eliminar_usuario(id_u):
    conn = obtener_conexion()
    conn.execute('DELETE FROM usuarios WHERE id_usuario = ?', (id_u,))
    conn.commit()
    conn.close()

    sincronizar_con_sheets()
    return jsonify({'success': True, 'message': 'Usuario eliminado'})


@app.route('/api/sincronizar', methods=['POST'])
def sincronizar_manual():
    sincronizar_con_sheets()
    return jsonify({'success': True, 'message': 'Sincronización completada'})


def sincronizacion_periodica():
    while True:
        time.sleep(SYNC_INTERVAL)
        try:
            sincronizar_con_sheets()
        except Exception as e:
            print('Error en sincronización periódica:', e)


@app.route('/api/config', methods=['GET'])
def obtener_configuracion():
    return jsonify({
        'GSHEETS_URL': gsheet_url()
    })


@app.route('/api/config', methods=['POST'])
def actualizar_configuracion():
    data = request.get_json()
    url = data.get('GSHEETS_URL', '').strip()
    guardar_config('GSHEETS_URL', url)
    sincronizar_con_sheets()
    return jsonify({'success': True, 'message': 'Configuración guardada'})


# Servir archivos estáticos del frontend
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def servir_frontend(path):
    if path and os.path.exists(os.path.join(FRONTEND_PATH, path)):
        return send_from_directory(FRONTEND_PATH, path)
    return send_from_directory(FRONTEND_PATH, 'index.html')


if __name__ == '__main__':
    inicializar_db()
    sincronizar_con_sheets()

    hilo = threading.Thread(target=sincronizacion_periodica, daemon=True)
    hilo.start()
    print(f'Sincronización automática cada {SYNC_INTERVAL} segundos activada')

    app.run(host='0.0.0.0', port=PORT, threaded=True)
