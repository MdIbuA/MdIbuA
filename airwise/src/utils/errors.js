'use strict';

/** An error whose message is safe to show to API clients. */
class AppError extends Error {
  constructor(message, status = 400, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.details = details;
  }
}

module.exports = { AppError };
