function sincronizarUsuarios() {
  const SHEET_ID = 'TU_SHEET_ID_AQUI';
  const SHEET_NAME = 'usuarios';
  const API_URL = 'https://TU_DOMINIO_O_IP/api/usuarios';

  try {
    const response = UrlFetchApp.fetch(API_URL, {
      method: 'get',
      muteHttpExceptions: true
    });

    const usuarios = JSON.parse(response.getContentText());
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);

    sheet.clear();
    sheet.getRange(1, 1, 1, 3).setValues([['id_usuarios', 'nombre_usuario', 'contrasena_usuario']]);

    if (usuarios.length === 0) {
      Logger.log('No hay usuarios para sincronizar');
      return;
    }

    const filas = usuarios.map(u => [u.id_usuario, u.nombre_usuario, u.contrasena_usuario]);
    sheet.getRange(2, 1, filas.length, 3).setValues(filas);

    Logger.log(`Sincronizados ${usuarios.length} usuarios`);
  } catch (error) {
    Logger.log('Error al sincronizar: ' + error.toString());
  }
}

function crearTrigger() {
  ScriptApp.newTrigger('sincronizarUsuarios')
    .timeBased()
    .everyMinutes(2)
    .create();
  Logger.log('Trigger creado');
}
