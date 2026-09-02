/**
 * Envuelve un handler async de Express para que las excepciones caigan
 * automáticamente en next(err) en vez de tener que poner try/catch en cada ruta.
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
