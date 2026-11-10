'use strict';

class WasmUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WasmUnavailableError';
  }
}

class BallisticsEngineError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BallisticsEngineError';
  }
}

const initEngine = jest.fn();
const computeTrajectory = jest.fn();
const createEngineWorker = jest.fn(() => null);

module.exports = {
  WasmUnavailableError,
  BallisticsEngineError,
  initEngine,
  computeTrajectory,
  createEngineWorker,
};
