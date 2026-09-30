/** Lo que se le muestra a un error de negocio, no de sistema. */
export class BusinessError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
    this.name = 'BusinessError';
  }
}
