export const UNAVAILABLE = 'Comments are unavailable right now.';

export class Failure extends Error {
  constructor(status, code, message = UNAVAILABLE, pause = 0) {
    super(code);
    this.status = status;
    this.code = code;
    this.publicMessage = message;
    this.pause = pause;
  }
}
