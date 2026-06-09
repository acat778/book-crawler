import { MongoClient } from 'mongodb';
import config from '../config.js';

/** @type {MongoClient} */
let client = null;
/** @type {import('mongodb').Db} */
let db = null;

/**
 * 获取 MongoDB 数据库实例
 */
export async function getDb() {
  if (!client) {
    const uri = `mongodb://${config.mongodb.host}:${config.mongodb.port}`;
    client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });
    await client.connect();
    db = client.db(config.mongodb.database);
    console.log(`[MongoDB] 已连接: ${config.mongodb.host}:${config.mongodb.port}/${config.mongodb.database}`);
  }
  return db;
}

/**
 * 保存章节段落到 paragraphs 集合
 * @param {number} bookId
 * @param {number} chapterId
 * @param {string[]} paragraphs
 */
export async function saveParagraphs(bookId, chapterId, paragraphs) {
  const database = await getDb();
  const col = database.collection('paragraphs');

  // 先删除旧数据
  await col.deleteMany({ bookId, chapterId });

  // 插入新数据
  await col.insertOne({ bookId, chapterId, paragraphs });
}

/**
 * 查询某书籍的段落文档数量
 * @param {number} bookId
 */
export async function countByBookId(bookId) {
  const database = await getDb();
  return database.collection('paragraphs').countDocuments({ bookId });
}

/**
 * 查询某章节的段落
 * @param {number} bookId
 * @param {number} chapterId
 */
export async function getParagraphs(bookId, chapterId) {
  const database = await getDb();
  return database.collection('paragraphs').findOne({ bookId, chapterId });
}

/**
 * 测试 MongoDB 连接
 */
export async function testConnection() {
  const database = await getDb();
  await database.command({ ping: 1 });
  return true;
}
