const SPREADSHEET_ID = "TU_SPREADSHEET_ID_AQUI";

// doPost recibe:
//   { modo: "sincronizar", hoja: "usuarios", datos: [ { id_usuario, nombre_usuario, contrasena_usuario, fecha_modificacion } ] }
// Devuelve: { ok: true, datos: [ ...usuarios actuales de Sheets ] }
function doPost(e) {
  try {
    let body;
    if (e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    } else {
      body = e.parameter || {};
    }

    const modo = body.modo || "recibir";
    const nombreHoja = body.hoja || "usuarios";
    const datosRecibidos = body.datos || [];

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let hoja = ss.getSheetByName(nombreHoja);

    if (!hoja) {
      hoja = ss.insertSheet(nombreHoja);
    }

    // Asegurar encabezados
    const encabezados = ["id_usuario", "nombre_usuario", "contrasena_usuario", "fecha_modificacion"];
    hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados]);

    // Leer datos actuales de Sheets
    const usuariosSheets = leerUsuarios(hoja, encabezados);
    const idsSheets = new Set(usuariosSheets.map(u => u.id_usuario));

    // Aplicar cambios recibidos del backend (gana el que tenga fecha más reciente)
    datosRecibidos.forEach(u => {
      const id = parseInt(u.id_usuario) || 0;
      const nombre = String(u.nombre_usuario || "").trim();
      const password = String(u.contrasena_usuario || "");
      const fecha = String(u.fecha_modificacion || "");

      if (!nombre) return;

      const existente = usuariosSheets.find(x => x.id_usuario === id);

      if (!existente) {
        usuariosSheets.push({ id_usuario: id, nombre_usuario: nombre, contrasena_usuario: password, fecha_modificacion: fecha });
        return;
      }

      if (fecha && existente.fecha_modificacion && fecha <= existente.fecha_modificacion) {
        return;
      }

      existente.nombre_usuario = nombre;
      if (password) existente.contrasena_usuario = password;
      if (fecha) existente.fecha_modificacion = fecha;
    });

    // Borrar en Sheets los que el backend no envió (fueron borrados en la app)
    const idsRecibidos = new Set(datosRecibidos.map(u => parseInt(u.id_usuario) || 0).filter(id => id > 0));
    const indicesABorrar = [];
    usuariosSheets.forEach((u, index) => {
      if (u.id_usuario > 0 && !idsRecibidos.has(u.id_usuario)) {
        indicesABorrar.push(index);
      }
    });
    for (let i = indicesABorrar.length - 1; i >= 0; i--) {
      usuariosSheets.splice(indicesABorrar[i], 1);
    }

    // Re-escribir toda la hoja
    hoja.clear();
    hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados]);

    if (usuariosSheets.length > 0) {
      const filas = usuariosSheets.map(u => [u.id_usuario, u.nombre_usuario, u.contrasena_usuario, u.fecha_modificacion]);
      hoja.getRange(2, 1, filas.length, encabezados.length).setValues(filas);
    }

    return responderJSON({
      ok: true,
      mensaje: "Sincronizados " + usuariosSheets.length + " usuarios",
      datos: usuariosSheets
    });
  } catch (error) {
    return responderJSON({ ok: false, error: error.message });
  }
}

function leerUsuarios(hoja, encabezados) {
  const lastRow = hoja.getLastRow();
  if (lastRow < 2) return [];

  const values = hoja.getRange(2, 1, lastRow - 1, encabezados.length).getValues();
  return values.map(fila => ({
    id_usuario: parseInt(fila[0]) || 0,
    nombre_usuario: String(fila[1] || "").trim(),
    contrasena_usuario: String(fila[2] || ""),
    fecha_modificacion: String(fila[3] || "")
  })).filter(u => u.nombre_usuario !== "");
}

function doGet(e) {
  return responderJSON({ ok: true, mensaje: "Endpoint activo. Usa POST para sincronizar." });
}

function responderJSON(objeto) {
  return ContentService
    .createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}
