import { EventEmitter } from 'node:events'

const emitter = new EventEmitter()
emitter.setMaxListeners(200)

export function publishTaskEvent(event) {
  emitter.emit('task', event)
}

export function subscribeTaskEvents(listener) {
  emitter.on('task', listener)
  return () => emitter.off('task', listener)
}

export function publishTaskLog(log) {
  emitter.emit(`log:${log.taskId}`, log)
}

export function subscribeTaskLogs(taskId, listener) {
  const eventName = `log:${taskId}`
  emitter.on(eventName, listener)
  return () => emitter.off(eventName, listener)
}
