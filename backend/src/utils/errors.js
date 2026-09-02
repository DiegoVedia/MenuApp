export class ApiError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class NotFoundError extends ApiError {
  constructor(message = 'Recurso no encontrado') {
    super(404, message);
  }
}

export class BadRequestError extends ApiError {
  constructor(message = 'Solicitud inválida', details) {
    super(400, message, details);
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = 'No autorizado') {
    super(401, message);
  }
}

export class ConflictError extends ApiError {
  constructor(message = 'Conflicto con el estado actual del recurso') {
    super(409, message);
  }
}
