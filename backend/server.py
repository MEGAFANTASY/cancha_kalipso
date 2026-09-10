import os
import sqlite3
import bcrypt
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

PORT = int(os.environ.get('PORT', 7000))
DB_PATH = os.environ.get('DB_PATH', os.path.join(os.path.dirname(__file__), '..', 'db', 'usuarios.db'))
FRONTEND_PATH = os.environ.get('FRONTEND_PATH', '/app/frontend')


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
            contrasena_usuario TEXT NOT NULL
        );
    ''')

    cursor = conn.execute('SELECT * FROM usuarios WHERE nombre_usuario = ?', ('admin',))
    if cursor.fetchone() is None:
        hashed = bcrypt.hashpw('123'.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        conn.execute(
            'INSERT INTO usuarios (nombre_usuario, contrasena_usuario) VALUES (?, ?)',
            ('admin', hashed)
        )
        print('Usuario admin creado con contraseña hasheada')

    conn.commit()
    conn.close()


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
    conn = obtener_conexion()
    rows = conn.execute(
        'SELECT id_usuario, nombre_usuario, contrasena_usuario FROM usuarios'
    ).fetchall()
    conn.close()

    usuarios = [dict(row) for row in rows]
    return jsonify(usuarios)


# Servir archivos estáticos del frontend
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def servir_frontend(path):
    if path and os.path.exists(os.path.join(FRONTEND_PATH, path)):
        return send_from_directory(FRONTEND_PATH, path)
    return send_from_directory(FRONTEND_PATH, 'index.html')


if __name__ == '__main__':
    inicializar_db()
    app.run(host='0.0.0.0', port=PORT, threaded=True)
