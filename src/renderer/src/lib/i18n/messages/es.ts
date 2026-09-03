/** Spanish is the default and, for now, only shipped locale — WorshipApp's
 *  audience is a Spanish-speaking church. The dictionary + provider exist so
 *  adding `it`/`en` later means dropping in another file here, not touching
 *  ~40 components again. */
const es = {
  app: { title: "WorshipApp" },
  header: {
    openDisplay: "Abrir Pantalla",
    closeDisplay: "Cerrar",
    changeLogo: "Cambiar Logo",
    selectDisplay: "Seleccionar pantalla",
  },
  playlist: {
    title: "Lista de Reproducción",
    empty: "Lista vacía",
    emptyHint: "Agregá elementos o arrastrá archivos",
    moveUp: "Mover arriba",
    moveDown: "Mover abajo",
    remove: "Quitar",
    clear: "Vaciar",
    addPpt: "PPT",
    addVideo: "Video",
    addImage: "Imagen",
    addAudio: "Audio",
  },
  library: {
    videos: "Videos",
    images: "Imágenes",
    audios: "Audios",
    add: "+ Agregar",
    remove: "Quitar",
    files: "archivos",
    missing: "No encontrado",
    relocate: "Relocalizar…",
  },
  preview: {
    title: "Vista Previa",
    placeholder: "Seleccioná un elemento de la lista",
    placeholderHint: "o usá la pestaña Biblia para buscar versículos",
  },
  bible: {
    title: "Biblia",
    version: "Versión",
    import: "+ Importar",
    book: "Libro...",
    chapter: "Cap...",
    showChapter: "Mostrar Capítulo",
    search: "Buscar…",
    empty: "Buscá un versículo",
    emptyHint: "Seleccioná libro y capítulo",
    previous: "Anterior",
    next: "Siguiente",
    addToList: "Agregar a Lista",
  },
  live: { title: "En Vivo", disconnected: "Desconectado", noSignal: "Sin señal" },
  footer: { black: "NEGRO", logo: "LOGO", present: "EN VIVO", stop: "DETENER" },
  services: {
    title: "Servicios",
    save: "Guardar culto",
    saveAs: "Guardar como…",
    open: "Abrir",
    duplicate: "Duplicar",
    delete: "Eliminar",
    name: "Nombre del culto",
    empty: "No hay cultos guardados",
  },
  settings: {
    title: "Configuración",
    theme: "Tema",
    themeDark: "Oscuro",
    themeLight: "Claro",
  },
  common: { cancel: "Cancelar", confirm: "Confirmar", save: "Guardar", delete: "Eliminar" },
};

export default es;
export type Messages = typeof es;
