import { getMongoDb } from './mongo-client.js'
import { publishTaskLog } from '../realtime/task-events.js'

const COLLECTION = 'acat-read-book-crawler-log'
let indexReady

async function collection() {
  const db = await getMongoDb()
  const value = db.collection(COLLECTION)
  indexReady ||= Promise.all([
    value.createIndex({ taskId: 1, createdAt: -1 }),
    value.createIndex({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 }),
  ])
  await indexReady
  return value
}

export async function appendTaskLog(taskId, level, message) {
  const log = { taskId, level, message, time: new Date().toISOString(), createdAt: new Date() }
  publishTaskLog(log)
  try {
    await (await collection()).insertOne(log)
  } catch (error) {
    console.error(`[TaskLog] MongoDB 写入失败: ${error.message}`)
  }
  return log
}

export async function listTaskLogs(taskId, { before, limit = 200 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500)
  const filter = { taskId }
  if (before) filter.createdAt = { $lt: new Date(before) }
  const rows = await (await collection()).find(filter).sort({ createdAt: -1 }).limit(safeLimit + 1).toArray()
  const hasMore = rows.length > safeLimit
  return {
    list: rows.slice(0, safeLimit).reverse().map(({ _id, createdAt, ...row }) => row),
    hasMore,
    nextBefore: hasMore ? rows[safeLimit - 1].createdAt.toISOString() : null,
  }
}
