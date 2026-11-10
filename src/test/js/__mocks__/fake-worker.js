'use strict';

class FakeWorker {
  constructor() {
    this.sent = [];
    this.responder = null;
    this._listeners = {};
    this.terminate = jest.fn();
  }

  postMessage(msg) {
    this.sent.push(msg);
    if (this.responder) {
      this.responder(msg, this);
    }
  }

  emit(data) {
    const handlers = this._listeners['message'] || [];
    handlers.forEach(h => h({ data }));
  }

  emitError() {
    const handlers = this._listeners['error'] || [];
    handlers.forEach(h => h(new ErrorEvent('error')));
  }

  emitMessageError() {
    const handlers = this._listeners['messageerror'] || [];
    handlers.forEach(h => h(new MessageEvent('messageerror')));
  }

  addEventListener(type, handler) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(handler);
  }

  removeEventListener(type, handler) {
    if (!this._listeners[type]) return;
    this._listeners[type] = this._listeners[type].filter(h => h !== handler);
  }

  static bridge(workerCoreModule) {
    const fw = new FakeWorker();
    const scope = {
      postMessage: (msg) => fw.emit(msg),
      addEventListener: (type, handler) => fw.addEventListener(type, handler),
      removeEventListener: (type, handler) => fw.removeEventListener(type, handler),
      close: jest.fn(),
    };
    workerCoreModule.bootstrap(scope);
    fw._scope = scope;
    return { fw, scope };
  }
}

module.exports = { FakeWorker };
