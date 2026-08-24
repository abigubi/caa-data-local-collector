import { EventEmitter } from "node:events";

class StatusBus extends EventEmitter {
  constructor() {
    super();
    this.current = { state: "idle", message: "Local collector is ready.", at: new Date().toISOString() };
  }

  update(message, details = {}) {
    this.current = { ...this.current, ...details, message, at: new Date().toISOString() };
    this.emit("status", this.current);
    return this.current;
  }
}

export const statusBus = new StatusBus();
