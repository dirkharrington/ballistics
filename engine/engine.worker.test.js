'use strict';

jest.mock('./worker-core.js', () => ({
  bootstrap: jest.fn(),
}));

const workerCore = require('./worker-core.js');

test('engine.worker.js calls bootstrap with self', () => {
  require('./engine.worker.js');
  expect(workerCore.bootstrap).toHaveBeenCalledTimes(1);
  expect(workerCore.bootstrap).toHaveBeenCalledWith(self);
});
