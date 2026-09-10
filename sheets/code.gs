const CONFIG_HOJAS = {
  usuarios: ['id_usuario', 'nombre_usuario', 'contrasena_usuario', 'fecha_modificacion'],
  reservas: ['id_reserva', 'nombre_cliente', 'telefono', 'fecha', 'hora', 'estado', 'notas', 'precio', 'fecha_modificacion'],
  mesas: ['id_mesa', 'nombre_mesa', 'ubicacion', 'activa', 'fecha_modificacion'],
  items: ['id_item', 'nombre_item', 'categoria', 'precio_venta', 'unidad', 'stock', 'fecha_modificacion'],
  cargues: ['id_cargue', 'id_item', 'cantidad', 'costo_unitario', 'proveedor', 'fecha_cargue', 'fecha_modificacion'],
  ventas: ['id_venta', 'id_mesa', 'subtotal', 'fecha_inicio_mesa', 'fecha_cierre', 'fecha_modificacion'],
  venta_items: ['id_venta_item', 'id_venta', 'id_item', 'cantidad', 'precio_unitario', 'total_linea', 'fecha_modificacion']
};

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const modo = payload.modo;
    const hoja = payload.hoja;
    const datos = payload.datos || [];

    if (!CONFIG_HOJAS[hoja]) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'Hoja no soportada: ' + hoja }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(hoja);
    if (!sheet) {
      sheet = ss.insertSheet(hoja);
    }

    const headers = CONFIG_HOJAS[hoja];

    // Encabezados
    sheet.clear();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

    // Preparar filas
    const filas = datos.map(row => headers.map(h => row[h] !== undefined ? row[h] : ''));

    if (filas.length > 0) {
      sheet.getRange(2, 1, filas.length, headers.length).setValues(filas);
    }

    if (modo === 'sincronizar') {
      // Devolver datos actuales para resolución bidireccional
      const data = sheet.getDataRange().getValues();
      const encabezados = data[0];
      const registros = data.slice(1).map(row => {
        const obj = {};
        encabezados.forEach((h, i) => obj[h] = row[i]);
        return obj;
      });
      return ContentService.createTextOutput(JSON.stringify({ ok: true, datos: registros }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, mensaje: 'Endpoint activo' }))
    .setMimeType(ContentService.MimeType.JSON);
}
