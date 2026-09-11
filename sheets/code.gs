const SPREADSHEET_ID = "1hjS67sXY9-Qe7USU7uRM8yxyHZ1diRygtJr5H4gJD00";

const CONFIG_HOJAS = {
  usuarios: {
    encabezados: ["id_usuario", "nombre_usuario", "contrasena_usuario", "fecha_modificacion"]
  },
  reservas: {
    encabezados: ["id_reserva", "nombre_cliente", "telefono", "fecha", "hora", "estado", "notas", "precio", "fecha_modificacion"]
  },
  mesas: {
    encabezados: ["id_mesa", "nombre_mesa", "ubicacion", "activa", "fecha_modificacion"]
  },
  items: {
    encabezados: ["id_item", "nombre_item", "categoria", "precio_venta", "unidad", "stock", "fecha_modificacion"]
  },
  cargues: {
    encabezados: ["id_cargue", "id_item", "cantidad", "costo_unitario", "proveedor", "fecha_cargue", "fecha_modificacion"]
  },
  ventas: {
    encabezados: ["id_venta", "id_mesa", "subtotal", "fecha_inicio_mesa", "fecha_cierre", "fecha_modificacion"]
  },
  venta_items: {
    encabezados: ["id_venta_item", "id_venta", "id_item", "cantidad", "precio_unitario", "total_linea", "agregado_por", "fecha_modificacion"]
  }
};

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

    const config = CONFIG_HOJAS[nombreHoja];
    if (!config) {
      return responderJSON({ ok: false, error: "Hoja no soportada: " + nombreHoja });
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let hoja = ss.getSheetByName(nombreHoja);
    if (!hoja) {
      hoja = ss.insertSheet(nombreHoja);
    }

    const encabezados = config.encabezados;
    const pk = encabezados[0];

    // Asegurar encabezados
    hoja.clear();
    hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados]);

    // Leer datos actuales
    const registrosSheets = leerRegistros(hoja, encabezados);

    // Merge: recibidos ganan si su fecha es más reciente
    const porId = {};
    registrosSheets.forEach(r => { porId[r[pk]] = r; });

    datosRecibidos.forEach(r => {
      const id = parseInt(r[pk]) || 0;
      if (id === 0) return;

      const fechaRecibida = String(r.fecha_modificacion || "");
      const existente = porId[id];

      if (!existente) {
        porId[id] = mapearRegistro(r, encabezados);
        return;
      }

      if (fechaRecibida && existente.fecha_modificacion && fechaRecibida <= existente.fecha_modificacion) {
        return;
      }

      porId[id] = mapearRegistro(r, encabezados);
    });

    // Re-escribir toda la hoja
    const filas = Object.values(porId)
      .filter(r => (parseInt(r[pk]) || 0) > 0)
      .map(r => encabezados.map(col => r[col] || ""));

    if (filas.length > 0) {
      hoja.getRange(2, 1, filas.length, encabezados.length).setValues(filas);
    }

    const datosRespuesta = Object.values(porId).filter(r => (parseInt(r[pk]) || 0) > 0);

    return responderJSON({
      ok: true,
      mensaje: "Sincronizados " + datosRespuesta.length + " registros de " + nombreHoja,
      datos: datosRespuesta
    });
  } catch (error) {
    return responderJSON({ ok: false, error: error.message });
  }
}

function mapearRegistro(origen, columnas) {
  const r = {};
  columnas.forEach(col => {
    r[col] = origen[col] !== undefined ? String(origen[col]) : "";
  });
  r._origenLocal = true;
  return r;
}

function leerRegistros(hoja, encabezados) {
  const lastRow = hoja.getLastRow();
  if (lastRow < 2) return [];

  const values = hoja.getRange(2, 1, lastRow - 1, encabezados.length).getValues();
  return values.map(fila => {
    const r = {};
    encabezados.forEach((col, idx) => {
      r[col] = fila[idx] !== undefined ? String(fila[idx]) : "";
    });
    r[encabezados[0]] = parseInt(r[encabezados[0]]) || 0;
    if (encabezados.includes("activa")) {
      r.activa = parseInt(r.activa) || 0;
    }
    return r;
  }).filter(r => {
    const pk = encabezados[0];
    return (r[pk] && r[pk] > 0) || (r[encabezados[1]] && r[encabezados[1]].trim() !== "");
  });
}

function doGet(e) {
  return responderJSON({ ok: true, mensaje: "Endpoint activo. Usa POST para sincronizar." });
}

function responderJSON(objeto) {
  return ContentService
    .createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}
